'use strict';

// Everything waiting for a decision. Approver / Finance only.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { EXPENSES_TABLE, ensureStaff, isApprover, shapeExpense } = require('./lib/domain');

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

    const records = await airtable.listRecords(EXPENSES_TABLE, {
      filterByFormula: `{Status} = 'Submitted'`,
      'sort[0][field]': 'Submitted On',
      'sort[0][direction]': 'asc',
    });

    return ok({ expenses: records.map(shapeExpense), role });
  } catch (err) {
    return error(err);
  }
};
