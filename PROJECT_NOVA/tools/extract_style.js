#!/usr/bin/env node
/**
 * extract_style.js — Phase 28: Build and save a style profile from any reference set.
 *
 * Usage:
 *   node tools/extract_style.js                        # Goku batch (default)
 *   node tools/extract_style.js --source goku          # Goku batch
 *   node tools/extract_style.js --dir path/to/grids/   # custom batch dir
 *   node tools/extract_style.js --output custom.json   # save to specific file
 *   node tools/extract_style.js --verbose              # per-band detail
 *
 * Output: exports/style_profiles/<source>.json
 *
 * This is how the pipeline learns a new style. Point it at any folder of
 * _grid.json files and it extracts a reusable style profile that ai_draw.js
 * can generate from.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, dirname }    from 'path';
import { fileURLToPath }    from 'url';
import { PALETTE }          from '../src/core/palette.js';
import { buildStyleProfile, styleProfileToJSON } from '../src/eval/style_profile.js';

const __dir  = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dir, '..');
const BATCH  = join(ROOT, 'exports', 'batch');
const OUTDIR = join(ROOT, 'exports', 'style_profiles');

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = k => args.includes(k);
const opt  = (k, def) => { const i = args.indexOf(k); return i !== -1 ? args[i + 1] : def; };

const sourceLabel = opt('--source', 'goku');
const customDir   = opt('--dir', null);
const outputFile  = opt('--output', null);
const verbose     = flag('--verbose');

// ── Load grids ────────────────────────────────────────────────────────────────

function loadGridsFromDir(dir) {
  if (!existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }
  const files = readdirSync(dir).filter(f => f.endsWith('_grid.json'));
  if (!files.length) {
    console.error(`No *_grid.json files found in: ${dir}`);
    process.exit(1);
  }
  const grids = [];
  for (const f of files) {
    try {
      const raw  = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (raw.data && Array.isArray(raw.data)) {
        grids.push(raw.data.map(row => new Uint8Array(row)));
      }
    } catch { /* skip malformed */ }
  }
  return { grids, count: files.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const gridsDir = customDir ?? BATCH;
console.log(`\nLoading grids from: ${gridsDir}`);

const { grids, count } = loadGridsFromDir(gridsDir);
console.log(`  ${grids.length} of ${count} grid files loaded`);

if (!grids.length) {
  console.error('No grids loaded — aborting.');
  process.exit(1);
}

console.log('Building style profile...');
const profile = buildStyleProfile(grids, PALETTE, sourceLabel);

// ── Print summary ─────────────────────────────────────────────────────────────

console.log('\n────────────────────────────────────────────────────────────');
console.log(`Style Profile: ${profile.source}`);
console.log(`  Frames:      ${profile.frameCount}`);
console.log(`  Median size: ${profile.dims.medianWidth}×${profile.dims.medianHeight}px`);
console.log(`  Aspect:      ${profile.dims.aspectRatio.toFixed(3)}`);
console.log(`  Symmetry:    ${(profile.symmetry.meanScore * 100).toFixed(1)}%`);
console.log(`  Outline cov: ${(profile.outline.coverageRatio * 100).toFixed(1)}%`);

console.log('\n  Band Distribution:');
const BAND_NAMES = ['shadow_deep', 'shadow', 'mid', 'bright', 'highlight', 'peak'];
for (const b of BAND_NAMES) {
  const { mean, sigma } = profile.bands[b];
  const bar = '█'.repeat(Math.round(mean * 20)).padEnd(20);
  console.log(`    ${b.padEnd(12)} ${bar} ${(mean * 100).toFixed(1)}% ± ${(sigma * 100).toFixed(1)}%`);
}

if (verbose) {
  console.log('\n  Spatial Bias (where each band lives):');
  for (const b of BAND_NAMES) {
    const { topBias, centerBias } = profile.spatial[b];
    const vPos = topBias < 0.4 ? 'TOP' : topBias > 0.6 ? 'BOTTOM' : 'MIDDLE';
    const hPos = centerBias < 0.3 ? 'CENTER' : centerBias > 0.6 ? 'EDGE' : 'MID';
    console.log(`    ${b.padEnd(12)} vertical=${vPos.padEnd(7)} horizontal=${hPos}`);
  }
  console.log('\n  Highlight centroid (normalized):');
  console.log(`    row: ${profile.highlight.centroidRowNorm.toFixed(3)} (${profile.highlight.centroidRowNorm < 0.4 ? 'UPPER' : 'LOWER'} half)`);
  console.log(`    col: ${profile.highlight.centroidColNorm.toFixed(3)}`);
}

// ── Save ──────────────────────────────────────────────────────────────────────

if (!existsSync(OUTDIR)) mkdirSync(OUTDIR, { recursive: true });
const outPath = outputFile ?? join(OUTDIR, `${sourceLabel}.json`);
writeFileSync(outPath, styleProfileToJSON(profile));
console.log(`\nSaved: ${outPath}`);
console.log('────────────────────────────────────────────────────────────\n');
