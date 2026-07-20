'use strict';

// List all mileage rates (active + inactive) for the Finance management screen,
// plus the currency codes the form offers. Finance only.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { CURRENCY_CODES, ensureStaff, listMileageRatesAdmin } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);
    if (role !== 'Finance') {
      const err = new Error('Only Finance can manage mileage rates.');
      err.statusCode = 403;
      throw err;
    }

    const rates = await listMileageRatesAdmin();
    return ok({ rates, currencies: CURRENCY_CODES });
  } catch (err) {
    return error(err);
  }
};
