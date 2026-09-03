'use strict';

// Approve or send back (reject) a submitted expense. Approver / Finance only.
// "Send back" maps to the base's "Rejected" status plus an Approver Note so the
// submitter sees why and can fix + resubmit.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, STATUS, EVENTS, ensureStaff, isApprover, approverScopeAllows, displayMaps, shapeExpense, logActivity } = require('./lib/domain');
const notify = require('./lib/notify');

const today = () => new Date().toISOString().slice(0, 10);

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

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
    const id = String(body.id || '').trim();
    const decision = String(body.decision || '').trim().toLowerCase();
    const note = String(body.note || '').trim();

    if (!id) throw badRequest('Missing the expense id.');
    if (decision !== 'approve' && decision !== 'sendback') {
      throw badRequest('Decision must be "approve" or "sendback".');
    }
    if (decision === 'sendback' && !note) {
      throw badRequest('Please add a short note so they know what to fix.');
    }

    // Only act on records still awaiting a decision.
    const current = await airtable.findFirst(TABLES.EXPENSES, {
      filterByFormula: `RECORD_ID() = '${id.replace(/'/g, "\\'")}'`,
    });
    if (!current) throw badRequest('That expense no longer exists.');
    if ((current.fields && current.fields.Status) !== STATUS.SUBMITTED) {
      const err = new Error('That expense was already decided by someone else.');
      err.statusCode = 409;
      throw err;
    }
    // An approver (not Finance) may only decide on people who report to them —
    // the same team boundary the Review queue already shows them.
    if (!(await approverScopeAllows(current.fields, role, approverId))) {
      const err = new Error('That expense isn’t from someone who reports to you.');
      err.statusCode = 403;
      throw err;
    }

    const fields = {
      Status: decision === 'approve' ? STATUS.APPROVED : STATUS.REJECTED,
      'Decided On': today(),
      Approver: [approverId],
    };
    if (note) fields['Approver Note'] = note;

    // If this expense rode in on a missing-receipt affidavit, the approver is
    // also signing off on that: approving approves it; sending back denies it.
    const affStatus = current.fields && current.fields['Affidavit Status'];
    const affStatusName = affStatus && (affStatus.name || affStatus);
    const hasPendingAffidavit = current.fields && current.fields['Missing Receipt'] && affStatusName !== 'Approved';
    if (hasPendingAffidavit) {
      fields['Affidavit Status'] = decision === 'approve' ? 'Approved' : 'Denied';
    }

    const [updated, maps] = await Promise.all([
      airtable.updateRecord(TABLES.EXPENSES, id, fields),
      displayMaps(),
    ]);
    await logActivity({
      expenseId: id,
      event: decision === 'approve' ? EVENTS.APPROVED : EVENTS.SENT_BACK,
      user,
      note,
    });
    if (decision === 'approve' && hasPendingAffidavit) {
      await logActivity({ expenseId: id, event: EVENTS.AFFIDAVIT_APPROVED, user });
    }

    const shaped = shapeExpense(updated, maps);
    try {
      const submitter = { email: shaped.submitterEmail, name: shaped.submitterName };
      if (decision === 'approve') await notify.submitterApproved({ submitter, expense: shaped });
      else await notify.submitterSentBack({ submitter, expense: shaped, note });
    } catch (e) {
      console.error('[rembly] decision notify failed', e && e.message);
    }

    return ok({ expense: shaped });
  } catch (err) {
    return error(err);
  }
};
