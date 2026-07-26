'use strict';

// Find likely duplicate expenses across the household and explain WHICH signals
// make each set look like the same charge, so a person can eyeball it and delete
// the extra copy. It flags on several signals, not just one:
//   • same exact cost + same day        (whatever the merchant reads)
//   • same exact cost + a similar name   (within a few days)
//   • same exact cost from two places    (a receipt AND a budget row)
//   • same day + a similar name          (even if the amounts differ a little)
// Conservative-ish: it surfaces candidates, the person decides.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, displayMaps, shapeExpense, isHeldEmailReceipt,
  ensureStaff, householdScope, submitterEmailFormula,
} = require('./lib/domain');
const { daysApart, merchantsAlike, norm } = require('./lib/matching');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const money = (n, c) => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD', currencyDisplay: 'narrowSymbol' }).format(n); }
  catch { return `${Number(n).toFixed(2)} ${c || ''}`.trim(); }
};

// Words that don't help tell two merchants apart, so we ignore them when looking
// for a shared name token.
const STOP = new Set(['hotel', 'hotels', 'resort', 'resorts', 'motel', 'inn', 'the', 'and', 'for', 'llc', 'inc', 'ltd', 'restaurant', 'restaurace', 'cafe', 'store', 'shop', 'manual', 'services', 'service']);
const nameOf = (e) => e.merchant || e.description || '';
function bigTokens(s) {
  return norm(s).split(' ').filter((t) => t.length >= 4 && !STOP.has(t));
}
// Do two names look like the same place? Either one contains the other, or they
// share a meaningful word (e.g. both "…Tower Tap…", both "…Hilton…").
function merchantsRelated(a, b) {
  if (merchantsAlike(a, b)) return true;
  const ta = new Set(bigTokens(a));
  return bigTokens(b).some((t) => ta.has(t));
}
const sharedToken = (a, b) => {
  const ta = new Set(bigTokens(a));
  return bigTokens(b).find((t) => ta.has(t)) || '';
};

// Minutes between two HH:MM times, or 0 if either is missing/unparseable.
function minutesApart(a, b) {
  const p = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const x = p(a); const y = p(b);
  if (x == null || y == null) return 0;
  return Math.abs(x - y);
}
// A known, clearly-different time on the receipts means these are separate
// charges (e.g. several road tolls the same day) — not a duplicate.
function timesConflict(a, b) {
  if (!a.receiptTime || !b.receiptTime) return false; // unknown time can't rule it out
  return minutesApart(a.receiptTime, b.receiptTime) > 3;
}

// For the same-day pass where amounts differ: only near-identical totals look
// like the same charge read twice (e.g. $23.71 vs $23.51). Two same-store buys
// of clearly different amounts on one day are just two purchases, not a double.
function amountsNear(a, b) {
  if ((a.currency || 'USD') !== (b.currency || 'USD')) return false;
  const x = Number(a.amount) || 0;
  const y = Number(b.amount) || 0;
  if (!x || !y) return false;
  return Math.abs(x - y) <= 0.02 * Math.max(x, y); // within 2%
}

// Same-cost pass: two expenses of the identical amount look like one charge?
function sameCostSame(a, b) {
  if (timesConflict(a, b)) return false; // different times on the receipts → not a double
  const d = daysApart(a.date, b.date);
  const diffSrc = a.source && b.source && a.source !== b.source;
  const related = merchantsRelated(nameOf(a), nameOf(b));
  const bothNamed = nameOf(a).trim() && nameOf(b).trim();
  // Same cost + same day: a double, as long as the names look related or one of
  // them is blank (so two different same-priced buys on one day don't get paired).
  if (d === 0 && (related || !bothNamed)) return true;
  if (related && d != null && d <= 7) return true;              // same cost + a similar name, within a week
  if (related && diffSrc && d != null && d <= 14) return true;  // same vendor from two places, within two weeks
  return false;
}

