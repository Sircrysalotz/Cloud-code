#!/usr/bin/env node
/**
 * goku_report.js — Full pipeline health report.
 *
 * Evaluates all clean batch frames against the Goku reference distribution
 * and prints a structured report covering:
 *   - Pass rate and rmsZ distribution
 *   - Per-metric deviation summary
 *   - Top outlier frames per metric
 *   - Pipeline readiness verdict
 *
 * Usage:
 *   node tools/goku_report.js
 *   node tools/goku_report.js --verbose   (show per-frame rows)
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname }             from 'path';
import { fileURLToPath }             from 'url';
import { paletteFromRGB }            from '../src/core/palette.js';
import { runCleanup }                from '../src/cleanup/index.js';
import { computeMetrics }            from '../src/eval/metrics.js';
import { compareToReference, adjustmentHints } from '../src/eval/compare.js';
import { loadBatchReference }        from '../src/eval/reference_lib.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const BATCH = join(__dir, '..', 'exports', 'batch');
const MAX_PALETTE = 40;

const BAND_KEYS   = ['shadow_deep_ratio','shadow_ratio','mid_ratio','bright_ratio','highlight_ratio','peak_ratio'];
const STRUCT_KEYS = ['symmetry_score','outline_thickness_variance','unique_body_colors','body_density'];
const ALL_KEYS    = [...BAND_KEYS, ...STRUCT_KEYS];

const args    = process.argv.slice(2);
const verbose = args.includes('--verbose');

// ── Load reference ────────────────────────────────────────────────────────────

const ref = loadBatchReference();
if (!ref) { console.error('No batch reference. Run: python3 tools/batch_ingest.py'); process.exit(1); }
const { distribution } = ref;

// ── Load clean frame names ────────────────────────────────────────────────────

const names = readdirSync(BATCH)
  .filter(f => f.endsWith('_palette.json'))
  .map(f => f.replace('_palette.json', ''))
  .filter(name => {
    try {
      const p = JSON.parse(readFileSync(join(BATCH, `${name}_palette.json`), 'utf8'));
      return p.length <= MAX_PALETTE;
    } catch { return false; }
  })
  .sort();

// ── Evaluate all frames ───────────────────────────────────────────────────────

process.stdout.write(`Evaluating ${names.length} frames...`);
const results = [];

for (const name of names) {
  try {
    const gridData    = JSON.parse(readFileSync(join(BATCH, `${name}_grid.json`),    'utf8'));
    const paletteData = JSON.parse(readFileSync(join(BATCH, `${name}_palette.json`), 'utf8'));
    const palette     = paletteFromRGB(paletteData);
    const raw         = gridData.data.map(row => Array.isArray(row) ? [...row] : Object.values(row).map(Number));
    const { grid }    = runCleanup(raw, palette);
    const metrics     = computeMetrics(grid, palette);
    const comparison  = compareToReference(metrics, distribution);
    results.push({ name, metrics, comparison });
  } catch (e) {
    // skip malformed frames
  }
}
console.log(' done.\n');

const n     = results.length;
const pass  = results.filter(r => r.comparison.pass).length;
const rmsZs = results.map(r => r.comparison.rms_z);
rmsZs.sort((a,b) => a - b);
const medZ  = rmsZs[Math.floor(n/2)] ?? 0;
const meanZ = rmsZs.reduce((a,b)=>a+b,0) / Math.max(n,1);
const p90Z  = rmsZs[Math.floor(n * 0.90)] ?? 0;

// ── Report ────────────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║          NOVA PIPELINE — GOKU REFERENCE REPORT           ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log();

// Overall verdict
const verdict = pass / n >= 0.90 ? '✓ EXCELLENT'
              : pass / n >= 0.75 ? '~ GOOD'
              : pass / n >= 0.60 ? '! NEEDS WORK'
              : '✗ FAILING';
console.log(`Overall: ${verdict}  —  ${pass}/${n} frames pass (${(pass/n*100).toFixed(1)}%)`);
console.log(`rmsZ — mean: ${meanZ.toFixed(2)}  median: ${medZ.toFixed(2)}  p90: ${p90Z.toFixed(2)}  max: ${Math.max(...rmsZs).toFixed(2)}`);
console.log();

// Per-metric summary
console.log('Metric breakdown (frames flagged bad/critical):');
console.log('─'.repeat(56));
for (const key of ALL_KEYS) {
  const flagged = results.filter(r => {
    const f = r.comparison.flags.find(f => f.key === key);
    return f && (f.severity === 'bad' || f.severity === 'critical');
  });
  if (flagged.length === 0) { console.log(`  ✓ ${key.padEnd(30)} 0 flags`); continue; }

  const highCount = flagged.filter(r => r.comparison.flags.find(f=>f.key===key)?.direction === 'high').length;
  const lowCount  = flagged.length - highCount;
  const dirStr    = highCount > 0 && lowCount > 0 ? `${lowCount}↓ ${highCount}↑`
                  : lowCount > 0 ? `${lowCount}↓` : `${highCount}↑`;
  const pct       = (flagged.length / n * 100).toFixed(0);
  const marker    = flagged.length / n > 0.20 ? '!' : ' ';
  console.log(`  ${marker} ${key.padEnd(30)} ${String(flagged.length).padStart(3)} flagged (${pct.padStart(3)}%)  ${dirStr}`);
}
console.log();

// Worst frames
const worst = [...results].sort((a,b) => b.comparison.rms_z - a.comparison.rms_z).slice(0, 10);
console.log('Top 10 worst-scoring frames:');
console.log('─'.repeat(56));
for (const { name, comparison } of worst) {
  const topFlags = comparison.flags.slice(0, 2).map(f => f.key.replace('_ratio','').replace('_score',''));
  const status   = comparison.pass ? 'PASS' : 'FAIL';
  console.log(`  ${name.padEnd(16)} rmsZ=${String(comparison.rms_z).padEnd(5)} ${status.padEnd(5)} ${topFlags.join(', ')}`);
}
console.log();

// Most common flag
const flagCounts = {};
for (const { comparison } of results) {
  for (const f of comparison.flags) {
    if (f.severity === 'bad' || f.severity === 'critical') {
      flagCounts[f.key] = (flagCounts[f.key] ?? 0) + 1;
    }
  }
}
const topFlag = Object.entries(flagCounts).sort((a,b) => b[1]-a[1])[0];
if (topFlag) {
  const hints = adjustmentHints([{ key: topFlag[0], direction: 'low' }]);
  console.log(`Most common issue: ${topFlag[0]} (${topFlag[1]} frames)`);
  if (hints[0]) console.log(`  Hint: ${hints[0]}`);
  console.log();
}

// Reference distribution summary
console.log('Reference distribution (165 Goku frames):');
console.log('─'.repeat(56));
for (const key of BAND_KEYS) {
  const d = distribution[key];
  if (!d) continue;
  const bar = '█'.repeat(Math.round(d.mean * 20)) + '░'.repeat(20 - Math.round(d.mean * 20));
  console.log(`  ${key.replace('_ratio','').padEnd(14)} ${bar} ${(d.mean*100).toFixed(1)}% ±${(d.stddev*100).toFixed(1)}%`);
}
console.log();

// Per-frame verbose table
if (verbose) {
  console.log('Per-frame results:');
  console.log(`${'Frame'.padEnd(16)} rmsZ   Pass  Flags`);
  console.log('─'.repeat(60));
  for (const { name, comparison } of results) {
    const flags = comparison.flags.slice(0,3).map(f=>f.key.replace('_ratio','').slice(0,8)).join(',');
    console.log(`${name.padEnd(16)} ${String(comparison.rms_z).padEnd(6)} ${comparison.pass?'✓':'✗'}     ${flags}`);
  }
  console.log();
}

console.log(`Pipeline: ${n} frames evaluated against 165-frame Goku reference`);
console.log(`Date: ${new Date().toISOString().slice(0, 19)} UTC`);
