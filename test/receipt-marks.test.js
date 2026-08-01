'use strict';

// The receipt-highlight boxes must be clamped to sane 0–1 coords so a bad model
// guess can never draw a highlight in the wrong place. Tests scanner.normalize.

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalize } = require('../netlify/functions/lib/scanner');

const base = { amount: 10, currency: 'USD', date: '2026-08-01', time: null, merchant: 'x', description: 'y', account: null };
const norm = (extra) => normalize({ ...base, ...extra }, { accountCodes: new Set() });

test('a good box passes through', () => {
  assert.deepEqual(norm({ amountBox: { x: 0.6, y: 0.9, w: 0.3, h: 0.05 } }).amountBox,
    { x: 0.6, y: 0.9, w: 0.3, h: 0.05 });
});

test('out-of-range coords are clamped into the image', () => {
  const b = norm({ amountBox: { x: -0.1, y: 0.2, w: 0.4, h: 1.5 } }).amountBox;
  assert.ok(b.x >= 0 && b.x <= 1 && b.y >= 0 && b.y <= 1);
  assert.ok(b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001);
  assert.equal(b.x, 0);           // negative x clamped to the left edge
  assert.equal(b.h, 0.8);         // height clamped to fit below y
});

test('a box pinned past the edge with no room left is dropped', () => {
  assert.equal(norm({ amountBox: { x: 1.5, y: 0.5, w: 2, h: 0.4 } }).amountBox, null);
});

test('degenerate or missing boxes become null', () => {
  assert.equal(norm({ amountBox: { x: 0.5, y: 0.5, w: 0, h: 0.1 } }).amountBox, null); // zero width
  assert.equal(norm({ amountBox: { x: 0.5, y: 0.5, w: 0.001, h: 0.1 } }).amountBox, null); // too tiny
  assert.equal(norm({ amountBox: null }).amountBox, null);
  assert.equal(norm({}).amountBox, null);
  assert.equal(norm({ amountBox: { x: 'a', y: 0.5, w: 0.2, h: 0.1 } }).amountBox, null); // non-numeric
});

test('date and amount boxes are independent', () => {
  const out = norm({ amountBox: { x: 0.6, y: 0.9, w: 0.3, h: 0.05 }, dateBox: null });
  assert.ok(out.amountBox);
  assert.equal(out.dateBox, null);
});