function reasonFor(items, sameCost) {
  const cur = items[0].currency || 'USD';
  let span = 0;
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const d = daysApart(items[i].date, items[j].date);
      if (d != null && d > span) span = d;
    }
  }
  const parts = [];
  if (sameCost) parts.push(`Same cost (${money(items[0].amount, cur)})`);
  else parts.push('Same day');
  if (sameCost) parts.push(span === 0 ? 'same day' : `${span} day${span === 1 ? '' : 's'} apart`);
  const sources = [...new Set(items.map((i) => i.source).filter(Boolean))];
  if (sources.length > 1) parts.push(`from different places (${sources.join(' + ')})`);
  // Point at the shared word when there is one.
  let tok = '';
  for (let i = 0; i < items.length && !tok; i += 1) {
    for (let j = i + 1; j < items.length && !tok; j += 1) tok = sharedToken(nameOf(items[i]), nameOf(items[j]));
  }
  if (tok) parts.push(`similar name (“${tok}”)`);
  if (!sameCost) parts.push('amounts differ — check which is right');
  return parts.join(' · ');
}

// Connected-components grouping over a list, joining any two the predicate links.
function cluster(list, linked) {
  const groups = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i += 1) {
    if (seen.has(i)) continue;
    const group = [i];
    seen.add(i);
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < list.length; j += 1) {
        if (seen.has(j)) continue;
        if (group.some((k) => linked(list[k], list[j]))) { group.push(j); seen.add(j); grew = true; }
      }
    }
    if (group.length >= 2) groups.push(group.map((k) => list[k]));
  }
  return groups;
}

// The pure core: given shaped expenses, return the likely-duplicate groups.
function findDuplicateGroups(items) {
  const list = items.filter((e) => e.amount != null && e.amount > 0);
  const groups = [];
  const grouped = new Set(); // expense ids already in a group

  // Pass 1 — SAME EXACT COST. Bucket by currency+amount, then cluster.
  const buckets = new Map();
  for (const e of list) {
    const key = `${e.currency || 'USD'}|${round2(e.amount)}`;
    (buckets.get(key) || buckets.set(key, []).get(key)).push(e);
  }
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    for (const g of cluster(bucket, sameCostSame)) {
      const gItems = g.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
      gItems.forEach((e) => grouped.add(e.id));
      groups.push({ reason: reasonFor(gItems, true), amount: round2(gItems[0].amount), items: gItems });
    }
  }

  // Pass 2 — SAME DAY + SIMILAR NAME, even when the amounts differ (a double
  // charge that got read with slightly different totals). Skip anything already
  // caught above.
  const rest = list.filter((e) => !grouped.has(e.id) && e.date);
  const byDate = new Map();
  for (const e of rest) (byDate.get(e.date) || byDate.set(e.date, []).get(e.date)).push(e);
  for (const dayList of byDate.values()) {
    if (dayList.length < 2) continue;
    for (const g of cluster(dayList, (a, b) => merchantsRelated(nameOf(a), nameOf(b)) && amountsNear(a, b) && !timesConflict(a, b))) {
      const gItems = g.slice().sort((a, b) => (b.amount || 0) - (a.amount || 0));
      gItems.forEach((e) => grouped.add(e.id));
      groups.push({ reason: reasonFor(gItems, false), amount: round2(gItems[0].amount || 0), items: gItems });
    }
  }

  groups.sort((a, b) => b.amount - a.amount);
  return groups;
}

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { record: staffRec } = await ensureStaff(user);
    const { emails } = await householdScope(staffRec);
    const [records, maps] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: submitterEmailFormula(emails.length ? emails : [user.email.toLowerCase()]),
      }),
      displayMaps(),
    ]);

    // Real expenses only — held email receipts live in the inbox.
    const items = records
      .filter((r) => !isHeldEmailReceipt(r.fields))
      .map((r) => shapeExpense(r, maps));

    return ok({ groups: findDuplicateGroups(items) });
  } catch (err) {
    return error(err);
  }
};

module.exports.findDuplicateGroups = findDuplicateGroups;
