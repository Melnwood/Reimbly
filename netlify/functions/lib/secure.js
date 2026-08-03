'use strict';

// Small crypto helpers for the Gmail connection: encrypt the stored refresh
// token at rest, and sign the OAuth "state" so the callback can't be forged.
// The key is derived from GMAIL_OAUTH_CLIENT_SECRET (which exists only for this
// feature), so it's a real secret, separate from everything else, no new env var.

const crypto = require('crypto');

function baseKey(label) {
  const secret = process.env.GMAIL_OAUTH_CLIENT_SECRET || '';
  return crypto.createHmac('sha256', secret).update(label).digest();
}

// --- token encryption (AES-256-GCM) ---
function encrypt(plain) {
  const key = baseKey('reimbly-gmail-token');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

function decrypt(blob) {
  const parts = String(blob || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Bad token blob.');
  const key = baseKey('reimbly-gmail-token');
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const enc = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// --- signed OAuth state (HMAC, short-lived) ---
function signState(obj, ttlSeconds = 900) {
  const payload = { ...obj, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', baseKey('reimbly-gmail-state')).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyState(state) {
  const parts = String(state || '').split('.');
  if (parts.length !== 2) throw new Error('Bad state.');
  const expected = crypto.createHmac('sha256', baseKey('reimbly-gmail-state')).update(parts[0]).digest('base64url');
  if (parts[1].length !== expected.length
    || !crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) {
    throw new Error('State could not be verified.');
  }
  const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp * 1000 <= Date.now()) throw new Error('State expired.');
  return payload;
}

module.exports = { encrypt, decrypt, signState, verifyState };
