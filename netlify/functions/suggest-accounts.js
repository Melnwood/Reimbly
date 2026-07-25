'use strict';

// Best-guess a GL account for import rows that don't have one, from the payee /
// memo text. One Claude call per batch. The import preview calls this
// automatically for uncoded rows; the person reviews and adjusts before saving.
// Only accounts the person is allowed to see are offered to the model.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { ensureStaff, accountAccessFor } = require('./lib/domain');

const SDK = require('@anthropic-ai/sdk');
const Anthropic = SDK.Anthropic || SDK.default || SDK;
const MODEL = () => process.env.SCAN_MODEL || 'claude-opus-4-8';
const MAX_ROWS = 100;

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function assignTool() {
  return {
    name: 'assign_accounts',
    description: 'Assign the single best-fit GL account code to each transaction.',
    input_schema: {
      type: 'object',
      properties: {
        assignments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              line: { type: 'number', description: 'The transaction line number.' },
              code: { type: ['string', 'null'], description: 'Best-fit account CODE from the list, or null if genuinely unsure.' },
            },
            required: ['line', 'code'],
            additionalProperties: false,
          },
        },
      },
      required: ['assignments'],
      additionalProperties: false,
    },
  };
}

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      const err = new Error('Account suggestions need the receipt reader turned on (ANTHROPIC_API_KEY).');
      err.statusCode = 503;
      throw err;
    }
    const user = await verifyRequest(event.headers);
    await ensureStaff(user);

    const body = parseBody(event);
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : [];
    if (!rows.length) throw badRequest('No rows to suggest accounts for.');

    const access = await accountAccessFor(user.email);
    const accounts = access.accounts.filter((a) => access.visibleIds.has(a.id));
    if (!accounts.length) return ok({ suggestions: [] });
    const codes = new Set(accounts.map((a) => String(a.code)));
    const legend = accounts.map((a) => `${a.code} = ${a.name}`).join('\n');

    const lines = rows
      .map((r) => {
        const line = Number(r.line);
        const bits = [String(r.merchant || '').slice(0, 120), String(r.description || '').slice(0, 200)].filter(Boolean).join(' · ');
        const amount = r.amount != null ? ` — ${r.amount}` : '';
        return isFinite(line) ? `#${line}: ${bits}${amount}` : null;
      })
      .filter(Boolean)
      .join('\n');

    const prompt =
      'You are coding staff reimbursement expenses at Josiah Venture (a ministry working ' +
      'across Central & Eastern Europe) to a chart of accounts. For each transaction below, ' +
      'choose the single best-fit account CODE from this list, or null if you are genuinely ' +
      'unsure — do not force a guess.\n\n' + legend +
      '\n\nTransactions (by line number):\n' + lines +
      '\n\nCall assign_accounts with exactly one entry per line.';

    const client = new Anthropic();
    const message = await client.messages.create({
      model: MODEL(),
      max_tokens: 4096,
      tools: [assignTool()],
      tool_choice: { type: 'tool', name: 'assign_accounts' },
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });
    const toolUse = (message.content || []).find((b) => b.type === 'tool_use');
    const raw = toolUse && toolUse.input && Array.isArray(toolUse.input.assignments) ? toolUse.input.assignments : [];
    const suggestions = raw
      .map((a) => ({ line: Number(a && a.line), code: a && a.code != null ? String(a.code).trim() : '' }))
      .filter((a) => isFinite(a.line) && codes.has(a.code));

    return ok({ suggestions });
  } catch (err) {
    return error(err);
  }
};
