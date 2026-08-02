'use strict';

// Recurring monthly subscriptions — the pure date logic that decides which day
// a given month's copy lands on (and whether there's one to make at all).

const test = require('node:test');
const assert = require('node:assert/strict');

const { monthOf, daysInMonth, recurringCopyDate } = require('../netlify/functions/lib/recurring');

test('monthOf pulls the YYYY-MM off a date', () => {
  assert.equal(monthOf('2026-07-14'), '2026-07');
  assert.equal(monthOf(''), '');
});

test('daysInMonth knows month lengths (incl. leap Feb)', () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29); // leap year
  assert.equal(daysInMonth(2026, 4), 30);
});

test('a copy keeps the same day-of-month', () => {
  assert.equal(recurringCopyDate('2026-07-14', '2026-08'), '2026-08-14');
});

test("a 31st clamps to the month's last day", () => {
  assert.equal(recurringCopyDate('2026-07-31', '2026-09'), '2026-09-30');
  assert.equal(recurringCopyDate('2026-01-31', '2026-02'), '2026-02-28');
});

test('nothing to make when the template is already in the current month', () => {
  assert.equal(recurringCopyDate('2026-08-03', '2026-08'), null);
});

test('nothing to make when the template is in the future', () => {
  assert.equal(recurringCopyDate('2026-09-03', '2026-08'), null);
});
