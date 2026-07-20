'use strict';

// Form options that come from the base so the app stays in sync without a
// redeploy — currently the chart of accounts for the Account picker.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { listAccounts, listMileageRates } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    await verifyRequest(event.headers);
    const [accounts, mileageRates] = await Promise.all([listAccounts(), listMileageRates()]);
    return ok({ accounts, mileageRates });
  } catch (err) {
    return error(err);
  }
};
