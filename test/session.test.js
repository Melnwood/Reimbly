'use strict';

// Reimbly's own long-lived session token — what Face ID restores so returning to
// the app doesn't need a fresh Google sign-in every hour.

process.env.AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || 'test-signing-secret';

const test = require('node:test');
const assert = require('node:assert/strict');

const { signAppToken, verifyAppToken, looksLikeAppToken } = require('../netlify/functions/lib/session');

test('a minted token round-trips back to the person', () => {
  const t = signAppToken({ email: 'Mel@JosiahVenture.com', name: 'Mel', sub: 'abc' });
  assert.equal(looksLikeAppToken(t), true);
  const who = verifyAppToken(t);
  assert.equal(who.email, 'mel@josiahventure.com'); // normalized
  assert.equal(who.name, 'Mel');
});

test('a tampered token is rejected', () => {
  const t = signAppToken({ email: 'a@b.com' });
  assert.throws(() => verifyAppToken(`${t.slice(0, -3)}xxx`), /verified/);
});

test('an expired token is rejected', () => {
  const t = signAppToken({ email: 'a@b.com' }, -1); // already expired
  assert.throws(() => verifyAppToken(t), /expired/);
});

test('a Google-style token is not mistaken for ours', () => {
  const fakeGoogle = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ iss: 'accounts.google.com' })).toString('base64url')}.sig`;
  assert.equal(looksLikeAppToken(fakeGoogle), false);
});

test('garbage is not mistaken for ours and does not throw on the check', () => {
  assert.equal(looksLikeAppToken('not-a-token'), false);
  assert.equal(looksLikeAppToken(''), false);
});
