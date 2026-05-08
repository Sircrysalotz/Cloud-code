#!/usr/bin/env node
/**
 * Test runner — no dependencies, no jest required.
 * Discovers and runs all tests/unit/*.js files in alphabetical order.
 */

import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { join, dirname } from 'path';
import { PASS, FAIL } from './helpers.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const unitDir = join(__dir, 'unit');
const files = readdirSync(unitDir).filter(f => f.endsWith('.js')).sort();

for (const f of files) {
  await import(pathToFileURL(join(unitDir, f)).href);
}

// PASS and FAIL are mutated by helpers.js exports — re-read them via helpers module
import('./helpers.js').then(h => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${h.PASS} passed, ${h.FAIL} failed`);
  if (h.FAIL === 0) {
    console.log('All tests passed.');
  } else {
    console.log(`FAILED: ${h.FAIL} test(s)`);
    process.exit(1);
  }
});
