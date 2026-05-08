#!/usr/bin/env node
/**
 * eval_goku.js — Evaluate any ingested Goku frame against the reference distribution.
 *
 * Loads a frame's grid + palette from exports/batch/, runs cleanup,
 * computes metrics, z-scores against the 165-frame Goku reference, and prints:
 *   - ASCII grid (before + after cleanup)
 *   - Metric table with z-scores
 *   - Adjustment hints for out-of-range metrics
 *   - Overall pass/fail + rmsZ
 *
 * Usage:
 *   node tools/eval_goku.js                    # random frame
 *   node tools/eval_goku.js frame_0004         # specific frame
 *   node tools/eval_goku.js --all              # evaluate all frames, print summary
 *   node tools/eval_goku.js --worst 10         # show 10 worst-scoring frames
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname }             from 'path';
import { fileURLToPath }             from 'url';
import { paletteFromRGB }            from '../src/core/palette.js';
import { gridToAscii }               from '../src/core/ascii.js';
import { runCleanup }                from '../src/cleanup/index.js';
import { computeMetrics }            from '../src/eval/metrics.js';
import { compareToReference, adjustmentHints } from '../src/eval/compare.js';
import { loadBatchReference }        from '../src/eval/reference_lib.js';

const __dir  = dirname(fileURLToPath(import.meta.url));
const BATCH  = join(__dir, '..', 'exports', 'batch');

// ── Load helpers ──────────────────────────────────────────────────────────────

function loadFrame(name) {
  const gridData    = JSON.parse(readFileSync(join(BATCH, `${name}_grid.json`),    'utf8'));
  const paletteData = JSON.parse(readFileSync(join(BATCH, `${name}_palette.json`), 'utf8'));
  const palette     = paletteFromRGB(paletteData);
  const grid        = gridData.data.map(row => Array.isArray(row) ? [...row] : Object.values(row).map(Number));
  return { name, grid, palette, gridData };
}

// Max palette size for a clean sprite frame (contaminated frames have 40-100+ colors)
const MAX_PALETTE_SIZE = 40;

function listFrameNames() {
  return readdirSync(BATCH)
    .filter(f => f.endsWith('_palette.json'))
    .map(f => f.replace('_palette.json', ''))
    .filter(name => {
      try {
        const p = JSON.parse(readFileSync(join(BATCH, `${name}_palette.json`), 'utf8'));
        return p.length <= MAX_PALETTE_SIZE;
      } catch { return false; }
    })
    .sort();
}

// ── Eval a single frame ───────────────────────────────────────────────────────

function evalFrame(name, distribution, { verbose = true } = {}) {
  const { grid: rawGrid, palette, gridData } = loadFrame(name);
  const { grid: cleanGrid } = runCleanup(rawGrid, palette);
  const metrics    = computeMetrics(cleanGrid, palette);
  const comparison = compareToReference(metrics, distribution);
  const hints      = adjustmentHints(comparison.flags);

  if (!verbose) return { name, metrics, comparison };

  const w = gridData.width, h = gridData.height;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Frame: ${name}  (${w}×${h})  palette: ${palette.colors.length} colors`);
  if (gridData.accuracy) {
    console.log(`Ingest accuracy: ${gridData.accuracy.exact_pct}%  mean Δ=${gridData.accuracy.mean_color_error}`);
  }

  // ASCII: before cleanup (left) and after (right) side by side if narrow enough
  if (w <= 30) {
    const rawLines   = gridToAscii(rawGrid,   palette).split('\n');
    const cleanLines = gridToAscii(cleanGrid, palette).split('\n');
    const maxLines   = Math.max(rawLines.length, cleanLines.length);
    console.log(`\nRaw${' '.repeat(w - 3)}  Cleaned`);
    for (let i = 0; i < maxLines; i++) {
      const l = rawLines[i]   ?? ' '.repeat(w);
      const r = cleanLines[i] ?? ' '.repeat(w);
      console.log(`${l}  ${r}`);
    }
  } else {
    console.log('\n[Cleaned ASCII]');
    console.log(gridToAscii(cleanGrid, palette));
  }

  // Metric table
  console.log('\nMetric                   Actual   Mean     σ        Z');
  console.log('─'.repeat(56));
  const BAND_KEYS = ['shadow_deep_ratio','shadow_ratio','mid_ratio','bright_ratio','highlight_ratio','peak_ratio'];
  const STRUCT_KEYS = ['symmetry_score','outline_thickness_variance','unique_body_colors','body_density'];
  for (const key of [...BAND_KEYS, ...STRUCT_KEYS]) {
    const r = comparison.results[key];
    if (!r) continue;
    const sev   = r.severity !== 'ok' ? ` ← ${r.severity.toUpperCase()}` : '';
    const label = key.padEnd(24);
    console.log(`${label} ${fmt(r.actual)} ${fmt(r.mean)} ${fmt(r.stddev)} ${fmtZ(r.z)}${sev}`);
  }

  console.log(`\nrmsZ: ${comparison.rms_z}  →  ${comparison.summary}`);

  if (hints.length) {
    console.log('\nHints:');
    hints.forEach(h => console.log(`  • ${h}`));
  }

  return { name, metrics, comparison };
}

// ── All-frames report ─────────────────────────────────────────────────────────

function evalAll(distribution, { worst = 0 } = {}) {
  const names   = listFrameNames();
  const results = [];
  let pass = 0, fail = 0;

  process.stdout.write(`Evaluating ${names.length} frames...`);
  for (const name of names) {
    try {
      const r = evalFrame(name, distribution, { verbose: false });
      results.push(r);
      if (r.comparison.pass) pass++; else fail++;
    } catch { fail++; }
  }
  console.log(' done.\n');

  results.sort((a, b) => b.comparison.rms_z - a.comparison.rms_z);

  const showCount = worst > 0 ? worst : results.length;
  console.log(`${'Frame'.padEnd(16)} rmsZ   Status   Flags`);
  console.log('─'.repeat(60));
  for (const { name, comparison } of results.slice(0, showCount)) {
    const flagSummary = comparison.flags.slice(0, 3).map(f => f.key.replace('_ratio','').replace('_score','')).join(', ');
    const status = comparison.pass ? 'PASS' : 'FAIL';
    console.log(`${name.padEnd(16)} ${String(comparison.rms_z).padEnd(6)} ${status.padEnd(8)} ${flagSummary}`);
  }

  console.log(`\nTotal: ${names.length}  Pass: ${pass}  Fail: ${fail}  (${(pass/names.length*100).toFixed(1)}% pass rate)`);
  const rmsZs = results.map(r => r.comparison.rms_z);
  const mean  = rmsZs.reduce((a, b) => a + b, 0) / rmsZs.length;
  console.log(`rmsZ — mean: ${mean.toFixed(2)}  min: ${Math.min(...rmsZs).toFixed(2)}  max: ${Math.max(...rmsZs).toFixed(2)}`);
}

// ── Format helpers ────────────────────────────────────────────────────────────

function fmt(x)  { return x == null ? '  ---  ' : String(typeof x === 'number' ? x.toFixed(3) : x).padEnd(7); }
function fmtZ(z) { const s = z?.toFixed(2); return z == null ? '---' : (z > 0 ? `+${s}` : s); }

// ── Main ──────────────────────────────────────────────────────────────────────

const ref = loadBatchReference();
if (!ref) {
  console.error('No batch reference found. Run: python3 tools/batch_ingest.py');
  process.exit(1);
}
const { distribution } = ref;

const args  = process.argv.slice(2);
const all   = args.includes('--all');
const worst = (() => { const i = args.indexOf('--worst'); return i >= 0 ? parseInt(args[i+1]) : 0; })();

if (all || worst > 0) {
  evalAll(distribution, { worst });
} else {
  const names = listFrameNames();
  const name  = args.find(a => !a.startsWith('--')) ?? names[Math.floor(Math.random() * names.length)];
  evalFrame(name, distribution);
}
