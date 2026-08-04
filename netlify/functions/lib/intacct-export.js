'use strict';

// Shared Intacct-export plumbing used by both the live export (export-intacct) and
// the re-download of a past batch (redownload-intacct): turn Airtable expense
// records into the JE + Summary workbook. No side effects — building the file never
// changes anything; the caller decides whether to commit the batch.

const XLSX = require('xlsx');
const { buildJournalEntry, summaryRows } = require('./intacct');

const firstLink = (v) => (Array.isArray(v) && v.length ? v[0] : null);
const firstLookup = (v) => (Array.isArray(v) ? (v.length ? v[0] : '') : (v == null ? '' : v));

// One Airtable expense record → the shape the JE builder expects.
function normalizeExpense(r, accounts) {
  const f = r.fields || {};
  const acct = accounts[firstLink(f.Account)] || {};
  return {
    id: r.id,
    amountUsd: f['Amount (USD)'],
    description: f.Description || '',
    expenseAccount: f['Expense Account'] || '',
    glCode: acct.code || '',
    deptId: firstLookup(f['Fund Code']),      // Intacct DEPT_ID (explicit override, if set)
    projectId: firstLookup(f['Project Code']), // Intacct GLENTRY_PROJECTID
    classId: firstLookup(f['Class']),          // Intacct GLENTRY_CLASSID
    person: firstLookup(f['Submitter Email']) || '',
    reportId: firstLink(f.Report),
  };
}

// Build the .xlsx (Journal Entry + Summary sheets) from expense records. Returns
// the base64 file plus the built `je` (so the caller can read je.missing / totals).
function buildWorkbook(records, accounts, { batchId, batchLabel, date, dateLabel, fee, sheetName }) {
  const expenses = (records || []).map((r) => normalizeExpense(r, accounts));
  const je = buildJournalEntry(expenses, { batchLabel, date, fee });
  const reportCount = new Set(expenses.map((e) => e.reportId).filter(Boolean)).size;
  const peopleCount = new Set(expenses.map((e) => e.person).filter(Boolean)).size;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(je.rows), String(sheetName || 'Journal Entry').slice(0, 31));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(summaryRows({ batchId, dateLabel, je, reportCount, peopleCount })),
    'Summary',
  );
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  return { base64, je, expenses, reportCount, peopleCount };
}

module.exports = { normalizeExpense, buildWorkbook };
