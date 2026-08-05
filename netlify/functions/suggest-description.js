'use strict';

// Help fill in the "what was this for" description for a hand-entered expense.
// Two ways, best first:
//   1. Memory — the descriptions this person has used before at the SAME
//      merchant (so "coffee with a student" at the usual café comes right back).
//   2. Fresh suggestions — Claude proposes a few from whatever's filled in, for a
//      merchant they've never used. Feature-flagged by ANTHROPIC_API_KEY; memory
//      works with or without it.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const { TABLES, ensureStaff, accountMap } = require('./lib/domain');
const { CATEGORIES_8 } = require('./lib/coding');

const firstLink = (v) => (Array.isArray(v) && v.length ? v[0] : null);
const leadingCode = (s) => (String(s || '').match(/^\s*(\S+)/) || [])[1] || '';

const SDK = require('@anthropic-ai/sdk');
const Anthropic = SDK.Anthropic || SDK.default || SDK;
const MODEL = () => process.env.SCAN_MODEL || 'claude-opus-4-8';
const MAX_REMEMBERED = 4;

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

// This person's past expenses, newest first — the raw material for "learning."
async function historyFor(email) {
  const em = String(email).toLowerCase().replace(/'/g, "\\'");
  try {
    return await airtable.listRecords(TABLES.EXPENSES, {
      filterByFormula: `LOWER(ARRAYJOIN({Submitter Email})) = '${em}'`,
      'sort[0][field]': 'Submitted On',
      'sort[0][direction]': 'desc',
    });
  } catch (e) {
    return [];
  }
}

const sameMerchant = (f, want) => String(f.Merchant || '').trim().toLowerCase() === want;

// The distinct descriptions this person has used before at this merchant,
// most-recent first. Pulled straight from their history.
function rememberedFrom(records, merchant) {
  if (!merchant) return [];
  const want = String(merchant).trim().toLowerCase();
  const seen = new Set();
  const out = [];
  for (const r of records) {
    const f = r.fields || {};
    if (!sameMerchant(f, want)) continue;
    const d = String(f.Description || '').trim();
    const key = d.toLowerCase();
    if (d && !seen.has(key)) { seen.add(key); out.push(d); }
    if (out.length >= MAX_REMEMBERED) break;
  }
  return out;
}

// The account (fund) + category this person usually codes THIS merchant to — so a
// regular coffee run comes back already coded, ready to confirm. Most-used pairing
// wins (ties broken by most recent). Only pairs they actually used, so the two
// always go together (a valid category for that fund).
function codingFrom(records, merchant, accounts) {
  if (!merchant) return null;
  const want = String(merchant).trim().toLowerCase();
  const tally = new Map();
  let order = 0;
  for (const r of records) {
    const f = r.fields || {};
    if (!sameMerchant(f, want)) continue;
    const expenseAccount = leadingCode(f['Expense Account']);
    const acct = accounts[firstLink(f.Account)] || {};
    const accountCode = acct.code || '';
    if (!expenseAccount && !accountCode) continue;
    const key = `${expenseAccount}|${accountCode}`;
    const cur = tally.get(key) || { expenseAccount, accountCode, n: 0, order: order++ };
    cur.n += 1;
    tally.set(key, cur);
  }
  if (!tally.size) return null;
  const best = [...tally.values()].sort((a, b) => (b.n - a.n) || (a.order - b.order))[0];
  const out = {};
  if (best.expenseAccount) out.expenseAccount = best.expenseAccount;
  if (best.accountCode) out.accountCode = best.accountCode;
  return Object.keys(out).length ? out : null;
}

// For a merchant with no history, let Claude pick the single best-fitting category
// (GL code) from the standard list — a starting guess the person confirms. Returns
// a code that's guaranteed to be in the list, or '' if it couldn't choose.
async function guessCategory({ merchant, amount, currency }) {
  const cats = CATEGORIES_8;
  const list = cats.map((c) => `${c.code} — ${c.name}`).join('\n');
  const facts = [
    merchant ? `Merchant: ${merchant}` : '',
    amount != null ? `Amount: ${amount}${currency ? ` ${currency}` : ''}` : '',
  ].filter(Boolean).join('\n');
  const prompt =
    'A staff member at Josiah Venture (a Christian ministry across Central & Eastern ' +
    'Europe) is filing a reimbursement. From the expense categories below, pick the ONE ' +
    'that best fits this purchase. Choose only from the list; if nothing clearly fits, pick ' +
    'the closest sensible one. Return its code exactly.\n\nCategories:\n' + list + '\n\n' +
    facts + '\n\nCall pick_category with the best code.';
  const client = new Anthropic();
  const message = await client.messages.create({
    model: MODEL(),
    max_tokens: 80,
    tools: [{
      name: 'pick_category',
      description: 'Pick the single best-fitting expense category code.',
      input_schema: {
        type: 'object',
        properties: { code: { type: 'string', description: 'The GL code, exactly as listed.' } },
        required: ['code'],
        additionalProperties: false,
      },
    }],
    tool_choice: { type: 'tool', name: 'pick_category' },
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  });
  const toolUse = (message.content || []).find((b) => b.type === 'tool_use');
  const code = toolUse && toolUse.input ? String(toolUse.input.code || '').trim() : '';
  return cats.some((c) => c.code === code) ? code : '';
}

function describeTool() {
  return {
    name: 'write_descriptions',
    description: 'Return three short, distinct description options for the expense.',
    input_schema: {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          description: 'Exactly three short descriptions (max ~8 words each), most likely first.',
          items: { type: 'string' },
        },
      },
      required: ['options'],
      additionalProperties: false,
    },
  };
}

