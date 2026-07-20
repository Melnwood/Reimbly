'use strict';

// Finance / Cedarstone kicks an approved expense back to the submitter with a
// reason (missing receipt, wrong coding, etc.). It becomes "Rejected" so it
// shows up in the person's "My expenses" to fix and resubmit, and the reason
// is recorded on the trail. Finance only.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, STATUS, EVENTS, ensureStaff, displayMaps, shapeExpense, logActivity } = require('./lib/domain');

const today = () => new Date().toISOString().slice(0, 10);

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);
    if (role !== 'Finance') {
      const err = new Error('Only Finance can kick an expense back.');
      err.statusCode = 403;
      throw err;
    }

    const body = parseBody(event);
    const id = String(body.id || '').trim();
    const note = String(body.note || '').trim();
    if (!id) throw badRequest('Missing the expense id.');
    if (!note) throw badRequest('Please add a note so they know what to fix.');

    const current = await airtable.findFirst(TABLES.EXPENSES, {
      filterByFormula: `RECORD_ID() = '${id.replace(/'/g, "\\'")}'`,
    });
    if (!current) throw badRequest('That expense no longer exists.');
    const status = current.fields && current.fields.Status;
    // Cedarstone works the approved queue; a paid or already-rejected one is off-limits.
    if (status !== STATUS.APPROVED && status !== STATUS.SUBMITTED) {
      const err = new Error('You can only kick back an expense that is submitted or approved.');
      err.statusCode = 409;
      throw err;
    }

    const [updated, maps] = await Promise.all([
      airtable.updateRecord(TABLES.EXPENSES, id, {
        Status: STATUS.REJECTED,
        'Decided On': today(),
        'Approver Note': note,
      }),
      displayMaps(),
    ]);
    await logActivity({ expenseId: id, event: EVENTS.KICKED_BACK, user, note });

    return ok({ expense: shapeExpense(updated, maps) });
  } catch (err) {
    return error(err);
  }
};
