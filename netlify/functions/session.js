'use strict';

// Exchange a verified sign-in (Google, or an existing Reimbly token) for a fresh
// long-lived Reimbly session token. The app calls this right after Google
// sign-in, and again to slide the window on a Face-ID unlock. Returns the token
// and its expiry (ms) so the client can store it for Face ID to restore.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { signAppToken, DEFAULT_DAYS } = require('./lib/session');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers); // accepts Google or Reimbly token
    const token = signAppToken(user);
    return ok({ token, exp: Date.now() + DEFAULT_DAYS * 86400 * 1000 });
  } catch (err) {
    return error(err);
  }
};
