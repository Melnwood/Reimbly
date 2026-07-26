'use strict';

// The signed-in person's own expenses, newest first. We match on the
// "Submitter Email" lookup (populated from the linked Staff record).

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, displayMaps, shapeExpense, isHeldEmailReceipt,
  ensureStaff, householdScope, submitterEmailFormula,
} = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    // Pool the whole household's expenses — a couple sees and manages one list.
    const { record } = await ensureStaff(user);
    const { emails } = await householdScope(record);
    const formula = submitterEmailFormula(emails.length ? emails : [user.email.toLowerCase()]);

    const [records, maps] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: formula,
        'sort[0][field]': 'Submitted On',
        'sort[0][direction]': 'desc',
      }),
      displayMaps(),
    ]);

    // Held email receipts (Drafts waiting in the inbox) aren't real expenses —
    // they belong on the Import screen, not in the person's expense list.
    const expenses = records
      .filter((r) => !isHeldEmailReceipt(r.fields))
      .map((r) => shapeExpense(r, maps));
    return ok({ expenses });
  } catch (err) {
    return error(err);
  }
};
