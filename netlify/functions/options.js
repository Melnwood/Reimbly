'use strict';

// Form options that come from the base so the app stays in sync without a
// redeploy — currently the chart of accounts for the Account picker.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { accountAccessFor, listMileageRates } = require('./lib/domain');
const { ACCOUNTS, CATEGORIES_7, CATEGORIES_8, GENERAL_FUND_CODE } = require('./lib/coding');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const [access, mileageRates] = await Promise.all([accountAccessFor(user.email), listMileageRates()]);
    // The old "accounts" list is the base's GL-code table (the app's original
    // single picker). Kept for the category picker until the two-level flow lands.
    const accounts = access.accounts
      .filter((a) => access.visibleIds.has(a.id))
      .map((a) => ({ id: a.id, code: a.code, name: a.name }));
    // The ExpenseWire two-level coding: pick an Expense Account, then a Category.
    // General Fund uses the 7-series categories; every other account the 8-series.
    return ok({
      accounts,
      mileageRates,
      expenseAccounts: ACCOUNTS,
      categories7: CATEGORIES_7,
      categories8: CATEGORIES_8,
      generalFundCode: GENERAL_FUND_CODE,
    });
  } catch (err) {
    return error(err);
  }
};
