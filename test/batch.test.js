'use strict';

// The payment-batch id stamped on a CedarStone download, so a whole download
// can be grouped and marked paid in one click.

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeBatchId } = require('../netlify/functions/lib/domain');

test('makeBatchId builds a stable, sortable id from the download time', () => {
  const id = makeBatchId(new Date('2026-08-01T14:32:07Z'));
  assert.equal(id, 'batch-2026-08-01-143207');
});

test('makeBatchId zero-pads month, day, and time parts', () => {
  const id = makeBatchId(new Date('2026-01-05T09:03:04Z'));
  assert.equal(id, 'batch-2026-01-05-090304');
});

test('two downloads a second apart get different ids (sortable newest-last)', () => {
  const a = makeBatchId(new Date('2026-08-01T14:32:07Z'));
  const b = makeBatchId(new Date('2026-08-01T14:32:08Z'));
  assert.notEqual(a, b);
  assert.ok(a < b);
});
