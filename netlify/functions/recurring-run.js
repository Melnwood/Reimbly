'use strict';

// Materialize this month's copies of the signed-in household's monthly
// subscriptions. Called quietly when the app opens. For each template (an
// expense marked "Recurring Monthly"), if this month's copy hasn't been made
// yet — and no matching charge already came in (e.g. from the bank import) —
// create a fresh Draft copy dated this month. Copies never carry the receipt,
// so each still passes through the normal receipt gate.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, STATUS, EVENTS, DEFAULT_PAYMENT_METHOD,
  ensureStaff, householdScope, submitterEmailFormula, logActivity,
} = require('./lib/domain');
const { monthOf, recurringCopyDate } = require('./lib/recurring');

const today = () => new Date().toISOString().slice(0, 10);
const firstLinkId = (v) => (Array.isArray(v) && v.length ? v[0] : null);
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { record: staffRec } = await ensureStaff(user);
    const { emails } = await householdScope(staffRec);

    const currentMonth = monthOf(today());
    const mine = await airtable.listRecords(TABLES.EXPENSES, {
      filterByFormula: submitterEmailFormula(emails),
    });

    const templates = mine.filter((r) => (r.fields || {})['Recurring Monthly'] === true);
    if (!templates.length) return ok({ created: 0 });

    // What the household already has this month, to avoid double-making.
    const thisMonth = mine.filter((r) => monthOf((r.fields || {})['Expense Date']) === currentMonth);
    const madeSources = new Set(thisMonth.map((r) => (r.fields || {})['Recurring Source']).filter(Boolean));
    const merchantsThisMonth = new Set(thisMonth.map((r) => norm((r.fields || {}).Merchant)).filter(Boolean));

    let created = 0;
    for (const t of templates) {
      const f = t.fields || {};
      const copyDate = recurringCopyDate(f['Expense Date'], currentMonth);
      if (!copyDate) continue;                       // template is this month / future
      if (madeSources.has(t.id)) continue;           // this month's copy already exists
      const merchant = norm(f.Merchant);
      if (merchant && merchantsThisMonth.has(merchant)) continue; // real charge already in (e.g. import)

      // Copy the coding, not the proof. Draft, dated this month, no receipt.
      const fields = {
        Description: f.Description || '',
        Amount: f.Amount,
        'Expense Date': copyDate,
        'Payment Method': f['Payment Method'] || DEFAULT_PAYMENT_METHOD,
        Status: STATUS.DRAFT,
        Submitter: Array.isArray(f.Submitter) ? f.Submitter : [],
        Currency: Array.isArray(f.Currency) ? f.Currency : [],
        Account: Array.isArray(f.Account) ? f.Account : [],
        'Recurring Source': t.id,
      };
      if (f.Merchant) fields.Merchant = f.Merchant;
      if (f['Business Purpose']) fields['Business Purpose'] = f['Business Purpose'];
      if (f['Expense Account']) fields['Expense Account'] = f['Expense Account'];

      try {
        const rec = await airtable.createRecord(TABLES.EXPENSES, fields);
        await logActivity({ expenseId: rec.id, event: EVENTS.IMPORTED, user, note: 'Monthly subscription — auto-created' });
        created += 1;
        merchantsThisMonth.add(merchant); // guard against two templates for the same merchant
      } catch (e) {
        console.error('[reimbly] recurring create failed', t.id, e && e.message);
      }
    }

    return ok({ created });
  } catch (err) {
    return error(err);
  }
};
