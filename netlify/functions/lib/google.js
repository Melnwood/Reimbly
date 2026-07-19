'use strict';

const { OAuth2Client } = require('google-auth-library');

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
async function verifyRequest(headers) {
  const token = bearerToken(headers);
  if (!token) {
    const err = new Error('Missing sign-in token.');
    err.statusCode = 401;
    throw err;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const allowedDomain = process.env.ALLOWED_DOMAIN;
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
  const domain = email.split('@')[1];
  const expected = (allowedDomain || '').toLowerCase();
  if (expected && domain !== expected) {
    const err = new Error(`Only ${expected} accounts can use Reimbly.`);
    err.statusCode = 403;
    throw err;
  }

  return {
    email,
    name: payload.name || payload.given_name || email.split('@')[0],
    sub: payload.sub,
  };
}

module.exports = { verifyRequest, bearerToken };
