'use strict';

// The one-tap Gmail worker. A Netlify scheduled function (see netlify.toml) that,
// for each person who connected their Gmail, reads new receipt-looking mail and
// files it into their receipt inbox — the same result as the old Apps Script, but
// with nothing for them to install. Read-only; only receipt-looking messages.

const airtable = require('./lib/airtable');
const { TABLES, listGmailConnectedStaff } = require('./lib/domain');
const gmail = require('./lib/gmail');
const { intakeReceipts } = require('./lib/intake');
const { decrypt } = require('./lib/secure');

const DEFAULT_LOOKBACK_MS = 3 * 24 * 3600 * 1000; // first run: last 3 days
const MAX_MSGS_PER_MAILBOX = 20;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

async function pollOne(staff) {
  const f = staff.fields || {};
  const email = String(f.Email || '').toLowerCase();
  if (!email) return 0;

  let refresh;
  try { refresh = decrypt(f['Gmail Token']); } catch (e) { return 0; }

  let access;
  try {
    access = await gmail.accessFromRefresh(refresh);
  } catch (e) {
    // Grant was revoked or is invalid — clear it so we stop trying.
    console.error('[reimbly] gmail refresh failed for', email, e && e.message);
    try { await airtable.updateRecord(TABLES.STAFF, staff.id, { 'Gmail Token': '' }); } catch (_) { /* noop */ }
    return 0;
  }

  const cursorMs = Number(f['Gmail Sync Cursor']) || (Date.now() - DEFAULT_LOOKBACK_MS);
  const afterSec = Math.floor(cursorMs / 1000);
  let msgs;
  try { msgs = await gmail.listMessages(access, gmail.receiptQuery(afterSec), MAX_MSGS_PER_MAILBOX); } catch (e) { return 0; }

  let newest = cursorMs;
  let filed = 0;
  for (const m of msgs) {
    try {
      const full = await gmail.getMessage(access, m.id);
      const parsed = gmail.parseMessage(full);
      if (parsed.internalDate && parsed.internalDate <= cursorMs) continue; // already seen
      // Fetch each attachment's bytes.
      const attachments = [];
      for (const a of parsed.attachments) {
        try {
          const base64 = await gmail.getAttachment(access, m.id, a.attachmentId);
          attachments.push({ filename: a.filename, contentType: a.contentType, base64 });
        } catch (e) { /* skip this attachment */ }
      }
      const res = await intakeReceipts({
        user: { email, name: f.Name || email },
        staffId: staff.id,
        subject: parsed.subject,
        receivedAt: parsed.internalDate ? dayOf(parsed.internalDate) : null,
        attachments,
        text: parsed.text,
        mode: 'inbox',
      });
      filed += (res.held || 0) + (res.attached || 0);
      if (parsed.internalDate > newest) newest = parsed.internalDate;
    } catch (e) {
      console.error('[reimbly] gmail message failed', m.id, e && e.message);
    }
  }

  if (newest > cursorMs) {
    try { await airtable.updateRecord(TABLES.STAFF, staff.id, { 'Gmail Sync Cursor': String(newest) }); } catch (e) { /* noop */ }
  }
  return filed;
}

exports.handler = async () => {
  try {
    if (!gmail.configured() || !process.env.ANTHROPIC_API_KEY) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'not configured' }) };
    }
    const staff = await listGmailConnectedStaff();
    let total = 0;
    let mailboxes = 0;
    for (const s of staff) {
      mailboxes += 1;
      total += await pollOne(s);
    }
    console.log(`[reimbly] gmail-poll: ${total} receipts across ${mailboxes} mailboxes`);
    return { statusCode: 200, body: JSON.stringify({ filed: total, mailboxes }) };
  } catch (err) {
    console.error('[reimbly] gmail-poll failed', err && err.message);
    return { statusCode: 500, body: 'error' };
  }
};
