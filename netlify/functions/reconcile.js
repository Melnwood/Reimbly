'use strict';

// Reconcile a list of reimbursable expenses exported from a budget app against
// what's actually in Reimbly. For each row we try to find a matching expense the
// signed-in person already submitted; anything with no match is "missing" (the
// gap you care about). Also reports expenses in Reimbly, within the file's date
// range, that aren't on the budget list ("extra"). Writes nothing.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, CURRENCY_CODES, ensureStaff, listAccounts, displayMaps, shapeExpense, round2,
} = require('./lib/domain');
const { parseSpreadsheet } = require('./lib/importer');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 1000;
const CURRENCIES = new Set(CURRENCY_CODES);
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

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
    if (Math.floor((file.base64.length * 3) / 4) > MAX_FILE_BYTES) throw badRequest('That file is too large (max 5 MB).');

    const { rows, headers, unmatched } = parseSpreadsheet(file);
    if (!rows.length) throw badRequest('No rows found under the header row.');
    if (rows.length > MAX_ROWS) throw badRequest(`That file has ${rows.length} rows — please split it.`);

    const email = user.email.toLowerCase().replace(/'/g, "\\'");
    const [accounts, existingRecords, maps] = await Promise.all([
      listAccounts(),
      airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: `LOWER(ARRAYJOIN({Submitter Email})) = '${email}'`,
      }),
      displayMaps(),
    ]);
    const resolveAccount = makeAccountResolver(accounts);

    // A consumable pool of the person's existing expenses.
    const pool = existingRecords.map((r) => {
      const e = shapeExpense(r, maps);
      return {
        exp: e,
        amount: e.amount != null ? Math.abs(round2(e.amount)) : null,
        date: e.date ? String(e.date).slice(0, 10) : null,
        merchant: e.merchant,
        used: false,
      };
    });

    // Match on amount + day + merchant first, then amount + day.
    const claim = (amount, date, merchant) => {
      if (amount == null || !date) return null;
      let hit = pool.find((x) => !x.used && x.amount === amount && x.date === date && norm(x.merchant) === norm(merchant) && norm(merchant) !== '');
      if (!hit) hit = pool.find((x) => !x.used && x.amount === amount && x.date === date);
      if (hit) { hit.used = true; return hit.exp; }
      return null;
    };

    const dates = rows.map((r) => r.date).filter(Boolean).sort();
    const from = dates[0] || null;
    const to = dates[dates.length - 1] || null;

    const matched = [];
    const missing = [];
    for (const r of rows) {
      const amount = r.amount != null ? Math.abs(round2(r.amount)) : null;
      const currency = r.currency && CURRENCIES.has(r.currency) ? r.currency : (r.currency || 'USD');
      const acct = resolveAccount(r.account);
      const base = {
        line: r.line, date: r.date, amount, currency, merchant: r.merchant, description: r.description,
        accountCode: acct ? acct.code : '', accountName: acct ? acct.name : '',
      };
      const hit = claim(amount, r.date, r.merchant);
      if (hit) {
        matched.push({ ...base, matchedTo: { id: hit.id, status: hit.status, merchant: hit.merchant, date: hit.date } });
      } else {
        const issues = [];
        if (!(amount > 0)) issues.push('Amount');
        if (!r.date) issues.push('Date');
        missing.push({ ...base, importable: amount > 0 && !!r.date, duplicate: false, dupReason: '', issues });
      }
    }

    // Expenses in Reimbly, within the budget file's date range, not on the list.
    const extra = pool
      .filter((x) => !x.used && x.date && (!from || x.date >= from) && (!to || x.date <= to))
      .map((x) => ({ id: x.exp.id, date: x.date, amount: x.amount, currency: x.exp.currency, merchant: x.exp.merchant, description: x.exp.description, status: x.exp.status }));

    return ok({
      summary: { total: rows.length, matched: matched.length, missing: missing.length, extra: extra.length, from, to },
      matched, missing, extra, headers, unmatched,
    });
  } catch (err) {
    return error(err);
  }
};
