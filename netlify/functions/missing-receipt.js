'use strict';

// Declare a missing receipt. When a receipt truly isn't available (common in
// Central & Eastern Europe), the person fills in the expense as usual and signs
// an affidavit — an attestation that the expense is true and correct. It lands
// as "Pending" and an approver signs off on it when they approve the expense.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, EVENTS,
  ensureStaff, householdScope, getExpenseById, canModify,
  displayMaps, shapeExpense, logActivity,
} = require('./lib/domain');

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
    const { role, record: staffRec } = await ensureStaff(user);
    const { emails: householdEmails } = await householdScope(staffRec);
    const body = parseBody(event);

    const id = String(body.id || '').trim();
    if (!id) throw badRequest('Missing the expense id.');
    const reason = String(body.reason || '').trim();
    if (!reason) throw badRequest('Please say why a receipt isn’t available.');
    if (body.agree !== true) throw badRequest('Please sign the statement to confirm it’s true.');

    const current = await getExpenseById(id);
    if (!current) throw badRequest('That expense no longer exists.');
    if (!canModify(current, user, role, householdEmails)) {
      const err = new Error('You can only declare this for your own household’s expenses before they’re approved.');
      err.statusCode = 403;
      throw err;
    }

    await airtable.updateRecord(TABLES.EXPENSES, id, {
      'Missing Receipt': true,
      'Affidavit Reason': reason,
      'Affidavit Signed By': user.name || user.email,
      'Affidavit Signed On': today(),
      'Affidavit Status': 'Pending',
      // A signed affidavit stands in for the receipt — clear any stray blank.
      Receipt: [],
    });

    await logActivity({
      expenseId: id,
      event: EVENTS.AFFIDAVIT_SIGNED,
      user,
      note: `“${reason}” — signed by ${user.name || user.email}`,
    });

    const [fresh, maps] = await Promise.all([getExpenseById(id), displayMaps()]);
    return ok({ expense: shapeExpense(fresh || current, maps) });
  } catch (err) {
    return error(err);
  }
};
