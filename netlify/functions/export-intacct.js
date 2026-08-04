'use strict';

// Generate the Intacct Journal-Entry upload (.xlsx) for CedarStone and record
// the download as one payment batch. Finance only. This is the hand-off: it
// takes every Approved expense, stamps them with a batch id + the download
// time, moves them into "Waiting to be paid", and hands back the file. Later,
// the one-click "Mark this download paid" button reimburses the whole batch.
// Format + field mapping: docs/INTACCT-UPLOAD-FORMAT.md.

const XLSX = require('xlsx');
const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, STATUS, EVENTS, ensureStaff, accountMap, makeBatchId, logActivity,
} = require('./lib/domain');
const { buildJournalEntry } = require('./lib/intacct');

const firstLink = (v) => (Array.isArray(v) && v.length ? v[0] : null);
const firstLookup = (v) => (Array.isArray(v) ? (v.length ? v[0] : '') : (v == null ? '' : v));
const today = () => new Date().toISOString().slice(0, 10);

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);
    if (role !== 'Finance') {
      const err = new Error('Only Finance can export the Intacct batch.');
      err.statusCode = 403;
      throw err;
    }

    // Only fresh Approved expenses form a new download. Anything already
    // "Waiting to be paid" belongs to a previous download and is left alone.
    const [records, accounts] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: `{Status} = '${STATUS.APPROVED}'`,
        'sort[0][field]': 'Expense Date',
        'sort[0][direction]': 'asc',
      }),
      accountMap(),
    ]);

    if (!records.length) {
      const err = new Error('Nothing approved to export yet.');
      err.statusCode = 400;
      throw err;
    }

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

    // Optional bank/wire fee for this pay run (adds the balancing 7111100 line).
    // Finance can pass it in; default 0 → no fee line, credit = the expense total.
    let fee = 0;
    try { fee = Number((JSON.parse(event.body || '{}') || {}).fee) || 0; } catch (e) { fee = 0; }

    const date = today();
    const stamp = date.replace(/-/g, '');
    const batchId = makeBatchId();
    const exportedOn = new Date().toISOString();
    const batchLabel = `Reimbly ${batchId}`;
    const je = buildJournalEntry(expenses, { batchLabel, date, fee });

    // Build the .xlsx (CedarStone's preferred upload format).
    const ws = XLSX.utils.aoa_to_sheet(je.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Reimbly JE ${stamp}`.slice(0, 31));
    const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

    // Record the download: stamp every line with the batch + time and move it
    // into "Waiting to be paid". Best-effort per row so one bad record doesn't
    // sink the batch — but report how many actually moved.
    let queued = 0;
    for (const r of records) {
      try {
        await airtable.updateRecord(TABLES.EXPENSES, r.id, {
          Status: STATUS.WAITING_TO_PAY,
          'Payment Batch': batchId,
          'Exported On': exportedOn,
        });
        await logActivity({ expenseId: r.id, event: EVENTS.QUEUED_FOR_PAYMENT, user, note: `Exported in ${batchId}` });
        queued += 1;
      } catch (e) {
        console.error('[reimbly] export-intacct stamp failed', r.id, e && e.message);
      }
    }

    return ok({
      filename: `reimbly-intacct-je-${date}.xlsx`,
      base64,
      count: je.count,
      totalDebit: je.totalDebit,
      totalCredit: je.totalCredit,
      balanced: je.balanced,
      fee: je.fee,
      missing: je.missing,
      batchId,
      exportedOn,
      queued,
    });
  } catch (err) {
    return error(err);
  }
};
