'use strict';

// Bulk set up people and permissions from a spreadsheet. Finance only.
// Columns (header row, any order; extras ignored):
//   Name, Email (required), Role, Upline (email), Accounts (restricted GL codes)
// Matches people by email — updates existing, creates new, never deletes.
// Two passes so uplines can point at people created in the same file.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, ensureStaff, findStaffByEmail, listAccounts, staffMap, listPeople,
} = require('./lib/domain');
const { fileToGrid } = require('./lib/importer');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;
const ROLES = { staff: 'Staff', approver: 'Approver', finance: 'Finance' };

const ALIASES = {
  name: ['name', 'full name', 'person', 'staff', 'staff name'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  role: ['role', 'access', 'permission', 'type'],
  upline: ['upline', 'uplink', 'uplinks', 'supervisor', 'manager', 'approver', 'reports to', 'upline email', 'supervisor email'],
  accounts: ['accounts', 'allowed accounts', 'restricted accounts', 'account', 'account codes', 'funds', 'fund', 'general fund', 'general fund accounts', 'restricted account codes'],
  household: ['household', 'family', 'couple', 'shared account', 'reimburse with', 'household group', 'spouse group'],
};

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function mapHeaders(headerRow) {
  const map = {};
  (headerRow || []).forEach((h, i) => {
    const key = String(h == null ? '' : h).trim().toLowerCase();
    if (!key) return;
    for (const [field, names] of Object.entries(ALIASES)) {
      if (names.includes(key) && map[field] == null) { map[field] = i; break; }
    }
  });
  return map;
}

const splitCodes = (v) => String(v || '').split(/[\s,;/|]+/).map((s) => s.trim()).filter(Boolean);

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
    const file = body.file;
    if (!file || !file.base64) throw badRequest('No file was uploaded.');
    if (Math.floor((file.base64.length * 3) / 4) > MAX_FILE_BYTES) throw badRequest('That file is too large (max 5 MB).');

    const grid = fileToGrid(file);
    if (!grid.length) throw badRequest('That file looks empty.');
    const map = mapHeaders(grid[0]);
    if (map.email == null) throw badRequest('Couldn’t find an "Email" column.');
    const dataRows = grid.slice(1).filter((r) => r.some((v) => String(v).trim() !== ''));
    if (!dataRows.length) throw badRequest('No people found under the header row.');
    if (dataRows.length > MAX_ROWS) throw badRequest(`That file has too many rows (max ${MAX_ROWS}).`);

    const accounts = await listAccounts();
    const codeToId = new Map(accounts.map((a) => [String(a.code).trim(), a.id]));
    const at = (row, field) => (map[field] != null ? row[map[field]] : undefined);

    const warnings = [];
    let created = 0;
    let updated = 0;
    const uplineWants = []; // { email, uplineEmail }

    // Pass 1 — upsert each person's own fields.
    for (let i = 0; i < dataRows.length; i += 1) {
      const row = dataRows[i];
      const line = i + 2;
      const email = String(at(row, 'email') || '').trim().toLowerCase();
      if (!email || !email.includes('@')) { warnings.push(`Row ${line}: missing/!invalid email — skipped`); continue; }

      const fields = {};
      const name = String(at(row, 'name') || '').trim();
      if (name) fields.Name = name;

      const roleRaw = String(at(row, 'role') || '').trim().toLowerCase();
      if (roleRaw) {
        if (ROLES[roleRaw]) fields.Role = ROLES[roleRaw];
        else warnings.push(`Row ${line}: unknown role "${roleRaw}" — left unchanged`);
      }

      if (map.accounts != null) { // column present → authoritative (blank clears)
        const ids = [];
        for (const code of splitCodes(at(row, 'accounts'))) {
          if (codeToId.has(code)) ids.push(codeToId.get(code));
          else warnings.push(`Row ${line}: account "${code}" not in the chart — skipped`);
        }
        fields['Allowed Accounts'] = ids;
      }

      // Household: people sharing a value are pooled (e.g. a couple). Column
      // present → authoritative, so a blank cell clears it.
      if (map.household != null) fields.Household = String(at(row, 'household') || '').trim();

      const existing = await findStaffByEmail(email);
      if (existing) {
        if (Object.keys(fields).length) await airtable.updateRecord(TABLES.STAFF, existing.id, fields);
        updated += 1;
      } else {
        await airtable.createRecord(TABLES.STAFF, { Email: email, Role: fields.Role || 'Staff', ...fields });
        created += 1;
      }

      const uplineEmail = String(at(row, 'upline') || '').trim().toLowerCase();
      if (uplineEmail) uplineWants.push({ email, uplineEmail, line });
    }

    // Pass 2 — wire up uplines now that everyone exists.
    if (uplineWants.length) {
      const staff = await staffMap();
      const idByEmail = {};
      for (const id of Object.keys(staff)) idByEmail[(staff[id].email || '').toLowerCase()] = id;
      for (const w of uplineWants) {
        const selfId = idByEmail[w.email];
        const upId = idByEmail[w.uplineEmail];
        if (!upId) { warnings.push(`Row ${w.line}: upline "${w.uplineEmail}" not found`); continue; }
        if (upId === selfId) { warnings.push(`Row ${w.line}: a person can't be their own upline`); continue; }
        if (selfId) await airtable.updateRecord(TABLES.STAFF, selfId, { Upline: [upId] });
      }
    }

    const people = await listPeople();
    return ok({ created, updated, warnings, people });
  } catch (err) {
    return error(err);
  }
};
