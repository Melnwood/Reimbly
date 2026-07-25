'use strict';

// Turn a forwarded receipt email into a Submitted expense, automatically.
// A small Google Apps Script (see integrations/gmail-to-rembly.gs) finds receipt
// emails and POSTs each one here. We read every receipt with
// Claude (image, PDF, or the email's own text) and file it for the sender to
// review in "My expenses". Protected by a shared secret, not Google sign-in,
// because it's called by a machine.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const airtable = require('./lib/airtable');
const {
  TABLES, STATUS, EVENTS, DEFAULT_PAYMENT_METHOD,
  ensureStaff, resolveCurrencyId, resolveAccountId, listAccounts, logActivity,
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

    let accounts = [];
    try { accounts = await listAccounts(); } catch (e) { console.error('[reimbly] accounts load failed', e); }

    const createFromScan = async (scan, receipt) => {
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
    if (!created.length) {
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

    return ok({ created: created.length, items: created, skipped });
  } catch (err) {
    return error(err);
  }
};
