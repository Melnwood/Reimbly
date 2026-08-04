'use strict';

// Re-download the Intacct file for a batch that was already exported — same file,
// nothing committed. For when Finance loses the download or CedarStone needs it
// again. Finance only. Reproduces the original file exactly: same batch label, the
// original download date, and the wire fee that was saved with the batch.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, ensureStaff, accountMap } = require('./lib/domain');
const { buildWorkbook } = require('./lib/intacct-export');

const firstVal = (v) => (Array.isArray(v) ? (v.length ? v[0] : '') : (v == null ? '' : v));

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);
    if (role !== 'Finance') {
      const err = new Error('Only Finance can download the Intacct batch.');
      err.statusCode = 403;
      throw err;
    }

    const batchId = String((JSON.parse(event.body || '{}') || {}).batchId || '').trim();
    if (!batchId) {
      const err = new Error('Which batch? No batch id was given.');
      err.statusCode = 400;
      throw err;
    }

    const [records, accounts] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: `{Payment Batch} = '${batchId.replace(/'/g, "\\'")}'`,
        'sort[0][field]': 'Expense Date',
        'sort[0][direction]': 'asc',
      }),
      accountMap(),
    ]);

    if (!records.length) {
      const err = new Error('That batch could not be found.');
      err.statusCode = 404;
      throw err;
    }

    // Reproduce the original download exactly, from what was saved on the records.
    const f0 = records[0].fields || {};
    const exportedOn = firstVal(f0['Exported On']) || '';
    const date = (String(exportedOn).slice(0, 10)) || new Date().toISOString().slice(0, 10);
    const fee = Number(f0['Batch Fee']) || 0;
    const stamp = date.replace(/-/g, '');
    const batchLabel = `Reimbly ${batchId}`;

    const { base64, je } = buildWorkbook(records, accounts, {
      batchId, batchLabel, date, dateLabel: date, fee, sheetName: `Reimbly JE ${stamp}`,
    });

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
      reissued: true,
    });
  } catch (err) {
    return error(err);
  }
};
