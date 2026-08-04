'use strict';

// Unit tests for the Intacct Journal-Entry builder (lib/intacct). Pure functions.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildJournalEntry, COLUMNS, mdY, leadingCode, usd, resolveDims, summaryRows,
  BANK_ACCT, FEE_ACCT,
} = require('../netlify/functions/lib/intacct');
const { buildWorkbook } = require('../netlify/functions/lib/intacct-export');

const idx = (name) => COLUMNS.indexOf(name);
// Find the single data row whose ACCT_NO matches (skips the header at row 0).
const rowByAcct = (je, acct) => je.rows.slice(1).find((r) => r[idx('ACCT_NO')] === acct);

test('mdY: YYYY-MM-DD → M/D/YYYY', () => {
  assert.equal(mdY('2026-08-01'), '8/1/2026');
  assert.equal(mdY('2026-12-25'), '12/25/2026');
  assert.equal(mdY(''), '');
});

test('leadingCode: takes the code prefix', () => {
  assert.equal(leadingCode('430028 – Ukraine European Partner Ministry'), '430028');
  assert.equal(leadingCode('002060 - Mel & Amy Ellenwood'), '002060');
  assert.equal(leadingCode(''), '');
});

test('usd rounds to cents', () => {
  assert.equal(usd(668.214), 668.21);
  assert.equal(usd('abc'), 0);
});

test('resolveDims: derives DEPT/CLASS/PROJECT from the fund it is booked to', () => {
  const d = resolveDims({ expenseAccount: '210730 – Garrett & Brittney Haas' });
  assert.equal(d.dept, '110-USA Staff');
  assert.equal(d.classId, '07-Estonia');
  assert.equal(d.project, '210730');
});

test('resolveDims: an explicit value on the expense overrides the fund lookup', () => {
  const d = resolveDims({ expenseAccount: '210730 – Garrett & Brittney Haas', classId: '99-Special' });
  assert.equal(d.classId, '99-Special');
  assert.equal(d.dept, '110-USA Staff'); // still from the fund
});

const camps = {
  id: 'r1', amountUsd: 668.21, description: 'Cash for EU camps',
  expenseAccount: '430028 – Ukraine European Initiatives', glCode: '8490000',
};

test('buildJournalEntry: header, then a bank credit line, then the expense', () => {
  const je = buildJournalEntry([camps], { batchLabel: 'EW Batch 146', date: '2026-08-01' });
  assert.deepEqual(je.rows[0], COLUMNS); // header first

  const bank = je.rows[1];
  assert.equal(bank[idx('ACCT_NO')], BANK_ACCT);
  assert.equal(bank[idx('CREDIT')], 668.21);
  assert.equal(bank[idx('DEBIT')], '');
  assert.equal(bank[idx('DEPT_ID')], '710-General Fund');
  assert.equal(bank[idx('GLENTRY_PROJECTID')], '10000');
  assert.equal(bank[idx('GLENTRY_CLASSID')], '00-JV Wide and USA');
  assert.equal(bank[idx('MEMO')], 'EW Batch 146');

  const line = je.rows[2];
  assert.equal(line[idx('JOURNAL')], 'EE');
  assert.equal(line[idx('DATE')], '8/1/2026');
  assert.equal(line[idx('LINE_NO')], 2);
  assert.equal(line[idx('ACCT_NO')], '8490000');
  assert.equal(line[idx('LOCATION_ID')], 'JV NFP--Josiah Venture');
  assert.equal(line[idx('DEPT_ID')], '132-National Projs');
  assert.equal(line[idx('MEMO')], 'Cash for EU camps');
  assert.equal(line[idx('DEBIT')], 668.21);
  assert.equal(line[idx('GLENTRY_PROJECTID')], '430028');
  assert.equal(line[idx('GLENTRY_CLASSID')], '08-Ukraine');

  assert.equal(je.missing.length, 0);
  assert.equal(je.count, 1);
  assert.equal(je.totalDebit, 668.21);
  assert.equal(je.totalCredit, 668.21);
  assert.equal(je.balanced, true);
});

