'use strict';

// Re-read one expense's attached receipt with the current reader: correct the
// DATE if it changed, and record where the total & date sit on the image so the
// reviewer's highlight shows on receipts added before that feature existed. Used
// by the "Re-read receipt dates" action — one expense per call to stay well
// within the per-request time limit. Amount/account are left alone.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, ensureStaff, getExpenseById, listAccounts, isApprover } = require('./lib/domain');
const { scanReceipt, isScannable } = require('./lib/scanner');

const owns = (rec, email) => ((rec.fields && rec.fields['Submitter Email']) || []).join(',').toLowerCase() === String(email).toLowerCase();

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      const err = new Error('Receipt reading isn’t turned on (ANTHROPIC_API_KEY).');
      err.statusCode = 503;
      throw err;
    }
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);

    const body = parseBody(event);
    const id = String(body.id || '').trim();
    if (!id) { const e = new Error('Missing the expense id.'); e.statusCode = 400; throw e; }

    const rec = await getExpenseById(id);
    if (!rec) { const e = new Error('That expense no longer exists.'); e.statusCode = 404; throw e; }
    if (!owns(rec, user.email) && !isApprover(role)) { const e = new Error('That isn’t your expense.'); e.statusCode = 403; throw e; }

    const att = Array.isArray(rec.fields.Receipt) ? rec.fields.Receipt[0] : null;
    if (!att || !att.url || !isScannable(att.type)) return ok({ id, changed: false, reason: 'no readable receipt' });

    const resp = await fetch(att.url);
    if (!resp || !resp.ok) return ok({ id, changed: false, reason: 'could not fetch receipt' });
    const base64 = Buffer.from(await resp.arrayBuffer()).toString('base64');

    let accounts = [];
    try { accounts = await listAccounts(); } catch (e) { /* account isn't needed for a date re-read */ }

    const scan = await scanReceipt({ filename: att.filename || 'receipt', contentType: att.type, base64 }, { accounts });
    const old = rec.fields['Expense Date'] || null;
    const next = scan && scan.date ? scan.date : null;

    const patch = {};
    if (next && next !== old) patch['Expense Date'] = next;
    // Backfill the highlight positions (the total & date on the image).
    const marks = scan && (scan.amountBox || scan.dateBox)
      ? { amount: scan.amountBox || null, date: scan.dateBox || null } : null;
    if (marks) patch['Receipt Marks'] = JSON.stringify(marks);

    if (!Object.keys(patch).length) return ok({ id, merchant: rec.fields.Merchant || '', changed: false, date: old });
    await airtable.updateRecord(TABLES.EXPENSES, id, patch);
    return ok({ id, merchant: rec.fields.Merchant || '', changed: !!patch['Expense Date'], marked: !!marks, old, date: next || old });
  } catch (err) {
    return error(err);
  }
};
