'use strict';

// Delete an expense. Owners may delete their own while it's still Submitted /
// Sent back / Draft; approvers and finance may delete any.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, ensureStaff, getExpenseById, canModify } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { id: staffId, role } = await ensureStaff(user);

    const id = String((parseBody(event) || {}).id || '').trim();
    if (!id) {
      const err = new Error('Missing the expense id.');
      err.statusCode = 400;
      throw err;
    }

    const current = await getExpenseById(id);
    if (!current) return ok({ deleted: true }); // already gone — nothing to do

    if (!(await canModify(current, user, role, null, staffId))) {
      const err = new Error('You can only delete your own expenses before they’re approved.');
      err.statusCode = 403;
      throw err;
    }

    await airtable.deleteRecord(TABLES.EXPENSES, id);
    return ok({ deleted: true });
  } catch (err) {
    return error(err);
  }
};
