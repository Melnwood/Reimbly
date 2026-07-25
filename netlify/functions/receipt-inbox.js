'use strict';

// The signed-in person's "receipt inbox": receipts that arrived by email and are
// held as Drafts, waiting to be claimed by a YNAB row. GET lists them. POST lets
// the person hand-match one to an expense the auto-matcher missed, or discard a
// held receipt that isn't a real reimbursement.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, STATUS, EVENTS, ensureStaff, heldReceiptsFor, getExpenseById, logActivity, displayMaps, shapeExpense,
} = require('./lib/domain');

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

const owns = (rec, email) => ((rec.fields && rec.fields['Submitter Email']) || []).join(',').toLowerCase() === String(email).toLowerCase();

exports.handler = async (event) => {
  const guard = methodGuard(event, ['GET', 'POST']);
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    await ensureStaff(user);

    if ((event.httpMethod || 'GET').toUpperCase() === 'GET') {
      const held = await heldReceiptsFor(user.email);
      return ok({ receipts: held.map((h) => h.exp) });
    }

    // POST — attach or discard a held receipt.
    const body = parseBody(event);
    const id = String(body.id || '').trim();
    const action = String(body.action || '').trim().toLowerCase();
    if (!id) throw badRequest('Missing the receipt id.');

    const draft = await getExpenseById(id);
    if (!draft || (draft.fields && draft.fields.Status) !== STATUS.DRAFT) throw badRequest('That held receipt no longer exists.');
    if (!owns(draft, user.email)) { const e = new Error('That isn’t your receipt.'); e.statusCode = 403; throw e; }

    if (action === 'discard') {
      await airtable.deleteRecord(TABLES.EXPENSES, id);
      return ok({ discarded: true });
    }

    if (action === 'attach') {
      const expenseId = String(body.expenseId || '').trim();
      if (!expenseId) throw badRequest('Pick an expense to attach the receipt to.');
      const target = await getExpenseById(expenseId);
      if (!target) throw badRequest('That expense no longer exists.');
      if (!owns(target, user.email)) { const e = new Error('That isn’t your expense.'); e.statusCode = 403; throw e; }
      const receipt = Array.isArray(draft.fields.Receipt) ? draft.fields.Receipt : [];
      if (!receipt.length) throw badRequest('That held receipt has no file to attach.');

      // Copy the receipt file onto the target (Airtable ingests it by URL), then
      // remove the now-empty holding Draft.
      const updated = await airtable.updateRecord(TABLES.EXPENSES, expenseId, {
        Receipt: receipt.map((a) => ({ url: a.url, filename: a.filename })),
      });
      await airtable.deleteRecord(TABLES.EXPENSES, id);
      await logActivity({ expenseId, event: EVENTS.EDITED, user, note: 'Receipt attached from inbox' });

      const maps = await displayMaps();
      return ok({ attached: true, expense: shapeExpense(updated, maps) });
    }

    throw badRequest('Unknown action. Use "attach" or "discard".');
  } catch (err) {
    return error(err);
  }
};
