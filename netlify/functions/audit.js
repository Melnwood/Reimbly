'use strict';

// Pre-Cedarstone audit: scan every expense in the pipeline (Submitted +
// Approved) and flag anything that would make the report look sloppy — missing
// receipt, date, amount, account, currency, or an uncomputed USD total.
// Approver / Finance only.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, ensureStaff, displayMaps, shapeExpense, dupKey } = require('./lib/domain');

// Return the list of problems with one expense (empty = ready to send).
function auditExpense(e) {
  const issues = [];
  if (!e.description) issues.push('Missing description');
  if (e.amount == null || !(e.amount > 0)) issues.push('Missing amount');
  if (!e.currency) issues.push('Missing currency');
  if (e.amountUsd == null) issues.push('USD not calculated');
  if (!e.date) issues.push('Missing date');
  if (!e.account) issues.push('Missing account');
  if (!e.receipt) {
    // A signed & approved no-receipt affidavit stands in for the receipt.
    if (!e.missingReceipt) issues.push('Missing receipt');
    else if (e.affidavitStatus !== 'Approved') issues.push('No-receipt affidavit pending approval');
  }
  return issues;
}

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);
    // This is a whole-org, pre-Cedarstone completeness sweep — not scoped to any
    // one team like Review/Paid are — so it's kept to Finance, who already sees
    // everyone's expenses on those screens too.
    if (role !== 'Finance') {
      const err = new Error('Only Finance can run the audit.');
      err.statusCode = 403;
      throw err;
    }

    const [records, maps] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: `OR({Status} = 'Submitted', {Status} = 'Approved')`,
        'sort[0][field]': 'Submitted On',
        'sort[0][direction]': 'desc',
      }),
      displayMaps(),
    ]);

    const items = records.map((r) => {
      const e = shapeExpense(r, maps);
      return { ...e, issues: auditExpense(e) };
    });

    // Flag likely duplicates: same person + same amount + day + merchant.
    const groups = new Map();
    for (const e of items) {
      const k = dupKey({ amount: e.amount, date: e.date, merchant: e.merchant });
      if (!k) continue;
      const key = `${(e.submitterEmail || '').toLowerCase()}|${k}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    for (const arr of groups.values()) {
      if (arr.length > 1) arr.forEach((e) => e.issues.push('Possible duplicate'));
    }

    const flagged = items.filter((i) => i.issues.length > 0);

    return ok({
      counts: {
        total: items.length,
        ready: items.length - flagged.length,
        needsAttention: flagged.length,
      },
      items: flagged,
    });
  } catch (err) {
    return error(err);
  }
};

module.exports.auditExpense = auditExpense; // exported for tests
