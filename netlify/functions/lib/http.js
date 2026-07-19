'use strict';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

function json(statusCode, data) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(data) };
}

function ok(data) {
  return json(200, data);
}

function error(err) {
  const statusCode = err && err.statusCode ? err.statusCode : 500;
  const message =
    statusCode >= 500
      ? 'Something went wrong on our end. Please try again.'
      : err.message || 'Request failed.';
  if (statusCode >= 500) console.error('[reimbly]', err);
  return json(statusCode, { error: message });
}

function methodGuard(event, allowed) {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  if (!list.includes(event.httpMethod)) {
    return json(405, { error: `Method ${event.httpMethod} not allowed.` });
  }
  return null;
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('Request body must be valid JSON.');
    err.statusCode = 400;
    throw err;
  }
}

module.exports = { json, ok, error, methodGuard, parseBody };
