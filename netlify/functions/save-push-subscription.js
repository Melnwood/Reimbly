'use strict';

// Register (or remove) the signed-in person's device for push notifications.
// The browser sends its PushSubscription after the person taps "turn on alerts";
// we store it on their Staff row so notify.js can reach every device they use.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { ensureStaff, savePushSub, removePushSubs } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    await ensureStaff(user); // make sure they have a Staff row to attach to

    const body = parseBody(event);

    // Turning alerts off on this device.
    if (body.unsubscribe) {
      await removePushSubs(user.email, [String(body.unsubscribe)]);
      return ok({ removed: true });
    }

    const sub = body.subscription;
    if (!sub || !sub.endpoint || !(sub.keys && sub.keys.p256dh && sub.keys.auth)) {
      const err = new Error('That push subscription is incomplete.');
      err.statusCode = 400;
      throw err;
    }
    const saved = await savePushSub(user.email, sub);
    return ok({ saved });
  } catch (err) {
    return error(err);
  }
};
