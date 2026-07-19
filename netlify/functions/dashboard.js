'use strict';

// Spend dashboard + history for approvers/finance: totals, a breakdown by
// account (category), a status breakdown, and the full history newest-first.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, ensureStaff, isApprover, displayMaps, shapeExpense } = require('./lib/domain');

// Statuses that count as real spend (money out or on its way out).
const ACTIVE = new Set(['Submitted', 'Approved', 'Reimbursed']);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Roll a list of shaped expenses into the dashboard numbers.
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
    const { role } = await ensureStaff(user);
    if (!isApprover(role)) {
      const err = new Error('You do not have dashboard access.');
      err.statusCode = 403;
      throw err;
    }

    const [records, maps] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, {
        'sort[0][field]': 'Submitted On',
        'sort[0][direction]': 'desc',
      }),
      displayMaps(),
    ]);

    const items = records.map((r) => shapeExpense(r, maps));
    const monthPrefix = new Date().toISOString().slice(0, 7);

    return ok({ ...aggregate(items, monthPrefix), history: items.slice(0, 100) });
  } catch (err) {
    return error(err);
  }
};

module.exports.aggregate = aggregate; // exported for tests
