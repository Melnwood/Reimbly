'use strict';

// Generate the Intacct Journal-Entry upload (.xlsx) for Cedarstone from the
// current payable batch (Approved + Waiting-to-be-paid expenses). Finance only.
// Read-only: it produces the file, it doesn't change any expense's status.
// Format + field mapping: docs/INTACCT-UPLOAD-FORMAT.md.

const XLSX = require('xlsx');
const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, STATUS, ensureStaff, accountMap } = require('./lib/domain');
const { buildJournalEntry } = require('./lib/intacct');

const firstLink = (v) => (Array.isArray(v) && v.length ? v[0] : null);
const firstLookup = (v) => (Array.isArray(v) ? (v.length ? v[0] : '') : (v == null ? '' : v));
const today = () => new Date().toISOString().slice(0, 10);

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);
    if (role !== 'Finance') {
      const err = new Error('Only Finance can export the Intacct batch.');
      err.statusCode = 403;
      throw err;
    }

    const [records, accounts] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: `OR({Status} = '${STATUS.APPROVED}', {Status} = '${STATUS.WAITING_TO_PAY}')`,
        'sort[0][field]': 'Expense Date',
        'sort[0][direction]': 'asc',
      }),
      accountMap(),
    ]);

    // Normalize each expense into the shape the JE builder expects.
    const expenses = records.map((r) => {
      const f = r.fields || {};
      const acct = accounts[firstLink(f.Account)] || {};
      return {
        id: r.id,
        amountUsd: f['Amount (USD)'],
        description: f.Description || '',
        expenseAccount: f['Expense Account'] || '',
        glCode: acct.code || '',
        deptId: firstLookup(f['Fund Code']),      // Intacct DEPT_ID
        projectId: firstLookup(f['Project Code']), // Intacct GLENTRY_PROJECTID
        classId: firstLookup(f['Class']),          // Intacct GLENTRY_CLASSID
        person: firstLookup(f['Submitter Email']) || '',
      };
    });

    const date = today();
    const stamp = date.replace(/-/g, '');
    const batchLabel = `Rembly Batch ${stamp}`;
    const je = buildJournalEntry(expenses, { batchLabel, date });

    // Build the .xlsx (Cedarstone's preferred upload format).
    const ws = XLSX.utils.aoa_to_sheet(je.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Rembly JE ${stamp}`.slice(0, 31));
    const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

    return ok({
      filename: `rembly-intacct-je-${date}.xlsx`,
      base64,
      count: je.count,
      totalDebit: je.totalDebit,
      missing: je.missing,
    });
  } catch (err) {
    return error(err);
  }
};
