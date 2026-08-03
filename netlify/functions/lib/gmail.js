'use strict';

// Talking to Google for the "Connect Gmail" flow — the OAuth handshake and the
// read-only Gmail calls that pull receipts. Raw fetch (Node 18+), no big SDK.

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const appUrl = () => (process.env.APP_URL || 'https://reimbly.netlify.app').replace(/\/$/, '');
const redirectUri = () => `${appUrl()}/api/gmail-callback`;
const clientId = () => process.env.GMAIL_OAUTH_CLIENT_ID || '';
const clientSecret = () => process.env.GMAIL_OAUTH_CLIENT_SECRET || '';
const configured = () => !!(clientId() && clientSecret());

// The consent URL. access_type=offline + prompt=consent so we get a refresh
// token; login_hint + hd nudge Google to the person's JV account.
function authUrl(state, email) {
  const p = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  if (email) { p.set('login_hint', email); p.set('hd', String(email).split('@')[1] || ''); }
  return `${AUTH}?${p.toString()}`;
}

async function postToken(params) {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google token error: ${data.error || res.status}`);
  return data;
}

// Trade the one-time code for tokens (includes the long-lived refresh token).
function exchangeCode(code) {
  return postToken({
    code, client_id: clientId(), client_secret: clientSecret(),
    redirect_uri: redirectUri(), grant_type: 'authorization_code',
  });
}

// A short-lived access token from a stored refresh token.
async function accessFromRefresh(refreshToken) {
  const data = await postToken({
    refresh_token: refreshToken, client_id: clientId(), client_secret: clientSecret(),
    grant_type: 'refresh_token',
  });
  return data.access_token;
}

// Best-effort revoke at Google (so Disconnect really cuts access).
async function revoke(token) {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' });
  } catch (e) { /* best-effort */ }
}

// The Gmail search for receipt-like mail. Same spirit as the old Apps Script:
// requires an attachment (keeps most newsletters out) and matches receipt words
// across the JV languages. `afterEpochSec` limits to new mail since last sync.
function receiptQuery(afterEpochSec) {
  const kw = 'receipt OR invoice OR faktura OR "účtenka" OR paragon OR rachunek OR Rechnung OR factura OR "order confirmation" OR "tax invoice" OR "payment received"';
  const after = afterEpochSec ? ` after:${Math.floor(afterEpochSec)}` : '';
  return `has:attachment (${kw})${after}`;
}

async function apiGet(accessToken, path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail API ${res.status}`);
  return res.json();
}

async function listMessages(accessToken, query, max = 25) {
  const data = await apiGet(accessToken, `/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
  return Array.isArray(data.messages) ? data.messages : [];
}

const getMessage = (accessToken, id) => apiGet(accessToken, `/messages/${id}?format=full`);

async function getAttachment(accessToken, msgId, attId) {
  const data = await apiGet(accessToken, `/messages/${msgId}/attachments/${attId}`);
  // Gmail returns base64url; the rest of the app wants standard base64.
  return Buffer.from(String(data.data || ''), 'base64url').toString('base64');
}

const header = (payload, name) => {
  const h = ((payload && payload.headers) || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
};

// Flatten a message payload into { subject, from, internalDate, attachments, text }.
function parseMessage(msg) {
  const payload = msg.payload || {};
  const attachments = [];
  let text = '';
  const walk = (part) => {
    if (!part) return;
    const mime = String(part.mimeType || '').toLowerCase();
    const filename = part.filename || '';
    const body = part.body || {};
    if (filename && body.attachmentId) {
      attachments.push({ filename, contentType: mime, attachmentId: body.attachmentId, size: body.size || 0 });
    } else if (mime === 'text/plain' && body.data && !text) {
      text = Buffer.from(body.data, 'base64url').toString('utf8');
    } else if (mime === 'text/html' && body.data && !text) {
      text = Buffer.from(body.data, 'base64url').toString('utf8').replace(/<[^>]+>/g, ' ');
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  return {
    subject: header(payload, 'Subject'),
    from: header(payload, 'From'),
    internalDate: Number(msg.internalDate) || 0, // ms epoch
    attachments,
    text: text.slice(0, 20000),
  };
}

module.exports = {
  SCOPE, configured, redirectUri, authUrl, exchangeCode, accessFromRefresh, revoke,
  receiptQuery, listMessages, getMessage, getAttachment, parseMessage,
};
