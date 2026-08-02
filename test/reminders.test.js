'use strict';

// The deadline-clock logic behind the gentle nudge: days left, and which days
// actually send a reminder.

const test = require('node:test');
const assert = require('node:assert/strict');

const { daysBetween, daysLeftFor, shouldRemind } = require('../netlify/functions/lib/reminders');

test('daysBetween counts whole days', () => {
  assert.equal(daysBetween('2026-08-01', '2026-08-02'), 1);
  assert.equal(daysBetween('2026-06-01', '2026-07-01'), 30);
  assert.equal(daysBetween('nope', '2026-08-02'), null);
});

test('daysLeftFor: a 60-day window, expense 50 days old → 10 left', () => {
  assert.equal(daysLeftFor('2026-06-13', '2026-08-02', 60), 10);
});

test('daysLeftFor goes negative once past the deadline', () => {
  assert.equal(daysLeftFor('2026-06-01', '2026-08-02', 60), -2);
});

test('the first nudge is at 10 days left, then it escalates', () => {
  assert.deepEqual(shouldRemind(10), { kind: 'approaching', daysLeft: 10 });
  assert.deepEqual(shouldRemind(5), { kind: 'approaching', daysLeft: 5 });
  assert.deepEqual(shouldRemind(1), { kind: 'approaching', daysLeft: 1 });
});

test('quiet on the in-between days (no daily nagging)', () => {
  assert.equal(shouldRemind(9), null);
  assert.equal(shouldRemind(7), null);
  assert.equal(shouldRemind(3), null);
  assert.equal(shouldRemind(11), null); // not near the deadline yet
});

test('the deadline day itself sends a "due today"', () => {
  assert.deepEqual(shouldRemind(0), { kind: 'due', daysLeft: 0 });
});

test('overdue nudges weekly, not daily', () => {
  assert.equal(shouldRemind(-1), null);
  assert.equal(shouldRemind(-6), null);
  assert.deepEqual(shouldRemind(-7), { kind: 'overdue', daysLeft: -7 });
  assert.deepEqual(shouldRemind(-14), { kind: 'overdue', daysLeft: -14 });
});
