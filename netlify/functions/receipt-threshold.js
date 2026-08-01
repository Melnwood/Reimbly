'use strict';

// Set the org's receipt-free limit (USD): expenses at or under this amount need
// no receipt. Finance only. The current value is served via /options.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { ensureStaff, setReceiptThresholdUsd } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);
    if (role !== 'Finance') {
      const err = new Error('Only Finance can change the receipt-free limit.');
      err.statusCode = 403;
      throw err;
    }

    const body = parseBody(event);
    const value = Number(body.value);
    if (!isFinite(value) || value < 0) {
      const err = new Error('Enter a dollar amount of $0 or more.');
      err.statusCode = 400;
      throw err;
    }

    const saved = await setReceiptThresholdUsd(value);
    return ok({ receiptThresholdUsd: saved });
  } catch (err) {
    return error(err);
  }
};
