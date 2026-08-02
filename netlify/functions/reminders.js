'use strict';

// The gentle nudge. A Netlify scheduled function (daily — see netlify.toml) that
// reminds each person about their own expenses drawing near the reimbursement
// deadline (default 60 days from the expense date). The first nudge lands with
// 10 days to go ("you still have 10 days"), then it escalates, and — if a report
// blows the deadline — a weekly heads-up until it's dealt with.
//
// Gentle by design: push only (no email), so it reaches just the people who
// turned notifications on, and only on the milestone days, not daily. Change the
// deadline on the Rules screen; change the run time / turn it off in netlify.toml.

const airtable = require('./lib/airtable');
const {
  TABLES, STATUS, isHeldEmailReceipt, getReportDeadlineDays,
} = require('./lib/domain');
const { daysLeftFor, shouldRemind } = require('./lib/reminders');
const notify = require('./lib/notify');

const firstLookup = (v) => (Array.isArray(v) ? v[0] : v);
const today = () => new Date().toISOString().slice(0, 10);

exports.handler = async () => {
  try {
    const [drafts, deadline] = await Promise.all([
      airtable.listRecords(TABLES.EXPENSES, { filterByFormula: `{Status} = '${STATUS.DRAFT}'` }),
      getReportDeadlineDays(),
    ]);
    const now = today();

    // Per person, gather their unsubmitted drafts that are in the final stretch
    // (10 days or fewer left, or already past). Track the soonest deadline.
    const byEmail = new Map();
    for (const r of drafts) {
      const f = r.fields || {};
      if (isHeldEmailReceipt(f)) continue;
      const date = f['Expense Date'];
      if (!date) continue;
      const left = daysLeftFor(date, now, deadline);
      if (left == null || left > 10) continue; // not near the deadline yet
      const email = String(firstLookup(f['Submitter Email']) || '').toLowerCase();
      if (!email) continue;
      const g = byEmail.get(email) || { count: 0, minLeft: Infinity };
      g.count += 1;
      if (left < g.minLeft) g.minLeft = left;
      byEmail.set(email, g);
    }

    let reminded = 0;
    for (const [email, g] of byEmail) {
      const nudge = shouldRemind(g.minLeft); // gate on the soonest one
      if (!nudge) continue;
      const n = g.count;
      const expenses = `${n} expense${n === 1 ? '' : 's'}`;
      let title;
      let body;
      if (nudge.kind === 'overdue') {
        title = 'Past the reimbursement deadline';
        body = `${expenses} ${n === 1 ? 'is' : 'are'} past the ${deadline}-day limit — please submit ${n === 1 ? 'it' : 'them'} soon.`;
      } else if (nudge.kind === 'due') {
        title = 'Due today';
        body = `${expenses} ${n === 1 ? 'hits' : 'hit'} the ${deadline}-day limit today — submit ${n === 1 ? 'it' : 'them'} to be reimbursed.`;
      } else {
        title = `${g.minLeft} day${g.minLeft === 1 ? '' : 's'} left to finish your report`;
        body = `${expenses} ${n === 1 ? 'is' : 'are'} nearing the ${deadline}-day limit — you still have ${g.minLeft} day${g.minLeft === 1 ? '' : 's'}.`;
      }
      const ok = await notify.sendPush({ to: email, title, body });
      if (ok) reminded += 1;
    }

    console.log(`[reimbly] reminders: nudged ${reminded} of ${byEmail.size} nearing the ${deadline}-day limit`);
    return { statusCode: 200, body: JSON.stringify({ reminded, nearing: byEmail.size }) };
  } catch (e) {
    console.error('[reimbly] reminders failed', e && e.message);
    return { statusCode: 500, body: 'error' };
  }
};
