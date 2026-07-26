'use strict';

// Domain layer for the real "JV Expenses" Airtable base. That base is
// relational: Expenses links to Staff (Submitter/Approver), Categories, and
// Currencies, and computes "Amount (USD)" with a formula from the linked
// currency's rate. So this module resolves names/codes/emails to record ids for
// writing links, and builds id→label maps for reading them back for display.

const crypto = require('crypto');
const airtable = require('./airtable');

// Receipts are served through the app's own /api/receipt so the browser never
// sees an Airtable file URL. A short HMAC (keyed on the server-only Airtable
// token) makes the link unguessable — the same "anyone with the link" model the
// Airtable URLs already had, just on our own domain.
function receiptToken(expenseId) {
  const key = process.env.AIRTABLE_TOKEN || 'rembly-dev';
  return crypto.createHmac('sha256', key).update(`receipt:${expenseId}`).digest('hex').slice(0, 24);
}
function verifyReceiptToken(expenseId, token) {
  const expected = receiptToken(expenseId);
  const a = Buffer.from(String(token || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const TABLES = {
  STAFF: 'Staff',
  EXPENSES: 'Expenses',
  CURRENCIES: 'Currencies',
  CATEGORIES: 'Categories',
  ACCOUNTS: 'Accounts',
  ACTIVITY: 'Activity Log',
  MILEAGE_RATES: 'Mileage Rates',
  REPORTS: 'Reports',
};

// Event names in the Activity Log's "Event" single-select. This is the trail
// every expense carries: who did what, when, and why.
const EVENTS = {
  IMPORTED: 'Imported',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  SENT_BACK: 'Sent back',
  KICKED_BACK: 'Kicked back',
  RESUBMITTED: 'Resubmitted',
  EDITED: 'Edited',
  QUEUED_FOR_PAYMENT: 'Queued for payment',
  PAID: 'Paid',
  AFFIDAVIT_SIGNED: 'Missing-receipt affidavit signed',
  AFFIDAVIT_APPROVED: 'Missing-receipt affidavit approved',
};

// Status options that actually exist in the base's Expenses.Status field:
// Draft, Submitted, Approved, Rejected, Reimbursed.
const STATUS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  // After CedarStone exports the approved batch to pay it, expenses sit here until
  // the money actually goes out. (Auto-created in Airtable on first use via typecast.)
  WAITING_TO_PAY: 'Waiting to be paid',
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
function canModify(record, user, role, householdEmails = null) {
  const f = record.fields || {};
  const status = f.Status || 'Submitted';
  const owner = submitterEmailOf(f).toLowerCase();
  const inHousehold = householdEmails
    && (householdEmails.has ? householdEmails.has(owner) : householdEmails.includes(owner));
  const isOwner = owner === user.email.toLowerCase() || !!inHousehold;
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
  const [currency, category, staff, account, report] = await Promise.all([
    idLabelMap(TABLES.CURRENCIES, 'Code'),
    idLabelMap(TABLES.CATEGORIES, 'Category'),
    staffMap(),
    accountMap(),
    idLabelMap(TABLES.REPORTS, 'Name'),
  ]);
  return { currency, category, staff, account, report };
}

// ---- Reports ----------------------------------------------------------
// A report is a named container an owner drops expenses into, then submits the
// whole thing for approval. Nothing clever — just a name and an owner.

async function getReportById(id) {
  if (!id) return null;
  return airtable.findFirst(TABLES.REPORTS, {
    filterByFormula: `RECORD_ID() = '${esc(String(id))}'`,
  });
}

// Every report owned by a staff member (including empty ones), newest first.
async function listReportsOwnedBy(staffId) {
  if (!staffId) return [];
  const records = await airtable.listRecords(TABLES.REPORTS, {});
  return records
    .filter((r) => (Array.isArray(r.fields && r.fields.Owner) ? r.fields.Owner : []).includes(staffId))
    .map((r) => {
      const f = r.fields || {};
      return {
        id: r.id,
        name: f.Name || 'Untitled report',
        submittedOn: f['Submitted On'] || null,
        expenseIds: Array.isArray(f.Expenses) ? f.Expenses : [],
        createdTime: r.createdTime || null,
      };
    })
    .sort((a, b) => String(b.createdTime || '').localeCompare(String(a.createdTime || '')));
}

async function createReport(name, staffId) {
  return airtable.createRecord(TABLES.REPORTS, { Name: name, Owner: [staffId] });
}

// Point an expense at a report (or clear it with reportId = null).
async function setExpenseReport(expenseId, reportId) {
  return airtable.updateRecord(TABLES.EXPENSES, expenseId, { Report: reportId ? [reportId] : [] });
}

// Does this report belong to this staff member? Accepts a single id or a Set of
// household ids (so a partner can see/manage the household's reports).
function reportOwnedBy(report, staffIdOrSet) {
  const owners = Array.isArray(report.fields && report.fields.Owner) ? report.fields.Owner : [];
  if (staffIdOrSet && staffIdOrSet.has) return owners.some((id) => staffIdOrSet.has(id));
  return owners.includes(staffIdOrSet);
}

// ---- Households --------------------------------------------------------
// Staff who share a "Household" value (case-insensitive) are pooled: they see
// and manage each other's expenses and reports, and are reimbursed together.
// Someone with no Household set is simply a household of one — themselves.
function householdKeyOf(staffRecord) {
  return String((staffRecord && staffRecord.fields && staffRecord.fields.Household) || '').trim().toLowerCase();
}
async function householdScope(staffRecord) {
  const key = householdKeyOf(staffRecord);
  let members = staffRecord ? [staffRecord] : [];
  if (key) {
    const all = await airtable.listRecords(TABLES.STAFF, {
      filterByFormula: `LOWER({Household}) = '${esc(key)}'`,
    });
    if (all.length) members = all;
    if (staffRecord && !members.some((r) => r.id === staffRecord.id)) members.push(staffRecord);
  }
  const ids = new Set(members.map((r) => r.id));
  const emails = members
    .map((r) => String((r.fields && r.fields.Email) || '').toLowerCase())
    .filter(Boolean);
  return { members, ids, emails, key };
}
// Airtable formula matching an expense whose submitter is any of these emails.
function submitterEmailFormula(emails) {
  const list = (emails && emails.length ? emails : [''])
    .map((e) => `LOWER(ARRAYJOIN({Submitter Email})) = '${esc(String(e).toLowerCase())}'`);
  return list.length === 1 ? list[0] : `OR(${list.join(', ')})`;
}
// Every report owned by anyone in the given set of staff ids, newest first.
async function listReportsOwnedByAny(idSet) {
  if (!idSet || !idSet.size) return [];
  const records = await airtable.listRecords(TABLES.REPORTS, {});
  return records
    .filter((r) => (Array.isArray(r.fields && r.fields.Owner) ? r.fields.Owner : []).some((id) => idSet.has(id)))
    .map((r) => {
      const f = r.fields || {};
      return {
        id: r.id,
        name: f.Name || 'Untitled report',
        submittedOn: f['Submitted On'] || null,
        ownerId: Array.isArray(f.Owner) && f.Owner.length ? f.Owner[0] : null,
        expenseIds: Array.isArray(f.Expenses) ? f.Expenses : [],
        createdTime: r.createdTime || null,
      };
    })
    .sort((a, b) => String(b.createdTime || '').localeCompare(String(a.createdTime || '')));
}

// How an expense got into Rembly, for a provenance badge. Uses an explicit
// "Source" field if the base has one, otherwise reads it off the Notes tag each
// entry path writes (so existing records get a sensible label too).
function sourceOf(fields = {}) {
  const explicit = fields.Source;
  if (explicit) return typeof explicit === 'object' ? explicit.name : String(explicit);
  const notes = String(fields.Notes || '');
  if (/from email|captured from email/i.test(notes)) return 'Email';
  if (/imported from ynab|from ynab/i.test(notes)) return 'YNAB';
  if (/imported from/i.test(notes)) return 'CSV';
  if (/added by photo|by photo/i.test(notes)) return 'Photo';
  return 'Manual';
}

// A "held email receipt" is a Draft that arrived by email and is waiting to be
// claimed by an expense — it lives in the Import screen's receipt inbox, not in
// the person's expense list. An *imported* Draft (from YNAB/CSV) is a real
// unsubmitted expense instead, so it must not be treated as a held receipt.
function isHeldEmailReceipt(fields = {}) {
  // Still "held" only while it's an unclaimed email Draft with no report. Once
  // it's filed into a report it becomes a normal Unsubmitted expense and leaves
  // the inbox.
  return (fields.Status || '') === STATUS.DRAFT
    && sourceOf(fields) === 'Email'
    && !firstLinkId(fields.Report);
}

// Shape a raw Expenses record into the trimmed object the browser needs,
// resolving linked ids through the maps from displayMaps().
function shapeExpense(record, maps = {}) {
  const f = record.fields || {};
  const currencyId = firstLinkId(f.Currency);
  const categoryId = firstLinkId(f.Category);
  const accountId = firstLinkId(f.Account);
  const submitterId = firstLinkId(f.Submitter);
  const reportId = firstLinkId(f.Report);
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
    // The foreign amount printed on the receipt (when the bank charged USD),
    // so the browser can show "zł400 · $98.50 · rate 0.2463".
    originalAmount: f['Original Amount'] != null ? Number(f['Original Amount']) : null,
    originalCurrency: f['Original Currency'] || '',
    // Missing-receipt affidavit: a signed declaration used in place of a receipt.
    receiptTime: f['Receipt Time'] || '',
    clearedWith: String(f['Dedupe Cleared'] || '').split(/[\s,]+/).filter(Boolean),
    missingReceipt: !!f['Missing Receipt'],
    affidavitReason: f['Affidavit Reason'] || '',
    affidavitSignedBy: f['Affidavit Signed By'] || '',
    affidavitSignedOn: f['Affidavit Signed On'] || null,
    affidavitStatus: (f['Affidavit Status'] && (f['Affidavit Status'].name || f['Affidavit Status'])) || '',
    category: (maps.category && categoryId && maps.category[categoryId]) || '',
    account: account.name || '',
    accountCode: account.code || '',
    date: f['Expense Date'] || null,
    distance: f.Distance != null ? Number(f.Distance) : null,
    distanceUnit: f['Distance Unit'] || '',
    mileageRate: f['Mileage Rate'] != null ? Number(f['Mileage Rate']) : null,
    status: f.Status || STATUS.SUBMITTED,
    source: sourceOf(f),
    reportId: reportId || null,
    reportName: (maps.report && reportId && maps.report[reportId]) || '',
    submitterName: submitter.name || '',
    submitterEmail: firstLookup(f['Submitter Email']) || submitter.email || '',
    submittedOn: f['Submitted On'] || null,
    decidedOn: f['Decided On'] || null,
    paidOn: f['Paid On'] || null,
    notes: f['Approver Note'] || '',
    receipt: receipts[0]
      ? {
          url: `/api/receipt?e=${record.id}&t=${receiptToken(record.id)}`,
          thumb: `/api/receipt?e=${record.id}&t=${receiptToken(record.id)}&thumb=1`,
          filename: receipts[0].filename,
        }
      : null,
  };
}

// Held email receipts waiting to be claimed: a person's Draft expenses that came
// in from email. Each carries the receipt file and the amount/date/merchant
// Claude read off it, so a YNAB row can find and adopt the right one.
async function heldReceiptsFor(email, maps) {
  const em = String(email || '').toLowerCase().replace(/'/g, "\\'");
  const records = await airtable.listRecords(TABLES.EXPENSES, {
    filterByFormula: `AND(LOWER(ARRAYJOIN({Submitter Email})) = '${em}', {Status} = '${STATUS.DRAFT}')`,
  });
  const m = maps || (await displayMaps());
  // Only receipts that actually came from email — never an imported/unsubmitted
  // expense that happens to also be a Draft.
  return records
    .filter((r) => isHeldEmailReceipt(r.fields))
    .map((r) => ({ record: r, exp: shapeExpense(r, m) }));
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
  heldReceiptsFor,
  isHeldEmailReceipt,
  sourceOf,
  getReportById,
  listReportsOwnedBy,
  listReportsOwnedByAny,
  createReport,
  setExpenseReport,
  reportOwnedBy,
  householdScope,
  householdKeyOf,
  submitterEmailFormula,
  receiptToken,
  verifyReceiptToken,
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
