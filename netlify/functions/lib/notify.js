'use strict';

// Notifications — email and iPhone/browser push. Both are feature-flagged: with
// no keys set every send is a silent no-op, so the app runs fine without them.
// Sends are always best-effort — a failed notification never blocks the action
// that triggered it.
//
// Env:
//   RESEND_API_KEY      turn email on (https://resend.com)
//   NOTIFY_FROM         e.g. "Rembly <rembly@josiahventure.com>" (verified sender)
//   APP_URL             link back to the app (default the Netlify site)
//   VAPID_PUBLIC_KEY    turn push on (generate with: npx web-push generate-vapid-keys)
//   VAPID_PRIVATE_KEY   the matching private key (secret)
//   VAPID_SUBJECT       a contact URL or mailto, e.g. mailto:it@josiahventure.com

const domain = require('./domain');

const APP_NAME = 'Rembly';
const appUrl = () => process.env.APP_URL || 'https://reimbly.netlify.app';

const pushOn = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

function usd(n) {
  const v = Number(n);
  if (!isFinite(v)) return '';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

const labelOf = (e = {}) => e.merchant || e.description || 'an expense';
const amountOf = (e = {}) => (e.amountUsd != null ? usd(e.amountUsd) : (e.amount != null ? `${e.amount} ${e.currency || ''}`.trim() : ''));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// A small, brand-styled email shell.
function shell({ heading, intro, rows = [], cta, ctaLabel }) {
  const detail = rows.length
    ? `<table style="margin:16px 0;border-collapse:collapse;font-size:14px;color:#16203a">${rows
        .map((r) => `<tr><td style="padding:3px 14px 3px 0;color:#59617a">${esc(r[0])}</td><td style="padding:3px 0;font-weight:600">${esc(r[1])}</td></tr>`)
        .join('')}</table>`
    : '';
  const button = cta
    ? `<a href="${esc(cta)}" style="display:inline-block;margin-top:8px;background:#e11d74;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:999px">${esc(ctaLabel || 'Open ' + APP_NAME)}</a>`
    : '';
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:8px">
    <div style="font-weight:800;font-size:18px;color:#16203a;letter-spacing:-.02em;margin-bottom:14px">rembly</div>
    <div style="background:#fff;border:1px solid #e4e7f1;border-radius:14px;padding:22px 24px">
      <h1 style="margin:0 0 8px;font-size:19px;color:#16203a">${esc(heading)}</h1>
      <p style="margin:0;color:#59617a;font-size:15px;line-height:1.5">${intro}</p>
      ${detail}
      ${button}
    </div>
    <p style="color:#8c93a8;font-size:12px;margin:14px 4px">${APP_NAME} · Josiah Venture expenses</p>
  </div>`;
  const text = `${heading}\n\n${String(intro).replace(/<[^>]+>/g, '')}\n${rows.map((r) => `${r[0]}: ${r[1]}`).join('\n')}${cta ? `\n\n${ctaLabel || 'Open ' + APP_NAME}: ${cta}` : ''}`;
  return { html, text };
}

async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false; // notifications off, or no recipient
  const from = process.env.NOTIFY_FROM || 'Rembly <onboarding@resend.dev>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!res.ok) {
      console.error('[rembly] email failed', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[rembly] email error', e && e.message);
    return false;
  }
}

// Send a push to every device a person has registered. Off unless the VAPID
// keys are set. Prunes subscriptions the push service reports as gone (404/410).
async function sendPush({ to, title, body, url }) {
  if (!pushOn() || !to) return false;
  let subs;
  try {
    subs = await domain.getPushSubs(to);
  } catch (e) {
    return false;
  }
  if (!subs.length) return false;

  const webpush = require('web-push');
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:it@josiahventure.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  const payload = JSON.stringify({ title: title || APP_NAME, body: body || '', url: url || appUrl() });
  const dead = [];
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) dead.push(sub.endpoint); // gone for good
      else console.error('[rembly] push failed', code || (e && e.message));
    }
  }));
  if (dead.length) {
    try { await domain.removePushSubs(to, dead); } catch (e) { /* best-effort */ }
  }
  return true;
}

// ---- the notifications ------------------------------------------------

// A new expense is waiting for an approver.
async function approverNewExpense({ approver, submitterName, expense }) {
  if (!approver || !approver.email) return;
  const { html, text } = shell({
    heading: `${submitterName || 'Someone'} needs your approval`,
    intro: `${esc(submitterName || 'A staff member')} just submitted an expense that's waiting for you to review.`,
    rows: [['What', labelOf(expense)], ['Amount', amountOf(expense)], ['Date', expense.date || '']].filter((r) => r[1]),
    cta: `${appUrl()}/#approvals`,
    ctaLabel: 'Review it',
  });
  await Promise.all([
    sendEmail({ to: approver.email, subject: `${submitterName || 'A staff member'} submitted an expense to approve`, html, text }),
    sendPush({ to: approver.email, title: 'New expense to approve', body: `${submitterName || 'A staff member'} — ${amountOf(expense) || labelOf(expense)}`, url: `${appUrl()}/#approvals` }),
  ]);
}

