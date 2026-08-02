'use strict';

// Set the reimbursement deadline (days a person has to submit an expense).
// Finance only. The current value is served via /options.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { ensureStaff, setReportDeadlineDays } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);
    if (role !== 'Finance') {
      const err = new Error('Only Finance can change the deadline.');
      err.statusCode = 403;
      throw err;
    }

    const body = parseBody(event);
    const value = Number(body.value);
    if (!isFinite(value) || value < 1) {
      const err = new Error('Enter a number of days (at least 1).');
      err.statusCode = 400;
      throw err;
    }

    const saved = await setReportDeadlineDays(value);
    return ok({ reportDeadlineDays: saved });
  } catch (err) {
    return error(err);
  }
};
