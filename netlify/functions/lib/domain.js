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
  ACCOUNTS: 'Accounts',
  ACTIVITY: 'Activity Log',
  MILEAGE_RATES: 'Mileage Rates',
};

// Event names in the Activity Log's "Event" single-select. This is the trail
// every expense carries: who did what, when, and why.
const EVENTS = {
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  SENT_BACK: 'Sent back',
  KICKED_BACK: 'Kicked back',
  RESUBMITTED: 'Resubmitted',
  EDITED: 'Edited',
  PAID: 'Paid',
};

// Status options that actually exist in the base's Expenses.Status field:
// Draft, Submitted, Approved, Rejected, Reimbursed.
const STATUS = {
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  REIMBURSED: 'Reimbursed',
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

// ---- Duplicate detection ----------------------------------------------
// Two expenses are "probably the same" when the money, the day, and the
// merchant match. Used by the audit and the spreadsheet importer.
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const normMerchant = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
function dupKey({ amount, date, merchant } = {}) {
  if (amount == null || !date) return null; // not enough to compare on
  return `${round2(amount)}|${String(date).slice(0, 10)}|${normMerchant(merchant)}`;
}
const firstLinkId = (v) => (Array.isArray(v) && v.length ? v[0] : null);
const firstLookup = (v) => (Array.isArray(v) ? v[0] : v);

async function findStaffByEmail(email) {
  return airtable.findFirst(TABLES.STAFF, {
    filterByFormula: `LOWER({Email}) = '${esc(email.toLowerCase())}'`,
  });
}

// A staff member by record id → { id, name, email, uplineId }, or null.
async function staffById(id) {
  if (!id) return null;
  const rec = await airtable.findFirst(TABLES.STAFF, {
    filterByFormula: `RECORD_ID() = '${esc(String(id))}'`,
  });
  if (!rec) return null;
  const f = rec.fields || {};
  return { id: rec.id, name: f.Name || '', email: f.Email || '', uplineId: firstLinkId(f.Upline) };
}

// ---- push subscriptions (for iPhone / browser notifications) ----------
// Each person's device push subscriptions live as a JSON array in a single
// "Push Subscriptions" long-text field on their Staff row. No new table needed.

function parseSubs(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((s) => s && s.endpoint) : [];
  } catch {
    return [];
  }
}

// Every push subscription on file for a person, by email.
async function getPushSubs(email) {
  const rec = await findStaffByEmail(String(email || ''));
  return rec ? parseSubs(rec.fields && rec.fields['Push Subscriptions']) : [];
}

// Register a device's subscription (idempotent — replaces one with the same
// endpoint). Returns true once saved, false if the person isn't in Staff yet.
async function savePushSub(email, sub) {
  if (!sub || !sub.endpoint) return false;
  const rec = await findStaffByEmail(String(email || ''));
  if (!rec) return false;
  const subs = parseSubs(rec.fields && rec.fields['Push Subscriptions']).filter((s) => s.endpoint !== sub.endpoint);
  subs.push(sub);
  await airtable.updateRecord(TABLES.STAFF, rec.id, { 'Push Subscriptions': JSON.stringify(subs) });
  return true;
}

// Drop specific endpoints (a device unsubscribed, or the push service says the
// subscription is gone). No-op if there's nothing to remove.
async function removePushSubs(email, endpoints) {
  const drop = new Set((endpoints || []).filter(Boolean));
  if (!drop.size) return;
  const rec = await findStaffByEmail(String(email || ''));
  if (!rec) return;
  const subs = parseSubs(rec.fields && rec.fields['Push Subscriptions']);
  const kept = subs.filter((s) => !drop.has(s.endpoint));
  if (kept.length !== subs.length) {
    await airtable.updateRecord(TABLES.STAFF, rec.id, { 'Push Subscriptions': JSON.stringify(kept) });
  }
}

// Statuses a submitter may still edit or delete their own expense in.
const EDITABLE_STATUSES = new Set(['Submitted', 'Rejected', 'Draft']);

async function getExpenseById(id) {
  return airtable.findFirst(TABLES.EXPENSES, {
    filterByFormula: `RECORD_ID() = '${esc(String(id))}'`,
  });
}

// The submitter's email from the lookup field on a raw Expenses record.
function submitterEmailOf(fields = {}) {
  const v = fields['Submitter Email'];
  return (Array.isArray(v) ? v[0] : v) || '';
}