// A whole batch of expenses was just submitted for one approver (e.g. after an
// import — the person reviewed and hit "Submit all").
async function approverNewExpenses({ approver, submitterName, count = 1, totalUsd }) {
  if (!approver || !approver.email) return;
  if (count === 1) {
    // Fall back to the single-expense wording when it's really just one.
    return approverNewExpense({ approver, submitterName, expense: {} });
  }
  const who = submitterName || 'A staff member';
  const { html, text } = shell({
    heading: `${who} sent ${count} expenses to approve`,
    intro: `${esc(who)} just submitted ${count} expenses${totalUsd != null ? ` (total ${usd(totalUsd)})` : ''} that are waiting for you to review.`,
    rows: [['Expenses', String(count)], ['Total', totalUsd != null ? usd(totalUsd) : '']].filter((r) => r[1]),
    cta: `${appUrl()}/#approvals`,
    ctaLabel: 'Review them',
  });
  await Promise.all([
    sendEmail({ to: approver.email, subject: `${who} submitted ${count} expenses to approve`, html, text }),
    sendPush({ to: approver.email, title: `${count} expenses to approve`, body: `${who}${totalUsd != null ? ` — ${usd(totalUsd)}` : ''}`, url: `${appUrl()}/#approvals` }),
  ]);
}

// A submitter's expense(s) were approved.
async function submitterApproved({ submitter, expense, count = 1, totalUsd }) {
  if (!submitter || !submitter.email) return;
  const many = count > 1;
  const { html, text } = shell({
    heading: many ? `${count} expenses approved` : 'Your expense was approved',
    intro: many
      ? `Good news — ${count} of your expenses were approved${totalUsd != null ? ` (total ${usd(totalUsd)})` : ''}.`
      : `Good news — your expense was approved.`,
    rows: many ? [] : [['What', labelOf(expense)], ['Amount', amountOf(expense)]].filter((r) => r[1]),
    cta: `${appUrl()}/#mine`,
    ctaLabel: 'View in Rembly',
  });
  await Promise.all([
    sendEmail({ to: submitter.email, subject: many ? `${count} expenses approved` : 'Your expense was approved', html, text }),
    sendPush({ to: submitter.email, title: many ? `${count} expenses approved` : 'Expense approved', body: many ? `Total ${usd(totalUsd)}`.trim() : `${labelOf(expense)}${amountOf(expense) ? ` — ${amountOf(expense)}` : ''}`, url: `${appUrl()}/#mine` }),
  ]);
}

// A submitter's expense was sent back / kicked back.
async function submitterSentBack({ submitter, expense, note }) {
  if (!submitter || !submitter.email) return;
  const { html, text } = shell({
    heading: 'Your expense needs a quick fix',
    intro: `Your expense was sent back so you can fix it and resubmit.${note ? ` <br><br><em>“${esc(note)}”</em>` : ''}`,
    rows: [['What', labelOf(expense)], ['Amount', amountOf(expense)]].filter((r) => r[1]),
    cta: `${appUrl()}/#mine`,
    ctaLabel: 'Fix &amp; resubmit',
  });
  await Promise.all([
    sendEmail({ to: submitter.email, subject: 'Your expense needs a quick fix', html, text }),
    sendPush({ to: submitter.email, title: 'Expense sent back', body: note ? `“${note}”` : `${labelOf(expense)} needs a quick fix`, url: `${appUrl()}/#mine` }),
  ]);
}

// A submitter was reimbursed.
async function submitterPaid({ submitter, count = 1, totalUsd }) {
  if (!submitter || !submitter.email) return;
  const { html, text } = shell({
    heading: "You've been reimbursed 💸",
    intro: `You've been reimbursed for ${count} expense${count === 1 ? '' : 's'}${totalUsd != null ? ` — ${usd(totalUsd)}` : ''}. It should reach you through the usual payout.`,
    cta: `${appUrl()}/#mine`,
    ctaLabel: 'See details',
  });
  await Promise.all([
    sendEmail({ to: submitter.email, subject: "You've been reimbursed", html, text }),
    sendPush({ to: submitter.email, title: "You've been reimbursed 💸", body: `${count} expense${count === 1 ? '' : 's'}${totalUsd != null ? ` — ${usd(totalUsd)}` : ''}`, url: `${appUrl()}/#mine` }),
  ]);
}

module.exports = { sendEmail, sendPush, approverNewExpense, approverNewExpenses, submitterApproved, submitterSentBack, submitterPaid };
