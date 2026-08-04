'use strict';

// Build Cedarstone's Intacct Journal-Entry upload (the "ExpWire batch" format)
// from Rembly expenses. The exact columns, field mapping, and source spec are in
// docs/INTACCT-UPLOAD-FORMAT.md.
//
// Shape of one batch (confirmed by Olivia Lightner's example_2, Aug 2026):
//   line 1        — bank clearing account 1100000, CREDIT = the whole batch total
//   line 2        — bank fee account 7111100, DEBIT = the wire fee (only if there is one)
//   lines 3..N    — one DEBIT line per expense
// so the journal always balances (total debit = total credit).
//
// Each expense's dimensions (DEPT_ID / GLENTRY_PROJECTID / GLENTRY_CLASSID) come
// from the fund it's booked to, via the fund→dimensions listing CedarStone
// maintains (lib/fund-dimensions). Pure functions only (no Airtable / no I/O).

const { dimensionsFor, GENERAL_FUND_CODE } = require('./fund-dimensions');

const COLUMNS = [
  'DONOTIMPORT', 'JOURNAL', 'DATE', 'REVERSEDATE', 'DESCRIPTION', 'REFERENCE_NO', 'LINE_NO',
  'ACCT_NO', 'LOCATION_ID', 'DEPT_ID', 'DOCUMENT', 'MEMO', 'DEBIT', 'CREDIT', 'SOURCEENTITY',
  'CURRENCY', 'EXCH_RATE_DATE', 'EXCH_RATE_TYPE_ID', 'EXCHANGE_RATE', 'STATE', 'ALLOCATION_ID',
  'BILLABLE', 'GLENTRY_PROJECTID', 'GLENTRY_CUSTOMERID', 'GLENTRY_CLASSID',
  'GLENTRY_EMPLOYEEID', 'GLENTRY_VENDORID',
];

const JOURNAL = 'EE';                    // the JE journal symbol Cedarstone uses
const LOCATION_ID = 'JV NFP--Josiah Venture';
const BANK_ACCT = '1100000';             // clearing account the batch total is credited to
const FEE_ACCT = '7111100';              // bank/wire fee account

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

// Work out an expense's Intacct dimensions. Any value explicitly set on the
// expense wins (in case Cedarstone recodes a fund); otherwise we derive them from
// the fund it's booked to — the account they picked is the fund/support account.
function resolveDims(exp) {
  const fundCode = leadingCode(exp.expenseAccount) || String(exp.projectId || '');
  const d = dimensionsFor(fundCode) || {};
  return {
    dept: String(exp.deptId || '').trim() || d.dept || '',
    classId: String(exp.classId || '').trim() || d.class || '',
    project: String(exp.projectId || '').trim() || d.project || leadingCode(exp.expenseAccount),
  };
}

// One JE debit line (as a column→value map) from a normalized expense:
//   { id, amountUsd, description, expenseAccount, glCode, deptId, projectId, classId, person }
function jeLine(exp, { lineNo, batchLabel, date }) {
  const dims = resolveDims(exp);
  return {
    JOURNAL,
    DATE: mdY(date),
    DESCRIPTION: batchLabel,
    LINE_NO: lineNo,
    ACCT_NO: String(exp.glCode || '').trim(),
    LOCATION_ID,
    DEPT_ID: dims.dept,
    MEMO: String(exp.description || '').trim(),
    DEBIT: usd(exp.amountUsd),
    GLENTRY_PROJECTID: dims.project,
    GLENTRY_CLASSID: dims.classId,
  };
}

// A bank-side line (the clearing credit or the fee debit), booked to the General
// Fund's dimensions — the same as Cedarstone's own upload.
function bankLine({ lineNo, batchLabel, date, acctNo, memo, debit, credit }) {
  const gf = dimensionsFor(GENERAL_FUND_CODE) || {};
  return {
    JOURNAL,
    DATE: mdY(date),
    DESCRIPTION: batchLabel,
    LINE_NO: lineNo,
    ACCT_NO: acctNo,
    LOCATION_ID,
    DEPT_ID: gf.dept || '710-General Fund',
    MEMO: memo,
    DEBIT: debit != null ? usd(debit) : '',
    CREDIT: credit != null ? usd(credit) : '',
    GLENTRY_PROJECTID: gf.project || '10000',
    GLENTRY_CLASSID: gf.class || '00-JV Wide and USA',
  };
}

