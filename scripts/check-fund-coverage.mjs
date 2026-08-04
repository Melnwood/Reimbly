#!/usr/bin/env node
'use strict';

// Safety net: list the accounts a person can pick that CedarStone's fund listing
// doesn't have dimensions for. An expense on one of these would export un-coded —
// and the Intacct download now blocks on exactly that. Run this after updating the
// fund listing (or the accounts) to see what CedarStone still needs to send:
//
//     node scripts/check-fund-coverage.mjs

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { dimensionsFor } = require('../netlify/functions/lib/fund-dimensions.js');
const { ACCOUNTS } = require('../netlify/functions/lib/coding.js');

const accts = ACCOUNTS || [];
const missing = accts.filter((a) => !dimensionsFor(a.code));

console.log(`Accounts people can pick: ${accts.length}`);
console.log(`Covered by the fund listing: ${accts.length - missing.length}`);
console.log(`Missing dimensions: ${missing.length}`);
if (missing.length) {
  console.log('\nThese need dimensions from CedarStone (or should be retired):');
  for (const a of missing) console.log(`  ${a.code}  ${a.name}`);
}
