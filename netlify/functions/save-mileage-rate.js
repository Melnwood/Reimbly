'use strict';

// Create, update, or delete a mileage rate. Finance only.
//   { name, unit, rate, currency, active }        → create
//   { id, name, unit, rate, currency, active }    → update
//   { id, delete: true }                          → delete

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, CURRENCY_CODES, ensureStaff, resolveCurrencyId } = require('./lib/domain');

const UNITS = new Set(['miles', 'km']);

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role } = await ensureStaff(user);
    if (role !== 'Finance') {
      const err = new Error('Only Finance can manage mileage rates.');
      err.statusCode = 403;
      throw err;
    }

    const body = parseBody(event);
    const id = String(body.id || '').trim();

    if (body.delete) {
      if (!id) throw badRequest('Missing the rate id.');
      await airtable.deleteRecord(TABLES.MILEAGE_RATES, id);
      return ok({ deleted: true, id });
    }

    const name = String(body.name || '').trim();
    const unit = String(body.unit || '').trim().toLowerCase();
    const rate = Number(body.rate);
    const currency = String(body.currency || '').trim().toUpperCase();
    const active = body.active !== false; // default to active

    if (!name) throw badRequest('Give the rate a name.');
    if (!UNITS.has(unit)) throw badRequest('Unit must be miles or km.');
    if (!isFinite(rate) || rate <= 0) throw badRequest('Rate must be greater than zero.');
    if (!CURRENCY_CODES.includes(currency)) throw badRequest(`Currency "${currency}" isn't set up.`);

    const currencyId = await resolveCurrencyId(currency);
    if (!currencyId) throw badRequest(`Currency "${currency}" isn't in the base.`);

    const fields = {
      Name: name,
      Unit: unit,
      Rate: rate,
      Currency: [currencyId],
      Active: active,
    };

    const saved = id
      ? await airtable.updateRecord(TABLES.MILEAGE_RATES, id, fields)
      : await airtable.createRecord(TABLES.MILEAGE_RATES, fields);

    return ok({
      rate: {
        id: saved.id,
        name,
        unit,
        rate,
        currency,
        active,
      },
    });
  } catch (err) {
    return error(err);
  }
};
