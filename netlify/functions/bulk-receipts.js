'use strict';

// Bulk receipt drop. The person picks a batch of receipt photos (on a phone this
// comes straight from their photo library). Rembly reads each with Claude and
// either attaches it to the matching expense that's missing a receipt, or — when
// nothing matches — creates a new Unsubmitted expense from what it read, with the
// photo attached, so nothing is lost. Best-effort per photo: one bad read never
// sinks the batch.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, STATUS, EVENTS,
  ensureStaff, householdScope, submitterEmailFormula,
  resolveCurrencyId, resolveAccountId,
  displayMaps, shapeExpense, isHeldEmailReceipt, logActivity,
} = require('./lib/domain');
const { scanReceipt } = require('./lib/scanner');
const { pickBest } = require('./lib/matching');

const MAX_PER_CALL = 12;
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const today = () => new Date().toISOString().slice(0, 10);

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function validReceipt(r) {
  if (!r || !r.base64 || !r.filename || !r.contentType) return null;
  if (Math.floor((r.base64.length * 3) / 4) > MAX_RECEIPT_BYTES) return null;
  return { filename: r.filename, contentType: r.contentType, base64: r.base64 };
}

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    if (!process.env.ANTHROPIC_API_KEY) {
      const err = new Error('Receipt reading is not turned on yet.');
      err.statusCode = 503;
      throw err;
    }
    const { id: staffId, record: staffRec } = await ensureStaff(user);
    const { emails } = await householdScope(staffRec);

    const body = parseBody(event);
    const receipts = Array.isArray(body.receipts) ? body.receipts : [];
    if (!receipts.length) throw badRequest('No receipts were provided.');
    if (receipts.length > MAX_PER_CALL) throw badRequest(`Please send at most ${MAX_PER_CALL} at a time.`);

    const maps = await displayMaps();

    // Candidate expenses to attach to: the household's own, still missing a
    // receipt, editable, not a held email receipt, and not one that chose to go
    // receipt-free with an affidavit.
    const householdRecs = await airtable.listRecords(TABLES.EXPENSES, {
      filterByFormula: submitterEmailFormula(emails.length ? emails : [user.email.toLowerCase()]),
    });
    const candidates = householdRecs
      .filter((r) => {
        const f = r.fields || {};
        const hasReceipt = Array.isArray(f.Receipt) && f.Receipt.length;
        const status = f.Status || '';
        const editable = status === STATUS.DRAFT || status === STATUS.SUBMITTED || status === STATUS.REJECTED;
        return !hasReceipt && editable && !isHeldEmailReceipt(f) && !f['Missing Receipt'];
      })
      .map((r) => ({ rec: r, e: shapeExpense(r, maps), used: false }));

    const results = { matched: 0, created: 0, failed: 0, items: [] };

    for (const raw of receipts) {
      const receipt = validReceipt(raw);
      if (!receipt) { results.failed += 1; results.items.push({ file: raw && raw.filename, status: 'failed', why: 'unreadable file' }); continue; }
      try {
        const scan = await scanReceipt(receipt, { accounts: [] });
        const amount = scan && scan.amount != null ? Number(scan.amount) : null;
        const currency = scan && scan.currency ? String(scan.currency).toUpperCase() : 'USD';
        const date = (scan && scan.date) || null;
        const time = (scan && scan.time) || '';
        const merchant = (scan && scan.merchant) || '';
        const accountCode = (scan && scan.account) ? String(scan.account) : '';

        // Try to attach to a matching expense that still needs a receipt.
        const pool = candidates.map((c) => (c.used
          ? { amount: null, date: null, merchant: '', currency: '' } // skip used ones
          : { amount: c.e.amount, date: c.e.date, merchant: c.e.merchant, currency: c.e.currency || 'USD' }));
        const idx = amount != null ? pickBest({ amount, date, merchant, currency }, pool) : -1;

        if (idx >= 0) {
          const cand = candidates[idx];
          cand.used = true;
          await airtable.updateRecord(TABLES.EXPENSES, cand.rec.id, { Receipt: [] });
          await airtable.uploadAttachment(cand.rec.id, 'Receipt', receipt);
          // If the receipt is foreign but the expense is the bank/USD amount,
          // record the original amount so the exchange rate can show.
          const patch = {};
          if (currency && currency !== (cand.e.currency || 'USD') && (cand.e.currency || 'USD') === 'USD' && amount > 0) {
            patch['Original Amount'] = amount; patch['Original Currency'] = currency;
          }
          if (time) patch['Receipt Time'] = time;
          if (Object.keys(patch).length) await airtable.updateRecord(TABLES.EXPENSES, cand.rec.id, patch);
          await logActivity({ expenseId: cand.rec.id, event: EVENTS.EDITED, user, note: 'Receipt matched from a photo upload' });
          results.matched += 1;
          results.items.push({ file: receipt.filename, status: 'matched', into: cand.rec.id, merchant: cand.e.merchant });
          continue;
        }

        // No match — create a new Unsubmitted expense from what we read.
        const currencyId = await resolveCurrencyId(currency).catch(() => null);
        const accountId = accountCode ? await resolveAccountId(accountCode).catch(() => null) : null;
        const fields = {
          Description: merchant || 'Receipt (from photo)',
          Status: STATUS.DRAFT,
          Submitter: [staffId],
          Notes: 'Added by photo',
        };
        if (merchant) fields.Merchant = merchant;
        if (amount != null && amount > 0) fields.Amount = amount;
        if (date) fields['Expense Date'] = date;
        if (time) fields['Receipt Time'] = time;
        if (currencyId) fields.Currency = [currencyId];
        if (accountId) fields.Account = [accountId];
        const created = await airtable.createRecord(TABLES.EXPENSES, fields);
        try {
          await airtable.uploadAttachment(created.id, 'Receipt', receipt);
        } catch (e) {
          console.error('[rembly] bulk receipt attach failed', e && e.message);
        }
        await logActivity({ expenseId: created.id, event: EVENTS.IMPORTED, user, note: 'Added from a photo upload' });
        results.created += 1;
        results.items.push({ file: receipt.filename, status: 'created', id: created.id, merchant });
      } catch (e) {
        console.error('[rembly] bulk receipt read failed', e && e.message);
        results.failed += 1;
        results.items.push({ file: receipt.filename, status: 'failed', why: 'could not read' });
      }
    }

    return ok(results);
  } catch (err) {
    return error(err);
  }
};
