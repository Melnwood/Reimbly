'use strict';

// Unit tests for the timing/health math (submitted→approved, approved→paid,
// report volume, and sent-back→resubmitted). Pure functions, no Airtable — run
// with `npm test` (Node's built-in runner, no extra dependencies).

const test = require('node:test');
const assert = require('node:assert/strict');

const { summarize, reportVolume, bounceBack } = require('../netlify/functions/timing');

// A fixed "now" so month buckets and aging are deterministic.
const NOW = new Date('2026-07-15T00:00:00Z');

test('summarize: approve/pay averages, this-vs-prev month, and awaiting', () => {
  const expenses = [
    // Approved this month (4-day approve), not yet paid → still awaiting payment.
    { submittedOn: '2026-07-01', decidedOn: '2026-07-05', paidOn: null, status: 'Approved', amountUsd: 100 },
    // Reimbursed: approved last month (2 days), paid 7 days after approval.
    { submittedOn: '2026-06-01', decidedOn: '2026-06-03', paidOn: '2026-06-10', status: 'Reimbursed', amountUsd: 50 },
  ];
  const s = summarize(expenses, NOW);

  assert.equal(s.approve.count, 2);
  assert.equal(s.approve.avgDays, 3);            // (4 + 2) / 2
  assert.equal(s.approve.thisMonthAvg, 4);       // only the July approval
  assert.equal(s.approve.prevMonthAvg, 2);       // only the June approval
  assert.equal(s.approvedThisMonth, 1);

  assert.equal(s.pay.count, 1);
  assert.equal(s.pay.avgDays, 7);
  assert.equal(s.pay.prevMonthAvg, 7);
  assert.equal(s.pay.thisMonthAvg, null);        // nothing paid in July
  assert.equal(s.paidTrackedInApp, true);

  assert.equal(s.awaiting.count, 1);
  assert.equal(s.awaiting.usd, 100);
  assert.equal(s.awaiting.oldestDays, 10);       // 2026-07-05 → 2026-07-15
});

test('summarize: waiting-to-be-paid also counts as awaiting; no paid data hides the clock', () => {
  const expenses = [
    { submittedOn: '2026-07-02', decidedOn: '2026-07-04', paidOn: null, status: 'Waiting to be paid', amountUsd: 25.5 },
  ];
  const s = summarize(expenses, NOW);
  assert.equal(s.awaiting.count, 1);
  assert.equal(s.awaiting.usd, 25.5);
  assert.equal(s.pay.count, 0);
  assert.equal(s.paidTrackedInApp, false);       // nothing ever marked paid
});

test('summarize: ignores backwards/incomplete date pairs', () => {
  const expenses = [
    { submittedOn: '2026-07-10', decidedOn: '2026-07-05', paidOn: null, status: 'Approved', amountUsd: 10 }, // decided before submitted
    { submittedOn: null, decidedOn: '2026-07-05', paidOn: null, status: 'Approved', amountUsd: 10 },         // no submit date
  ];
  const s = summarize(expenses, NOW);
  assert.equal(s.approve.count, 0);
  assert.equal(s.approve.avgDays, null);
});

test('reportVolume: counts submitted reports by month, skips unsubmitted drafts', () => {
  const reports = [
    { fields: { 'Submitted On': '2026-07-02' } },
    { fields: { 'Submitted On': '2026-07-20' } },
    { fields: { 'Submitted On': '2026-06-15' } },
    { fields: {} }, // an unsubmitted draft — hasn't "come in"
  ];
  const v = reportVolume(reports, NOW);
  assert.equal(v.thisMonth, 2);
  assert.equal(v.prevMonth, 1);
  assert.equal(v.total6mo, 3);
  assert.equal(v.trend.length, 6);
  assert.equal(v.trend[v.trend.length - 1].c, 2); // July is the last bucket
});

test('bounceBack: pairs sent-back with the next resubmit; leaves the unpaired one "still out"', () => {
  const rows = [
    { expenseId: 'A', event: 'Sent back', at: '2026-07-01T00:00:00Z' },
    { expenseId: 'A', event: 'Resubmitted', at: '2026-07-03T00:00:00Z' },
    { expenseId: 'B', event: 'Sent back', at: '2026-07-10T00:00:00Z' }, // never resubmitted
  ];
  const b = bounceBack(rows, NOW);
  assert.equal(b.count, 1);
  assert.equal(b.avgDays, 2);
  assert.equal(b.waiting.count, 1);
  assert.equal(b.waiting.oldestDays, 5); // 2026-07-10 → 2026-07-15
});
