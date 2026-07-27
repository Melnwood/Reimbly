'use strict';

// Form options that come from the base so the app stays in sync without a
// redeploy — currently the chart of accounts for the Account picker.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { accountAccessFor, listMileageRates } = require('./lib/domain');
const { CATEGORY_SETS, GENERAL_FUND_ACCOUNT_CODE } = require('./lib/categories');

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
    // The GL expense-category lists for the picker: General Fund uses the
    // 7-series, every other account the 8-series. The browser shows the set that
    // matches the account the person picks.
    return ok({ accounts, mileageRates, categorySets: CATEGORY_SETS, generalFundCode: GENERAL_FUND_ACCOUNT_CODE });
  } catch (err) {
    return error(err);
  }
};
