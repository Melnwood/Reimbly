'use strict';

// Create expenses from the rows the person chose in the import preview. Each
// comes in as an Unsubmitted (Draft) expense owned by the uploader, tagged in
// Notes so it's clear it came from a spreadsheet, and recorded on the activity
// trail. The person reviews them in "My expenses" and hits Submit to send the
// whole batch for approval — importing is not the same as submitting.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { pickBest } = require('./lib/matching');
const {
  TABLES, STATUS, EVENTS, DEFAULT_PAYMENT_METHOD,
  ensureStaff, resolveCurrencyId, accountAccessFor, dupKey, logActivity, heldReceiptsFor,
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
    // Label the origin so each expense shows how it got in (YNAB vs a plain CSV).
    const kind = String(body.kind || '').toLowerCase() === 'ynab' ? 'YNAB' : 'CSV';
    const originNote = `Imported from ${kind} · ${source}`;
    if (!rows.length) throw badRequest('Nothing was selected to import.');
    if (rows.length > MAX_ROWS) throw badRequest(`Too many rows at once (max ${MAX_ROWS}).`);

    const created = [];
    const skipped = [];
    let attached = 0; // rows that adopted a held email receipt
    const batchKeys = new Set(); // guard against the same row twice in one commit
    const access = await accountAccessFor(user.email); // account access for this person

    // Option #2: pull matching receipts in from the email holding pool.
    const attachReceipts = body.attachReceipts !== false; // default on
    let pool = [];
    if (attachReceipts) {
      try {
        const held = await heldReceiptsFor(user.email);
        pool = held.map((h) => ({
          record: h.record,
          amount: h.exp.amount, date: h.exp.date, merchant: h.exp.merchant,
          currency: h.exp.currency || 'USD', used: false,
        }));
      } catch (e) { console.error('[rembly] held receipts load failed', e && e.message); }
    }

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

      const key = dupKey({ amount, date, merchant });
      if (key && batchKeys.has(key)) { skipped.push({ line, reason: 'Duplicate of another selected row' }); continue; }

      const currencyId = await resolveCurrencyId(currency);
      if (!currencyId) { skipped.push({ line, reason: `Currency "${currency}" isn't set up` }); continue; }

      // The account is optional — budget exports (like YNAB) don't carry a GL
      // account. When one is given we validate it; otherwise the expense comes in
      // uncoded and gets an account assigned during review/approval.
      let accountId = null;
      if (account) {
        const acct = access.accounts.find((a) => String(a.code) === account);
        if (!acct) { skipped.push({ line, reason: `Account "${account}" isn't in the chart` }); continue; }
        if (!access.visibleIds.has(acct.id)) { skipped.push({ line, reason: `No access to account ${account}` }); continue; }
        accountId = acct.id;
      }

      const fields = {
        Description: description,
        'Expense Date': date,
        Amount: amount,
        'Payment Method': DEFAULT_PAYMENT_METHOD,
        // Land as Unsubmitted — the uploader reviews the batch and submits it.
        Status: STATUS.DRAFT,
        // Stamp an entry date so imported rows sort with the newest expenses in
        // "My expenses" (this is not the same as being submitted for approval).
        'Submitted On': today(),
        Notes: originNote,
        Submitter: [staffId],
        Currency: [currencyId],
      };
      if (accountId) fields.Account = [accountId];
      if (merchant) fields.Merchant = merchant;

      // If a held email receipt matches this row, adopt it (promote that Draft to
      // a Submitted expense, keeping its attached receipt) instead of making a new
      // record. YNAB is the source of truth, so its values overwrite the draft's.
      const match = attachReceipts ? pickBest({ amount, date, merchant, currency }, pool) : -1;
      let recId;
      if (match >= 0) {
        const draft = pool[match];
        draft.used = true;
        const updated = await airtable.updateRecord(TABLES.EXPENSES, draft.record.id, fields);
        recId = updated.id;
        attached += 1;
      } else {
        const rec = await airtable.createRecord(TABLES.EXPENSES, fields);
        recId = rec.id;
      }
      await logActivity({ expenseId: recId, event: EVENTS.IMPORTED, user, note: originNote });
      if (key) batchKeys.add(key);
      created.push({ id: recId, hasReceipt: match >= 0 });
    }

    return ok({ created: created.length, attached, needsReceipt: created.length - attached, items: created, skipped });
  } catch (err) {
    return error(err);
  }
};
