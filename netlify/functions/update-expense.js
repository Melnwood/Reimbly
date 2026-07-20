'use strict';

// Edit an existing expense. Owners may edit their own while it's Submitted /
// Sent back / Draft; approvers and finance may edit any. Editing a sent-back
// (Rejected) expense resubmits it fresh for approval.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES,
  STATUS,
  EVENTS,
  ensureStaff,
  getExpenseById,
  canModify,
  resolveCurrencyId,
  resolveAccountId,
  displayMaps,
  shapeExpense,
  logActivity,
} = require('./lib/domain');

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
    const { role } = await ensureStaff(user);
    const body = parseBody(event);

    const id = String(body.id || '').trim();
    if (!id) throw badRequest('Missing the expense id.');

    const current = await getExpenseById(id);
    if (!current) throw badRequest('That expense no longer exists.');
    if (!canModify(current, user, role)) {
      const err = new Error('You can only edit your own expenses before they’re approved.');
      err.statusCode = 403;
      throw err;
    }

    const description = String(body.description || '').trim();
    const merchant = String(body.merchant || '').trim();
    const amount = Number(body.amount);
    const currency = String(body.currency || 'USD').trim().toUpperCase();
    const account = String(body.account || '').trim();
    const date = String(body.date || '').trim();

    if (!description) throw badRequest('Please add a short description.');
    if (!isFinite(amount) || amount <= 0) throw badRequest('Amount must be greater than zero.');
    if (!date) throw badRequest('Please pick the date of the expense.');
    if (!account) throw badRequest('Please choose the account to charge this to.');

    const currencyId = await resolveCurrencyId(currency);
    if (!currencyId) throw badRequest(`Currency "${currency}" isn't set up in the base yet.`);
    const accountId = await resolveAccountId(account);
    if (!accountId) throw badRequest(`Account "${account}" isn't in the chart of accounts.`);

    const fields = {
      Description: description,
      Merchant: merchant,
      'Expense Date': date,
      Amount: amount,
      Currency: [currencyId],
      Account: [accountId],
    };

    // Editing a sent-back expense sends it back through for approval, clean.
    const wasRejected = (current.fields && current.fields.Status) === STATUS.REJECTED;
    if (wasRejected) {
      fields.Status = STATUS.SUBMITTED;
      fields['Submitted On'] = today();
      fields['Decided On'] = null;
      fields.Approver = [];
      fields['Approver Note'] = '';
    }

    const receipt = validateReceipt(body.receipt);
    if (receipt) {
      await airtable.updateRecord(TABLES.EXPENSES, id, { Receipt: [] }); // replace, don't append
      await airtable.uploadAttachment(id, 'Receipt', receipt);
    }

    await airtable.updateRecord(TABLES.EXPENSES, id, fields);
    await logActivity({
      expenseId: id,
      event: wasRejected ? EVENTS.RESUBMITTED : EVENTS.EDITED,
      user,
    });

    const [fresh, maps] = await Promise.all([getExpenseById(id), displayMaps()]);
    return ok({ expense: shapeExpense(fresh || current, maps), resubmitted: wasRejected });
  } catch (err) {
    return error(err);
  }
};