async function aiOptions({ merchant, amount, currency, account, date, hint }) {
  const facts = [
    merchant ? `Where: ${merchant}` : '',
    amount != null ? `Amount: ${amount}${currency ? ` ${currency}` : ''}` : '',
    account ? `Charged to account: ${account}` : '',
    date ? `Date: ${date}` : '',
    hint ? `Their note so far: ${hint}` : '',
  ].filter(Boolean).join('\n');

  const prompt =
    'A staff member at Josiah Venture (a Christian ministry working across Central & ' +
    'Eastern Europe) is entering a reimbursement expense by hand and wants help writing ' +
    'the short "what was this for" description. Based on the details below, write THREE ' +
    'distinct, natural description options a person could pick from. Keep each under about ' +
    'eight words, concrete and specific (e.g. "Team dinner after camp planning", "Fuel for ' +
    'the retreat van", "Monthly Claude AI subscription"). No quotes, no trailing period, no ' +
    'numbering. Order them most-likely first.\n\n' + facts +
    '\n\nCall write_descriptions with exactly three options.';

  const client = new Anthropic();
  const message = await client.messages.create({
    model: MODEL(),
    max_tokens: 400,
    tools: [describeTool()],
    tool_choice: { type: 'tool', name: 'write_descriptions' },
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  });
  const toolUse = (message.content || []).find((b) => b.type === 'tool_use');
  const raw = toolUse && toolUse.input && Array.isArray(toolUse.input.options) ? toolUse.input.options : [];
  return raw
    .map((s) => String(s || '').replace(/^["'\s]+|["'.\s]+$/g, '').slice(0, 90))
    .filter(Boolean)
    .slice(0, 3);
}

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    await ensureStaff(user);

    const body = parseBody(event);
    const merchant = String(body.merchant || '').trim().slice(0, 120);
    const account = String(body.account || '').trim().slice(0, 120);
    const hint = String(body.hint || body.description || '').trim().slice(0, 200);
    const amount = body.amount != null && isFinite(Number(body.amount)) ? Number(body.amount) : null;
    const currency = String(body.currency || '').trim().slice(0, 8);
    const date = String(body.date || '').trim().slice(0, 10);
    const recallOnly = body.recallOnly === true;

    const records = merchant ? await historyFor(user.email) : [];
    const remembered = rememberedFrom(records, merchant);
    // The usual coding at this merchant (needs the accounts map to read GL codes).
    let coding = null;
    if (merchant) {
      try { coding = codingFrom(records, merchant, await accountMap()); } catch (e) { coding = null; }
    }

    // Recall is history first (works with the AI key unset). If there's no history
    // for this merchant, offer Claude's best-guess category for the person to
    // confirm — a new coffee shop still comes in pre-coded, just marked a guess.
    if (recallOnly) {
      if (!coding && merchant && process.env.ANTHROPIC_API_KEY) {
        try {
          const code = await guessCategory({ merchant, amount, currency });
          if (code) coding = { accountCode: code, guess: true };
        } catch (e) { /* a guess is a nicety — never interrupt */ }
      }
      return ok({ remembered, options: [], coding });
    }

    if (!merchant && !hint && !account) throw badRequest('Add where you spent it (or a couple of words) first.');

    // Only spend a Claude call when we actually need fresh ideas.
    let options = [];
    if (process.env.ANTHROPIC_API_KEY && remembered.length < 3) {
      try { options = await aiOptions({ merchant, amount, currency, account, date, hint }); } catch (e) { options = []; }
    }
    // Don't repeat a suggestion the person already has in their history.
    const have = new Set(remembered.map((d) => d.toLowerCase()));
    options = options.filter((o) => !have.has(o.toLowerCase()));

    return ok({ remembered, options, coding });
  } catch (err) {
    return error(err);
  }
};
