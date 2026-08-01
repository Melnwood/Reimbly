'use strict';

// Unit tests for the receipt gate — what counts as "enough proof of spend" to
// let an expense be submitted. Pure function over raw Airtable fields.

const test = require('node:test');
const assert = require('node:assert/strict');

const { receiptGatePasses, isMileageExpense } = require('../netlify/functions/lib/domain');

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

test('fails with a half-finished declaration (no reason)', () => {
  assert.equal(receiptGatePasses({
    'Missing Receipt': true,
    'Affidavit Signed By': 'Mel Ellenwood',
  }), false);
});

test('fails when there is neither a receipt nor a declaration', () => {
  assert.equal(receiptGatePasses({ Description: 'Taxi', Amount: 20 }), false);
  assert.equal(receiptGatePasses({ Receipt: [] }), false);
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
