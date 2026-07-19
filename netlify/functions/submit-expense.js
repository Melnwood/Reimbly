'use strict';

// Create an expense for the signed-in person, then upload the receipt straight
// onto the new record via Airtable's content API.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { EXPENSES_TABLE, ensureStaff, toUsd, shapeExpense } = require('./lib/domain');

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024; // ~8 MB decoded

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
    await ensureStaff(user); // make sure they have a Staff record
    const body = parseBody(event);

    const description = String(body.description || '').trim();
    const amount = Number(body.amount);
    const currency = String(body.currency || 'USD').trim().toUpperCase();
    const category = String(body.category || '').trim();
    const date = String(body.date || '').trim();

    if (!description) throw badRequest('Please add a short description.');
    if (!isFinite(amount) || amount <= 0) throw badRequest('Amount must be greater than zero.');
    if (!currency) throw badRequest('Please choose a currency.');
    if (!date) throw badRequest('Please pick the date of the expense.');

    const receipt = validateReceipt(body.receipt);
    const { usd, converted } = await toUsd(amount, currency);

    const fields = {
      Description: description,
      Amount: amount,
      Currency: currency,
      'Amount (USD)': usd,
      Category: category || 'Other',
      Date: date,
      Status: 'Submitted',
      'Submitter Email': user.email,
      'Submitter Name': user.name,
      'Submitted On': new Date().toISOString(),
    };

    const record = await airtable.createRecord(EXPENSES_TABLE, fields);

    let receiptWarning = null;
    if (receipt) {
      try {
        await airtable.uploadAttachment(record.id, 'Receipt', receipt);
      } catch (e) {
        // The expense is saved; just flag that the receipt didn't attach.
        console.error('[reimbly] receipt upload failed', e);
        receiptWarning = 'Your expense was saved, but the receipt did not attach. You can add it in Airtable.';
      }
    }

    // Re-read so the response reflects the attached receipt + any computed fields.
    const fresh = await airtable.findFirst(EXPENSES_TABLE, {
      filterByFormula: `RECORD_ID() = '${record.id}'`,
    });

    return ok({
      expense: shapeExpense(fresh || record),
      converted,
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
  // base64 length ≈ 4/3 of byte size.
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > MAX_RECEIPT_BYTES) {
    throw badRequest('Receipt is too large (max 8 MB). Try a photo instead of a scan.');
  }
  return { filename, contentType, base64 };
}
