'use strict';

// The paid archive. Approver / Finance only.
//   ready   — Approved, not yet exported (Finance exports these to start paying).
//   waiting — "Waiting to be paid": exported and awaiting the actual payment,
//             where Finance bulk-marks them paid (Finance only).
//   paid    — expenses already Reimbursed, newest first (the archive).
// Finance sees everyone; an approver sees only the people who report to them.

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
    const isFinance = role === 'Finance';

    const [records, maps] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: `OR({Status} = '${STATUS.APPROVED}', {Status} = '${STATUS.WAITING_TO_PAY}', {Status} = '${STATUS.REIMBURSED}')`,
      }),
      displayMaps(),
    ]);

    let items = records.map((r) => shapeExpense(r, maps));

    // An approver who isn't Finance only sees their own people's expenses.
    if (!isFinance) {
      items = items.filter((e) => {
        const submitter = e.submitterId && maps.staff[e.submitterId];
        const uplineId = submitter && submitter.uplineId;
        return !uplineId || uplineId === myStaffId;
      });
    }

    // Exporting and marking-paid are Finance actions, so only Finance gets those.
    const ready = isFinance ? items.filter((e) => e.status === STATUS.APPROVED) : [];
    const waiting = isFinance ? items.filter((e) => e.status === STATUS.WAITING_TO_PAY) : [];
    const paid = items
      .filter((e) => e.status === STATUS.REIMBURSED)
      .sort((a, b) => String(b.paidOn || '').localeCompare(String(a.paidOn || '')));

    return ok({ ready, waiting, paid, role });
  } catch (err) {
    return error(err);
  }
};