// Decide whether `user` (with `role`) may edit/delete a raw expense record.
function canModify(record, user, role) {
  const f = record.fields || {};
  const status = f.Status || 'Submitted';
  const isOwner = submitterEmailOf(f).toLowerCase() === user.email.toLowerCase();
  return APPROVER_ROLES.has(role) || (isOwner && EDITABLE_STATUSES.has(status));
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

// Resolve a GL account code (e.g. "8394000") to its record id.
async function resolveAccountId(code) {
  if (!code) return null;
  const rec = await airtable.findFirst(TABLES.ACCOUNTS, {
    filterByFormula: `{Code} = '${esc(String(code).trim())}'`,
  });
  return rec ? rec.id : null;
}

// Active mileage rates for the expense form, cheapest field set for display.
async function listMileageRates() {
  const [records, currency] = await Promise.all([
    airtable.listRecords(TABLES.MILEAGE_RATES, {}),
    idLabelMap(TABLES.CURRENCIES, 'Code'),
  ]);
  return records
    .map((r) => {
      const f = r.fields || {};
      const currencyId = firstLinkId(f.Currency);
      return {
        id: r.id,
        name: f.Name || '',
        unit: f.Unit || 'miles',
        rate: f.Rate != null ? Number(f.Rate) : null,
        currencyId,
        currency: (currencyId && currency[currencyId]) || 'USD',
        active: !!f.Active,
      };
    })
    .filter((r) => r.active && r.rate != null && r.rate > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Every mileage rate (active and inactive) for the Finance management screen.
async function listMileageRatesAdmin() {
  const [records, currency] = await Promise.all([
    airtable.listRecords(TABLES.MILEAGE_RATES, {}),
    idLabelMap(TABLES.CURRENCIES, 'Code'),
  ]);
  return records
    .map((r) => {
      const f = r.fields || {};
      const currencyId = firstLinkId(f.Currency);
      return {
        id: r.id,
        name: f.Name || '',
        unit: f.Unit || 'miles',
        rate: f.Rate != null ? Number(f.Rate) : null,
        currencyId,
        currency: (currencyId && currency[currencyId]) || '',
        active: !!f.Active,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// One mileage rate by id (for the submit calculation). Null if gone/inactive.
async function getMileageRate(id) {
  if (!id) return null;
  const rec = await airtable.findFirst(TABLES.MILEAGE_RATES, {
    filterByFormula: `RECORD_ID() = '${esc(String(id))}'`,
  });
  if (!rec) return null;
  const f = rec.fields || {};
  return {
    id: rec.id,
    name: f.Name || '',
    unit: f.Unit || 'miles',
    rate: f.Rate != null ? Number(f.Rate) : null,
    currencyId: firstLinkId(f.Currency),
    active: !!f.Active,
  };
}

// The full chart of accounts for the form dropdown, sorted by code.
async function listAccounts() {
  const records = await airtable.listRecords(TABLES.ACCOUNTS, {
    'sort[0][field]': 'Code',
    'sort[0][direction]': 'asc',
  });
  return records
    .map((r) => ({
      id: r.id,
      code: (r.fields || {}).Code || '',
      name: (r.fields || {}).Name || '',
      restricted: !!(r.fields || {}).Restricted,
    }))
    .filter((a) => a.code);
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
    map[r.id] = {
      name: f.Name || '',
      email: f.Email || '',
      uplineId: firstLinkId(f.Upline),
      allowedAccountIds: Array.isArray(f['Allowed Accounts']) ? f['Allowed Accounts'] : [],
    };
  }
  return map;
}

/**
 * Work out which accounts a person may charge to. An account flagged
 * "Restricted" is a general-fund line: hidden from everyone except the people
 * it's granted to (via Staff "Allowed Accounts"). Un-flagged accounts are open
 * to all. Returns { accounts, visibleIds:Set, allowedIds:Set, restrictedIds:Set }.
 */
async function accountAccessFor(email) {
  const [accounts, staff] = await Promise.all([listAccounts(), staffMap()]);
  const restrictedIds = new Set(accounts.filter((a) => a.restricted).map((a) => a.id));
  let allowedIds = new Set();
  const target = String(email || '').toLowerCase();
  for (const id of Object.keys(staff)) {
    if ((staff[id].email || '').toLowerCase() === target) {
      allowedIds = new Set(staff[id].allowedAccountIds || []);
      break;
    }
  }
  const visibleIds = new Set(
    accounts.filter((a) => !restrictedIds.has(a.id) || allowedIds.has(a.id)).map((a) => a.id),
  );
  return { accounts, visibleIds, allowedIds, restrictedIds };
}

// People list for the Finance management screen.
async function listPeople() {
  const [records, accounts] = await Promise.all([
    airtable.listRecords(TABLES.STAFF, {}),
    listAccounts(),
  ]);
  const codeById = {};
  for (const a of accounts) codeById[a.id] = a.code;
  const nameById = {};
  for (const r of records) nameById[r.id] = (r.fields || {}).Name || (r.fields || {}).Email || '';
  return records.map((r) => {
    const f = r.fields || {};
    return {
      id: r.id,
      name: f.Name || '',
      email: f.Email || '',
      role: f.Role || 'Staff',
      uplineEmail: '',
      uplineName: (() => {
        const up = firstLinkId(f.Upline);
        return up ? nameById[up] || '' : '';
      })(),
      accounts: (Array.isArray(f['Allowed Accounts']) ? f['Allowed Accounts'] : []).map((id) => codeById[id]).filter(Boolean),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

async function accountMap() {
  const records = await airtable.listRecords(TABLES.ACCOUNTS, {});
  const map = {};
  for (const r of records) {
    const f = r.fields || {};
    map[r.id] = { code: f.Code || '', name: f.Name || '' };
  }
  return map;
}

// The small maps needed to display expenses. Fetched once per request.
async function displayMaps() {
  const [currency, category, staff, account] = await Promise.all([
    idLabelMap(TABLES.CURRENCIES, 'Code'),
    idLabelMap(TABLES.CATEGORIES, 'Category'),
    staffMap(),
    accountMap(),
  ]);
  return { currency, category, staff, account };
}

// Shape a raw Expenses record into the trimmed object the browser needs,
// resolving linked ids through the maps from displayMaps().
function shapeExpense(record, maps = {}) {
  const f = record.fields || {};
  const currencyId = firstLinkId(f.Currency);
  const categoryId = firstLinkId(f.Category);
  const accountId = firstLinkId(f.Account);
  const submitterId = firstLinkId(f.Submitter);
  const submitter = (maps.staff && submitterId && maps.staff[submitterId]) || {};
  const account = (maps.account && accountId && maps.account[accountId]) || {};
  const receipts = Array.isArray(f.Receipt) ? f.Receipt : [];

  return {
    id: record.id,
    submitterId,
    description: f.Description || '',
    merchant: f.Merchant || '',
    amount: f.Amount != null ? Number(f.Amount) : null,
    currency: (maps.currency && currencyId && maps.currency[currencyId]) || '',
    amountUsd: f['Amount (USD)'] != null ? Number(f['Amount (USD)']) : null,
    category: (maps.category && categoryId && maps.category[categoryId]) || '',
    account: account.name || '',
    accountCode: account.code || '',
    date: f['Expense Date'] || null,
    distance: f.Distance != null ? Number(f.Distance) : null,
    distanceUnit: f['Distance Unit'] || '',
    mileageRate: f['Mileage Rate'] != null ? Number(f['Mileage Rate']) : null,
    status: f.Status || STATUS.SUBMITTED,
    submitterName: submitter.name || '',
    submitterEmail: firstLookup(f['Submitter Email']) || submitter.email || '',
    submittedOn: f['Submitted On'] || null,
    decidedOn: f['Decided On'] || null,
    paidOn: f['Paid On'] || null,
    notes: f['Approver Note'] || '',
    receipt: receipts[0]
      ? { url: receipts[0].url, filename: receipts[0].filename, thumb: receipts[0].thumbnails?.small?.url }
      : null,
  };
}

// ---- Activity trail ----------------------------------------------------

// Record one event on an expense's trail. Best-effort: logging must never
// break the real action, so this swallows its own errors.
async function logActivity({ expenseId, event, user = {}, note = '' } = {}) {
  try {
    const actor = user.name || user.email || 'Someone';
    const summary = event === EVENTS.SUBMITTED || event === EVENTS.RESUBMITTED || event === EVENTS.EDITED
      ? `${event} by ${actor}`
      : `${event} by ${actor}`;
    await airtable.createRecord(TABLES.ACTIVITY, {
      Summary: summary,
      Expense: [expenseId],
      'Expense ID': expenseId,
      Event: event,
      Actor: actor,
      'Actor Email': user.email || '',
      Note: note || '',
      At: new Date().toISOString(),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('logActivity failed:', err && err.message);
  }
}

// The full trail for one expense, oldest event first.
async function listActivity(expenseId) {
  const records = await airtable.listRecords(TABLES.ACTIVITY, {
    filterByFormula: `{Expense ID} = '${esc(String(expenseId))}'`,
    'sort[0][field]': 'At',
    'sort[0][direction]': 'asc',
  });
  return records.map((r) => {
    const f = r.fields || {};
    return {
      id: r.id,
      event: f.Event || '',
      summary: f.Summary || '',
      actor: f.Actor || '',
      actorEmail: f['Actor Email'] || '',
      note: f.Note || '',
      at: f.At || null,
    };
  });
}

module.exports = {
  TABLES,
  STATUS,
  EVENTS,
  round2,
  dupKey,
  logActivity,
  listActivity,
  DEFAULT_PAYMENT_METHOD,
  CURRENCY_CODES,
  CATEGORY_NAMES,
  ensureStaff,
  findStaffByEmail,
  staffById,
  getPushSubs,
  savePushSub,
  removePushSubs,
  getExpenseById,
  canModify,
  isApprover,
  resolveCurrencyId,
  resolveCategoryId,
  resolveAccountId,
  listAccounts,
  staffMap,
  accountAccessFor,
  listPeople,
  listMileageRates,
  listMileageRatesAdmin,
  getMileageRate,
  displayMaps,
  shapeExpense,
};
