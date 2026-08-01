'use strict';

// Build Cedarstone's Intacct Journal-Entry upload (the "ExpWire batch" format)
// from Rembly expenses. The exact columns, field mapping, and source spec are in
// docs/INTACCT-UPLOAD-FORMAT.md. One debit line per expense.
//
// Pure functions only (no Airtable / no I/O) so they're easy to test.

const COLUMNS = [
  'DONOTIMPORT', 'JOURNAL', 'DATE', 'REVERSEDATE', 'DESCRIPTION', 'REFERENCE_NO', 'LINE_NO',
  'ACCT_NO', 'LOCATION_ID', 'DEPT_ID', 'DOCUMENT', 'MEMO', 'DEBIT', 'CREDIT', 'SOURCEENTITY',
  'CURRENCY', 'EXCH_RATE_DATE', 'EXCH_RATE_TYPE_ID', 'EXCHANGE_RATE', 'STATE', 'ALLOCATION_ID',
  'BILLABLE', 'GLENTRY_PROJECTID', 'GLENTRY_CUSTOMERID', 'GLENTRY_CLASSID',
  'GLENTRY_EMPLOYEEID', 'GLENTRY_VENDORID',
];

const JOURNAL = 'EE';                    // the JE journal symbol Cedarstone uses
const LOCATION_ID = 'JV NFP--Josiah Venture';

function usd(n) {
  const v = Number(n);
  return isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

// YYYY-MM-DD → M/D/YYYY (what the sample upload uses). Passes anything else through.
function mdY(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : String(d || '');
}

// The leading token of a string, e.g. "430028 – Ukraine…" → "430028".
function leadingCode(s) {
  const m = /^\s*(\S+)/.exec(String(s || ''));
  return m ? m[1] : '';
}

// One JE debit line (as a column→value map) from a normalized expense:
//   { id, amountUsd, description, expenseAccount, glCode, deptId, projectId, classId, person }
function jeLine(exp, { lineNo, batchLabel, date }) {
  return {
    JOURNAL,
    DATE: mdY(date),
    DESCRIPTION: batchLabel,
    LINE_NO: lineNo,
    ACCT_NO: String(exp.glCode || '').trim(),
    LOCATION_ID,
    DEPT_ID: String(exp.deptId || '').trim(),
    MEMO: String(exp.description || '').trim(),
    DEBIT: usd(exp.amountUsd),
    // The Project is the account they picked (its code) unless a real project is set.
    GLENTRY_PROJECTID: String(exp.projectId || '').trim() || leadingCode(exp.expenseAccount),
    GLENTRY_CLASSID: String(exp.classId || '').trim(),
  };
}

function rowToArray(line) {
  return COLUMNS.map((c) => (line[c] == null ? '' : line[c]));
}

// Build the whole JE. Returns { columns, rows (array-of-arrays incl. header),
// missing } where `missing` lists lines still lacking a required dimension.
function buildJournalEntry(expenses, { batchLabel, date }) {
  const body = [];
  const missing = [];
  (expenses || []).forEach((exp, i) => {
    const line = jeLine(exp, { lineNo: i + 1, batchLabel, date });
    body.push(rowToArray(line));
    const needs = [];
    if (!line.ACCT_NO) needs.push('GL account');
    if (!line.DEPT_ID) needs.push('fund');
    if (!line.GLENTRY_PROJECTID) needs.push('project');
    if (!line.GLENTRY_CLASSID) needs.push('class');
    if (needs.length) missing.push({ id: exp.id, who: exp.person || '', desc: line.MEMO, needs });
  });
  const total = body.reduce((s, r) => s + (Number(r[COLUMNS.indexOf('DEBIT')]) || 0), 0);
  return { columns: COLUMNS.slice(), rows: [COLUMNS.slice(), ...body], missing, count: body.length, totalDebit: usd(total) };
}

module.exports = {
  COLUMNS, JOURNAL, LOCATION_ID, usd, mdY, leadingCode, jeLine, rowToArray, buildJournalEntry,
};
