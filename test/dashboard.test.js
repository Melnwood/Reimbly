'use strict';

// Unit tests for the dashboard spend roll-up. Pure function — run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');

const { aggregate } = require('../netlify/functions/dashboard');

test('aggregate: totals count only active spend, month filter, per-account rollup', () => {
  const items = [
    { amountUsd: 100, status: 'Approved', date: '2026-07-05', account: 'Selah' },
    { amountUsd: 50, status: 'Submitted', date: '2026-06-20', account: 'Selah' },
    { amountUsd: 999, status: 'Draft', date: '2026-07-01', account: 'Scratch' }, // not active spend
  ];
  const a = aggregate(items, '2026-07');

  assert.equal(a.totals.count, 2);        // Draft excluded
  assert.equal(a.totals.usd, 150);
  assert.equal(a.thisMonthUsd, 100);      // only the July active one

  // Every status is still tallied (so byStatus can show drafts), but only active
  // statuses feed totals and the account breakdown.
  const byStatus = Object.fromEntries(a.byStatus.map((s) => [s.status, s]));
  assert.equal(byStatus.Draft.count, 1);
  assert.equal(byStatus.Approved.usd, 100);

  assert.equal(a.byAccount.length, 1);    // Scratch was a draft, so not counted
  assert.equal(a.byAccount[0].account, 'Selah');
  assert.equal(a.byAccount[0].usd, 150);
  assert.equal(a.byAccount[0].count, 2);
});

test('aggregate: unassigned account bucket and USD rounding', () => {
  const items = [
    { amountUsd: 10.005, status: 'Approved', date: '2026-07-01', account: '' },
    { amountUsd: 0.005, status: 'Reimbursed', date: '2026-07-01', account: '' },
  ];
  const a = aggregate(items, '2026-07');
  assert.equal(a.byAccount[0].account, 'Unassigned');
  assert.equal(a.totals.usd, 10.01); // rounded to cents
});
