'use strict';

// Read a receipt photo (or PDF) with Claude's vision and return the fields
// pre-filled for the submit form: amount, currency, date, merchant,
// description, and a best-fit GL account (read live from the Accounts table).
// Best-effort — any field it can't read comes back null and the person just
// fills it in.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { listAccounts } = require('./lib/domain');
const { scanReceipt, normalize } = require('./lib/scanner');

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    await verifyRequest(event.headers); // JV sign-in only — protects the API key
    if (!process.env.ANTHROPIC_API_KEY) {
      const err = new Error('Receipt scanning is not turned on yet.');
      err.statusCode = 503;
      throw err;
    }

    const { receipt } = parseBody(event);
    if (!receipt || !receipt.base64) throw badRequest('No receipt was provided.');

    const approxBytes = Math.floor((receipt.base64.length * 3) / 4);
    if (approxBytes > MAX_RECEIPT_BYTES) throw badRequest('Receipt is too large to scan (max 8 MB).');

    // Load the chart of accounts so the model can pick a real GL code.
    let accounts = [];
    try {
      accounts = await listAccounts();
    } catch (e) {
      console.error('[reimbly] could not load accounts for scan', e);
    }

    const scan = await scanReceipt(receipt, { accounts });
    if (scan === null) return ok({ scan: null, unsupported: true }); // e.g. a .heic — fill manually
    return ok({ scan });
  } catch (err) {
    // A scan failure should never block submitting — surface a soft error.
    if (!err.statusCode) {
      console.error('[reimbly] scan failed', err);
      return ok({ scan: null, error: 'Could not read the receipt automatically.' });
    }
    return error(err);
  }
};

module.exports.normalize = normalize; // exported for tests
