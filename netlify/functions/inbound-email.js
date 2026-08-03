'use strict';

// Turn a forwarded receipt email into a held receipt (the old Google Apps Script
// path). A script in the sender's Gmail POSTs each receipt email here; the shared
// intake core reads it and files it for the sender to review. Protected by a
// shared secret, not Google sign-in, because it's called by a machine.
//
// Opt-in: Reimbly only accepts email for people who turned it on themselves.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { ensureStaff, emailIntakeOn } = require('./lib/domain');
const { intakeReceipts } = require('./lib/intake');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const secret = process.env.INBOUND_EMAIL_SECRET;
    if (!secret) { const err = new Error('Email intake is not turned on yet.'); err.statusCode = 503; throw err; }
    const headers = event.headers || {};
    const body = parseBody(event);
    const provided = headers['x-reimbly-secret'] || headers['X-Reimbly-Secret'] || body.secret;
    if (provided !== secret) { const err = new Error('Not authorized.'); err.statusCode = 401; throw err; }
    if (!process.env.ANTHROPIC_API_KEY) { const err = new Error('Receipt reading is not turned on yet.'); err.statusCode = 503; throw err; }

    const from = String(body.from || '').trim().toLowerCase();
    if (!from) { const err = new Error('Missing the sender email.'); err.statusCode = 400; throw err; }
    const name = String(body.name || '').trim() || from;

    const user = { email: from, name };
    const { id: staffId, record: staffRec } = await ensureStaff(user);

    // Opt-in gate: quietly ignore forwards for anyone who hasn't turned it on.
    if (!emailIntakeOn(staffRec && staffRec.fields)) {
      return ok({ created: 0, held: 0, attached: 0, items: [], skipped: [], disabled: true });
    }

    const result = await intakeReceipts({
      user,
      staffId,
      subject: String(body.subject || '').trim(),
      receivedAt: body.receivedAt,
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
      text: String(body.text || ''),
      mode: body.mode,
    });

    return ok({ created: result.madeExpenses, held: result.held, attached: result.attached, items: result.created, skipped: result.skipped });
  } catch (err) {
    return error(err);
  }
};
