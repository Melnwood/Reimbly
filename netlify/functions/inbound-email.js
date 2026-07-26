'use strict';

// Turn a forwarded receipt email into a Submitted expense, automatically.
// A small Google Apps Script (see integrations/gmail-to-rembly.gs) finds receipt
// emails and POSTs each one here. We read every receipt with
// Claude (image, PDF, or the email's own text) and file it for the sender to
// review in "My expenses". Protected by a shared secret, not Google sign-in,
// because it's called by a machine.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const airtable = require('./lib/airtable');
const { pickBest } = require('./lib/matching');
const {
  TABLES, STATUS, EVENTS, DEFAULT_PAYMENT_METHOD,
  ensureStaff, resolveCurrencyId, resolveAccountId, listAccounts, logActivity,
  displayMaps, shapeExpense,
} = require('./lib/domain');
const { scanReceipt, scanText, isScannable } = require('./lib/scanner');

const MAX_ATTACHMENTS = 20;
const MIN_ATTACH_BYTES = 8 * 1024; // skip tiny images (logos, signatures)
const MAX_ATTACH_BYTES = 8 * 1024 * 1024;
const today = () => new Date().toISOString().slice(0, 10);
const bytesOf = (b64) => Math.floor((String(b64 || '').length * 3) / 4);

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const secret = process.env.INBOUND_EMAIL_SECRET;
    if (!secret) {
      const err = new Error('Email intake is not turned on yet.');
      err.statusCode = 503;
      throw err;
    }
    const headers = event.headers || {};
    const body = parseBody(event);
    const provided = headers['x-reimbly-secret'] || headers['X-Reimbly-Secret'] || body.secret;
    if (provided !== secret) {
      const err = new Error('Not authorized.');
      err.statusCode = 401;
      throw err;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      const err = new Error('Receipt reading is not turned on yet.');
      err.statusCode = 503;
      throw err;
    }

    const from = String(body.from || '').trim().toLowerCase();
    if (!from) {
      const err = new Error('Missing the sender email.');
      err.statusCode = 400;
      throw err;
    }
    const name = String(body.name || '').trim() || from;
    const subject = String(body.subject || '').trim();
    const receiptDate = /^\d{4}-\d{2}-\d{2}/.test(String(body.receivedAt || '')) ? String(body.receivedAt).slice(0, 10) : null;
    const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, MAX_ATTACHMENTS) : [];

    const user = { email: from, name };
    const { id: staffId } = await ensureStaff(user);

    // In "inbox" mode (used with the YNAB flow) a receipt doesn't become an
    // expense on its own — it's held as a Draft until a YNAB row claims it, or
    // it's attached straight to an expense that's already waiting for a receipt.
    const inbox = body.mode === 'inbox' || process.env.RECEIPT_INBOX_MODE === '1';

    let accounts = [];
    try { accounts = await listAccounts(); } catch (e) { console.error('[reimbly] accounts load failed', e); }

    // For inbox mode: the person's expenses that are still missing a receipt, so
    // a newly-arrived receipt can attach itself to the right one.
    let needyPool = [];
    if (inbox) {
      try {
        const emailEsc = from.replace(/'/g, "\\'");
        const [recs, maps] = await Promise.all([
          airtable.listRecords(TABLES.EXPENSES, {
            filterByFormula: `AND(LOWER(ARRAYJOIN({Submitter Email})) = '${emailEsc}', OR({Status} = '${STATUS.SUBMITTED}', {Status} = '${STATUS.APPROVED}'))`,
          }),
          displayMaps(),
        ]);
        needyPool = recs
          .map((r) => shapeExpense(r, maps))
          .filter((e) => !e.receipt)
          .map((e) => ({ id: e.id, amount: e.amount, date: e.date, merchant: e.merchant, currency: e.currency || 'USD', used: false }));
      } catch (e) {
        console.error('[reimbly] needy pool load failed', e && e.message);
      }
    }

    const createFromScan = async (scan, receipt) => {
      const target = { amount: scan.amount, date: scan.date || receiptDate, merchant: scan.merchant, currency: (scan.currency || 'USD').toUpperCase() };

      // Inbox mode: attach to a waiting expense if one matches, else hold as Draft.
      if (inbox) {
        if (receipt) {
          const idx = pickBest(target, needyPool);
          if (idx >= 0) {
            const hit = needyPool[idx];
            hit.used = true;
            try { await airtable.uploadAttachment(hit.id, 'Receipt', receipt); } catch (e) { console.error('[reimbly] email receipt attach failed', e); }
            await logActivity({ expenseId: hit.id, event: EVENTS.EDITED, user, note: 'Receipt matched from email' });
            return { id: hit.id, amount: scan.amount, merchant: scan.merchant, attachedTo: hit.id };
          }
        }
        const heldFields = {
          Description: scan.description || scan.merchant || subject || 'Emailed receipt',
          'Expense Date': scan.date || receiptDate || today(),
          'Payment Method': DEFAULT_PAYMENT_METHOD,
          Status: STATUS.DRAFT,
          Notes: `Captured from email — awaiting a match${subject ? `: ${subject}` : ''}`,
          Submitter: [staffId],
        };
        if (scan.amount != null) heldFields.Amount = scan.amount;
        const heldCur = await resolveCurrencyId(scan.currency || 'USD');
        if (heldCur) heldFields.Currency = [heldCur];
        if (scan.merchant) heldFields.Merchant = scan.merchant;
        if (scan.time) heldFields['Receipt Time'] = scan.time;
        // Keep the account Claude read off the receipt, so the held receipt (and
        // any YNAB row that later adopts it) comes in already coded.
        const heldAcct = scan.account ? await resolveAccountId(scan.account) : null;
        if (heldAcct) heldFields.Account = [heldAcct];
        const draft = await airtable.createRecord(TABLES.EXPENSES, heldFields);
        if (receipt) {
          try { await airtable.uploadAttachment(draft.id, 'Receipt', receipt); } catch (e) { console.error('[reimbly] held receipt attach failed', e); }
        }
        return { id: draft.id, amount: scan.amount, merchant: scan.merchant, held: true };
      }

      // Default mode: a receipt becomes a Submitted expense right away.
      const currencyId = await resolveCurrencyId(scan.currency || 'USD');
      const accountId = scan.account ? await resolveAccountId(scan.account) : null;
      const fields = {
        Description: scan.description || scan.merchant || subject || 'Emailed receipt',
        'Expense Date': scan.date || receiptDate || today(),
        'Payment Method': DEFAULT_PAYMENT_METHOD,
        Status: STATUS.SUBMITTED,
        'Submitted On': today(),
        Notes: `From email${subject ? `: ${subject}` : ''}`,
        Submitter: [staffId],
      };
      if (scan.amount != null) fields.Amount = scan.amount;
      if (currencyId) fields.Currency = [currencyId];
      if (accountId) fields.Account = [accountId];
      if (scan.merchant) fields.Merchant = scan.merchant;
      if (scan.time) fields['Receipt Time'] = scan.time;

      const rec = await airtable.createRecord(TABLES.EXPENSES, fields);
      if (receipt) {
        try { await airtable.uploadAttachment(rec.id, 'Receipt', receipt); } catch (e) { console.error('[reimbly] email receipt attach failed', e); }
      }
      await logActivity({ expenseId: rec.id, event: EVENTS.SUBMITTED, user, note: 'From email' });
      return { id: rec.id, amount: scan.amount, merchant: scan.merchant, hasReceipt: !!receipt };
    };

    const created = [];
    const skipped = [];

    const usable = attachments.filter((a) => a && a.base64 && isScannable(a.contentType) && bytesOf(a.base64) >= MIN_ATTACH_BYTES && bytesOf(a.base64) <= MAX_ATTACH_BYTES);
    for (const att of usable) {
      try {
        const scan = await scanReceipt(att, { accounts });
        if (!scan) { skipped.push({ filename: att.filename, reason: 'Unreadable file type' }); continue; }
        created.push(await createFromScan(scan, { filename: att.filename || 'receipt', contentType: att.contentType, base64: att.base64 }));
      } catch (e) {
        console.error('[reimbly] attachment scan failed', e);
        skipped.push({ filename: att.filename, reason: 'Could not read attachment' });
      }
    }

    // No usable attachment (e.g. an HTML-only Uber/hotel receipt) — read the body.
    // Skipped in inbox mode: with no file to attach later, there's nothing to hold.
    if (!created.length && !inbox) {
      const text = String(body.text || '').trim();
      if (text) {
        try {
          const scan = await scanText(text, { accounts });
          if (scan && (scan.amount != null || scan.merchant)) created.push(await createFromScan(scan, null));
          else skipped.push({ filename: '(email body)', reason: 'No receipt details found' });
        } catch (e) {
          console.error('[reimbly] body scan failed', e);
          skipped.push({ filename: '(email body)', reason: 'Could not read email body' });
        }
      }
    }

    const held = created.filter((c) => c && c.held).length;
    const attached = created.filter((c) => c && c.attachedTo).length;
    const madeExpenses = created.length - held - attached;
    return ok({ created: madeExpenses, held, attached, items: created, skipped });
  } catch (err) {
    return error(err);
  }
};
