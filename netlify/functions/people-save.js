'use strict';

// Add or edit one person (and their permissions) from the People & access
// screen — the single-record counterpart to the spreadsheet upload. Finance
// only. Matches by record id when given, otherwise by email: existing people
// are updated, new ones created, nobody is ever deleted.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, ensureStaff, findStaffByEmail, listAccounts, staffMap, listPeople,
} = require('./lib/domain');

const ROLES = { Staff: 1, Approver: 1, Finance: 1 };
const splitCodes = (v) => String(v || '').split(/[\s,;/|]+/).map((s) => s.trim()).filter(Boolean);

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
      const err = new Error('Only Finance can manage people.');
      err.statusCode = 403;
      throw err;
    }

    const body = parseBody(event);
    const id = String(body.id || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim();
    const roleIn = String(body.role || '').trim();
    const household = body.household != null ? String(body.household).trim() : null;
    const uplineEmail = String(body.uplineEmail || '').trim().toLowerCase();
    const accountsIn = Array.isArray(body.accounts) ? body.accounts : splitCodes(body.accounts);

    if (!id && (!email || !email.includes('@'))) throw badRequest('Enter a valid email address.');
    if (roleIn && !ROLES[roleIn]) throw badRequest('Role must be Staff, Approver, or Finance.');

    // Find the record we're editing (by id) or the one to upsert (by email).
    let record = null;
    if (id) {
      record = await airtable.findFirst(TABLES.STAFF, { filterByFormula: `RECORD_ID() = '${id.replace(/'/g, "\\'")}'` });
      if (!record) throw badRequest('That person no longer exists.');
    } else {
      record = await findStaffByEmail(email);
    }

    // Resolve restricted account codes → record ids.
    const accounts = await listAccounts();
    const codeToId = new Map(accounts.map((a) => [String(a.code).trim(), a.id]));
    const accountIds = [];
    const warnings = [];
    for (const code of accountsIn) {
      if (codeToId.has(String(code).trim())) accountIds.push(codeToId.get(String(code).trim()));
      else warnings.push(`Account "${code}" isn’t in the chart — skipped.`);
    }

    const fields = {};
    if (name) fields.Name = name;
    if (roleIn) fields.Role = roleIn;
    if (household != null) fields.Household = household;
    if (body.accounts !== undefined) fields['Allowed Accounts'] = accountIds;

    let personId;
    if (record) {
      if (Object.keys(fields).length) await airtable.updateRecord(TABLES.STAFF, record.id, fields);
      personId = record.id;
    } else {
      const created = await airtable.createRecord(TABLES.STAFF, { Email: email, Role: fields.Role || 'Staff', ...fields });
      personId = created.id;
    }

    // Wire up the upline (by email), if one was given / changed.
    if (body.uplineEmail !== undefined) {
      if (!uplineEmail) {
        await airtable.updateRecord(TABLES.STAFF, personId, { Upline: [] });
      } else {
        const staff = await staffMap();
        const idByEmail = {};
        for (const sid of Object.keys(staff)) idByEmail[(staff[sid].email || '').toLowerCase()] = sid;
        const upId = idByEmail[uplineEmail];
        if (!upId) warnings.push(`Upline "${uplineEmail}" isn’t a known person — left unchanged.`);
        else if (upId === personId) warnings.push('A person can’t be their own upline — left unchanged.');
        else await airtable.updateRecord(TABLES.STAFF, personId, { Upline: [upId] });
      }
    }

    const people = await listPeople();
    return ok({ people, warnings, savedId: personId });
  } catch (err) {
    return error(err);
  }
};
