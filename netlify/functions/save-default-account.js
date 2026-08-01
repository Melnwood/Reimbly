'use strict';

// Save the caller's preferred default Expense Account onto their Staff record, so
// the form pre-selects it on every device. POST { code }. An empty code clears it.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, ensureStaff } = require('./lib/domain');
const { accountName } = require('./lib/coding');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { id: staffId } = await ensureStaff(user);
    const body = parseBody(event);
    const code = String(body.code || '').trim();

    // Only accept a real account code (or empty to clear).
    if (code && !accountName(code)) {
      const err = new Error('That account isn’t recognised.');
      err.statusCode = 400;
      throw err;
    }

    await airtable.updateRecord(TABLES.STAFF, staffId, { 'Default Account': code });
    return ok({ defaultAccount: code });
  } catch (err) {
    return error(err);
  }
};
