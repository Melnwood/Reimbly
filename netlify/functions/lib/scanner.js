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
        isReceipt: { type: 'boolean', description: 'true ONLY if this is an actual proof of purchase — a receipt, invoice, or bill with a real amount that was (or is to be) paid. false for anything that is NOT a receipt: marketing/promotional emails, newsletters, shipping or delivery notices, order/booking confirmations with no price, statements, calendar invites, logos, signatures, screenshots, or any image that isn\'t a receipt.' },
        amount: { type: ['number', 'null'], description: 'The total amount paid, as a number (no currency symbol). null if not legible.' },
        currency: { type: ['string', 'null'], enum: [...CURRENCY_CODES, null], description: 'ISO code of the currency shown on the receipt.' },
        date: { type: ['string', 'null'], description: 'Date of purchase as YYYY-MM-DD. null if not legible.' },
        time: { type: ['string', 'null'], description: 'Time of day printed on the receipt, in 24-hour HH:MM (e.g. "14:32"). Important for things like road tolls. null if no time is shown.' },
        merchant: { type: ['string', 'null'], description: 'The store or vendor name.' },
        description: { type: ['string', 'null'], description: 'A short, human description in English, e.g. "Lunch at Cafe Louvre" or "Train ticket Praha–Ostrava".' },
        account: { type: ['string', 'null'], description: 'The single best-fit GL account CODE from the account list in the instructions. Return only the numeric code, e.g. "8394000". null if unsure.' },
        amountBox: { type: ['object', 'null'], description: 'Where the printed TOTAL amount sits on the image, as a normalized box (fractions of image width/height, origin top-left). null if not an image or not locatable.', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['x', 'y', 'w', 'h'], additionalProperties: false },
        dateBox: { type: ['object', 'null'], description: 'Where the printed DATE sits on the image, as a normalized box (fractions of image width/height, origin top-left). null if not an image or not locatable.', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['x', 'y', 'w', 'h'], additionalProperties: false },
      },
      required: ['isReceipt', 'amount', 'currency', 'date', 'time', 'merchant', 'description', 'account', 'amountBox', 'dateBox'],
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
    'you find.\n\n' +
    'FIRST decide whether this is really a receipt. Set "isReceipt" to false if it is NOT an ' +
    'actual proof of purchase — for example a marketing or promotional email, a newsletter, a ' +
    'shipping/delivery notice, an order or booking confirmation with no price, an account ' +
    'statement, a calendar invite, a company logo or email banner, a signature image, or any ' +
    'picture that simply isn\'t a receipt. Only set isReceipt=true when there is a real amount ' +
    'that was paid (or is due to be paid). When isReceipt is false, return null for the other ' +
    'fields, so it is not filed as an expense.\n\n' +
    'Use the total actually paid and the currency printed on the receipt. Translate ' +
    'the description to English. If a field is not legible, return null for it rather than guessing.\n\n' +
    'IMPORTANT — dates: use the date the money was actually spent — the ' +
    'PAYMENT / TRANSACTION date (when the card was charged or cash paid). If the receipt ' +
    'shows several dates — a hotel’s check-in and check-out, an invoice’s issue and due ' +
    'date, a booking date vs. a stay date — choose the payment/transaction date, not the ' +
    'service date. Read it exactly as this receipt means it: a European ' +
    'receipt is day-first (e.g. a Czech/Polish receipt showing 12.07.2026 or 12/07/2026 ' +
    'means 12 July 2026); a US receipt is month-first (07/12/2026 means 12 July 2026 too, ' +
    'but 03/05 means March 5). Decide from the receipt’s country, currency, language, and ' +
    'how the date is written — do NOT assume one convention. Return the result as YYYY-MM-DD. ' +
    'Also read the TIME of day if the receipt shows one (common on tolls, parking, and fuel) ' +
    'and return it as 24-hour HH:MM in "time" — it helps tell apart several identical charges ' +
    'made on the same day.\n\n' +
    'For "description", say in plain English WHAT the money was for — the product or service, ' +
    'not just the vendor name. If you recognize the vendor, name what they actually sell: e.g. ' +
    'Anthropic → "Claude AI subscription"; Starlink → "Starlink satellite internet"; a hotel → ' +
    '"Hotel stay in <city>"; a restaurant → "Meal at <name>"; an airline → "Flight <route>". ' +
    'Keep it short and human. Put the vendor name in "merchant".\n\n' +
    'For "account", choose the single best-fit GL account and return only its numeric code from ' +
    'this list:\n' + legend + '\n\n' +
    'Finally, for "amountBox" and "dateBox": give the location on the image of the printed TOTAL ' +
    'you returned and the printed PAYMENT DATE you returned (the exact same date — not a check-in ' +
    'or other date), so a reviewer can see them highlighted. Use a box normalized to ' +
    'the image size — x and y are the top-left corner as fractions of the width and height (0 = ' +
    'left/top, 1 = right/bottom), w and h are the width and height as fractions. Draw the box ' +
    'snugly around just those characters. Return null for a box you can\'t place (or when the ' +
    'input is text, not an image).'
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
  // Time as HH:MM (24h). Accept "9:5" → "09:05".
  const timeRaw = clean(input.time);
  const tm = /^(\d{1,2}):(\d{2})/.exec(timeRaw || '');
  const time = tm && Number(tm[1]) < 24 ? `${String(tm[1]).padStart(2, '0')}:${tm[2]}` : null;
  return {
    // Default to true when absent, so manual uploads (where the person chose the
    // file) are never dropped; only an explicit false gates the email intake.
    isReceipt: input.isReceipt !== false,
    amount: isFinite(amount) && amount > 0 ? amount : null,
    currency: CURRENCY_CODES.includes(String(currency || '').toUpperCase())
      ? String(currency).toUpperCase()
      : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : null,
    time,
    merchant: clean(input.merchant) || null,
    description: clean(input.description) || null,
    account: account && accountCodes.has(String(account)) ? String(account) : null,
    amountBox: normalizeBox(input.amountBox),
    dateBox: normalizeBox(input.dateBox),
  };
}

// A normalized 0–1 box, or null. Clamps into range and rejects empty/degenerate
// boxes so a bad guess can never draw a highlight in the wrong place off-screen.
function normalizeBox(b) {
  if (!b || typeof b !== 'object') return null;
  const n = (v) => (isFinite(Number(v)) ? Number(v) : NaN);
  let x = n(b.x); let y = n(b.y); let w = n(b.w); let h = n(b.h);
  if ([x, y, w, h].some((v) => Number.isNaN(v))) return null;
  x = Math.min(Math.max(x, 0), 1);
  y = Math.min(Math.max(y, 0), 1);
  w = Math.min(Math.max(w, 0), 1 - x);
  h = Math.min(Math.max(h, 0), 1 - y);
  if (w <= 0.005 || h <= 0.005) return null; // too small to be real
  return { x, y, w, h };
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
