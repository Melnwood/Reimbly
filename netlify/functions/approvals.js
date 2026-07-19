'use strict';

// Everything waiting for a decision. Approver / Finance only.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, STATUS, ensureStaff, isApprover, displayMaps, shapeExpense } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);
    if (!isApprover(role)) {
      const err = new Error('You do not have approver access.');
      err.statusCode = 403;
      throw err;
    }

    const [records, maps] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: `{Status} = '${STATUS.SUBMITTED}'`,
        'sort[0][field]': 'Submitted On',
        'sort[0][direction]': 'asc',
      }),
      displayMaps(),
    ]);

    return ok({ expenses: records.map((r) => shapeExpense(r, maps)), role });
  } catch (err) {
    return error(err);
  }
};
