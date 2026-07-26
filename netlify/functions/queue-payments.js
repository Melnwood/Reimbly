'use strict';

// Move approved expenses into "Waiting to be paid" — the step CedarStone takes
// when it exports the approved batch to run through its own payment process.
// Finance only. Only Approved expenses are touched, so it's safe to click twice.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, STATUS, EVENTS, ensureStaff, logActivity } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);
    if (role !== 'Finance') {
      const err = new Error('Only Finance can queue payments.');
      err.statusCode = 403;
      throw err;
    }

    const body = parseBody(event);
    const ids = Array.isArray(body.ids) ? body.ids.map((v) => String(v).trim()).filter(Boolean) : [];
    if (!ids.length) {
      const err = new Error('No approved expenses to queue.');
      err.statusCode = 400;
      throw err;
    }

    let queued = 0;
    const skipped = [];
    for (const id of ids) {
      const rec = await airtable.findFirst(TABLES.EXPENSES, {
        filterByFormula: `RECORD_ID() = '${id.replace(/'/g, "\\'")}'`,
      });
      if (!rec || (rec.fields && rec.fields.Status) !== STATUS.APPROVED) {
        skipped.push(id); // not approved (yet), already queued, or gone
        continue;
      }
      await airtable.updateRecord(TABLES.EXPENSES, id, { Status: STATUS.WAITING_TO_PAY });
      await logActivity({ expenseId: id, event: EVENTS.QUEUED_FOR_PAYMENT, user });
      queued += 1;
    }

    return ok({ queued, skipped });
  } catch (err) {
    return error(err);
  }
};
