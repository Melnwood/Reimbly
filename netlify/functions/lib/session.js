'use strict';

// Reimbly's own session token. Google ID tokens expire after ~1 hour, so a
// Face-ID unlock that only restores a stored Google token bounces the person to
// the Google sign-in as soon as it's stale. Instead, once someone has proved who
// they are with Google, we mint a long-lived Reimbly token (default 30 days).
// Face ID unlocks that, so returning to the app just works.
//
// It's a compact HS256 JWT signed with a key DERIVED from an existing server
// secret (AIRTABLE_TOKEN) — so there's no new env var to configure. The key
// never leaves the server; forging a token would require the Airtable secret,
// which already guards everything.

const crypto = require('crypto');

const ISSUER = 'reimbly';
const DEFAULT_DAYS = 30;

function signingKey() {
  const base = process.env.AIRTABLE_TOKEN || '';
  return crypto.createHmac('sha256', base).update('reimbly-session-v1').digest();
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

// Mint a Reimbly session token for a verified person.
function signAppToken({ email, name, sub }, days = DEFAULT_DAYS) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({
    iss: ISSUER, email, name: name || '', sub: sub || '', iat: now, exp: now + days * 86400,
  }));
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', signingKey()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

// True if a bearer token is one of ours (so verifyRequest knows which path to take).
function looksLikeAppToken(token) {
  try {
    const p = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return !!p && p.iss === ISSUER;
  } catch (e) {
    return false;
  }
}

// Verify a Reimbly token's signature + expiry. Returns {email,name,sub} or throws
// a 401-tagged error.
function verifyAppToken(token) {
  const unauth = (msg) => { const e = new Error(msg); e.statusCode = 401; return e; };
  const parts = String(token).split('.');
  if (parts.length !== 3) throw unauth('Bad session token.');
  const data = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', signingKey()).update(data).digest('base64url');
  const got = parts[2];
  if (got.length !== expected.length
    || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    throw unauth('Session could not be verified. Please sign in again.');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (e) {
    throw unauth('Bad session token.');
  }
  if (payload.iss !== ISSUER) throw unauth('Bad session token.');
  if (!payload.exp || payload.exp * 1000 <= Date.now()) throw unauth('Your session expired. Please sign in again.');
  return { email: String(payload.email || '').toLowerCase(), name: payload.name || '', sub: payload.sub || '' };
}

module.exports = { signAppToken, verifyAppToken, looksLikeAppToken, DEFAULT_DAYS };
