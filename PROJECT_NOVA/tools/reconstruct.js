#!/usr/bin/env node
/**
 * reconstruct.js — Load a palette-index grid + dynamic palette, render to PNG,
 * emit ASCII dump and accuracy report.
 *
 * Consumes output from tools/ingest_sprite.py:
 *   exports/<name>_grid.json    — {width, height, data, accuracy, source_box}
 *   exports/<name>_palette.json — [{index, rgb:[r,g,b]}, ...]
 *
 * Usage:
 *   node tools/reconstruct.js goku_frame
 *   node tools/reconstruct.js goku_frame --scale 4
 *   node tools/reconstruct.js goku_frame --cleanup  (run cleanup passes)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath }   from 'url';
import { dirname, join }   from 'path';
import { paletteFromRGB }  from '../src/core/palette.js';
import { gridToPNG }       from '../src/export/png_writer.js';
import { asciiDump }       from '../src/core/ascii.js';
import { runCleanup }      from '../src/cleanup/index.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT   = join(__dir, '..', 'exports');
mkdirSync(OUT, { recursive: true });

const args    = process.argv.slice(2);
const name    = args.find(a => !a.startsWith('--')) ?? 'goku_frame';
const scale   = (() => { const i = args.indexOf('--scale'); return i >= 0 ? parseInt(args[i+1]) : 8; })();
const cleanup = args.includes('--cleanup');

// ── Load ──────────────────────────────────────────────────────────────────────

const gridFile    = join(OUT, `${name}_grid.json`);
const paletteFile = join(OUT, `${name}_palette.json`);

const gridData    = JSON.parse(readFileSync(gridFile, 'utf8'));
const paletteData = JSON.parse(readFileSync(paletteFile, 'utf8'));

const palette = paletteFromRGB(paletteData);
let   grid    = gridData.data.map(row => Array.isArray(row) ? row : Object.values(row).map(Number));

const W = gridData.width;
const H = gridData.height;

console.log(`Grid: ${W}×${H}  palette: ${palette.size} colors`);
if (gridData.accuracy) {
  const a = gridData.accuracy;
  console.log(`Ingest accuracy: ${a.exact_pct}%  mean Δ=${a.mean_color_error}  body=${a.body_pixels}px`);
}

// ── Optional cleanup ──────────────────────────────────────────────────────────

if (cleanup) {
  console.log('\nRunning cleanup passes...');
  const result = runCleanup(grid);
  grid = result.grid;
  if (result.flags.length) console.log('Cleanup flags:', result.flags);
}

// ── ASCII dump ────────────────────────────────────────────────────────────────

// Use the dynamic palette's ASCII chars for the dump
function asciiDumpDynamic(g, label) {
  const lines = [`[${label}] ${g[0].length}×${g.length}`];
  for (const row of g) {
    lines.push(row.map(v => palette.ascii(v)).join(''));
  }
  return lines.join('\n');
}

console.log('\n' + asciiDumpDynamic(grid, name));

// ── Render PNG ────────────────────────────────────────────────────────────────

const pngBytes = gridToPNG(grid, palette, scale);
const outPath  = join(OUT, `${name}_recon${cleanup ? '_cleaned' : ''}.png`);
writeFileSync(outPath, pngBytes);
console.log(`\nPNG: ${outPath}  (${W * scale}×${H * scale}px)`);

// ── Pixel diff vs original grid ───────────────────────────────────────────────

const origGrid = gridData.data.map(row => Array.isArray(row) ? row : Object.values(row).map(Number));
if (cleanup) {
  let same = 0, changed = 0;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (grid[r][c] === origGrid[r][c]) same++; else changed++;
    }
  }
  const total = W * H;
  console.log(`\nCleanup diff: ${changed} pixels changed (${(changed/total*100).toFixed(1)}% of total)`);
}

// ── Palette summary ───────────────────────────────────────────────────────────

console.log('\nPalette:');
for (const c of palette.colors) {
  const isTransparent = c.a === 0;
  const tag = isTransparent ? 'transparent' : `rgb(${c.r},${c.g},${c.b})`;
  console.log(`  [${c.index}] '${c.ascii}'  ${tag}`);
}
