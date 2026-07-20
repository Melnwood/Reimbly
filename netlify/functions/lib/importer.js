'use strict';

// Turn an uploaded CSV or Excel file into clean, normalized expense rows.
// Header matching is forgiving (lots of aliases) so a spreadsheet "Claude put
// together" from email receipts doesn't have to use exact column names.

// field -> accepted header names (compared lower-cased and trimmed)
const HEADER_ALIASES = {
  date: ['date', 'expense date', 'transaction date', 'date of expense', 'txn date', 'day', 'purchase date'],
  amount: ['amount', 'total', 'price', 'cost', 'sum', 'value', 'charge'],
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

function normDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let mo = Number(m[1]);
    let da = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (mo > 12 && da <= 12) { const t = mo; mo = da; da = t; } // looks like D/M/Y
    const dt = new Date(Date.UTC(y, mo - 1, da));
    if (!isNaN(dt)) return dt.toISOString().slice(0, 10);
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

  const at = (row, field) => (map[field] != null ? row[map[field]] : undefined);
  const rows = [];
  for (let i = 1; i < grid.length; i += 1) {
    const r = grid[i];
    rows.push({
      line: i + 1, // 1-based spreadsheet row number
      date: normDate(at(r, 'date')),
      amount: normAmount(at(r, 'amount')),
      currency: String(at(r, 'currency') || '').trim().toUpperCase(),
      merchant: String(at(r, 'merchant') || '').trim(),
      description: String(at(r, 'description') || '').trim(),
      account: String(at(r, 'account') || '').trim(),
    });
  }

  return { rows, headers: Object.keys(map), unmatched };
}

module.exports = { parseSpreadsheet, fileToGrid, normAmount, normDate };
