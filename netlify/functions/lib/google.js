'use strict';

const { OAuth2Client } = require('google-auth-library');
const { looksLikeAppToken, verifyAppToken } = require('./session');

let client;
function getClient() {
  if (!client) {
    client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }
  return client;
}

/**
 * Pull the Bearer token out of an Authorization header.
 * @param {object} headers - Netlify event.headers (lower-cased keys).
 * @returns {string|null}
 */
function bearerToken(headers = {}) {
  const raw = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1].trim() : null;
}

/**
 * Verify a Google ID token and confirm the account belongs to the allowed
 * Workspace domain. Throws an Error with a `.statusCode` for the caller to map
 * onto an HTTP response.
 *
 * @param {object} headers - request headers containing the Authorization bearer.
 * @returns {Promise<{email: string, name: string, sub: string}>}
 */
// Enforce the Workspace-domain (or explicit allow-list) rule on an email.
function assertAllowed(email) {
  const domain = email.split('@')[1];
  const expected = (process.env.ALLOWED_DOMAIN || '').toLowerCase();
  const extra = (process.env.ALLOWED_EMAILS || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (expected && domain !== expected && !extra.includes(email)) {
    const err = new Error(`Only ${expected} accounts can use Reimbly.`);
    err.statusCode = 403;
    throw err;
  }
}

async function verifyRequest(headers) {
  const token = bearerToken(headers);
  if (!token) {
    const err = new Error('Missing sign-in token.');
    err.statusCode = 401;
    throw err;
  }

  // A Reimbly session token (minted after Google sign-in, long-lived) — this is
  // what a Face-ID unlock restores, so the app doesn't need Google every hour.
  if (looksLikeAppToken(token)) {
    const who = verifyAppToken(token); // throws 401 if bad/expired
    assertAllowed(who.email);
    return who;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    const err = new Error('Server is missing GOOGLE_CLIENT_ID.');
    err.statusCode = 500;
    throw err;
  }

  let payload;
  try {
    const ticket = await getClient().verifyIdToken({
      idToken: token,
      audience: clientId,
    });
    payload = ticket.getPayload();
  } catch (e) {
    const err = new Error('Sign-in could not be verified. Please sign in again.');
    err.statusCode = 401;
    throw err;
  }

  if (!payload || !payload.email || !payload.email_verified) {
    const err = new Error('Google account email is not verified.');
    err.statusCode = 401;
    throw err;
  }

  const email = String(payload.email).toLowerCase();
  assertAllowed(email);

  return {
    email,
    name: payload.name || payload.given_name || email.split('@')[0],
    sub: payload.sub,
  };
}

module.exports = { verifyRequest, bearerToken };
