'use strict';

// Finish the "Connect Gmail" handshake. Google redirects the person's browser
// here with a one-time code; we trade it for a refresh token, store it encrypted
// on their Staff record, turn Email Intake on, and bounce back to the app. No
// Reimbly auth header here (it's a browser redirect) — the signed `state` proves
// who started the flow.

const airtable = require('./lib/airtable');
const { TABLES } = require('./lib/domain');
const gmail = require('./lib/gmail');
const { encrypt, verifyState } = require('./lib/secure');

const appUrl = () => (process.env.APP_URL || 'https://reimbly.netlify.app').replace(/\/$/, '');
const back = (status) => ({ statusCode: 302, headers: { Location: `${appUrl()}/?gmail=${status}` }, body: '' });

// Pull the email out of a Google id_token without verifying (we only compare it
// to the state we signed; it's not used for auth).
function idTokenEmail(idToken) {
  try {
    return String(JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).email || '').toLowerCase();
  } catch (e) { return ''; }
}

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    if (q.error) return back('denied');
    if (!q.code || !q.state) return back('failed');

    let state;
    try { state = verifyState(q.state); } catch (e) { return back('failed'); }

    const tokens = await gmail.exchangeCode(q.code);
    // Make sure they connected their own JV account, not a different one.
    const gotEmail = idTokenEmail(tokens.id_token);
    if (gotEmail && state.email && gotEmail !== String(state.email).toLowerCase()) return back('mismatch');
    if (!tokens.refresh_token) return back('noretry'); // no refresh token granted

    await airtable.updateRecord(TABLES.STAFF, state.staffId, {
      'Gmail Token': encrypt(tokens.refresh_token),
      'Email Intake': true,
    });
    return back('connected');
  } catch (err) {
    console.error('[reimbly] gmail-callback failed', err && err.message);
    return back('failed');
  }
};
