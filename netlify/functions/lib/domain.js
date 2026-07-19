'use strict';

// Domain layer for the real "JV Expenses" Airtable base. That base is
// relational: Expenses links to Staff (Submitter/Approver), Categories, and
// Currencies, and computes "Amount (USD)" with a formula from the linked
// currency's rate. So this module resolves names/codes/emails to record ids for
// writing links, and builds id→label maps for reading them back for display.

const airtable = require('./airtable');

const TABLES = {
  STAFF: 'Staff',
  EXPENSES: 'Expenses',
  CURRENCIES: 'Currencies',
  CATEGORIES: 'Categories',
};

// Status options that actually exist in the base's Expenses.Status field:
// Draft, Submitted, Approved, Rejected, Reimbursed.
const STATUS = {
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

// Default when the app doesn't ask (Reimbly is for out-of-pocket spend).
const DEFAULT_PAYMENT_METHOD = 'Personal funds (reimburse me)';

// Kept in sync with the base's Currencies/Categories tables and the form
// dropdowns. Used to constrain the receipt scanner's output.
const CURRENCY_CODES = ['USD', 'EUR', 'CZK', 'PLN', 'GBP', 'RON', 'HUF', 'BGN', 'RSD', 'UAH'];
const CATEGORY_NAMES = [
  'Travel – Ground (taxi, train, fuel)',
  'Travel – Airfare',
  'Lodging',
  'Meals & Hospitality',
  'Ministry Supplies',
  'Events & Camps',
  'Training & Development',
  'Technology & Software',
  'Office & Admin',
  'Other',
];

const APPROVER_ROLES = new Set(['Approver', 'Finance']);
const esc = (s) => String(s).replace(/'/g, "\\'");
const firstLinkId = (v) => (Array.isArray(v) && v.length ? v[0] : null);
const firstLookup = (v) => (Array.isArray(v) ? v[0] : v);

async function findStaffByEmail(email) {
  return airtable.findFirst(TABLES.STAFF, {
    filterByFormula: `LOWER({Email}) = '${esc(email.toLowerCase())}'`,
  });
}

/**
 * Find the caller's Staff record, creating a default `Staff` one the first time
 * we see them. Returns { record, role, id }.
 */
async function ensureStaff(user) {
  let record = await findStaffByEmail(user.email);
  if (!record) {
    record = await airtable.createRecord(TABLES.STAFF, {
      Name: user.name,
      Email: user.email,
      Role: 'Staff',
    });
  }
  const role = (record.fields && record.fields.Role) || 'Staff';
  return { record, role, id: record.id };
}

function isApprover(role) {
  return APPROVER_ROLES.has(role);
}

// Look up a record id by a text field value (case-insensitive).
async function findIdByField(table, field, value) {
  if (!value) return null;
  const rec = await airtable.findFirst(table, {
    filterByFormula: `LOWER({${field}}) = '${esc(String(value).toLowerCase())}'`,
  });
  return rec ? rec.id : null;
}

const resolveCurrencyId = (code) => findIdByField(TABLES.CURRENCIES, 'Code', code);

// Resolve a category name to its record id, falling back to "Other".
async function resolveCategoryId(name) {
  return (
    (await findIdByField(TABLES.CATEGORIES, 'Category', name)) ||
    (await findIdByField(TABLES.CATEGORIES, 'Category', 'Other'))
  );
}

// Build an id→label map for a small lookup table so we can render linked
// records (which come back from the REST API as bare record ids).
async function idLabelMap(table, labelField) {
  const records = await airtable.listRecords(table, {});
  const map = {};
  for (const r of records) map[r.id] = (r.fields && r.fields[labelField]) || '';
  return map;
}

async function staffMap() {
  const records = await airtable.listRecords(TABLES.STAFF, {});
  const map = {};
  for (const r of records) {
    const f = r.fields || {};
    map[r.id] = { name: f.Name || '', email: f.Email || '' };
  }
  return map;
}

// The three small maps needed to display expenses. Fetched once per request.
async function displayMaps() {
  const [currency, category, staff] = await Promise.all([
    idLabelMap(TABLES.CURRENCIES, 'Code'),
    idLabelMap(TABLES.CATEGORIES, 'Category'),
    staffMap(),
  ]);
  return { currency, category, staff };
}

// Shape a raw Expenses record into the trimmed object the browser needs,
// resolving linked ids through the maps from displayMaps().
function shapeExpense(record, maps = {}) {
  const f = record.fields || {};
  const currencyId = firstLinkId(f.Currency);
  const categoryId = firstLinkId(f.Category);
  const submitterId = firstLinkId(f.Submitter);
  const submitter = (maps.staff && submitterId && maps.staff[submitterId]) || {};
  const receipts = Array.isArray(f.Receipt) ? f.Receipt : [];

  return {
    id: record.id,
    description: f.Description || '',
    amount: f.Amount != null ? Number(f.Amount) : null,
    currency: (maps.currency && currencyId && maps.currency[currencyId]) || '',
    amountUsd: f['Amount (USD)'] != null ? Number(f['Amount (USD)']) : null,
    category: (maps.category && categoryId && maps.category[categoryId]) || '',
    date: f['Expense Date'] || null,
    status: f.Status || STATUS.SUBMITTED,
    submitterName: submitter.name || '',
    submitterEmail: firstLookup(f['Submitter Email']) || submitter.email || '',
    submittedOn: f['Submitted On'] || null,
    decidedOn: f['Decided On'] || null,
    notes: f['Approver Note'] || '',
    receipt: receipts[0]
      ? { url: receipts[0].url, filename: receipts[0].filename, thumb: receipts[0].thumbnails?.small?.url }
      : null,
  };
}

module.exports = {
  TABLES,
  STATUS,
  DEFAULT_PAYMENT_METHOD,
  CURRENCY_CODES,
  CATEGORY_NAMES,
  ensureStaff,
  findStaffByEmail,
  isApprover,
  resolveCurrencyId,
  resolveCategoryId,
  displayMaps,
  shapeExpense,
};
