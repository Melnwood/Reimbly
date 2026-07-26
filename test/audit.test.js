'use strict';

// Unit tests for the pre-CedarStone audit flags (what makes an expense "not
// ready"). Pure function — run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');

const { auditExpense } = require('../netlify/functions/audit');

// A fully-documented expense: nothing to flag.
const clean = {
  description: 'Team lunch',
  amount: 24.5,
  currency: 'USD',
  amountUsd: 24.5,
  date: '2026-07-01',
  account: 'Selah',
  receipt: { url: '/api/receipt?e=rec1&t=abc' },
  missingReceipt: false,
};

test('auditExpense: a complete expense with a receipt has no issues', () => {
  assert.deepEqual(auditExpense(clean), []);
});

test('auditExpense: receiptless and not declared missing → "Missing receipt"', () => {
  const e = { ...clean, receipt: null, missingReceipt: false };
  assert.deepEqual(auditExpense(e), ['Missing receipt']);
});

test('auditExpense: declared missing but affidavit still pending → flagged for sign-off', () => {
  const e = { ...clean, receipt: null, missingReceipt: true, affidavitStatus: 'Pending' };
  assert.deepEqual(auditExpense(e), ['No-receipt affidavit pending approval']);
});

test('auditExpense: declared missing with an APPROVED affidavit stands in for the receipt', () => {
  const e = { ...clean, receipt: null, missingReceipt: true, affidavitStatus: 'Approved' };
  assert.deepEqual(auditExpense(e), []);
});

test('auditExpense: collects every missing field', () => {
  const issues = auditExpense({});
  for (const want of ['Missing description', 'Missing amount', 'Missing currency',
    'USD not calculated', 'Missing date', 'Missing account', 'Missing receipt']) {
    assert.ok(issues.includes(want), `expected issue: ${want}`);
  }
});

test('auditExpense: zero or negative amount is treated as missing', () => {
  assert.ok(auditExpense({ ...clean, amount: 0 }).includes('Missing amount'));
  assert.ok(auditExpense({ ...clean, amount: -5 }).includes('Missing amount'));
});
