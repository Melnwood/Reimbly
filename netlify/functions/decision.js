'use strict';

// Approve or send back a submitted expense. Approver / Finance only.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { EXPENSES_TABLE, ensureStaff, isApprover, shapeExpense } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);
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

    // Only act on records that are still awaiting a decision.
    const current = await airtable.findFirst(EXPENSES_TABLE, {
      filterByFormula: `RECORD_ID() = '${id.replace(/'/g, "\\'")}'`,
    });
    if (!current) throw badRequest('That expense no longer exists.');
    if ((current.fields && current.fields.Status) !== 'Submitted') {
      const err = new Error('That expense was already decided by someone else.');
      err.statusCode = 409;
      throw err;
    }

    const fields = {
      Status: decision === 'approve' ? 'Approved' : 'Sent Back',
      'Decided On': new Date().toISOString(),
      'Decided By': user.email,
    };
    if (note) fields.Notes = note;

    const updated = await airtable.updateRecord(EXPENSES_TABLE, id, fields);
    return ok({ expense: shapeExpense(updated) });
  } catch (err) {
    return error(err);
  }
};

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}
