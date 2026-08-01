'use strict';

// Edit an existing expense. Owners may edit their own while it's Submitted /
// Sent back / Draft; approvers and finance may edit any. Editing a sent-back
// (Rejected) expense resubmits it fresh for approval.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { scanReceipt } = require('./lib/scanner');
const {
  TABLES,
  STATUS,
  EVENTS,
  ensureStaff,
  getExpenseById,
  canModify,
  resolveCurrencyId,
  accountAccessFor,
  displayMaps,
  shapeExpense,
  logActivity,
  getReportById,
  reportOwnedBy,
  householdScope,
} = require('./lib/domain');
const { isValidCategory, accountName } = require('./lib/coding');

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const today = () => new Date().toISOString().slice(0, 10);

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function validateReceipt(receipt) {
  if (!receipt || !receipt.base64) return null;
  const { filename, contentType, base64 } = receipt;
  if (!filename || !contentType) throw badRequest('Receipt is missing its filename or type.');
  if (Math.floor((base64.length * 3) / 4) > MAX_RECEIPT_BYTES) {
    throw badRequest('Receipt is too large (max 8 MB).');
  }
  return { filename, contentType, base64 };
}

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role, record: staffRec } = await ensureStaff(user);
    // The household this person is pooled with — a partner may finish their
    // expenses and file them into the household's reports.
    const { ids: householdIds, emails: householdEmails } = await householdScope(staffRec);
    const body = parseBody(event);

    const id = String(body.id || '').trim();
    if (!id) throw badRequest('Missing the expense id.');

    const current = await getExpenseById(id);
    if (!current) throw badRequest('That expense no longer exists.');
    if (!canModify(current, user, role, householdEmails)) {
      const err = new Error('You can only edit your own expenses before they’re approved.');
      err.statusCode = 403;
      throw err;
    }

    // Just remove the receipt (the wrong one was attached) — a standalone action
    // that doesn't need the rest of the form. Also clears the foreign amount that
    // was read off that receipt, since it came from the wrong image.
    if (body.removeReceipt === true && !body.receipt) {
      await airtable.updateRecord(TABLES.EXPENSES, id, {
        Receipt: [], 'Original Amount': null, 'Original Currency': '',
      });
      await logActivity({ expenseId: id, event: EVENTS.EDITED, user, note: 'Removed the receipt' });
      const [fresh, maps] = await Promise.all([getExpenseById(id), displayMaps()]);
      return ok({ expense: shapeExpense(fresh || current, maps) });
    }

    const description = String(body.description || '').trim();
    const merchant = String(body.merchant || '').trim();
    const amount = Number(body.amount);
    const currency = String(body.currency || 'USD').trim().toUpperCase();
    const account = String(body.account || '').trim();       // the GL category code
    const expenseAccount = String(body.expenseAccount || '').trim(); // optional (main form only)
    const date = String(body.date || '').trim();

    if (!description) throw badRequest('Please add a short description.');
    if (!isFinite(amount) || amount <= 0) throw badRequest('Amount must be greater than zero.');
    if (!date) throw badRequest('Please pick the date of the expense.');
    if (!account) throw badRequest('Please choose an expense category.');
    // When the account came along (main form), enforce the fund → category rule.
    if (expenseAccount) {
      if (!accountName(expenseAccount)) throw badRequest('That account isn’t recognised.');
      if (!isValidCategory(expenseAccount, account)) throw badRequest('That category isn’t valid for this account.');
    }

    const currencyId = await resolveCurrencyId(currency);
    if (!currencyId) throw badRequest(`Currency "${currency}" isn't set up in the base yet.`);
    const access = await accountAccessFor(user.email);
    const acct = access.accounts.find((a) => String(a.code) === account);
    if (!acct) throw badRequest(`Account "${account}" isn't in the chart of accounts.`);
    if (!access.visibleIds.has(acct.id)) {
      const err = new Error('You don’t have access to that account.');
      err.statusCode = 403;
      throw err;
    }
    const accountId = acct.id;

    const fields = {
      Description: description,
      Merchant: merchant,
      'Expense Date': date,
      Amount: amount,
      Currency: [currencyId],
      Account: [accountId],
    };
    if (expenseAccount) fields['Expense Account'] = `${expenseAccount} – ${accountName(expenseAccount)}`;

    // Optionally move the expense into (or out of) a report in the same save, so
    // filing it happens together with the edits — no separate step.
    if (Object.prototype.hasOwnProperty.call(body, 'reportId')) {
      const reportId = String(body.reportId || '').trim();
      if (reportId) {
        const report = await getReportById(reportId);
        if (!report || !reportOwnedBy(report, householdIds)) {
          const err = new Error('That isn’t one of your reports.');
          err.statusCode = 403;
          throw err;
        }
      }
      fields.Report = reportId ? [reportId] : [];
    }

    // Editing a sent-back expense sends it back through for approval, clean.
    const wasRejected = (current.fields && current.fields.Status) === STATUS.REJECTED;
    if (wasRejected) {
      fields.Status = STATUS.SUBMITTED;
      fields['Submitted On'] = today();
      fields['Decided On'] = null;
      fields.Approver = [];
      fields['Approver Note'] = '';
    }

    // Save the edits first so they're never lost to a receipt problem.
    await airtable.updateRecord(TABLES.EXPENSES, id, fields);

    // Attaching the receipt is best-effort: if the upload fails (e.g. the photo
    // is too big for Airtable), the edit still sticks and we just warn.
    let receiptWarning = null;
    const receipt = validateReceipt(body.receipt);
    if (receipt) {
      try {
        await airtable.updateRecord(TABLES.EXPENSES, id, { Receipt: [] }); // replace, don't append
        await airtable.uploadAttachment(id, 'Receipt', receipt);
      } catch (e) {
        console.error('[reimbly] receipt upload failed', e);
        receiptWarning = 'Your changes were saved, but the receipt didn’t attach. Try a smaller photo.';
      }
      // Read the receipt for its ORIGINAL (foreign) amount. When the expense's
      // own amount is the bank/USD figure (e.g. a YNAB import) and the receipt is
      // in another currency, record that foreign amount so the app can show the
      // real exchange rate (bank USD ÷ foreign). Best-effort — never blocks.
      if (!receiptWarning && process.env.ANTHROPIC_API_KEY) {
        try {
          const scan = await scanReceipt(receipt, { accounts: [] });
          const foreignCur = scan && scan.currency ? String(scan.currency).toUpperCase() : '';
          const foreignAmt = scan && scan.amount != null ? Number(scan.amount) : null;
          const patch = {};
          if (foreignCur && foreignCur !== currency && foreignAmt > 0) {
            patch['Original Amount'] = foreignAmt;
            patch['Original Currency'] = foreignCur;
          }
          if (scan && scan.time) patch['Receipt Time'] = scan.time; // helps tell apart repeat charges
          if (Object.keys(patch).length) await airtable.updateRecord(TABLES.EXPENSES, id, patch);
        } catch (e) {
          console.error('[reimbly] fx read failed', e); // just skip the FX line
        }
      }
    }

    await logActivity({
      expenseId: id,
      event: wasRejected ? EVENTS.RESUBMITTED : EVENTS.EDITED,
      user,
    });

    const [fresh, maps] = await Promise.all([getExpenseById(id), displayMaps()]);
    return ok({ expense: shapeExpense(fresh || current, maps), resubmitted: wasRejected, warning: receiptWarning });
  } catch (err) {
    return error(err);
  }
};
