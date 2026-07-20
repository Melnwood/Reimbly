'use strict';

// Approve a whole batch of expenses at once (one person's report). Approver /
// Finance only. Only Submitted expenses are touched; anything else is skipped.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, STATUS, EVENTS, ensureStaff, isApprover, logActivity } = require('./lib/domain');

const today = () => new Date().toISOString().slice(0, 10);

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role, id: approverId } = await ensureStaff(user);
    if (!isApprover(role)) {
      const err = new Error('You do not have approver access.');
      err.statusCode = 403;
      throw err;
    }

    const body = parseBody(event);
    const ids = Array.isArray(body.ids) ? body.ids.map((v) => String(v).trim()).filter(Boolean) : [];
    const decision = String(body.decision || 'approve').toLowerCase();
    if (!ids.length) {
      const err = new Error('No expenses to approve.');
      err.statusCode = 400;
      throw err;
    }
    if (decision !== 'approve') {
      const err = new Error('Batch action must be "approve".');
      err.statusCode = 400;
      throw err;
    }

    let approved = 0;
    const skipped = [];
    for (const id of ids) {
      const rec = await airtable.findFirst(TABLES.EXPENSES, {
        filterByFormula: `RECORD_ID() = '${id.replace(/'/g, "\\'")}'`,
      });
      if (!rec || (rec.fields && rec.fields.Status) !== STATUS.SUBMITTED) {
        skipped.push(id); // already decided or gone — leave it alone
        continue;
      }
      await airtable.updateRecord(TABLES.EXPENSES, id, {
        Status: STATUS.APPROVED,
        'Decided On': today(),
        Approver: [approverId],
      });
      await logActivity({ expenseId: id, event: EVENTS.APPROVED, user });
      approved += 1;
    }

    return ok({ approved, skipped });
  } catch (err) {
    return error(err);
  }
};
