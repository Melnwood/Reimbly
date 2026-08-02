'use strict';

// Turn the "repeats monthly" flag on or off for one expense — the app's
// 🔁 Repeats monthly toggle. Marks it as a subscription template so Reimbly
// pre-creates a fresh draft each month. You can only set it on your own
// household's expenses.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, ensureStaff, householdScope, getExpenseById, canModify,
} = require('./lib/domain');

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
    const { role, record: staffRec } = await ensureStaff(user);
    const { emails: householdEmails } = await householdScope(staffRec);

    const body = parseBody(event);
    const id = String(body.id || '').trim();
    if (!id) throw badRequest('Missing the expense id.');
    const on = body.on === true;

    const current = await getExpenseById(id);
    if (!current) throw badRequest('That expense no longer exists.');
    if (!canModify(current, user, role, householdEmails)) {
      const err = new Error('You can only change your own household’s expenses.');
      err.statusCode = 403;
      throw err;
    }

    await airtable.updateRecord(TABLES.EXPENSES, id, { 'Recurring Monthly': on });
    return ok({ recurringMonthly: on });
  } catch (err) {
    return error(err);
  }
};
