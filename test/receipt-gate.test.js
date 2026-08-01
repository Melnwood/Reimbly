'use strict';

// Unit tests for the receipt gate — what counts as "enough proof of spend" to
// let an expense be submitted. Pure function over raw Airtable fields.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  receiptGatePasses, isMileageExpense, expenseReadinessFields, isExpenseReady,
} = require('../netlify/functions/lib/domain');

test('passes with a receipt attached', () => {
  assert.equal(receiptGatePasses({ Receipt: [{ id: 'att1' }] }), true);
});

test('passes with a complete "no receipt" declaration', () => {
  assert.equal(receiptGatePasses({
    'Missing Receipt': true,
    'Affidavit Reason': 'Vendor gave no receipt',
    'Affidavit Signed By': 'Mel Ellenwood',
  }), true);
});

test('fails with a half-finished declaration (no reason) on an over-$50 expense', () => {
  assert.equal(receiptGatePasses({
    'Amount (USD)': 80,
    'Missing Receipt': true,
    'Affidavit Signed By': 'Mel Ellenwood',
  }), false);
});

test('fails when an over-$50 expense has neither a receipt nor a declaration', () => {
  assert.equal(receiptGatePasses({ Description: 'Hotel', 'Amount (USD)': 120 }), false);
  assert.equal(receiptGatePasses({ 'Amount (USD)': 80, Receipt: [] }), false);
});

// --- the $50 rule: small spends need no receipt at all ---

test('an expense of $50 or less needs no receipt', () => {
  assert.equal(receiptGatePasses({ Description: 'Coffee', 'Amount (USD)': 4.5 }), true);
  assert.equal(receiptGatePasses({ 'Amount (USD)': 50 }), true); // exactly $50 is exempt
  assert.equal(receiptGatePasses({ Amount: 20 }), true); // falls back to plain amount
});

test('just over $50 still needs a receipt', () => {
  assert.equal(receiptGatePasses({ 'Amount (USD)': 50.01 }), false);
});

test('mileage passes with no receipt at all', () => {
  assert.equal(receiptGatePasses({ Distance: 40, 'Mileage Rate': 0.7 }), true);
  assert.equal(receiptGatePasses({ Miles: 12 }), true);
});

test('isMileageExpense: distance/miles/rate mark it as mileage', () => {
  assert.equal(isMileageExpense({ Distance: 5 }), true);
  assert.equal(isMileageExpense({ Miles: 5 }), true);
  assert.equal(isMileageExpense({ 'Mileage Rate': 0.7 }), true);
  assert.equal(isMileageExpense({ Amount: 20 }), false);
});

// --- readiness gate: everything a report needs before it can be submitted ---

const complete = {
  Description: 'Team lunch', Amount: 24.5, 'Expense Date': '2026-07-01',
  Account: ['recAcct1'], Receipt: [{ id: 'att1' }],
};

test('a fully-filled expense is ready', () => {
  assert.deepEqual(expenseReadinessFields(complete), []);
  assert.equal(isExpenseReady(complete), true);
});

test('a missing account blocks readiness (Mel’s case)', () => {
  const noAcct = { ...complete, Account: [] };
  assert.deepEqual(expenseReadinessFields(noAcct), ['account']);
  assert.equal(isExpenseReady(noAcct), false);
});

test('readiness lists every missing piece (over $50, so a receipt too)', () => {
  const bare = { 'Amount (USD)': 120 }; // over $50 but nothing else filled in
  const issues = expenseReadinessFields(bare);
  assert.ok(issues.includes('description'));
  assert.ok(issues.includes('amount'));
  assert.ok(issues.includes('date'));
  assert.ok(issues.includes('account'));
  assert.ok(issues.includes('receipt'));
});

test('a bare small expense still needs its fields, but not a receipt', () => {
  const issues = expenseReadinessFields({ Amount: 0 });
  assert.ok(issues.includes('description'));
  assert.ok(issues.includes('amount'));
  assert.ok(issues.includes('date'));
  assert.ok(issues.includes('account'));
  assert.ok(!issues.includes('receipt')); // $0 ≤ $50 → no receipt required
});

test('a mileage expense with an account is ready without a receipt', () => {
  const mileage = { Description: 'Drive', Amount: 12, 'Expense Date': '2026-07-01', Account: ['recAcct1'], Distance: 20, 'Mileage Rate': 0.6 };
  assert.equal(isExpenseReady(mileage), true);
});

test('a signed "no receipt" note satisfies the receipt part', () => {
  const declared = { ...complete, Receipt: [], 'Missing Receipt': true, 'Affidavit Reason': 'none given', 'Affidavit Signed By': 'Mel' };
  assert.equal(isExpenseReady(declared), true);
});
