'use strict';

// Spending breakdown data. Everyone gets their own spending; approvers/Finance
// can ask for the whole team's (scope=all). We return the raw shaped expenses
// and let the browser do the period/slice math, so month-stepping, date ranges
// and drill-in are instant without another round-trip.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, ensureStaff, isApprover, displayMaps, shapeExpense, householdScope, submitterEmailFormula } = require('./lib/domain');

// Statuses that count as real spend (money out or on its way out).
const ACTIVE = new Set(['Submitted', 'Approved', 'Reimbursed']);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Roll a list of shaped expenses into the dashboard numbers. Kept for the unit
// test and any server-side summary; the live UI aggregates client-side.
function aggregate(items, monthPrefix) {
  let totalUsd = 0;
  let count = 0;
  let monthUsd = 0;
  const statusMap = {};
  const acctMap = {};

  for (const e of items) {
    const usd = Number(e.amountUsd) || 0;
    const st = e.status || 'Submitted';
    (statusMap[st] = statusMap[st] || { status: st, count: 0, usd: 0 });
    statusMap[st].count += 1;
    statusMap[st].usd += usd;

    if (ACTIVE.has(st)) {
      totalUsd += usd;
      count += 1;
      if (String(e.date || '').slice(0, 7) === monthPrefix) monthUsd += usd;
      const key = e.account || 'Unassigned';
      (acctMap[key] = acctMap[key] || { account: key, count: 0, usd: 0 });
      acctMap[key].count += 1;
      acctMap[key].usd += usd;
    }
  }

  return {
    totals: { count, usd: round2(totalUsd) },
    thisMonthUsd: round2(monthUsd),
    byStatus: Object.values(statusMap).map((s) => ({ ...s, usd: round2(s.usd) })),
    byAccount: Object.values(acctMap).map((a) => ({ ...a, usd: round2(a.usd) })).sort((a, b) => b.usd - a.usd),
  };
}

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role, record: staffRec } = await ensureStaff(user);
    const canSeeAll = isApprover(role);

    const q = event.queryStringParameters || {};
    const wantAll = canSeeAll && String(q.scope || '').toLowerCase() === 'all';

    const params = {
      'sort[0][field]': 'Expense Date',
      'sort[0][direction]': 'desc',
    };
    if (!wantAll) {
      // "My" spending pools the whole household.
      const { emails } = await householdScope(staffRec);
      params.filterByFormula = submitterEmailFormula(emails.length ? emails : [user.email.toLowerCase()]);
    }

    const [records, maps] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, params),
      displayMaps(),
    ]);

    const expenses = records.map((r) => shapeExpense(r, maps));
    const monthPrefix = new Date().toISOString().slice(0, 7);

    return ok({
      scope: wantAll ? 'all' : 'mine',
      canSeeAll,
      role,
      expenses,
      ...aggregate(expenses, monthPrefix),
    });
  } catch (err) {
    return error(err);
  }
};

module.exports.aggregate = aggregate; // exported for tests
