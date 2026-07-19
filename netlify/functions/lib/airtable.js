'use strict';

// Thin wrapper around the Airtable REST + content APIs. The token lives only in
// the server environment; this module is never bundled into the browser.

const API_BASE = 'https://api.airtable.com/v0';
const CONTENT_BASE = 'https://content.airtable.com/v0';

function baseId() {
  const id = process.env.AIRTABLE_BASE_ID;
  if (!id) throw serverError('Server is missing AIRTABLE_BASE_ID.');
  return id;
}

function token() {
  const t = process.env.AIRTABLE_TOKEN;
  if (!t) throw serverError('Server is missing AIRTABLE_TOKEN.');
  return t;
}

function serverError(message) {
  const err = new Error(message);
  err.statusCode = 500;
  return err;
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${token()}`, ...extra };
}

async function parseOrThrow(res, context) {
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const detail =
      (body && body.error && (body.error.message || body.error.type)) ||
      body.raw ||
      res.statusText;
    const err = new Error(`Airtable ${context} failed: ${detail}`);
    // Surface auth/permission problems as-is; treat everything else as 502.
    err.statusCode = res.status === 401 || res.status === 403 ? res.status : 502;
    throw err;
  }
  return body;
}

const encodeTable = (table) => encodeURIComponent(table);

/**
 * List records, following pagination. `params` maps to Airtable query params
 * (filterByFormula, sort, maxRecords, fields, etc.).
 */
async function listRecords(table, params = {}) {
  const records = [];
  let offset;
  do {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        value.forEach((v) => qs.append(key, v));
      } else if (typeof value === 'object') {
        // e.g. sort: [{ field, direction }]
        qs.append(key, JSON.stringify(value));
      } else {
        qs.append(key, String(value));
      }
    }
    if (offset) qs.set('offset', offset);

    const url = `${API_BASE}/${baseId()}/${encodeTable(table)}?${qs.toString()}`;
    const res = await fetch(url, { headers: authHeaders() });
    const body = await parseOrThrow(res, `list ${table}`);
    records.push(...(body.records || []));
    offset = body.offset;
  } while (offset);

  return records;
}

async function findFirst(table, params = {}) {
  const records = await listRecords(table, { maxRecords: 1, ...params });
  return records[0] || null;
}

async function createRecord(table, fields, { typecast = true } = {}) {
  const url = `${API_BASE}/${baseId()}/${encodeTable(table)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ fields, typecast }),
  });
  return parseOrThrow(res, `create ${table}`);
}

async function updateRecord(table, id, fields, { typecast = true } = {}) {
  const url = `${API_BASE}/${baseId()}/${encodeTable(table)}/${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ fields, typecast }),
  });
  return parseOrThrow(res, `update ${table}`);
}

async function deleteRecord(table, id) {
  const url = `${API_BASE}/${baseId()}/${encodeTable(table)}/${id}`;
  const res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  return parseOrThrow(res, `delete ${table}`);
}

/**
 * Upload a receipt straight onto a record's attachment field via the content
 * API, so the file never lives anywhere but Airtable.
 *
 * @param {string} recordId
 * @param {string} field - attachment field name, e.g. "Receipt".
 * @param {{filename: string, contentType: string, base64: string}} file
 */
async function uploadAttachment(recordId, field, file) {
  const url = `${CONTENT_BASE}/${baseId()}/${recordId}/${encodeURIComponent(
    field
  )}/uploadAttachment`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      contentType: file.contentType,
      filename: file.filename,
      file: file.base64,
    }),
  });
  return parseOrThrow(res, 'upload attachment');
}

module.exports = {
  listRecords,
  findFirst,
  createRecord,
  updateRecord,
  deleteRecord,
  uploadAttachment,
};
