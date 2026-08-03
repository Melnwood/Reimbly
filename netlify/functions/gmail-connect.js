'use strict';

// Start the "Connect Gmail" handshake. Returns the Google consent URL for the
// signed-in person; the app sends them there. Finishes at gmail-callback.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { ensureStaff } = require('./lib/domain');
const gmail = require('./lib/gmail');
const { signState } = require('./lib/secure');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    if (!gmail.configured()) {
      const err = new Error('Connecting Gmail isn’t set up on the server yet.');
      err.statusCode = 503;
      throw err;
    }
    const user = await verifyRequest(event.headers);
    const { id: staffId } = await ensureStaff(user);
    // The signed state proves this flow was started by this signed-in person and
    // tells the (unauthenticated) callback which record to attach the token to.
    const state = signState({ email: user.email, staffId });
    return ok({ url: gmail.authUrl(state, user.email) });
  } catch (err) {
    return error(err);
  }
};
