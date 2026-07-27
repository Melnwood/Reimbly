'use strict';

// Unit tests for the account → category-set rule and code lookups.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CATEGORY_SETS, categorySetKey, categoriesForAccount, isValidCategoryCode, categoryName,
} = require('../netlify/functions/lib/categories');

const real = (cats) => cats.filter((c) => c.code !== '0000000'); // drop the placeholder

test('General Fund (010000) uses the 7-series; every other account the 8-series', () => {
  assert.equal(categorySetKey('010000'), 'general');
  assert.equal(categorySetKey('002060'), 'standard');
  assert.equal(categorySetKey(''), 'standard');
  assert.ok(real(categoriesForAccount('010000')).every((c) => c.code.startsWith('7')));
  assert.ok(real(categoriesForAccount('002060')).every((c) => c.code.startsWith('8')));
});

test('"Expense Code Needed" is a valid choice for every account', () => {
  assert.equal(isValidCategoryCode('010000', '0000000'), true);
  assert.equal(isValidCategoryCode('002060', '0000000'), true);
  assert.equal(categoryName('0000000'), 'Expense Code Needed');
  // It sorts to the top of each list.
  assert.equal(categoriesForAccount('010000')[0].code, '0000000');
});

test('isValidCategoryCode enforces the account\'s own set', () => {
  // 7412101 is a General Fund code; 8393000 is a ministry code.
  assert.equal(isValidCategoryCode('010000', '7412101'), true);
  assert.equal(isValidCategoryCode('010000', '8393000'), false);
  assert.equal(isValidCategoryCode('002060', '8393000'), true);
  assert.equal(isValidCategoryCode('002060', '7412101'), false);
});

test('same-named codes stay distinct across sets', () => {
  // "Credit Card Fees" exists in both series under different codes.
  assert.equal(categoryName('7111200'), 'Credit Card Fees');
  assert.equal(categoryName('8220000'), 'Credit Card Fees');
  assert.notEqual('7111200', '8220000');
});

test('categoryName returns empty for an unknown code', () => {
  assert.equal(categoryName('9999999'), '');
});

test('both sets are non-empty', () => {
  assert.ok(CATEGORY_SETS.general.length > 0);
  assert.ok(CATEGORY_SETS.standard.length > 0);
});
