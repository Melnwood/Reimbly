'use strict';

// Unit tests for the Intacct Journal-Entry builder (lib/intacct). Pure functions.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildJournalEntry, COLUMNS, mdY, leadingCode, usd } = require('../netlify/functions/lib/intacct');

const idx = (name) => COLUMNS.indexOf(name);

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

const fullyCoded = {
  id: 'r1', amountUsd: 668.21, description: 'Cash for EU camps',
  expenseAccount: '430028 – Ukraine European Partner Ministry',
  glCode: '8490000', deptId: '132-National Projs', projectId: '430028', classId: '08-Ukraine',
};

test('buildJournalEntry: header + a fully-coded line maps to the right columns', () => {
  const je = buildJournalEntry([fullyCoded], { batchLabel: 'Rembly Batch 20260801', date: '2026-08-01' });
  assert.deepEqual(je.rows[0], COLUMNS); // header first
  const line = je.rows[1];
  assert.equal(line[idx('JOURNAL')], 'EE');
  assert.equal(line[idx('DATE')], '8/1/2026');
  assert.equal(line[idx('DESCRIPTION')], 'Rembly Batch 20260801');
  assert.equal(line[idx('LINE_NO')], 1);
  assert.equal(line[idx('ACCT_NO')], '8490000');
  assert.equal(line[idx('LOCATION_ID')], 'JV NFP--Josiah Venture');
  assert.equal(line[idx('DEPT_ID')], '132-National Projs');
  assert.equal(line[idx('MEMO')], 'Cash for EU camps');
  assert.equal(line[idx('DEBIT')], 668.21);
  assert.equal(line[idx('GLENTRY_PROJECTID')], '430028');
  assert.equal(line[idx('GLENTRY_CLASSID')], '08-Ukraine');
  assert.equal(je.missing.length, 0);
  assert.equal(je.totalDebit, 668.21);
});

test('buildJournalEntry: project falls back to the account code; missing fund/class flagged', () => {
  const personal = {
    id: 'r2', amountUsd: 20, description: 'Taxi',
    expenseAccount: '002060 – Mel & Amy Ellenwood', glCode: '8395000',
    deptId: '', projectId: '', classId: '',
  };
  const je = buildJournalEntry([personal], { batchLabel: 'B', date: '2026-08-01' });
  const line = je.rows[1];
  assert.equal(line[idx('GLENTRY_PROJECTID')], '002060'); // derived from the account
  assert.equal(je.missing.length, 1);
  assert.deepEqual(je.missing[0].needs, ['fund', 'class']);
});

test('buildJournalEntry: line numbers are sequential across the batch', () => {
  const je = buildJournalEntry([fullyCoded, fullyCoded, fullyCoded], { batchLabel: 'B', date: '2026-08-01' });
  assert.equal(je.count, 3);
  assert.deepEqual([je.rows[1][idx('LINE_NO')], je.rows[2][idx('LINE_NO')], je.rows[3][idx('LINE_NO')]], [1, 2, 3]);
});
