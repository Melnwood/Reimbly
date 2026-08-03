'use strict';

// The shared "turn incoming emails into held receipts" core, used by both the
// forwarding endpoint (inbound-email, the old Apps Script path) and the new
// Gmail poller (gmail-poll). Given a sender + some attachments/text, it reads
// each with Claude, skips anything that isn't a receipt, and either attaches it
// to a waiting expense or holds it as a Draft for the person to file.

const airtable = require('./airtable');
const { pickBest } = require('./matching');
const {
  TABLES, STATUS, EVENTS, DEFAULT_PAYMENT_METHOD,
  resolveCurrencyId, resolveAccountId, listAccounts, logActivity, displayMaps, shapeExpense,
} = require('./domain');
const { scanReceipt, scanText, isScannable } = require('./scanner');

const MAX_ATTACHMENTS = 20;
const MIN_ATTACH_BYTES = 8 * 1024; // skip tiny images (logos, signatures)
const MAX_ATTACH_BYTES = 8 * 1024 * 1024;
const today = () => new Date().toISOString().slice(0, 10);
const bytesOf = (b64) => Math.floor((String(b64 || '').length * 3) / 4);

// user: { email, name }; staffId; subject; receivedAt (YYYY-MM-DD|null);
// attachments: [{ filename, contentType, base64 }]; text; mode: 'inbox'|'expense'.
async function intakeReceipts({ user, staffId, subject = '', receivedAt = null, attachments = [], text = '', mode }) {
  const inbox = mode === 'inbox' || process.env.RECEIPT_INBOX_MODE === '1';
  const receiptDate = /^\d{4}-\d{2}-\d{2}/.test(String(receivedAt || '')) ? String(receivedAt).slice(0, 10) : null;

  let accounts = [];
  try { accounts = await listAccounts(); } catch (e) { console.error('[reimbly] accounts load failed', e); }

  // Inbox mode: this person's expenses still missing a receipt, so an arriving
  // receipt can attach itself to the right one.
  let needyPool = [];
  if (inbox) {
    try {
      const emailEsc = String(user.email).toLowerCase().replace(/'/g, "\\'");
      const [recs, maps] = await Promise.all([
        airtable.listRecords(TABLES.EXPENSES, {
          filterByFormula: `AND(LOWER(ARRAYJOIN({Submitter Email})) = '${emailEsc}', OR({Status} = '${STATUS.SUBMITTED}', {Status} = '${STATUS.APPROVED}'))`,
        }),
        displayMaps(),
      ]);
      needyPool = recs.map((r) => shapeExpense(r, maps)).filter((e) => !e.receipt)
        .map((e) => ({ id: e.id, amount: e.amount, date: e.date, merchant: e.merchant, currency: e.currency || 'USD', used: false }));
    } catch (e) { console.error('[reimbly] needy pool load failed', e && e.message); }
  }

  const createFromScan = async (scan, receipt) => {
    const target = { amount: scan.amount, date: scan.date || receiptDate, merchant: scan.merchant, currency: (scan.currency || 'USD').toUpperCase() };
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
  const usable = (attachments || []).slice(0, MAX_ATTACHMENTS)
    .filter((a) => a && a.base64 && isScannable(a.contentType) && bytesOf(a.base64) >= MIN_ATTACH_BYTES && bytesOf(a.base64) <= MAX_ATTACH_BYTES);

  for (const att of usable) {
    try {
      const scan = await scanReceipt(att, { accounts });
      if (!scan) { skipped.push({ filename: att.filename, reason: 'Unreadable file type' }); continue; }
      if (scan.isReceipt === false) { skipped.push({ filename: att.filename, reason: 'Not a receipt' }); continue; }
      created.push(await createFromScan(scan, { filename: att.filename || 'receipt', contentType: att.contentType, base64: att.base64 }));
    } catch (e) {
      console.error('[reimbly] attachment scan failed', e);
      skipped.push({ filename: att.filename, reason: 'Could not read attachment' });
    }
  }

  // No usable attachment (e.g. an HTML-only receipt) — read the body. Skipped in
  // inbox mode: with no file to hold, there's nothing to attach later.
  if (!created.length && !inbox && String(text || '').trim()) {
    try {
      const scan = await scanText(String(text).trim(), { accounts });
      if (scan && scan.isReceipt !== false && scan.amount != null) created.push(await createFromScan(scan, null));
      else skipped.push({ filename: '(email body)', reason: 'No receipt details found' });
    } catch (e) {
      console.error('[reimbly] body scan failed', e);
      skipped.push({ filename: '(email body)', reason: 'Could not read email body' });
    }
  }

  const held = created.filter((c) => c && c.held).length;
  const attached = created.filter((c) => c && c.attachedTo).length;
  return { created, skipped, held, attached, madeExpenses: created.length - held - attached };
}

module.exports = { intakeReceipts };
