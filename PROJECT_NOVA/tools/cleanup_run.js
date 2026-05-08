#!/usr/bin/env node
/**
 * CLI: Run the full cleanup pipeline on a grid JSON file.
 * Usage: node tools/cleanup_run.js <grid.json> [--out <output.json>] [--ascii] [--diff]
 *
 *   --ascii    Print ASCII dump of result
 *   --diff     Print diff of before vs after
 *   --out      Write cleaned grid JSON to file (default: stdout)
 *   --verbose  Print per-pass ASCII dumps
 */

import { readFileSync, writeFileSync } from 'fs';
import { gridFromJSON, gridToJSON, asciiDump, asciiDiff } from '../src/core/ascii.js';
import { runCleanup } from '../src/cleanup/index.js';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node tools/cleanup_run.js <grid.json> [--out out.json] [--ascii] [--diff] [--verbose]');
  process.exit(1);
}

const filePath = args[0];
const outIdx   = args.indexOf('--out');
const outPath  = outIdx >= 0 ? args[outIdx + 1] : null;
const doAscii  = args.includes('--ascii');
const doDiff   = args.includes('--diff');
const verbose  = args.includes('--verbose');

let raw;
try {
  raw = readFileSync(filePath, 'utf8');
} catch (e) {
  console.error(`Cannot read: ${filePath}`);
  process.exit(1);
}

const original = gridFromJSON(raw);
const { grid: cleaned, flags, passResults } = runCleanup(original);

if (verbose) {
  for (const p of passResults) {
    console.log(`\n--- ${p.pass} ---`);
    console.log(asciiDump(p.grid, p.pass));
    if (p.flags?.length) console.log('Flags:', p.flags.join('\n  '));
  }
}

if (flags.length > 0) {
  console.error('Diagnostic flags:');
  for (const f of flags) console.error(' ', f);
}

if (doAscii) {
  console.log(asciiDump(cleaned, 'cleaned'));
}

if (doDiff) {
  console.log('\nDiff (! = changed):');
  console.log(asciiDiff(original, cleaned));
}

const outJSON = gridToJSON(cleaned, { source: filePath, cleaned: true });

if (outPath) {
  writeFileSync(outPath, outJSON);
  console.log(`Written to ${outPath}`);
} else if (!doAscii && !doDiff && !verbose) {
  process.stdout.write(outJSON + '\n');
}
