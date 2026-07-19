'use strict';

// The signed-in person's own expenses, newest first. We match on the
// "Submitter Email" lookup (populated from the linked Staff record).

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, displayMaps, shapeExpense } = require('./lib/domain');

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

    return ok({ expenses: records.map((r) => shapeExpense(r, maps)) });
  } catch (err) {
    return error(err);
  }
};
