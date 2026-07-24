'use strict';

// Email notifications. Feature-flagged: if RESEND_API_KEY isn't set, every
// send is a silent no-op, so the app runs fine without it. Sends are always
// best-effort — a failed email never blocks the action that triggered it.
//
// Env:
//   RESEND_API_KEY   turn notifications on (https://resend.com)
//   NOTIFY_FROM      e.g. "Rembly <rembly@josiahventure.com>" (verified sender)
//   APP_URL          link back to the app (default the Netlify site)

const APP_NAME = 'Rembly';
const appUrl = () => process.env.APP_URL || 'https://reimbly.netlify.app';

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
  await sendEmail({ to: approver.email, subject: `${submitterName || 'A staff member'} submitted an expense to approve`, html, text });
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
  await sendEmail({ to: submitter.email, subject: many ? `${count} expenses approved` : 'Your expense was approved', html, text });
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
  await sendEmail({ to: submitter.email, subject: 'Your expense needs a quick fix', html, text });
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
  await sendEmail({ to: submitter.email, subject: "You've been reimbursed", html, text });
}

module.exports = { sendEmail, approverNewExpense, submitterApproved, submitterSentBack, submitterPaid };
