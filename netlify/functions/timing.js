'use strict';

// How the reimbursement loop is keeping up — a health view for approvers/Finance
// (CedarStone's back office). Two clocks, both read off dates the app already
// stamps on every expense:
//   • time to approve  = Decided On − Submitted On   (submitted → approved)
//   • time to reimburse = Paid On   − Decided On     (approved → paid)
// Plus what's still waiting to be paid. No new fields — this is pure arithmetic
// over the expenses that have already been approved or reimbursed.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, STATUS, ensureStaff, isApprover, displayMaps, shapeExpense } = require('./lib/domain');

const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const asDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d; };
const mean = (arr) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : null);

// Build the last `n` month buckets ending with the month of `now`, oldest first.
function lastMonths(now, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ key: monthKey(d), label: MONTHS[d.getUTCMonth()] });
  }
  return out;
}

/**
 * Roll a list of shaped expenses (Approved + Reimbursed) into the timing numbers.
 * Pure so it can be reasoned about and tested independently of Airtable.
 */
function summarize(expenses, now = new Date()) {
  const thisKey = monthKey(now);
  const prevKey = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));

  const approveDur = [];   // all approve durations, in days
  const payDur = [];       // all pay durations, in days
  const approveByMonth = {}; // key -> [days]
  const payByMonth = {};
  const awaiting = { count: 0, usd: 0, oldestDays: 0 };
  let approvedThisMonth = 0;

  for (const e of expenses) {
    const sub = asDate(e.submittedOn);
    const dec = asDate(e.decidedOn);
    const paid = asDate(e.paidOn);
    const usd = Number(e.amountUsd) || 0;

    // submitted → approved
    if (sub && dec && dec >= sub) {
      const days = (dec - sub) / DAY;
      approveDur.push(days);
      const k = monthKey(dec);
      (approveByMonth[k] = approveByMonth[k] || []).push(days);
      if (k === thisKey) approvedThisMonth += 1;
    }

    // approved → paid (only once actually reimbursed)
    if (e.status === STATUS.REIMBURSED && dec && paid && paid >= dec) {
      const days = (paid - dec) / DAY;
      payDur.push(days);
      const k = monthKey(paid);
      (payByMonth[k] = payByMonth[k] || []).push(days);
    }

    // approved but not yet paid — still owed to someone
    if (e.status === STATUS.APPROVED) {
      awaiting.count += 1;
      awaiting.usd += usd;
      if (dec) awaiting.oldestDays = Math.max(awaiting.oldestDays, Math.floor((now - dec) / DAY));
    }
  }

  const monthAvg = (byMonth, key) => (byMonth[key] ? round1(mean(byMonth[key])) : null);
  const trendOf = (byMonth) => lastMonths(now, 6).map((m) => ({
    m: m.label,
    d: byMonth[m.key] ? round1(mean(byMonth[m.key])) : null,
    count: byMonth[m.key] ? byMonth[m.key].length : 0,
  }));

  return {
    approve: {
      avgDays: approveDur.length ? round1(mean(approveDur)) : null,
      count: approveDur.length,
      thisMonthAvg: monthAvg(approveByMonth, thisKey),
      prevMonthAvg: monthAvg(approveByMonth, prevKey),
    },
    pay: {
      avgDays: payDur.length ? round1(mean(payDur)) : null,
      count: payDur.length,
      thisMonthAvg: monthAvg(payByMonth, thisKey),
      prevMonthAvg: monthAvg(payByMonth, prevKey),
    },
    awaiting: { count: awaiting.count, usd: round2(awaiting.usd), oldestDays: awaiting.oldestDays },
    approvedThisMonth,
    trend: { approve: trendOf(approveByMonth), pay: trendOf(payByMonth) },
    // Whether "approved → paid" is being tracked at all: if nothing has ever been
    // marked paid in Rembly, that clock has no data and the UI says so.
    paidTrackedInApp: payDur.length > 0,
  };
}

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);
    if (!isApprover(role)) {
      const err = new Error('You do not have approver access.');
      err.statusCode = 403;
      throw err;
    }

    const [records, maps] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: `OR({Status} = '${STATUS.APPROVED}', {Status} = '${STATUS.REIMBURSED}')`,
      }),
      displayMaps(),
    ]);
    const expenses = records.map((r) => shapeExpense(r, maps));

    return ok({ role, ...summarize(expenses, new Date()) });
  } catch (err) {
    return error(err);
  }
};

module.exports.summarize = summarize; // exported for a quick sanity check / future test
