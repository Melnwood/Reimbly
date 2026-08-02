'use strict';

// Form options that come from the base so the app stays in sync without a
// redeploy — currently the chart of accounts for the Account picker.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const {
  ensureStaff, accountAccessFor, listMileageRates,
  listExpenseAccounts, visibleExpenseAccounts, getReceiptThresholdUsd, getReportDeadlineDays,
} = require('./lib/domain');
const { CATEGORIES_7, CATEGORIES_8, GENERAL_FUND_CODE } = require('./lib/coding');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { id: staffId, role } = await ensureStaff(user);
    const [access, mileageRates, allExpenseAccounts, receiptThresholdUsd, reportDeadlineDays] = await Promise.all([
      accountAccessFor(user.email),
      listMileageRates(),
      listExpenseAccounts(),
      getReceiptThresholdUsd(),
      getReportDeadlineDays(),
    ]);
    // The old "accounts" list is the base's GL-code table (the app's original
    // single picker). Kept for the category picker until the two-level flow lands.
    const accounts = access.accounts
      .filter((a) => access.visibleIds.has(a.id))
      .map((a) => ({ id: a.id, code: a.code, name: a.name }));
    // The ExpenseWire two-level coding: pick an Expense Account, then a Category.
    // General Fund uses the 7-series categories; every other account the 8-series.
    // Only the accounts this person may charge to are sent.
    const expenseAccounts = visibleExpenseAccounts(allExpenseAccounts, staffId, role);
    return ok({
      accounts,
      mileageRates,
      expenseAccounts,
      categories7: CATEGORIES_7,
      categories8: CATEGORIES_8,
      generalFundCode: GENERAL_FUND_CODE,
      receiptThresholdUsd,
      reportDeadlineDays,
      role,
    });
  } catch (err) {
    return error(err);
  }
};
