'use strict';

// Form options that come from the base so the app stays in sync without a
// redeploy — currently the chart of accounts for the Account picker.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { accountAccessFor, listMileageRates } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const [access, mileageRates] = await Promise.all([accountAccessFor(user.email), listMileageRates()]);
    // Only the accounts this person may charge to (restricted funds are hidden
    // unless granted to them).
    const accounts = access.accounts
      .filter((a) => access.visibleIds.has(a.id))
      .map((a) => ({ id: a.id, code: a.code, name: a.name }));
    return ok({ accounts, mileageRates });
  } catch (err) {
    return error(err);
  }
};
