'use strict';

// Submit a batch of the signed-in person's own Unsubmitted (Draft) expenses for
// approval — the "Submit all" action on My expenses. Only the owner's own
// drafts are touched; held email receipts and anything already in the pipeline
// are skipped. The upline approver gets one heads-up for the whole batch.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, STATUS, EVENTS,
  ensureStaff, isHeldEmailReceipt, sourceOf, logActivity, staffById, isExpenseReady, getReceiptThresholdUsd,
} = require('./lib/domain');
const notify = require('./lib/notify');

const today = () => new Date().toISOString().slice(0, 10);
const firstLookup = (v) => (Array.isArray(v) ? v[0] : v);
const emailOf = (f) => String(firstLookup(f['Submitter Email']) || '').toLowerCase();

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { id: staffId, record: staffRec } = await ensureStaff(user);
    const me = user.email.toLowerCase();

    const body = parseBody(event);
    const wantAll = body.all === true;
    const ids = Array.isArray(body.ids) ? body.ids.map((v) => String(v).trim()).filter(Boolean) : [];
    if (!wantAll && !ids.length) {
      const err = new Error('Nothing selected to submit.');
      err.statusCode = 400;
      throw err;
    }

    // Gather the candidate records. "all" pulls every one of my Drafts; otherwise
    // just the ones asked for (still filtered to my own drafts below).
    let candidates;
    if (wantAll) {
      const meEsc = me.replace(/'/g, "\\'");
      candidates = await airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: `AND(LOWER(ARRAYJOIN({Submitter Email})) = '${meEsc}', {Status} = '${STATUS.DRAFT}')`,
      });
    } else {
      candidates = [];
      for (const id of ids) {
        const rec = await airtable.findFirst(TABLES.EXPENSES, {
          filterByFormula: `RECORD_ID() = '${id.replace(/'/g, "\\'")}'`,
        });
        if (rec) candidates.push(rec);
      }
    }

    const receiptLimit = await getReceiptThresholdUsd();
    let submitted = 0;
    let totalUsd = 0;
    let heldForReceipt = 0;
    const skipped = [];
    for (const rec of candidates) {
      const f = rec.fields || {};
      // Only my own, only unsubmitted, never a held email receipt.
      if (emailOf(f) !== me) { skipped.push(rec.id); continue; }
      if ((f.Status || '') !== STATUS.DRAFT || isHeldEmailReceipt(f)) { skipped.push(rec.id); continue; }
      // Readiness gate: hold back anything not ready (no receipt/declaration, no
      // account, or a missing field).
      if (!isExpenseReady(f, receiptLimit)) { skipped.push(rec.id); heldForReceipt += 1; continue; }

      await airtable.updateRecord(TABLES.EXPENSES, rec.id, {
        Status: STATUS.SUBMITTED,
        'Submitted On': today(),
      });
      await logActivity({ expenseId: rec.id, event: EVENTS.SUBMITTED, user, note: `Submitted from ${sourceOf(f)}` });
      submitted += 1;
      totalUsd += Number(f['Amount (USD)']) || 0;
    }

    // One heads-up to the upline approver for the whole batch (best-effort).
    if (submitted) {
      try {
        const uplineId = Array.isArray(staffRec.fields && staffRec.fields.Upline) ? staffRec.fields.Upline[0] : null;
        if (uplineId) {
          const approver = await staffById(uplineId);
          await notify.approverNewExpenses({ approver, submitterName: user.name, count: submitted, totalUsd });
        }
      } catch (e) {
        console.error('[rembly] submit-batch notify failed', e && e.message);
      }
    }

    const warning = heldForReceipt
      ? `${heldForReceipt} expense${heldForReceipt === 1 ? ' was' : 's were'} held back — ${heldForReceipt === 1 ? 'it needs' : 'they need'} an account, a receipt (or a “no receipt” note), or a missing field first.`
      : null;
    return ok({ submitted, skipped, heldForReceipt, warning });
  } catch (err) {
    return error(err);
  }
};
