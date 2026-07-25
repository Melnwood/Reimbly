'use strict';

// The signed-in person's own expenses, newest first. We match on the
// "Submitter Email" lookup (populated from the linked Staff record).

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, displayMaps, shapeExpense, isHeldEmailReceipt } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const email = user.email.toLowerCase().replace(/'/g, "\\'");

    const [records, maps] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: `LOWER(ARRAYJOIN({Submitter Email})) = '${email}'`,
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
