'use strict';

// The activity trail for a single expense. The submitter can see their own
// expense's history; approvers and finance can see any. GET ?id=recXXexpense.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const {
  ensureStaff,
  isApprover,
  getExpenseById,
  displayMaps,
  shapeExpense,
  listActivity,
} = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);

    const id = String((event.queryStringParameters && event.queryStringParameters.id) || '').trim();
    if (!id) {
      const err = new Error('Missing the expense id.');
      err.statusCode = 400;
      throw err;
    }

    const record = await getExpenseById(id);
    if (!record) {
      const err = new Error('That expense no longer exists.');
      err.statusCode = 404;
      throw err;
    }

    // Owners see their own trail; approvers/finance see everyone's.
    if (!isApprover(role)) {
      const maps = await displayMaps();
      const shaped = shapeExpense(record, maps);
      if ((shaped.submitterEmail || '').toLowerCase() !== user.email.toLowerCase()) {
        const err = new Error('You can only see the history of your own expenses.');
        err.statusCode = 403;
        throw err;
      }
    }

    const activity = await listActivity(id);
    return ok({ activity });
  } catch (err) {
    return error(err);
  }
};
