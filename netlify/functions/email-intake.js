'use strict';

// A person turns forwarding-receipts-from-their-email on or off for themselves.
// Off by default; Reimbly never accepts email receipts until they opt in.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { ensureStaff, setEmailIntake } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { id: staffId } = await ensureStaff(user);
    const body = parseBody(event);
    const on = body.on === true;
    const saved = await setEmailIntake(staffId, on);
    return ok({ emailIntake: saved });
  } catch (err) {
    return error(err);
  }
};
