'use strict';

// Pair a held email receipt with an expense (a YNAB row, or an already-submitted
// expense that's missing its receipt). The rule is deliberately forgiving on
// merchant (a receipt's merchant text rarely matches a budget-app payee exactly)
// but strict on money + day, and it never crosses currencies — so a mismatch
// leaves the receipt held rather than attaching it to the wrong expense.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const norm = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();

// Days between two YYYY-MM-DD dates (absolute), or null if either is missing.
function daysApart(a, b) {
  if (!a || !b) return null;
  const da = Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`);
  const db = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`);
  if (isNaN(da) || isNaN(db)) return null;
  return Math.abs(Math.round((da - db) / 86400000));
}

// Do two amounts match within a penny (or a hair, for rounding on conversions)?
function amountsClose(a, b) {
  if (a == null || b == null) return false;
  const x = Math.abs(round2(a));
  const y = Math.abs(round2(b));
  return Math.abs(x - y) <= Math.max(0.01, 0.005 * Math.max(x, y));
}

function merchantsAlike(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

// Is `held` a plausible receipt for `target`? Both are { amount, date, merchant,
// currency }. Requires same currency + amount + a date within `dateWindow` days.
function isMatch(target, held, dateWindow = 4) {
  if (!target || !held) return false;
  const tc = (target.currency || 'USD').toUpperCase();
  const hc = (held.currency || 'USD').toUpperCase();
  if (tc !== hc) return false;
  if (!amountsClose(target.amount, held.amount)) return false;
  const d = daysApart(target.date, held.date);
  return d != null && d <= dateWindow;
}

// From a pool of held receipts, pick the best index to attach to `target`, or -1.
// Among valid candidates: prefer a merchant match, then the closest date, then
// the smallest amount gap. Skips any already flagged used.
function pickBest(target, pool, dateWindow = 4) {
  let best = -1;
  let bestScore = null;
  for (let i = 0; i < pool.length; i += 1) {
    const held = pool[i];
    if (!held || held.used) continue;
    if (!isMatch(target, held, dateWindow)) continue;
    const score = {
      merchant: merchantsAlike(target.merchant, held.merchant) ? 0 : 1,
      days: daysApart(target.date, held.date) || 0,
      gap: Math.abs(Math.abs(round2(target.amount)) - Math.abs(round2(held.amount))),
    };
    if (
      bestScore == null ||
      score.merchant < bestScore.merchant ||
      (score.merchant === bestScore.merchant && score.days < bestScore.days) ||
      (score.merchant === bestScore.merchant && score.days === bestScore.days && score.gap < bestScore.gap)
    ) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

module.exports = { isMatch, pickBest, amountsClose, daysApart, merchantsAlike, norm };
