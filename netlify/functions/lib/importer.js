'use strict';

// Turn an uploaded CSV or Excel file into clean, normalized expense rows.
// Header matching is forgiving (lots of aliases) so a spreadsheet "Claude put
// together" from email receipts doesn't have to use exact column names.

// field -> accepted header names (compared lower-cased and trimmed)
const HEADER_ALIASES = {
  date: ['date', 'expense date', 'transaction date', 'date of expense', 'txn date', 'day', 'purchase date'],
  amount: ['amount', 'total', 'price', 'cost', 'sum', 'value', 'charge', 'outflow'],
  currency: ['currency', 'ccy', 'cur', 'curr'],
  merchant: ['merchant', 'business', 'vendor', 'payee', 'store', 'where', 'company', 'supplier', 'from'],
  description: ['description', 'desc', 'purpose', 'details', 'memo', 'note', 'notes', 'item', 'what', 'reason'],
  account: ['account', 'gl', 'gl code', 'account code', 'code', 'category', 'gl account'],
  payment: ['payment method', 'paid with', 'method', 'payment'],
};

// ---- low-level parsing -------------------------------------------------

// A small RFC-4180-ish CSV parser (handles quotes, escaped quotes, newlines).
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  const clean = text.replace(/^﻿/, ''); // strip BOM
  for (let i = 0; i < clean.length; i += 1) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

// Return an array-of-arrays (row 0 = headers) from a CSV or XLSX file.
function fileToGrid(file) {
  const buf = Buffer.from(file.base64, 'base64');
  const name = String(file.filename || '').toLowerCase();
  const type = String(file.contentType || '').toLowerCase();
  const looksCsv = name.endsWith('.csv') || type.includes('csv') || type.includes('text/plain');
  if (looksCsv) return parseCsv(buf.toString('utf8'));
  // Excel
  // eslint-disable-next-line global-require
  const XLSX = require('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, {
    header: 1, blankrows: false, raw: false, dateNF: 'yyyy-mm-dd', defval: '',
  });
}

// ---- header + value normalization -------------------------------------

function mapHeaders(headerRow) {
  const map = {};
  const unmatched = [];
  (headerRow || []).forEach((h, i) => {
    const key = String(h == null ? '' : h).trim().toLowerCase();
    if (!key) return;
    let hit = null;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key)) { hit = field; break; }
    }
    if (hit && map[hit] == null) map[hit] = i;
    else if (!hit) unmatched.push(String(h).trim());
  });
  return { map, unmatched };
}

function normAmount(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.\-]/g, ''); // strip currency symbols, thousands separators
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

// Josiah Venture is a European org, so a slash/dot date like 12/07 means
// 12 July (day-first), not December 7. Default to day-first, overridable with
// IMPORT_DATE_ORDER=mdy for a US team.
const DEFAULT_DATE_ORDER = (process.env.IMPORT_DATE_ORDER || 'dmy').toLowerCase() === 'mdy' ? 'mdy' : 'dmy';

// Look at a whole column of dates and decide day-first vs month-first from any
// value that can only go one way (e.g. 25/07 must be day-first). Falls back to
// the default when every value is ambiguous.
function detectDateOrder(values) {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-]\d{2,4}$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy += 1; // first part must be the day
    else if (b > 12 && a <= 12) mdy += 1; // second part must be the day
  }
  if (dmy && !mdy) return 'dmy';
  if (mdy && !dmy) return 'mdy';
  return DEFAULT_DATE_ORDER;
}

function normDate(v, order = DEFAULT_DATE_ORDER) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // already unambiguous
  if (iso) {
    const dt0 = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return isNaN(dt0) ? null : dt0.toISOString().slice(0, 10);
  }
  const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    let mo;
    let da;
    if (order === 'mdy') { mo = a; da = b; } else { da = a; mo = b; }
    if (mo > 12 && da <= 12) { const t = mo; mo = da; da = t; } // impossible month → the other way
    const dt = new Date(Date.UTC(y, mo - 1, da));
    if (!isNaN(dt) && mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return dt.toISOString().slice(0, 10);
  }
  const dt = new Date(s);
  if (!isNaN(dt)) return dt.toISOString().slice(0, 10);
  return null;
}

/**
 * Parse a file into normalized rows. Resolution of currency/account is left to
 * the caller (which has the base's chart of accounts). Returns:
 *   { rows: [{ line, date, amount, currency, merchant, description, account }],
 *     headers: string[] (matched fields), unmatched: string[] }
 * or throws a 400-tagged error when the columns can't be understood.
 */
function parseSpreadsheet(file) {
  const grid = fileToGrid(file);
  if (!grid.length) {
    const err = new Error('That file looks empty.');
    err.statusCode = 400;
    throw err;
  }
  const { map, unmatched } = mapHeaders(grid[0]);
  if (map.date == null || map.amount == null) {
    const err = new Error('Couldn’t find a Date and an Amount column. Add headers like "Date" and "Amount" (a template is on the Import screen).');
    err.statusCode = 400;
    throw err;
  }

  // Recognize a YNAB export by its signature columns, so imports can be labeled.
  const rawHeaders = (grid[0] || []).map((h) => String(h == null ? '' : h).trim().toLowerCase());
  const format = rawHeaders.includes('outflow') || rawHeaders.includes('inflow') ? 'ynab' : 'csv';

  const at = (row, field) => (map[field] != null ? row[map[field]] : undefined);

  // Decide day-first vs month-first once, from the whole date column, so every
  // row in the file is read the same (and consistently with the real dates).
  const dateOrder = detectDateOrder(grid.slice(1).map((r) => at(r, 'date')));

  const rows = [];
  for (let i = 1; i < grid.length; i += 1) {
    const r = grid[i];
    rows.push({
      line: i + 1, // 1-based spreadsheet row number
      date: normDate(at(r, 'date'), dateOrder),
      amount: normAmount(at(r, 'amount')),
      currency: String(at(r, 'currency') || '').trim().toUpperCase(),
      merchant: String(at(r, 'merchant') || '').trim(),
      description: String(at(r, 'description') || '').trim(),
      account: String(at(r, 'account') || '').trim(),
    });
  }

  return { rows, headers: Object.keys(map), unmatched, format, dateOrder };
}

module.exports = { parseSpreadsheet, fileToGrid, normAmount, normDate, detectDateOrder };
