'use strict';

// Read a receipt photo (or PDF) with Claude's vision and return the fields
// pre-filled for the submit form: amount, currency, date, merchant,
// description, and a best-fit GL account (read live from the Accounts table).
// Best-effort — any field it can't read comes back null and the person just
// fills it in.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { CURRENCY_CODES, listAccounts } = require('./lib/domain');

// The SDK's CJS shape has varied across versions — accept them all.
const SDK = require('@anthropic-ai/sdk');
const Anthropic = SDK.Anthropic || SDK.default || SDK;

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': 1, 'image/jpg': 1, 'image/png': 1, 'image/gif': 1, 'image/webp': 1 };

function receiptTool() {
  return {
    name: 'record_receipt',
    description: 'Record the details read from a receipt so an expense form can be pre-filled.',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: ['number', 'null'], description: 'The total amount paid, as a number (no currency symbol). null if not legible.' },
        currency: { type: ['string', 'null'], enum: [...CURRENCY_CODES, null], description: 'ISO code of the currency shown on the receipt.' },
        date: { type: ['string', 'null'], description: 'Date of purchase as YYYY-MM-DD. null if not legible.' },
        merchant: { type: ['string', 'null'], description: 'The store or vendor name.' },
        description: { type: ['string', 'null'], description: 'A short, human description in English, e.g. "Lunch at Cafe Louvre" or "Train ticket Praha–Ostrava".' },
        account: { type: ['string', 'null'], description: 'The single best-fit GL account CODE from the account list in the instructions. Return only the numeric code, e.g. "8394000". null if unsure.' },
      },
      required: ['amount', 'currency', 'date', 'merchant', 'description', 'account'],
      additionalProperties: false,
    },
  };
}

function prompt(accounts) {
  const legend = accounts.map((a) => `${a.code} = ${a.name}`).join('\n');
  return (
    'This is a receipt for a staff expense at Josiah Venture, a ministry working across ' +
    'Central & Eastern Europe (so receipts are often in Czech, Polish, German, and other ' +
    'languages, in local currencies). Read it carefully and call record_receipt with what ' +
    'you find. Use the total actually paid and the currency printed on the receipt. Translate ' +
    'the description to English. If a field is not legible, return null for it rather than guessing.\n\n' +
    'For "account", choose the single best-fit GL account and return only its numeric code from ' +
    'this list:\n' + legend
  );
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function mediaBlock(receipt) {
  const type = String(receipt.contentType || '').toLowerCase();
  if (IMAGE_TYPES[type]) {
    const mediaType = type === 'image/jpg' ? 'image/jpeg' : type;
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: receipt.base64 } };
  }
  if (type === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: receipt.base64 } };
  }
  return null;
}

// Keep only values the app can use; drop anything off-list. `accountCodes` is a
// Set of the valid GL codes (empty if the accounts couldn't be loaded).
function normalize(input = {}, { accountCodes = new Set() } = {}) {
  const clean = (v) => (typeof v === 'string' ? v.trim() : v);
  const amount = Number(input.amount);
  const currency = clean(input.currency);
  const date = clean(input.date);
  const account = clean(input.account);
  return {
    amount: isFinite(amount) && amount > 0 ? amount : null,
    currency: CURRENCY_CODES.includes(String(currency || '').toUpperCase())
      ? String(currency).toUpperCase()
      : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : null,
    merchant: clean(input.merchant) || null,
    description: clean(input.description) || null,
    account: account && accountCodes.has(String(account)) ? String(account) : null,
  };
}

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    await verifyRequest(event.headers); // JV sign-in only — protects the API key
    if (!process.env.ANTHROPIC_API_KEY) {
      const err = new Error('Receipt scanning is not turned on yet.');
      err.statusCode = 503;
      throw err;
    }

    const { receipt } = parseBody(event);
    if (!receipt || !receipt.base64) throw badRequest('No receipt was provided.');

    const approxBytes = Math.floor((receipt.base64.length * 3) / 4);
    if (approxBytes > MAX_RECEIPT_BYTES) throw badRequest('Receipt is too large to scan (max 8 MB).');

    const block = mediaBlock(receipt);
    if (!block) return ok({ scan: null, unsupported: true }); // e.g. a .heic — just fill manually

    // Load the chart of accounts so the model can pick a real GL code.
    let accounts = [];
    try {
      accounts = await listAccounts();
    } catch (e) {
      console.error('[reimbly] could not load accounts for scan', e);
    }
    const accountCodes = new Set(accounts.map((a) => a.code));

    const client = new Anthropic();
    const message = await client.messages.create({
      model: process.env.SCAN_MODEL || 'claude-opus-4-8',
      max_tokens: 1024,
      tools: [receiptTool()],
      tool_choice: { type: 'tool', name: 'record_receipt' },
      messages: [{ role: 'user', content: [block, { type: 'text', text: prompt(accounts) }] }],
    });

    const toolUse = (message.content || []).find((b) => b.type === 'tool_use');
    return ok({ scan: normalize(toolUse ? toolUse.input : {}, { accountCodes }) });
  } catch (err) {
    // A scan failure should never block submitting — surface a soft error.
    if (!err.statusCode) {
      console.error('[reimbly] scan failed', err);
      return ok({ scan: null, error: 'Could not read the receipt automatically.' });
    }
    return error(err);
  }
};

module.exports.normalize = normalize; // exported for tests
