'use strict';

// Create an expense for the signed-in person, linking it to their Staff record,
// the chosen Category, and the Currency (which drives the base's automatic
// "Amount (USD)" formula). Then upload the receipt via Airtable's content API.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES,
  STATUS,
  DEFAULT_PAYMENT_METHOD,
  ensureStaff,
  resolveCurrencyId,
  resolveCategoryId,
  displayMaps,
  shapeExpense,
} = require('./lib/domain');

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024; // ~8 MB decoded

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

const today = () => new Date().toISOString().slice(0, 10);

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { id: staffId } = await ensureStaff(user);
    const body = parseBody(event);

    const description = String(body.description || '').trim();
    const amount = Number(body.amount);
    const currency = String(body.currency || 'USD').trim().toUpperCase();
    const category = String(body.category || '').trim();
    const date = String(body.date || '').trim();
    const purpose = String(body.purpose || '').trim();

    if (!description) throw badRequest('Please add a short description.');
    if (!isFinite(amount) || amount <= 0) throw badRequest('Amount must be greater than zero.');
    if (!date) throw badRequest('Please pick the date of the expense.');

    const receipt = validateReceipt(body.receipt);

    const currencyId = await resolveCurrencyId(currency);
    if (!currencyId) throw badRequest(`Currency "${currency}" isn't set up in the base yet.`);
    const categoryId = await resolveCategoryId(category);

    const fields = {
      Description: description,
      'Expense Date': date,
      Amount: amount,
      'Payment Method': DEFAULT_PAYMENT_METHOD,
      Status: STATUS.SUBMITTED,
      'Submitted On': today(),
      Submitter: [staffId],
      Currency: [currencyId],
    };
    if (categoryId) fields.Category = [categoryId];
    if (purpose) fields['Business Purpose'] = purpose;

    const created = await airtable.createRecord(TABLES.EXPENSES, fields);

    let receiptWarning = null;
    if (receipt) {
      try {
        await airtable.uploadAttachment(created.id, 'Receipt', receipt);
      } catch (e) {
        console.error('[reimbly] receipt upload failed', e);
        receiptWarning = 'Your expense was saved, but the receipt did not attach. You can add it in Airtable.';
      }
    }

    // Re-read so the response reflects the receipt and the computed Amount (USD).
    const [fresh, maps] = await Promise.all([
      airtable.findFirst(TABLES.EXPENSES, {
        filterByFormula: `RECORD_ID() = '${created.id}'`,
      }),
      displayMaps(),
    ]);

    return ok({
      expense: shapeExpense(fresh || created, maps),
      warning: receiptWarning,
    });
  } catch (err) {
    return error(err);
  }
};

function validateReceipt(receipt) {
  if (!receipt) return null;
  const { filename, contentType, base64 } = receipt;
  if (!base64) return null;
  if (!filename || !contentType) {
    throw badRequest('Receipt is missing its filename or type.');
  }
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > MAX_RECEIPT_BYTES) {
    throw badRequest('Receipt is too large (max 8 MB). Try a photo instead of a scan.');
  }
  return { filename, contentType, base64 };
}
