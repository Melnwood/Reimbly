'use strict';

// CedarStone's "Accounts & Access" back-office (Finance only).
//   GET  → the full list of Expense Accounts (incl. retired) + the people list,
//          so the screen can show who may use what.
//   POST → manage the list and access:
//          { action: 'create', code, name }        add a new account
//          { action: 'update', id, name?, active? } rename / retire / restore
//          { action: 'access', id, staffIds: [] }   set who may use an account
//
// An account with nobody assigned is open to everyone; once anyone is assigned,
// only they (and Finance) may charge to it.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES, ensureStaff, ensureExpenseAccountsSeeded, listExpenseAccounts, listPeople,
} = require('./lib/domain');
const { GENERAL_FUND_CODE } = require('./lib/coding');

function bad(message, code = 400) {
  const err = new Error(message);
  err.statusCode = code;
  return err;
}

async function requireFinance(event) {
  const user = await verifyRequest(event.headers);
  const { role } = await ensureStaff(user);
  if (role !== 'Finance') throw bad('Only Finance can manage accounts & access.', 403);
  return user;
}

exports.handler = async (event) => {
  const guard = methodGuard(event, ['GET', 'POST']);
  if (guard) return guard;

  try {
    await requireFinance(event);

    if (event.httpMethod === 'GET') {
      // Seed any built-in accounts not yet in the table, then hand back the lot.
      const [accounts, people] = await Promise.all([
        ensureExpenseAccountsSeeded(),
        listPeople(),
      ]);
      return ok({
        accounts,
        people: people.map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role })),
      });
    }

    // POST — a management action.
    const body = parseBody(event);
    const action = String(body.action || '').trim();

    if (action === 'create') {
      const code = String(body.code || '').trim();
      const name = String(body.name || '').trim();
      if (!code) throw bad('Give the account a code.');
      if (!name) throw bad('Give the account a name.');
      const existing = await listExpenseAccounts();
      if (existing.some((a) => a.code === code)) throw bad('An account with that code already exists.');
      const series = code === GENERAL_FUND_CODE ? '7' : '8';
      await airtable.createRecord(TABLES.EXPENSE_ACCOUNTS, {
        Code: code, Name: name, Series: series, Active: true,
      });
      return ok({ accounts: await listExpenseAccounts() });
    }

    if (action === 'update') {
      const id = String(body.id || '').trim();
      if (!id) throw bad('Missing the account to update.');
      const fields = {};
      if (typeof body.name === 'string') {
        const name = body.name.trim();
        if (!name) throw bad('The name can’t be blank.');
        fields.Name = name;
      }
      if (typeof body.active === 'boolean') fields.Active = body.active;
      if (!Object.keys(fields).length) throw bad('Nothing to change.');
      await airtable.updateRecord(TABLES.EXPENSE_ACCOUNTS, id, fields);
      return ok({ accounts: await listExpenseAccounts() });
    }

    if (action === 'access') {
      const id = String(body.id || '').trim();
      if (!id) throw bad('Missing the account to update.');
      const staffIds = Array.isArray(body.staffIds)
        ? body.staffIds.filter((s) => typeof s === 'string' && s.startsWith('rec'))
        : [];
      await airtable.updateRecord(TABLES.EXPENSE_ACCOUNTS, id, { 'Allowed Staff': staffIds });
      return ok({ accounts: await listExpenseAccounts() });
    }

    throw bad('Unknown action.');
  } catch (err) {
    return error(err);
  }
};
