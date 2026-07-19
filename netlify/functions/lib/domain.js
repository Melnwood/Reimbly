'use strict';

// Domain helpers shared across functions: the Staff role model, currency
// conversion, and shaping Expense records for the browser.

const airtable = require('./airtable');

const STAFF_TABLE = 'Staff';
const EXPENSES_TABLE = 'Expenses';
const CURRENCIES_TABLE = 'Currencies';

const APPROVER_ROLES = new Set(['Approver', 'Finance']);
const ESCAPE_QUOTES = (s) => String(s).replace(/'/g, "\\'");

/**
 * Find the caller's Staff record, creating a default `Staff` one the first time
 * we see them. Returns { record, role }.
 */
async function ensureStaff(user) {
  const formula = `LOWER({Email}) = '${ESCAPE_QUOTES(user.email.toLowerCase())}'`;
  let record = await airtable.findFirst(STAFF_TABLE, { filterByFormula: formula });

  if (!record) {
    record = await airtable.createRecord(STAFF_TABLE, {
      Email: user.email,
      Name: user.name,
      Role: 'Staff',
    });
  }

  const role = (record.fields && record.fields.Role) || 'Staff';
  return { record, role };
}

function isApprover(role) {
  return APPROVER_ROLES.has(role);
}

/**
 * Convert an amount to USD using the Currencies table. `Rate` is the USD value
 * of one unit of the currency. USD is 1:1; unknown currencies fall back to the
 * original amount so nothing is silently dropped.
 *
 * @returns {Promise<{usd: number, rate: number, converted: boolean}>}
 */
async function toUsd(amount, currency) {
  const code = String(currency || 'USD').trim().toUpperCase();
  if (code === 'USD') return { usd: round2(amount), rate: 1, converted: true };

  let record = null;
  try {
    record = await airtable.findFirst(CURRENCIES_TABLE, {
      filterByFormula: `UPPER({Code}) = '${ESCAPE_QUOTES(code)}'`,
    });
  } catch {
    // Currencies table may not exist yet — treat as "no rate available".
    record = null;
  }

  const rate = record && record.fields ? Number(record.fields.Rate) : NaN;
  if (!record || !isFinite(rate) || rate <= 0) {
    return { usd: round2(amount), rate: null, converted: false };
  }
  return { usd: round2(amount * rate), rate, converted: true };
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Shape an Airtable Expense record into the trimmed object the browser needs.
function shapeExpense(record) {
  const f = record.fields || {};
  const receipts = Array.isArray(f.Receipt) ? f.Receipt : [];
  return {
    id: record.id,
    description: f.Description || '',
    amount: f.Amount != null ? Number(f.Amount) : null,
    currency: f.Currency || 'USD',
    amountUsd: f['Amount (USD)'] != null ? Number(f['Amount (USD)']) : null,
    category: f.Category || '',
    date: f.Date || null,
    status: f.Status || 'Submitted',
    submitterName: f['Submitter Name'] || '',
    submitterEmail: f['Submitter Email'] || '',
    submittedOn: f['Submitted On'] || null,
    decidedOn: f['Decided On'] || null,
    decidedBy: f['Decided By'] || '',
    notes: f.Notes || '',
    receipt: receipts[0]
      ? { url: receipts[0].url, filename: receipts[0].filename, thumb: receipts[0].thumbnails?.small?.url }
      : null,
  };
}

module.exports = {
  STAFF_TABLE,
  EXPENSES_TABLE,
  CURRENCIES_TABLE,
  ensureStaff,
  isApprover,
  toUsd,
  shapeExpense,
};
