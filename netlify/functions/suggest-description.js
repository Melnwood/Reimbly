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
const { TABLES, ensureStaff } = require('./lib/domain');

const SDK = require('@anthropic-ai/sdk');
const Anthropic = SDK.Anthropic || SDK.default || SDK;
const MODEL = () => process.env.SCAN_MODEL || 'claude-opus-4-8';
const MAX_REMEMBERED = 4;

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

// The distinct descriptions this person has used before at this merchant,
// most-recent first. This is the "learning" — pulled straight from their history.
async function rememberedFor(email, merchant) {
  if (!merchant) return [];
  const em = String(email).toLowerCase().replace(/'/g, "\\'");
  const want = String(merchant).trim().toLowerCase();
  let records;
  try {
    records = await airtable.listRecords(TABLES.EXPENSES, {
      filterByFormula: `LOWER(ARRAYJOIN({Submitter Email})) = '${em}'`,
      'sort[0][field]': 'Submitted On',
      'sort[0][direction]': 'desc',
    });
  } catch (e) {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const r of records) {
    const f = r.fields || {};
    if (String(f.Merchant || '').trim().toLowerCase() !== want) continue; // same merchant only
    const d = String(f.Description || '').trim();
    const key = d.toLowerCase();
    if (d && !seen.has(key)) { seen.add(key); out.push(d); }
    if (out.length >= MAX_REMEMBERED) break;
  }
  return out;
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

    const remembered = await rememberedFor(user.email, merchant);

    // Recall is just history — no AI needed, so it works even with the key unset.
    if (recallOnly) return ok({ remembered, options: [] });

    if (!merchant && !hint && !account) throw badRequest('Add where you spent it (or a couple of words) first.');

    // Only spend a Claude call when we actually need fresh ideas.
    let options = [];
    if (process.env.ANTHROPIC_API_KEY && remembered.length < 3) {
      try { options = await aiOptions({ merchant, amount, currency, account, date, hint }); } catch (e) { options = []; }
    }
    // Don't repeat a suggestion the person already has in their history.
    const have = new Set(remembered.map((d) => d.toLowerCase()));
    options = options.filter((o) => !have.has(o.toLowerCase()));

    return ok({ remembered, options });
  } catch (err) {
    return error(err);
  }
};
