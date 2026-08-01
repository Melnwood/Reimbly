'use strict';

// Expense reports: named containers a person puts expenses into and submits as a
// batch. GET lists the caller's reports. POST creates/renames/deletes one,
// moves an expense in or out, or submits a whole report for approval.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, STATUS, EVENTS,
  ensureStaff, staffById, logActivity,
  getReportById, listReportsOwnedByAny, createReport, setExpenseReport, reportOwnedBy,
  householdScope, submitterEmailFormula,
  displayMaps, shapeExpense, isHeldEmailReceipt, isExpenseReady, getReceiptThresholdUsd,
} = require('./lib/domain');
const { pickBest } = require('./lib/matching');
const notify = require('./lib/notify');

const today = () => new Date().toISOString().slice(0, 10);
const firstLookup = (v) => (Array.isArray(v) ? v[0] : v);
const firstLinkId = (v) => (Array.isArray(v) && v.length ? v[0] : null);
const esc = (s) => String(s).replace(/'/g, "\\'");

// The household's expenses that belong to a given report (queried directly, so
// we never depend on Airtable's cached reverse-link being up to date).
async function membersOf(reportId, emails) {
  const mine = await airtable.listRecords(TABLES.EXPENSES, {
    filterByFormula: submitterEmailFormula(emails),
  });
  return mine.filter((r) => firstLinkId(r.fields && r.fields.Report) === reportId);
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}
function forbidden(message) {
  const err = new Error(message);
  err.statusCode = 403;
  return err;
}

// Is this one of the household's expenses? (Any pooled member may manage it.)
async function ownExpense(expenseId, emails) {
  const rec = await airtable.findFirst(TABLES.EXPENSES, {
    filterByFormula: `RECORD_ID() = '${esc(expenseId)}'`,
  });
  if (!rec) return null;
  const owner = String(firstLookup(rec.fields['Submitter Email']) || '').toLowerCase();
  return emails.includes(owner) ? rec : false;
}

exports.handler = async (event) => {
  const guard = methodGuard(event, ['GET', 'POST']);
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { id: staffId, record: staffRec } = await ensureStaff(user);
    // The household this person is pooled with (just themselves if none set).
    const { ids: householdIds, emails: householdEmails } = await householdScope(staffRec);

    if ((event.httpMethod || 'GET').toUpperCase() === 'GET') {
      const reports = await listReportsOwnedByAny(householdIds);
      // Resolve owner names so a couple can tell whose report is whose.
      const maps = householdIds.size > 1 ? await displayMaps() : null;
      return ok({ reports: reports.map((r) => ({
        id: r.id,
        name: r.name,
        submittedOn: r.submittedOn,
        count: r.expenseIds.length,
        ownerName: maps && r.ownerId && maps.staff && maps.staff[r.ownerId] ? maps.staff[r.ownerId].name : '',
      })) });
    }

    const body = parseBody(event);
    const action = String(body.action || '').toLowerCase();

    // --- create ---------------------------------------------------------
    if (action === 'create') {
      const name = String(body.name || '').trim().slice(0, 100);
      if (!name) throw badRequest('Give the report a name.');
      const rec = await createReport(name, staffId);
      return ok({ report: { id: rec.id, name, count: 0 } });
    }

    // --- rename ---------------------------------------------------------
    if (action === 'rename') {
      const id = String(body.id || '').trim();
      const name = String(body.name || '').trim().slice(0, 100);
      if (!id || !name) throw badRequest('Need the report and a new name.');
      const report = await getReportById(id);
      if (!report) throw badRequest('That report no longer exists.');
      if (!reportOwnedBy(report, householdIds)) throw forbidden('That isn’t your report.');
      await airtable.updateRecord(TABLES.REPORTS, id, { Name: name });
      return ok({ report: { id, name } });
    }

    // --- delete (only when empty) --------------------------------------
    if (action === 'delete') {
      const id = String(body.id || '').trim();
      if (!id) throw badRequest('Which report?');
      const report = await getReportById(id);
      if (!report) return ok({ deleted: true });
      if (!reportOwnedBy(report, householdIds)) throw forbidden('That isn’t your report.');
      const members = await membersOf(id, householdEmails);
      if (members.length) throw badRequest('Move its expenses out first, then delete the report.');
      await airtable.deleteRecord(TABLES.REPORTS, id);
      return ok({ deleted: true });
    }

    // --- assign an expense to a report (or clear it) --------------------
    if (action === 'assign') {
      const expenseId = String(body.expenseId || '').trim();
      const reportId = body.reportId ? String(body.reportId).trim() : null;
      if (!expenseId) throw badRequest('Which expense?');
      const exp = await ownExpense(expenseId, householdEmails);
      if (exp === null) throw badRequest('That expense no longer exists.');
      if (exp === false) throw forbidden('That isn’t your expense.');
      if (reportId) {
        const report = await getReportById(reportId);
        if (!report) throw badRequest('That report no longer exists.');
        if (!reportOwnedBy(report, householdIds)) throw forbidden('That isn’t your report.');
      }
      await setExpenseReport(expenseId, reportId);
      return ok({ assigned: true, expenseId, reportId });
    }

    // --- file a held email receipt into a report (de-duplicating) -------
    // If the person already has an expense that matches this receipt (same
    // money + day), attach the receipt to THAT one and drop the held copy —
    // so filing a receipt never creates a second copy of the same charge.
    if (action === 'file') {
      const expenseId = String(body.expenseId || '').trim();
      const reportId = body.reportId ? String(body.reportId).trim() : null;
      if (!expenseId) throw badRequest('Which receipt?');
      const heldRec = await airtable.findFirst(TABLES.EXPENSES, { filterByFormula: `RECORD_ID() = '${esc(expenseId)}'` });
      if (!heldRec) throw badRequest('That receipt no longer exists.');
      if (!householdEmails.includes(String(firstLookup(heldRec.fields['Submitter Email']) || '').toLowerCase())) throw forbidden('That isn’t your receipt.');
      if (reportId) {
        const report = await getReportById(reportId);
        if (!report) throw badRequest('That report no longer exists.');
        if (!reportOwnedBy(report, householdIds)) throw forbidden('That isn’t your report.');
      }

      const maps = await displayMaps();
      const held = shapeExpense(heldRec, maps);
      const mineRecs = await airtable.listRecords(TABLES.EXPENSES, {
        filterByFormula: submitterEmailFormula(householdEmails),
      });
      // Everything in the household that could be the real expense — not this
      // receipt, and not another unclaimed email receipt.
      const candidates = mineRecs
        .filter((r) => r.id !== expenseId && !isHeldEmailReceipt(r.fields))
        .map((r) => ({ rec: r, e: shapeExpense(r, maps) }));
      const pool = candidates.map((c) => ({ amount: c.e.amount, date: c.e.date, merchant: c.e.merchant, currency: c.e.currency || 'USD' }));
      const idx = pickBest({ amount: held.amount, date: held.date, merchant: held.merchant, currency: held.currency || 'USD' }, pool);

      if (idx >= 0) {
        const match = candidates[idx];
        const heldReceipt = Array.isArray(heldRec.fields.Receipt) ? heldRec.fields.Receipt : [];
        // Give the matched expense the receipt if it doesn't already have one.
        if (!match.e.receipt && heldReceipt.length) {
          await airtable.updateRecord(TABLES.EXPENSES, match.rec.id, {
            Receipt: heldReceipt.map((a) => ({ url: a.url, filename: a.filename })),
          });
        }
        // Drop it into the chosen report if it isn't in one yet.
        if (reportId && !firstLinkId(match.rec.fields.Report)) {
          await setExpenseReport(match.rec.id, reportId);
        }
        await airtable.deleteRecord(TABLES.EXPENSES, expenseId); // remove the duplicate copy
        await logActivity({ expenseId: match.rec.id, event: EVENTS.EDITED, user, note: 'Emailed receipt matched to this expense (duplicate avoided)' });
        return ok({ merged: true, into: match.rec.id });
      }

      // No match — file it as a new expense in the report, as before.
      await setExpenseReport(expenseId, reportId);
      return ok({ filed: true });
    }

    // --- submit a whole report for approval -----------------------------
    if (action === 'submit') {
      const id = String(body.id || '').trim();
      if (!id) throw badRequest('Which report?');
      const report = await getReportById(id);
      if (!report) throw badRequest('That report no longer exists.');
      if (!reportOwnedBy(report, householdIds)) throw forbidden('That isn’t your report.');

      const members = await membersOf(id, householdEmails);

      // Readiness gate: every draft about to be submitted must be complete — an
      // account, a receipt (or a signed "no receipt" note), and the basics filled
      // in. If any aren't ready, block the whole submit so nothing half-done
      // reaches the approver. The app highlights the ones that need fixing.
      const drafts = members.filter((rec) => (rec.fields.Status || '') === STATUS.DRAFT);
      const receiptLimit = await getReceiptThresholdUsd();
      const notReady = drafts.filter((rec) => !isExpenseReady(rec.fields, receiptLimit));
      if (notReady.length) {
        const n = notReady.length;
        throw badRequest(`${n} expense${n === 1 ? '' : 's'} in this report ${n === 1 ? 'isn’t' : 'aren’t'} ready — each needs an account, a receipt (or a signed “no receipt” note), and the basics filled in. Fix the highlighted one${n === 1 ? '' : 's'}, then submit.`);
      }

      let submitted = 0;
      let totalUsd = 0;
      for (const rec of members) {
        if ((rec.fields.Status || '') !== STATUS.DRAFT) continue; // only unsubmitted ones
        await airtable.updateRecord(TABLES.EXPENSES, rec.id, { Status: STATUS.SUBMITTED, 'Submitted On': today() });
        await logActivity({ expenseId: rec.id, event: EVENTS.SUBMITTED, user, note: `Submitted with report “${report.fields.Name || ''}”` });
        submitted += 1;
        totalUsd += Number(rec.fields['Amount (USD)']) || 0;
      }
      if (submitted) {
        try { await airtable.updateRecord(TABLES.REPORTS, id, { 'Submitted On': today() }); } catch (e) { /* non-critical */ }
        try {
          const uplineId = Array.isArray(staffRec.fields && staffRec.fields.Upline) ? staffRec.fields.Upline[0] : null;
          if (uplineId) {
            const approver = await staffById(uplineId);
            await notify.approverNewExpenses({ approver, submitterName: user.name, count: submitted, totalUsd });
          }
        } catch (e) { console.error('[rembly] report submit notify failed', e && e.message); }
      }
      return ok({ submitted });
    }

    throw badRequest('Unknown action.');
  } catch (err) {
    return error(err);
  }
};