test('buildJournalEntry: a wire fee adds the 7111100 debit line and stays balanced', () => {
  const je = buildJournalEntry([camps], { batchLabel: 'EW Batch 146', date: '2026-08-01', fee: 2.5 });
  const bank = rowByAcct(je, BANK_ACCT);
  const feeLine = rowByAcct(je, FEE_ACCT);
  assert.ok(feeLine, 'fee line present');
  assert.equal(feeLine[idx('DEBIT')], 2.5);
  assert.equal(feeLine[idx('MEMO')], 'Fee for EW Batch 146');
  assert.equal(feeLine[idx('LINE_NO')], 2);
  // Bank credit now covers expenses + fee.
  assert.equal(bank[idx('CREDIT')], 668.21 + 2.5);
  assert.equal(je.totalDebit, 670.71);
  assert.equal(je.totalCredit, 670.71);
  assert.equal(je.balanced, true);
  // Expense line follows the two bank lines.
  assert.equal(je.rows[3][idx('LINE_NO')], 3);
});

test('buildJournalEntry: no fee → no fee line, credit equals the expense total', () => {
  const je = buildJournalEntry([camps, camps], { batchLabel: 'B', date: '2026-08-01' });
  assert.equal(rowByAcct(je, FEE_ACCT), undefined);
  assert.equal(je.totalCredit, usd(668.21 * 2));
  assert.equal(je.balanced, true);
  // header + bank + 2 expenses
  assert.equal(je.rows.length, 4);
});

test('buildJournalEntry: unknown fund with no GL is flagged as missing', () => {
  const orphan = {
    id: 'r2', amountUsd: 20, description: 'Taxi',
    expenseAccount: '999999 – Not a real fund', glCode: '',
  };
  const je = buildJournalEntry([orphan], { batchLabel: 'B', date: '2026-08-01' });
  assert.equal(je.missing.length, 1);
  assert.deepEqual(je.missing[0].needs, ['GL account', 'fund', 'class']);
  // Project still falls back to the code they typed.
  const line = je.rows[2];
  assert.equal(line[idx('GLENTRY_PROJECTID')], '999999');
});

test('buildJournalEntry: line numbers are sequential across bank + expense lines', () => {
  const je = buildJournalEntry([camps, camps, camps], { batchLabel: 'B', date: '2026-08-01', fee: 1 });
  // bank(1), fee(2), then expenses 3,4,5
  const nums = je.rows.slice(1).map((r) => r[idx('LINE_NO')]);
  assert.deepEqual(nums, [1, 2, 3, 4, 5]);
  assert.equal(je.count, 3);
});

test('summaryRows: reports totals and the balance verdict', () => {
  const je = buildJournalEntry([camps], { batchLabel: 'EW Batch 146', date: '2026-08-01', fee: 2.5 });
  const rows = summaryRows({ batchId: 'batch-x', dateLabel: '8/1/2026', je, reportCount: 1, peopleCount: 1 });
  const map = new Map(rows.filter((r) => r.length === 2).map((r) => [r[0], r[1]]));
  assert.equal(map.get('Batch'), 'batch-x');
  assert.equal(map.get('Expense lines'), 1);
  assert.equal(map.get('Wire fee (USD)'), 2.5);
  assert.equal(map.get('Expenses total (USD)'), 668.21);
  assert.equal(map.get('Total credited to bank (USD)'), 670.71);
  assert.equal(map.get('Balanced'), 'Yes');
});

// --- shared workbook builder (JE + Summary sheets), used by export & re-download ---
const XLSX = require('xlsx');
const rec = (id, fields) => ({ id, fields });

test('buildWorkbook: two sheets, balances, and reports coding gaps', () => {
  const records = [
    rec('r1', { 'Amount (USD)': 668.21, Description: 'Camps', 'Expense Account': '430028 – Ukraine', Account: ['accGL'], Report: ['rep1'], 'Submitter Email': ['a@jv.org'] }),
    rec('r2', { 'Amount (USD)': 10, Description: 'Orphan', 'Expense Account': '999999 – nope', Report: ['rep1'], 'Submitter Email': ['a@jv.org'] }),
  ];
  const accounts = { accGL: { code: '8490000' } };
  const { base64, je, reportCount, peopleCount } = buildWorkbook(records, accounts, {
    batchId: 'b1', batchLabel: 'Reimbly b1', date: '2026-08-01', dateLabel: '8/1/2026', fee: 2.5,
  });
  const wb = XLSX.read(base64, { type: 'base64' });
  assert.deepEqual(wb.SheetNames, ['Journal Entry', 'Summary']);
  assert.equal(reportCount, 1);
  assert.equal(peopleCount, 1);
  // r2 has no GL code and an unknown fund → flagged, so the caller can block.
  assert.equal(je.missing.length, 1);
  assert.equal(je.missing[0].id, 'r2');
  assert.equal(je.balanced, true);
});
