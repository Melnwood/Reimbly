'use strict';

// Mark a batch of approved expenses as reimbursed (paid). Finance only.
// Moves Approved → Reimbursed and stamps "Paid On". Anything not currently
// Approved is skipped, so this is safe to click twice.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, STATUS, EVENTS, ensureStaff, logActivity } = require('./lib/domain');
const notify = require('./lib/notify');

const today = () => new Date().toISOString().slice(0, 10);
const firstLookup = (v) => (Array.isArray(v) ? v[0] : v);

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);
    if (role !== 'Finance') {
      const err = new Error('Only Finance can mark expenses as paid.');
      err.statusCode = 403;
      throw err;
    }

    const body = parseBody(event);
    const ids = Array.isArray(body.ids) ? body.ids.map((v) => String(v).trim()).filter(Boolean) : [];
    if (!ids.length) {
      const err = new Error('No expenses to mark as paid.');
      err.statusCode = 400;
      throw err;
    }

    let paid = 0;
    const skipped = [];
    const perSubmitter = new Map(); // email -> { count, totalUsd }
    for (const id of ids) {
      const rec = await airtable.findFirst(TABLES.EXPENSES, {
        filterByFormula: `RECORD_ID() = '${id.replace(/'/g, "\\'")}'`,
      });
      if (!rec || (rec.fields && rec.fields.Status) !== STATUS.APPROVED) {
        skipped.push(id); // not approved (yet), or gone — leave it alone
        continue;
      }
      await airtable.updateRecord(TABLES.EXPENSES, id, {
        Status: STATUS.REIMBURSED,
        'Paid On': today(),
      });
      await logActivity({ expenseId: id, event: EVENTS.PAID, user });
      paid += 1;
      const email = (firstLookup(rec.fields['Submitter Email']) || '').toLowerCase();
      if (email) {
        const g = perSubmitter.get(email) || { count: 0, totalUsd: 0 };
        g.count += 1;
        g.totalUsd += Number(rec.fields['Amount (USD)']) || 0;
        perSubmitter.set(email, g);
      }
    }

    // Tell each person they've been reimbursed (best-effort).
    try {
      for (const [email, g] of perSubmitter) {
        await notify.submitterPaid({ submitter: { email }, count: g.count, totalUsd: g.totalUsd });
      }
    } catch (e) {
      console.error('[rembly] paid notify failed', e && e.message);
    }

    return ok({ paid, skipped });
  } catch (err) {
    return error(err);
  }
};
