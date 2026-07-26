'use strict';

// Everything waiting for a decision. Approver / Finance only.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, STATUS, ensureStaff, isApprover, displayMaps, shapeExpense } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role, id: myStaffId } = await ensureStaff(user);
    if (!isApprover(role)) {
      const err = new Error('You do not have approver access.');
      err.statusCode = 403;
      throw err;
    }

    const year = new Date().getUTCFullYear();
    const [records, missingRecords, maps] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: `{Status} = '${STATUS.SUBMITTED}'`,
        'sort[0][field]': 'Submitted On',
        'sort[0][direction]': 'asc',
      }),
      // Every missing-receipt affidavit this year, any status — for the per-person
      // year-to-date count shown on the review queue.
      airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: `AND({Missing Receipt} = 1, YEAR({Submitted On}) = ${year})`,
      }),
      displayMaps(),
    ]);

    let expenses = records.map((r) => shapeExpense(r, maps));

    // ytdMissing: submitterId -> how many missing-receipt affidavits they've signed
    // this year. A rising count is the cue for a gentle check-in (not a gotcha).
    const ytdMissing = {};
    for (const r of missingRecords) {
      const e = shapeExpense(r, maps);
      if (e.submitterId) ytdMissing[e.submitterId] = (ytdMissing[e.submitterId] || 0) + 1;
    }

    // Finance sees everything; an approver sees expenses from the people who
    // report to them (Upline = them), plus any with no upline set yet.
    if (role !== 'Finance') {
      expenses = expenses.filter((e) => {
        const submitter = e.submitterId && maps.staff[e.submitterId];
        const uplineId = submitter && submitter.uplineId;
        return !uplineId || uplineId === myStaffId;
      });
    }

    return ok({ expenses, role, ytdMissing });
  } catch (err) {
    return error(err);
  }
};
