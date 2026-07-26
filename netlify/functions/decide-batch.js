'use strict';

// Decide a whole report at once (one person's submitted expenses) — approve them
// all, or send them all back with a note. Approver / Finance only. Only Submitted
// expenses are touched; anything else is skipped, so it's safe to click twice.
//
// Like the single decision, this also resolves a missing-receipt affidavit riding
// on an expense: approving approves the affidavit, sending back denies it. Each
// affected person gets one notification for the whole batch.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, STATUS, EVENTS, ensureStaff, isApprover, displayMaps, shapeExpense, logActivity,
} = require('./lib/domain');
const notify = require('./lib/notify');

const today = () => new Date().toISOString().slice(0, 10);
const firstLookup = (v) => (Array.isArray(v) ? v[0] : v);

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role, id: approverId } = await ensureStaff(user);
    if (!isApprover(role)) {
      const err = new Error('You do not have approver access.');
      err.statusCode = 403;
      throw err;
    }

    const body = parseBody(event);
    const ids = Array.isArray(body.ids) ? body.ids.map((v) => String(v).trim()).filter(Boolean) : [];
    const decision = String(body.decision || 'approve').toLowerCase();
    const note = String(body.note || '').trim();
    if (!ids.length) {
      const err = new Error('No expenses in this report.');
      err.statusCode = 400;
      throw err;
    }
    if (decision !== 'approve' && decision !== 'sendback') {
      const err = new Error('Batch action must be "approve" or "sendback".');
      err.statusCode = 400;
      throw err;
    }
    if (decision === 'sendback' && !note) {
      const err = new Error('Please add a short note so they know what to fix.');
      err.statusCode = 400;
      throw err;
    }

    const approving = decision === 'approve';
    let decided = 0;
    const skipped = [];
    const perSubmitter = new Map(); // email -> { count, totalUsd, sampleRec }

    for (const id of ids) {
      const rec = await airtable.findFirst(TABLES.EXPENSES, {
        filterByFormula: `RECORD_ID() = '${id.replace(/'/g, "\\'")}'`,
      });
      if (!rec || (rec.fields && rec.fields.Status) !== STATUS.SUBMITTED) {
        skipped.push(id); // already decided or gone — leave it alone
        continue;
      }

      const fields = {
        Status: approving ? STATUS.APPROVED : STATUS.REJECTED,
        'Decided On': today(),
        Approver: [approverId],
      };
      if (note) fields['Approver Note'] = note;

      // Resolve a pending missing-receipt affidavit alongside the decision.
      const affStatus = rec.fields && rec.fields['Affidavit Status'];
      const affStatusName = affStatus && (affStatus.name || affStatus);
      const hasPendingAffidavit = rec.fields && rec.fields['Missing Receipt'] && affStatusName !== 'Approved';
      if (hasPendingAffidavit) fields['Affidavit Status'] = approving ? 'Approved' : 'Denied';

      await airtable.updateRecord(TABLES.EXPENSES, id, fields);
      await logActivity({ expenseId: id, event: approving ? EVENTS.APPROVED : EVENTS.SENT_BACK, user, note });
      if (approving && hasPendingAffidavit) {
        await logActivity({ expenseId: id, event: EVENTS.AFFIDAVIT_APPROVED, user });
      }
      decided += 1;

      const email = (firstLookup(rec.fields['Submitter Email']) || '').toLowerCase();
      if (email) {
        const g = perSubmitter.get(email) || { count: 0, totalUsd: 0, sampleRec: rec };
        g.count += 1;
        g.totalUsd += Number(rec.fields['Amount (USD)']) || 0;
        perSubmitter.set(email, g);
      }
    }

    // One notification per person for the whole batch (best-effort).
    try {
      const maps = decision === 'sendback' ? await displayMaps() : null;
      for (const [email, g] of perSubmitter) {
        if (approving) {
          await notify.submitterApproved({ submitter: { email }, count: g.count, totalUsd: g.totalUsd });
        } else {
          const expense = shapeExpense(g.sampleRec, maps);
          await notify.submitterSentBack({ submitter: { email, name: expense.submitterName }, expense, note });
        }
      }
    } catch (e) {
      console.error('[rembly] batch notify failed', e && e.message);
    }

    return ok({ approved: approving ? decided : 0, sentBack: approving ? 0 : decided, decided, skipped });
  } catch (err) {
    return error(err);
  }
};
