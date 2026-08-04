#!/usr/bin/env node
'use strict';

// Regenerate netlify/functions/lib/fund-dimensions.js from CedarStone's fund
// listing. When CedarStone sends an updated listing, save it as
// docs/chart-of-accounts/fund-dimensions.csv (columns: Fund ID, Fund name, Fund
// type, Ministry Type ID (DEPT_ID), Country ID (CLASS), Entity ID) and run:
//
//     node scripts/generate-fund-dimensions.mjs
//
// Then run `node scripts/check-fund-coverage.mjs` to see any accounts a person can
// pick that the new listing doesn't cover.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = join(root, 'docs/chart-of-accounts/fund-dimensions.csv');
const OUT = join(root, 'netlify/functions/lib/fund-dimensions.js');

// Minimal RFC-4180-ish CSV parser (handles quoted fields with commas/quotes).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* ignore */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else { field += c; }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

const rows = parseCsv(readFileSync(CSV, 'utf8'));
const [header, ...body] = rows;
const col = (name) => header.findIndex((h) => h.trim().toLowerCase().startsWith(name));
const iId = col('fund id');
const iName = col('fund name');
const iDept = col('ministry type');
const iClass = col('country');
const iEntity = col('entity');
if (iId < 0 || iDept < 0 || iClass < 0) {
  console.error('Could not find the expected columns in', CSV);
  process.exit(1);
}

const funds = body
  .map((r) => ({
    code: String(r[iId] || '').trim(),
    name: String(r[iName] || '').trim(),
    dept: String(r[iDept] || '').trim(),
    cls: String(r[iClass] || '').trim(),
    entity: String(r[iEntity] || '').trim(),
  }))
  .filter((f) => f.code)
  .sort((a, b) => a.code.localeCompare(b.code));

const lines = [];
lines.push("'use strict';\n");
lines.push('// Fund → Intacct dimensions, keyed by Fund ID (the support/project account a');
lines.push('// person spends from = ExpenseWire GLENTRY_PROJECTID). Source of truth:');
lines.push('// CedarStone\'s "JV Intacct Fund listing with Dimensions". Each fund\'s Ministry');
lines.push('// Type → DEPT_ID and Country → GLENTRY_CLASSID.');
lines.push('// GENERATED from docs/chart-of-accounts/fund-dimensions.csv by');
lines.push('// scripts/generate-fund-dimensions.mjs — regenerate, don\'t hand-edit.\n');
lines.push('// Value = [Fund name, DEPT_ID (Ministry Type), CLASS (Country), Entity].');
lines.push('const DIMENSIONS = {');
for (const f of funds) {
  lines.push(`  ${JSON.stringify(f.code)}: ${JSON.stringify([f.name, f.dept, f.cls, f.entity])},`);
}
lines.push('};\n');
lines.push("const GENERAL_FUND_CODE = '010000';");
lines.push("// Intacct records the General Fund's project without the leading zeros ('10000'),");
lines.push('// as seen in CedarStone\'s own upload file; every other fund uses its 6-digit code.');
lines.push("const GENERAL_FUND_PROJECT = '10000';\n");
lines.push("// Normalize any fund reference to the 6-digit key ('10000' → '010000').");
lines.push('function normCode(code) {');
lines.push("  const m = /(\\d+)/.exec(String(code || ''));");
lines.push("  return m ? m[1].padStart(6, '0') : '';");
lines.push('}\n');
lines.push("// Look up a fund's dimensions. Returns null if the code isn't in the listing.");
lines.push('function dimensionsFor(code) {');
lines.push('  const key = normCode(code);');
lines.push('  const d = DIMENSIONS[key];');
lines.push('  if (!d) return null;');
lines.push('  return {');
lines.push('    name: d[0], dept: d[1], class: d[2], entity: d[3],');
lines.push('    project: key === GENERAL_FUND_CODE ? GENERAL_FUND_PROJECT : key,');
lines.push('  };');
lines.push('}\n');
lines.push('module.exports = { DIMENSIONS, GENERAL_FUND_CODE, GENERAL_FUND_PROJECT, normCode, dimensionsFor };');

writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`Wrote ${funds.length} funds → ${OUT}`);
