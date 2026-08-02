'use strict';

// The monthly nudge. A Netlify scheduled function (see netlify.toml) that runs
// once near month-end and gives each person a gentle push about the expenses
// they still have sitting as drafts — "3 to submit, 1 still needs a receipt."
//
// Gentle by design: push only (no email), so it reaches just the people who
// turned notifications on, and only when they actually have something waiting.
// To change the day or turn it off, edit the schedule in netlify.toml.

const airtable = require('./lib/airtable');
const {
  TABLES, STATUS, isHeldEmailReceipt, isExpenseReady, getReceiptThresholdUsd,
} = require('./lib/domain');
const notify = require('./lib/notify');

const firstLookup = (v) => (Array.isArray(v) ? v[0] : v);

exports.handler = async () => {
  try {
    const [drafts, limit] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, { filterByFormula: `{Status} = '${STATUS.DRAFT}'` }),
      getReceiptThresholdUsd(),
    ]);

    // Tally each person's own unsubmitted drafts (skipping held email receipts,
    // which aren't theirs to submit yet).
    const byEmail = new Map();
    for (const r of drafts) {
      const f = r.fields || {};
      if (isHeldEmailReceipt(f)) continue;
      const email = String(firstLookup(f['Submitter Email']) || '').toLowerCase();
      if (!email) continue;
      const g = byEmail.get(email) || { total: 0, notReady: 0 };
      g.total += 1;
      if (!isExpenseReady(f, limit)) g.notReady += 1;
      byEmail.set(email, g);
    }

    let reminded = 0;
    for (const [email, g] of byEmail) {
      if (!g.total) continue;
      const body = g.notReady
        ? `${g.total} expense${g.total === 1 ? '' : 's'} to submit — ${g.notReady} still ${g.notReady === 1 ? 'needs' : 'need'} a receipt or a detail.`
        : `${g.total} expense${g.total === 1 ? '' : 's'} ready to submit.`;
      // Push only — reaches people who opted into notifications. Never throws.
      const ok = await notify.sendPush({ to: email, title: 'A gentle nudge from Reimbly', body });
      if (ok) reminded += 1;
    }

    console.log(`[reimbly] reminders: nudged ${reminded} of ${byEmail.size} with drafts`);
    return { statusCode: 200, body: JSON.stringify({ reminded, withDrafts: byEmail.size }) };
  } catch (e) {
    console.error('[reimbly] reminders failed', e && e.message);
    return { statusCode: 500, body: 'error' };
  }
};
