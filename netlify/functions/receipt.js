'use strict';

// Serve a receipt file through the app's own domain, so the browser never sees
// an Airtable URL. Authorized by the short HMAC token in the link (see
// domain.receiptToken). Streams the current file bytes from Airtable server-side.

const { methodGuard } = require('./lib/http');
const { getExpenseById, verifyReceiptToken } = require('./lib/domain');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const q = event.queryStringParameters || {};
    const id = String(q.e || '').trim();
    const token = String(q.t || '').trim();
    const wantThumb = q.thumb === '1';
    if (!id || !verifyReceiptToken(id, token)) return { statusCode: 403, body: 'Not authorized.' };

    const rec = await getExpenseById(id);
    const att = rec && Array.isArray(rec.fields.Receipt) ? rec.fields.Receipt[0] : null;
    if (!att || !att.url) return { statusCode: 404, body: 'No receipt on this expense.' };

    let url = att.url;
    let type = att.type || 'application/octet-stream';
    if (wantThumb && att.thumbnails) {
      const t = att.thumbnails.large || att.thumbnails.small;
      if (t && t.url) { url = t.url; type = 'image/jpeg'; } // Airtable thumbnails are JPEG
    }

    const resp = await fetch(url);
    if (!resp || !resp.ok) return { statusCode: 502, body: 'Could not load the receipt.' };
    const body = Buffer.from(await resp.arrayBuffer()).toString('base64');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': type,
        'Content-Disposition': `inline; filename="${String(att.filename || 'receipt').replace(/["\r\n]/g, '')}"`,
        'Cache-Control': 'private, max-age=3600',
      },
      body,
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('[rembly] receipt serve failed', err && err.message);
    return { statusCode: 500, body: 'Could not load the receipt.' };
  }
};
