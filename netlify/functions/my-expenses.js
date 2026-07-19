'use strict';

// The signed-in person's own expenses, newest first.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { EXPENSES_TABLE, shapeExpense } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const email = user.email.replace(/'/g, "\\'");

    const records = await airtable.listRecords(EXPENSES_TABLE, {
      filterByFormula: `LOWER({Submitter Email}) = '${email}'`,
      'sort[0][field]': 'Submitted On',
      'sort[0][direction]': 'desc',
    });

    return ok({ expenses: records.map(shapeExpense) });
  } catch (err) {
    return error(err);
  }
};
