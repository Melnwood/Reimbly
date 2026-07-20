'use strict';

// Create expenses from the rows the person chose in the import preview. Each
// becomes a normal Submitted expense owned by the uploader, tagged in Notes so
// it's clear it came from a spreadsheet, and recorded on the activity trail.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, STATUS, EVENTS, DEFAULT_PAYMENT_METHOD,
  ensureStaff, resolveCurrencyId, resolveAccountId, dupKey, logActivity,
} = require('./lib/domain');

const MAX_ROWS = 500;
const today = () => new Date().toISOString().slice(0, 10);

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { id: staffId } = await ensureStaff(user);

    const body = parseBody(event);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const source = String(body.source || 'spreadsheet').slice(0, 120);
    if (!rows.length) throw badRequest('Nothing was selected to import.');
    if (rows.length > MAX_ROWS) throw badRequest(`Too many rows at once (max ${MAX_ROWS}).`);

    const created = [];
    const skipped = [];
    const batchKeys = new Set(); // guard against the same row twice in one commit

    for (const r of rows) {
      const line = r.line || '?';
      const amount = Number(r.amount);
      const date = String(r.date || '').trim();
      const currency = String(r.currency || 'USD').trim().toUpperCase();
      const account = String(r.account || r.accountCode || '').trim();
      const description = String(r.description || r.merchant || '').trim();
      const merchant = String(r.merchant || '').trim();

      if (!(amount > 0) || !date) { skipped.push({ line, reason: 'Missing amount or date' }); continue; }
      if (!description) { skipped.push({ line, reason: 'Missing description' }); continue; }
      if (!account) { skipped.push({ line, reason: 'No account chosen' }); continue; }

      const key = dupKey({ amount, date, merchant });
      if (key && batchKeys.has(key)) { skipped.push({ line, reason: 'Duplicate of another selected row' }); continue; }

      const currencyId = await resolveCurrencyId(currency);
      if (!currencyId) { skipped.push({ line, reason: `Currency "${currency}" isn't set up` }); continue; }
      const accountId = await resolveAccountId(account);
      if (!accountId) { skipped.push({ line, reason: `Account "${account}" isn't in the chart` }); continue; }

      const fields = {
        Description: description,
        'Expense Date': date,
        Amount: amount,
        'Payment Method': DEFAULT_PAYMENT_METHOD,
        Status: STATUS.SUBMITTED,
        'Submitted On': today(),
        Notes: `Imported from ${source}`,
        Submitter: [staffId],
        Currency: [currencyId],
        Account: [accountId],
      };
      if (merchant) fields.Merchant = merchant;

      const rec = await airtable.createRecord(TABLES.EXPENSES, fields);
      await logActivity({ expenseId: rec.id, event: EVENTS.SUBMITTED, user, note: `Imported from ${source}` });
      if (key) batchKeys.add(key);
      created.push(rec.id);
    }

    return ok({ created: created.length, skipped });
  } catch (err) {
    return error(err);
  }
};
