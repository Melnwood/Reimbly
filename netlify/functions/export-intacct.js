'use strict';

// Generate the Intacct Journal-Entry upload (.xlsx) for CedarStone and record the
// download as one payment batch. Finance only. This is the hand-off: it takes every
// Approved expense, builds the file, and — only if every line is fully coded —
// stamps them with a batch id + the download time, moves them into "Waiting to be
// paid", and hands back the file. If anything is missing a fund / GL code, it stops
// and reports exactly what to fix; nothing is committed. Format: docs/INTACCT-UPLOAD-FORMAT.md.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, STATUS, EVENTS, ensureStaff, accountMap, makeBatchId, logActivity,
} = require('./lib/domain');
const { buildWorkbook } = require('./lib/intacct-export');

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

    // Optional bank/wire fee for this pay run (adds the balancing 7111100 line).
    // Finance can pass it in; default 0 → no fee line, credit = the expense total.
    let fee = 0;
    try { fee = Number((JSON.parse(event.body || '{}') || {}).fee) || 0; } catch (e) { fee = 0; }

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

    const date = today();
    const stamp = date.replace(/-/g, '');
    const batchId = makeBatchId();
    const exportedOn = new Date().toISOString();
    const batchLabel = `Reimbly ${batchId}`;

    // Build the file first — no side effects yet.
    const { base64, je } = buildWorkbook(records, accounts, {
      batchId, batchLabel, date, dateLabel: date, fee, sheetName: `Reimbly JE ${stamp}`,
    });

    // Guard rail: never ship — or commit — a half-coded batch. If any line is
    // missing its GL account / fund / class, stop and say exactly what to fix.
    if (je.missing.length) {
      return ok({ blocked: true, missing: je.missing, count: je.count });
    }

    // All clean — record the download: stamp every line with the batch, fee, and
    // time, and move it into "Waiting to be paid". Best-effort per row so one bad
    // record doesn't sink the batch — but report how many actually moved.
    let queued = 0;
    for (const r of records) {
      try {
        await airtable.updateRecord(TABLES.EXPENSES, r.id, {
          Status: STATUS.WAITING_TO_PAY,
          'Payment Batch': batchId,
          'Exported On': exportedOn,
          'Batch Fee': fee,
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
