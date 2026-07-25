'use strict';

// Shared receipt-reading core (used by the manual scan endpoint and the inbound
// email endpoint). Sends a receipt image/PDF — or the text of an email receipt —
// to Claude and returns normalized {amount, currency, date, merchant,
// description, account} with anything unreadable set to null.

const { CURRENCY_CODES } = require('./domain');

// The SDK's CJS shape has varied across versions — accept them all.
const SDK = require('@anthropic-ai/sdk');
const Anthropic = SDK.Anthropic || SDK.default || SDK;

const IMAGE_TYPES = { 'image/jpeg': 1, 'image/jpg': 1, 'image/png': 1, 'image/gif': 1, 'image/webp': 1 };

function isScannable(contentType) {
  const t = String(contentType || '').toLowerCase();
  return !!IMAGE_TYPES[t] || t === 'application/pdf';
}

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
    'IMPORTANT — dates: read the date exactly as this receipt means it. A European ' +
    'receipt is day-first (e.g. a Czech/Polish receipt showing 12.07.2026 or 12/07/2026 ' +
    'means 12 July 2026); a US receipt is month-first (07/12/2026 means 12 July 2026 too, ' +
    'but 03/05 means March 5). Decide from the receipt’s country, currency, language, and ' +
    'how the date is written — do NOT assume one convention. Return the result as YYYY-MM-DD.\n\n' +
    'For "account", choose the single best-fit GL account and return only its numeric code from ' +
    'this list:\n' + legend
  );
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

const MODEL = () => process.env.SCAN_MODEL || 'claude-opus-4-8';

async function runTool(content, accounts) {
  const accountCodes = new Set(accounts.map((a) => a.code));
  const client = new Anthropic();
  const message = await client.messages.create({
    model: MODEL(),
    max_tokens: 1024,
    tools: [receiptTool()],
    tool_choice: { type: 'tool', name: 'record_receipt' },
    messages: [{ role: 'user', content }],
  });
  const toolUse = (message.content || []).find((b) => b.type === 'tool_use');
  return normalize(toolUse ? toolUse.input : {}, { accountCodes });
}

// Read one receipt image/PDF. Returns normalized fields, or null if the file
// type can't be read.
async function scanReceipt(receipt, { accounts = [] } = {}) {
  const block = mediaBlock(receipt);
  if (!block) return null;
  return runTool([block, { type: 'text', text: prompt(accounts) }], accounts);
}

// Read the text of an email receipt (for HTML-only receipts with no attachment).
async function scanText(text, { accounts = [] } = {}) {
  const body = String(text || '').slice(0, 12000);
  if (!body.trim()) return null;
  return runTool(
    [{ type: 'text', text: `${prompt(accounts)}\n\nThe receipt is the text of an email below:\n\n${body}` }],
    accounts,
  );
}

module.exports = { scanReceipt, scanText, normalize, isScannable, mediaBlock, receiptTool, prompt };
