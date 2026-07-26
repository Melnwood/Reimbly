'use strict';

// "Not a duplicate — keep both." Mark a flagged set of expenses as confirmed
// separate, so the duplicate detector won't group them again. We record, on each
// expense, the ids of the others it was cleared against (in "Dedupe Cleared").

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, ensureStaff, householdScope, getExpenseById, shapeExpense,
} = require('./lib/domain');

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { record: staffRec } = await ensureStaff(user);
    const { emails } = await householdScope(staffRec);
    const household = new Set(emails);

    const body = parseBody(event);
    const ids = uniq(Array.isArray(body.ids) ? body.ids.map((s) => String(s).trim()) : []);
    if (ids.length < 2) throw badRequest('Need at least two expenses to clear.');

    // Load each, confirm it belongs to the household, then add the OTHER ids to
    // its cleared list.
    const recs = await Promise.all(ids.map((id) => getExpenseById(id)));
    for (let i = 0; i < ids.length; i += 1) {
      const rec = recs[i];
      if (!rec) continue;
      const owner = String((shapeExpense(rec).submitterEmail) || '').toLowerCase();
      if (owner && household.size && !household.has(owner)) {
        const err = new Error('Those aren’t your household’s expenses.');
        err.statusCode = 403;
        throw err;
      }
    }
    for (let i = 0; i < ids.length; i += 1) {
      const rec = recs[i];
      if (!rec) continue;
      const existing = String((rec.fields && rec.fields['Dedupe Cleared']) || '').split(/[\s,]+/).filter(Boolean);
      const others = ids.filter((x) => x !== ids[i]);
      const merged = uniq(existing.concat(others));
      await airtable.updateRecord(TABLES.EXPENSES, ids[i], { 'Dedupe Cleared': merged.join('\n') });
    }

    return ok({ cleared: ids });
  } catch (err) {
    return error(err);
  }
};
