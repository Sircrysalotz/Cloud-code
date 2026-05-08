#!/usr/bin/env node
/**
 * CLI: Render a grid JSON file as ASCII.
 * Usage: node tools/ascii_dump.js <grid.json> [--label <name>]
 */

import { readFileSync } from 'fs';
import { gridFromJSON } from '../src/core/ascii.js';
import { asciiDump }    from '../src/core/ascii.js';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node tools/ascii_dump.js <grid.json> [--label <name>]');
  process.exit(1);
}

const filePath = args[0];
const labelIdx = args.indexOf('--label');
const label = labelIdx >= 0 ? args[labelIdx + 1] : filePath;

let raw;
try {
  raw = readFileSync(filePath, 'utf8');
} catch (e) {
  console.error(`Cannot read file: ${filePath}`);
  process.exit(1);
}

const grid = gridFromJSON(raw);
console.log(asciiDump(grid, label));
