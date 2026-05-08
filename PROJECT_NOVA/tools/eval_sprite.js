#!/usr/bin/env node
/**
 * eval_sprite.js — evaluate a sprite grid against the reference library.
 *
 * Usage:
 *   node tools/eval_sprite.js <grid.json> [--filter-quality excellent] [--filter-tags tag1,tag2]
 *
 * Outputs a full z-score comparison table + adjustment hints, all as text.
 * The AI reads this output to decide what structural changes to make.
 * No rendering. No image I/O. Pure data.
 */

import { readFileSync }           from 'fs';
import { fileURLToPath }          from 'url';
import { dirname, join, resolve } from 'path';
import { computeMetrics }         from '../src/eval/metrics.js';
import { buildReferenceProfile }  from '../src/eval/reference_lib.js';
import { compareToReference, adjustmentHints } from '../src/eval/compare.js';
import { asciiDump }              from '../src/core/ascii.js';

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
  console.log('Usage: node tools/eval_sprite.js <grid.json> [--filter-quality Q] [--filter-tags t1,t2]');
  process.exit(0);
}

const gridPath = resolve(args[0]);
const filterQuality = argValue(args, '--filter-quality') ?? null;
const filterTags    = (argValue(args, '--filter-tags') ?? '').split(',').filter(Boolean);

// ── Load sprite ───────────────────────────────────────────────────────────────
let raw;
try {
  raw = JSON.parse(readFileSync(gridPath, 'utf8'));
} catch (e) {
  console.error(`Failed to load ${gridPath}: ${e.message}`);
  process.exit(1);
}

// Uint8Array rows serialize as {0:v,1:v,...} — normalize to plain arrays
const rawGrid  = raw.data ?? raw;
const grid     = Array.isArray(rawGrid)
  ? rawGrid.map(row => Array.isArray(row) ? row : Object.values(row).map(Number))
  : rawGrid;
const spriteId = raw.id ?? gridPath;

// ── ASCII dump ────────────────────────────────────────────────────────────────
console.log('\n' + asciiDump(grid, spriteId));

// ── Compute metrics ───────────────────────────────────────────────────────────
const metrics = computeMetrics(grid);

console.log('\n── Metrics ──────────────────────────────────────────────────');
console.log(`  Size:            ${metrics.width}×${metrics.height}`);
console.log(`  Body pixels:     ${metrics.body_count}`);
console.log(`  Outline pixels:  ${metrics.outline_count}`);
console.log(`  Body density:    ${pct(metrics.body_density)}`);
console.log(`  Unique colors:   ${metrics.unique_body_colors}/6`);
console.log(`  Symmetry:        ${pct(metrics.symmetry_score)}`);
console.log(`  Outline TV:      ${metrics.outline_thickness_variance.toFixed(3)}`);
console.log(`  Highlight centroid: x=${metrics.highlight_centroid.x.toFixed(2)} y=${metrics.highlight_centroid.y.toFixed(2)}`);
console.log();
console.log('  Band ratios:');
for (const [name, key] of [
  ['shadow_deep', 'shadow_deep_ratio'], ['shadow', 'shadow_ratio'],
  ['mid',         'mid_ratio'],         ['bright',  'bright_ratio'],
  ['highlight',   'highlight_ratio'],   ['peak',    'peak_ratio'],
]) {
  console.log(`    ${name.padEnd(12)} ${pct(metrics[key]).padStart(6)}`);
}

// ── Reference comparison ──────────────────────────────────────────────────────
const { distribution, entries } = buildReferenceProfile({
  quality: filterQuality,
  tags: filterTags,
});

if (entries.length === 0) {
  console.log('\n[warn] No reference entries matched the filter — skipping z-score comparison.');
  process.exit(0);
}

console.log(`\n── Reference comparison (n=${entries.length} sprites) ──────────────────`);
const comparison = compareToReference(metrics, distribution);

const severityIcon = { ok: '✓', warn: '~', bad: '✗', critical: '!!' };
for (const [key, r] of Object.entries(comparison.results)) {
  const icon = severityIcon[r.severity] ?? '?';
  const bar  = zBar(r.z);
  console.log(`  ${icon} ${key.padEnd(28)} actual=${fmt(r.actual).padStart(6)}  z=${fmt(r.z).padStart(6)}  ${bar}`);
}

console.log(`\n  Overall rms_z: ${comparison.rms_z}  →  ${comparison.summary}`);

// ── Adjustment hints ──────────────────────────────────────────────────────────
if (comparison.flags.length > 0) {
  console.log('\n── Adjustment hints ─────────────────────────────────────────');
  const hints = adjustmentHints(comparison.flags);
  for (const h of hints) console.log(`  • ${h}`);
}

if (comparison.pass) {
  console.log('\n✓ Sprite passes reference comparison.');
} else {
  console.log('\n✗ Sprite needs adjustment — see hints above.');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function pct(v) { return typeof v === 'number' ? (v * 100).toFixed(1) + '%' : '—'; }
function fmt(v) { return typeof v === 'number' ? v.toFixed(3) : String(v); }

function zBar(z) {
  const n = Math.min(Math.abs(z), 5);
  const bar = '█'.repeat(Math.round(n));
  return z > 0 ? '+' + bar : '-' + bar;
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
}
