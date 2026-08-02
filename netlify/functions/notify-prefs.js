'use strict';

// A person sets how they want deadline reminders: email and/or push. Anyone can
// set their own. The current choice is served via /me (reminderChannels).

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { ensureStaff, setNotifyChannels } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { id: staffId } = await ensureStaff(user);

    const body = parseBody(event);
    const email = body.email === true;
    const push = body.push === true;

    const saved = await setNotifyChannels(staffId, { email, push });
    return ok({ reminderChannels: saved });
  } catch (err) {
    return error(err);
  }
};
