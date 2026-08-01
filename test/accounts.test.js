'use strict';

// Unit tests for the expense-account access rules (who may charge to what) and
// the fund → category series check. Pure functions — run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  accountVisibleTo, visibleExpenseAccounts,
  categoriesForExpenseAccount, isCategoryAllowedForAccount,
} = require('../netlify/functions/lib/domain');
const {
  isValidCategoryForSeries, CATEGORIES_8, categoriesForSeries,
} = require('../netlify/functions/lib/coding');

const open = { code: '010000', name: 'General Fund', series: '7', active: true, allowedStaffIds: [] };
const mels = { code: '002060', name: 'Mel & Amy Ellenwood', series: '8', active: true, allowedStaffIds: ['recMel'] };
const retired = { code: '999999', name: 'Old Fund', series: '8', active: false, allowedStaffIds: [] };

test('accountVisibleTo: an unassigned account is open to everyone', () => {
  assert.equal(accountVisibleTo(open, 'recAnyone', false), true);
  assert.equal(accountVisibleTo(open, null, false), true);
});

test('accountVisibleTo: an assigned account is limited to the people on it', () => {
  assert.equal(accountVisibleTo(mels, 'recMel', false), true);
  assert.equal(accountVisibleTo(mels, 'recSomeoneElse', false), false);
});

test('accountVisibleTo: Finance may charge to any active account', () => {
  assert.equal(accountVisibleTo(mels, 'recSomeoneElse', true), true);
});

test('accountVisibleTo: a retired account is off-limits to everyone, even Finance', () => {
  assert.equal(accountVisibleTo(retired, 'recAnyone', true), false);
});

test('visibleExpenseAccounts: a normal person sees open + their own, not others’', () => {
  const all = [open, mels, retired];
  const codes = visibleExpenseAccounts(all, 'recMel', 'Staff').map((a) => a.code);
  assert.deepEqual(codes.sort(), ['002060', '010000']); // no retired, no others' accounts
});

test('visibleExpenseAccounts: Finance sees every active account', () => {
  const all = [open, mels, retired];
  const codes = visibleExpenseAccounts(all, 'recFinance', 'Finance').map((a) => a.code);
  assert.deepEqual(codes.sort(), ['002060', '010000']); // both active ones, still no retired
});

test('categoriesForExpenseAccount: no subset = the whole series list', () => {
  const acct = { series: '8', categoryCodes: [] };
  assert.equal(categoriesForExpenseAccount(acct).length, CATEGORIES_8.length);
});

test('categoriesForExpenseAccount: a subset limits to just those codes', () => {
  const first = CATEGORIES_8[0].code;
  const acct = { series: '8', categoryCodes: [first] };
  const list = categoriesForExpenseAccount(acct);
  assert.equal(list.length, 1);
  assert.equal(list[0].code, first);
});

test('categoriesForExpenseAccount: a subset is still intersected with the series', () => {
  // A stale/foreign code in the subset can never leak a wrong-series category.
  const acct = { series: '8', categoryCodes: ['not-a-real-code'] };
  assert.equal(categoriesForExpenseAccount(acct).length, 0);
});

test('isCategoryAllowedForAccount: honours the subset, allows anything when unset', () => {
  const only = CATEGORIES_8[0].code;
  const other = CATEGORIES_8[1] && CATEGORIES_8[1].code;
  const restricted = { series: '8', categoryCodes: [only] };
  assert.equal(isCategoryAllowedForAccount(restricted, only), true);
  if (other) assert.equal(isCategoryAllowedForAccount(restricted, other), false);
  const openAcct = { series: '8', categoryCodes: [] };
  assert.equal(isCategoryAllowedForAccount(openAcct, only), true);
  if (other) assert.equal(isCategoryAllowedForAccount(openAcct, other), true);
});

test('isValidCategoryForSeries: General Fund (7) and standard (8) accept different codes', () => {
  // 7-series categories belong to the General Fund; 8-series to everything else.
  assert.equal(isValidCategoryForSeries('7', '7000000'), false); // not a real code, sanity
  // A category that is in the 8-series list should validate for series 8 and not 7.
  const { CATEGORIES_8, CATEGORIES_7 } = require('../netlify/functions/lib/coding');
  if (CATEGORIES_8.length) {
    const c8 = CATEGORIES_8[0].code;
    assert.equal(isValidCategoryForSeries('8', c8), true);
    assert.equal(isValidCategoryForSeries('7', c8), CATEGORIES_7.some((x) => x.code === c8));
  }
});
