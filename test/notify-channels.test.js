'use strict';

// How a person's reminder-channel choice is read off their Staff record.
// Default is BOTH (money they'd lose is worth over-reaching); "None" = opted out.

const test = require('node:test');
const assert = require('node:assert/strict');

const { notifyChannelsOf } = require('../netlify/functions/lib/domain');

test('unset defaults to both email and push', () => {
  assert.deepEqual(notifyChannelsOf({}), { email: true, push: true });
  assert.deepEqual(notifyChannelsOf({ 'Reminder Channels': [] }), { email: true, push: true });
});

test('an explicit choice is honored', () => {
  assert.deepEqual(notifyChannelsOf({ 'Reminder Channels': ['Email'] }), { email: true, push: false });
  assert.deepEqual(notifyChannelsOf({ 'Reminder Channels': ['Push'] }), { email: false, push: true });
  assert.deepEqual(notifyChannelsOf({ 'Reminder Channels': ['Email', 'Push'] }), { email: true, push: true });
});

test('"None" means opted out of everything', () => {
  assert.deepEqual(notifyChannelsOf({ 'Reminder Channels': ['None'] }), { email: false, push: false });
});

test('handles Airtable option objects, not just strings', () => {
  assert.deepEqual(
    notifyChannelsOf({ 'Reminder Channels': [{ id: 'sel1', name: 'Email' }] }),
    { email: true, push: false },
  );
});
