'use strict';

// The current people/permissions list for the Finance management screen:
// name, email, role, upline, and any restricted accounts they're granted.
// Finance only.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { ensureStaff, listPeople } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);
    if (role !== 'Finance') {
      const err = new Error('Only Finance can manage people.');
      err.statusCode = 403;
      throw err;
    }
    const people = await listPeople();
    return ok({ people });
  } catch (err) {
    return error(err);
  }
};
