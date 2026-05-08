#!/usr/bin/env node
/**
 * CLI: Convert a grid JSON to a PNG file.
 * Usage: node tools/export_png.js <grid.json> [--out out.png] [--scale N]
 *
 * Default scale: 4x (makes 24x24 sprites into 96x96 PNGs — readable on GitHub).
 * Output file defaults to <input_basename>.png in exports/.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname, basename, extname } from 'path';
import { gridFromJSON } from '../src/core/ascii.js';
import { gridToPNG }   from '../src/export/png_writer.js';
import { PALETTE }     from '../src/core/palette.js';

const __dir = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node tools/export_png.js <grid.json> [--out file.png] [--scale N]');
  process.exit(1);
}

const inputPath = args[0];
const outIdx   = args.indexOf('--out');
const scaleIdx = args.indexOf('--scale');
const scale    = scaleIdx >= 0 ? parseInt(args[scaleIdx + 1], 10) : 4;

const base    = basename(inputPath, extname(inputPath));
const outDir  = join(__dir, '../exports');
const outPath = outIdx >= 0 ? args[outIdx + 1] : join(outDir, base + '.png');

mkdirSync(outDir, { recursive: true });

const raw  = readFileSync(inputPath, 'utf8');
const grid = gridFromJSON(raw);
const png  = gridToPNG(grid, PALETTE, scale);

writeFileSync(outPath, png);
console.log(`Exported ${outPath} (${grid[0].length * scale}x${grid.length * scale}px)`);
