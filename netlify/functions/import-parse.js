'use strict';

// Read an uploaded CSV / Excel file and return a preview: every row normalized,
// with duplicates flagged (against what's already in Reimbly and against other
// rows in the same file). Writes nothing — the browser shows this for review,
// then calls import-commit with the rows the person actually wants.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, CURRENCY_CODES, ensureStaff, listAccounts, displayMaps, shapeExpense, dupKey, heldReceiptsFor,
} = require('./lib/domain');
const { parseSpreadsheet } = require('./lib/importer');
const { pickBest } = require('./lib/matching');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 500;
const CURRENCIES = new Set(CURRENCY_CODES);

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

// Resolve a free-text account value (code or name) against the chart of accounts.
function makeAccountResolver(accounts) {
  const byCode = new Map(accounts.map((a) => [String(a.code).trim(), a]));
  const byName = new Map(accounts.map((a) => [a.name.trim().toLowerCase(), a]));
  return (value) => {
    const v = String(value || '').trim();
    if (!v) return null;
    return byCode.get(v) || byName.get(v.toLowerCase()) || null;
  };
}

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    await ensureStaff(user);

    const body = parseBody(event);
    const file = body.file;
    if (!file || !file.base64) throw badRequest('No file was uploaded.');
    if (Math.floor((file.base64.length * 3) / 4) > MAX_FILE_BYTES) {
      throw badRequest('That file is too large (max 5 MB).');
    }

    const { rows, headers, unmatched, format } = parseSpreadsheet(file);
    if (!rows.length) throw badRequest('No rows found under the header row.');
    if (rows.length > MAX_ROWS) throw badRequest(`That file has ${rows.length} rows — please split it into batches of ${MAX_ROWS} or fewer.`);

    // Everything this person already has, keyed for duplicate detection.
    const email = user.email.toLowerCase().replace(/'/g, "\\'");
    const [accounts, existingRecords, maps] = await Promise.all([
      listAccounts(),
      airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: `LOWER(ARRAYJOIN({Submitter Email})) = '${email}'`,
      }),
      displayMaps(),
    ]);
    const resolveAccount = makeAccountResolver(accounts);
    const existingKeys = new Map();
    for (const rec of existingRecords) {
      const e = shapeExpense(rec, maps);
      const key = dupKey({ amount: e.amount, date: e.date, merchant: e.merchant });
      if (key) existingKeys.set(key, e);
    }

    // Held email receipts this person has waiting — so the preview can show which
    // rows will arrive with their receipt already attached.
    const attachReceipts = body.attachReceipts !== false; // default on
    let pool = [];
    if (attachReceipts) {
      try {
        const held = await heldReceiptsFor(user.email, maps);
        pool = held.map((h) => ({ amount: h.exp.amount, date: h.exp.date, merchant: h.exp.merchant, currency: h.exp.currency || 'USD', used: false }));
      } catch (e) { /* preview is best-effort; matching just won't show */ }
    }

    const seen = new Map();
    let duplicates = 0;
    let ready = 0;
    let withReceipt = 0;

    const preview = rows.map((r) => {
      const issues = [];
      if (r.amount == null || !(r.amount > 0)) issues.push('Amount');
      if (!r.date) issues.push('Date');
      const currency = r.currency || 'USD';
      if (!CURRENCIES.has(currency)) issues.push('Currency');
      const acct = resolveAccount(r.account);

      const key = dupKey({ amount: r.amount, date: r.date, merchant: r.merchant });
      let duplicate = false;
      let dupReason = '';
      if (key && existingKeys.has(key)) {
        duplicate = true;
        dupReason = 'Already in Rembly';
      } else if (key && seen.has(key)) {
        duplicate = true;
        dupReason = 'Repeated in this file';
      } else if (key) {
        seen.set(key, r.line);
      }

      const importable = r.amount > 0 && !!r.date; // account/currency are fixable in the preview
      if (duplicate) duplicates += 1;
      else if (importable) ready += 1;

      // Will a held email receipt attach to this row?
      let receiptFound = false;
      if (attachReceipts && !duplicate && importable) {
        const idx = pickBest({ amount: r.amount, date: r.date, merchant: r.merchant, currency }, pool);
        if (idx >= 0) { pool[idx].used = true; receiptFound = true; withReceipt += 1; }
      }

      return {
        line: r.line,
        date: r.date,
        amount: r.amount,
        currency,
        merchant: r.merchant,
        description: r.description,
        accountCode: acct ? acct.code : '',
        accountName: acct ? acct.name : '',
        duplicate,
        dupReason,
        issues,
        importable,
        receiptFound,
      };
    });

    const receiptsHeld = pool.length;
    return ok({
      rows: preview,
      summary: { total: preview.length, duplicates, ready, withReceipt, receiptsHeld, receiptsUnmatched: pool.filter((p) => !p.used).length },
      headers,
      unmatched,
      format,
    });
  } catch (err) {
    return error(err);
  }
};