function rowToArray(line) {
  return COLUMNS.map((c) => (line[c] == null ? '' : line[c]));
}

// Build the whole JE. Options: { batchLabel, date, fee }.
//   fee — the bank/wire fee for this pay run (adds the 7111100 debit line). 0 → no fee line.
// Returns { columns, rows (incl. header), missing, count, totalDebit, totalCredit, balanced, fee }.
function buildJournalEntry(expenses, { batchLabel, date, fee = 0 } = {}) {
  const list = expenses || [];
  const feeUsd = Math.max(0, usd(fee));

  // Expense debits first, so we know the batch total to credit the bank.
  const expenseDebit = list.reduce((s, e) => s + usd(e.amountUsd), 0);
  const creditTotal = usd(expenseDebit + feeUsd);

  const lines = [];
  // Line 1 — the whole batch, credited to the bank clearing account.
  lines.push(bankLine({ lineNo: 1, batchLabel, date, acctNo: BANK_ACCT, memo: batchLabel, credit: creditTotal }));
  // Line 2 — the wire fee, if any.
  if (feeUsd > 0) {
    lines.push(bankLine({ lineNo: 2, batchLabel, date, acctNo: FEE_ACCT, memo: `Fee for ${batchLabel}`, debit: feeUsd }));
  }

  // Lines 3..N — one per expense. Renumbered to follow the bank lines.
  const missing = [];
  let lineNo = lines.length;
  list.forEach((exp) => {
    lineNo += 1;
    const line = jeLine(exp, { lineNo, batchLabel, date });
    lines.push(line);
    const needs = [];
    if (!line.ACCT_NO) needs.push('GL account');
    if (!line.DEPT_ID) needs.push('fund');
    if (!line.GLENTRY_PROJECTID) needs.push('project');
    if (!line.GLENTRY_CLASSID) needs.push('class');
    if (needs.length) missing.push({ id: exp.id, who: exp.person || '', desc: line.MEMO, needs });
  });

  const body = lines.map(rowToArray);
  const totalDebit = usd(expenseDebit + feeUsd);
  return {
    columns: COLUMNS.slice(),
    rows: [COLUMNS.slice(), ...body],
    missing,
    count: list.length,
    totalDebit,
    totalCredit: creditTotal,
    balanced: Math.abs(totalDebit - creditTotal) < 0.005,
    fee: feeUsd,
  };
}

// A human-readable summary of a batch, as rows for a "Summary" sheet — so CedarStone
// can open the file and see at a glance it's complete and balanced.
function summaryRows({ batchId, dateLabel, je, reportCount, peopleCount }) {
  const expensesTotal = usd(je.totalDebit - je.fee);
  return [
    ['Reimbly → Intacct — batch summary'],
    [],
    ['Batch', batchId || ''],
    ['Downloaded', dateLabel || ''],
    ['Reports', reportCount != null ? reportCount : ''],
    ['People', peopleCount != null ? peopleCount : ''],
    ['Expense lines', je.count],
    ['Expenses total (USD)', expensesTotal],
    ['Wire fee (USD)', je.fee],
    ['Total credited to bank (USD)', je.totalCredit],
    [],
    ['Total debit (USD)', je.totalDebit],
    ['Total credit (USD)', je.totalCredit],
    ['Balanced', je.balanced ? 'Yes' : 'NO — do not import'],
  ];
}

module.exports = {
  COLUMNS, JOURNAL, LOCATION_ID, BANK_ACCT, FEE_ACCT,
  usd, mdY, leadingCode, resolveDims, jeLine, bankLine, rowToArray, buildJournalEntry, summaryRows,
};
