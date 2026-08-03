'use strict';

// Disconnect Gmail: revoke the grant at Google and clear the stored token, so
// Reimbly can no longer read this person's mail. They can reconnect anytime.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, ensureStaff } = require('./lib/domain');
const gmail = require('./lib/gmail');
const { decrypt } = require('./lib/secure');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { id: staffId, record } = await ensureStaff(user);

    const enc = record && record.fields && record.fields['Gmail Token'];
    if (enc) {
      try { await gmail.revoke(decrypt(enc)); } catch (e) { /* best-effort */ }
    }
    await airtable.updateRecord(TABLES.STAFF, staffId, { 'Gmail Token': '', 'Gmail Sync Cursor': '' });
    return ok({ gmailConnected: false });
  } catch (err) {
    return error(err);
  }
};
