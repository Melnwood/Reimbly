'use strict';

// Find likely duplicate expenses in the signed-in person's own list and explain
// why each set looks like a duplicate, so they can eyeball it and delete the
// extra copy. Two expenses look like the same charge when the money matches and
// they're a few days apart with a similar merchant — or when the very same
// amount came in from two different places (e.g. a YNAB row AND an emailed
// receipt). Conservative on purpose: it surfaces candidates, the person decides.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, displayMaps, shapeExpense, isHeldEmailReceipt } = require('./lib/domain');
const { daysApart, merchantsAlike } = require('./lib/matching');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const money = (n, c) => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD', currencyDisplay: 'narrowSymbol' }).format(n); }
  catch { return `${Number(n).toFixed(2)} ${c || ''}`.trim(); }
};

// Two of the person's expenses look like the same charge?
function looksSame(a, b) {
  if (a.amount == null || b.amount == null) return false;
  if ((a.currency || 'USD') !== (b.currency || 'USD')) return false;
  if (round2(a.amount) !== round2(b.amount)) return false;
  if (!merchantsAlike(a.merchant || a.description, b.merchant || b.description)) return false;
  const d = daysApart(a.date, b.date);
  const differentSource = a.source && b.source && a.source !== b.source;
  // Within a few days, or the same amount arriving from two different places.
  return (d != null && d <= 3) || (differentSource && d != null && d <= 10);
}

function reasonFor(items) {
  const cur = items[0].currency || 'USD';
  const amt = money(items[0].amount, cur);
  const dates = items.map((i) => i.date).filter(Boolean).sort();
  let span = 0;
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const d = daysApart(items[i].date, items[j].date);
      if (d != null && d > span) span = d;
    }
  }
  const parts = [`Same amount (${amt})`];
  if (dates.length) parts.push(span === 0 ? 'on the same day' : `${span} day${span === 1 ? '' : 's'} apart`);
  const sources = [...new Set(items.map((i) => i.source).filter(Boolean))];
  if (sources.length > 1) parts.push(`added from different places (${sources.join(' + ')})`);
  else parts.push('similar merchant');
  return parts.join(' · ');
}

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const email = user.email.toLowerCase().replace(/'/g, "\\'");
    const [records, maps] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: `LOWER(ARRAYJOIN({Submitter Email})) = '${email}'`,
      }),
      displayMaps(),
    ]);

    // Real expenses only — held email receipts live in the inbox.
    const items = records
      .filter((r) => !isHeldEmailReceipt(r.fields))
      .map((r) => shapeExpense(r, maps));

    // Bucket by currency + amount so we only compare like with like, then join
    // any that look like the same charge into a group (connected components).
    const buckets = new Map();
    for (const e of items) {
      if (e.amount == null || !(e.amount > 0)) continue;
      const key = `${e.currency || 'USD'}|${round2(e.amount)}`;
      (buckets.get(key) || buckets.set(key, []).get(key)).push(e);
    }

    const groups = [];
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue;
      const seen = new Set();
      for (let i = 0; i < bucket.length; i += 1) {
        if (seen.has(i)) continue;
        const group = [i];
        seen.add(i);
        // Grow the group with anything that matches any member already in it.
        let grew = true;
        while (grew) {
          grew = false;
          for (let j = 0; j < bucket.length; j += 1) {
            if (seen.has(j)) continue;
            if (group.some((k) => looksSame(bucket[k], bucket[j]))) { group.push(j); seen.add(j); grew = true; }
          }
        }
        if (group.length >= 2) {
          const gItems = group.map((k) => bucket[k]).sort((a, b) => String(a.date).localeCompare(String(b.date)));
          groups.push({ reason: reasonFor(gItems), amount: round2(gItems[0].amount), items: gItems });
        }
      }
    }

    groups.sort((a, b) => b.amount - a.amount);
    return ok({ groups });
  } catch (err) {
    return error(err);
  }
};
