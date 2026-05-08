#!/usr/bin/env node
/**
 * Auto-iteration loop.
 *
 * Generates a warrior sprite, evaluates it against the reference distribution,
 * applies parameter corrections from adjustment hints, and repeats until the
 * sprite passes (rmsZ below threshold) or the iteration budget is exhausted.
 *
 * Output:
 *   exports/warrior_tuned.png   — final result at 8x scale
 *   exports/warrior_tuned.json  — grid + metrics
 *   exports/tune_log.json       — per-iteration metrics for inspection
 */

import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath }            from 'url';
import { dirname, join }            from 'path';
import { IDX, PALETTE }             from '../src/core/palette.js';
import { asciiDump }                from '../src/core/ascii.js';
import { runCleanup }               from '../src/cleanup/index.js';
import { gridToPNG }                from '../src/export/png_writer.js';
import { evalGrid }                 from '../src/eval/compare.js';
import { defaultParams, badStartParams, buildFromParams, adjustParams } from '../src/authoring/parametric.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT   = join(__dir, '..', 'exports');
mkdirSync(OUT, { recursive: true });

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_ITER    = 20;
const TARGET_RMS  = 0.60;   // stop when rmsZ falls below this
const SCALE       = 8;

// ── Iteration loop ────────────────────────────────────────────────────────────

console.log('=== Auto-iteration loop ===');
console.log(`Target: rmsZ < ${TARGET_RMS}  |  Budget: ${MAX_ITER} iterations\n`);

const demo  = process.argv.includes('--demo');
let params  = demo ? badStartParams() : defaultParams();
if (demo) console.log('Demo mode: starting from imbalanced params\n');
const log  = [];
let bestGrid  = null;
let bestRmsZ  = Infinity;
let bestIter  = 0;

for (let iter = 0; iter < MAX_ITER; iter++) {
  // Generate + cleanup
  const rawGrid              = buildFromParams(params);
  const { grid: cleanGrid }  = runCleanup(rawGrid);

  // Evaluate
  const { metrics, comparison } = evalGrid(cleanGrid);
  const { rms_z, flags, pass: passed, summary } = comparison;

  log.push({
    iter,
    rms_z,
    pass: passed,
    thresholds: [...params.thresholds],
    flags: flags.map(f => `${f.metric}:${f.direction}:${f.severity}`),
  });

  const icon = passed ? '✓' : '✗';
  console.log(`iter ${String(iter).padStart(2)} ${icon}  rmsZ=${rms_z.toFixed(3)}  flags=${flags.length}  ${summary}`);

  if (rms_z < bestRmsZ) {
    bestRmsZ  = rms_z;
    bestGrid  = cleanGrid;
    bestIter  = iter;
  }

  if (passed && rms_z < TARGET_RMS) {
    console.log(`\n  Converged at iter ${iter}.`);
    break;
  }

  if (flags.length === 0) {
    // Pass but above TARGET_RMS — nothing to adjust, stop early
    console.log(`\n  No flags at iter ${iter} (rmsZ=${rms_z.toFixed(3)}). Stopping.`);
    break;
  }

  // Adjust params for next iteration
  params = adjustParams(params, flags);
}

console.log(`\nBest: iter=${bestIter}  rmsZ=${bestRmsZ.toFixed(3)}`);

// ── ASCII dump of best result ─────────────────────────────────────────────────

console.log('\n' + asciiDump(bestGrid, 'warrior_tuned'));

// ── Export ────────────────────────────────────────────────────────────────────

const { W, H } = (() => { const [w, h] = [bestGrid[0].length, bestGrid.length]; return { W: w, H: h }; })();

writeFileSync(join(OUT, 'warrior_tuned.png'), gridToPNG(bestGrid, PALETTE, SCALE));
console.log(`\nPNG: exports/warrior_tuned.png  (${W * SCALE}×${H * SCALE}px)`);

const { metrics: finalMetrics, comparison: finalComp } = evalGrid(bestGrid);
const tuned = {
  id:      'warrior_tuned',
  source:  'auto_iterate',
  rms_z:   bestRmsZ,
  iter:    bestIter,
  tags:    ['warrior', 'humanoid', 'standing', 'crimson', 'tuned'],
  width:   W,
  height:  H,
  data:    bestGrid.map(row => Array.from(row)),
  metrics: finalMetrics,
  comparison: {
    rms_z:   finalComp.rms_z,
    pass:    finalComp.pass,
    summary: finalComp.summary,
    flags:   finalComp.flags,
  },
};
writeFileSync(join(OUT, 'warrior_tuned.json'), JSON.stringify(tuned, null, 2));
console.log('JSON: exports/warrior_tuned.json');

writeFileSync(join(OUT, 'tune_log.json'), JSON.stringify({ target: TARGET_RMS, iterations: log }, null, 2));
console.log('Log:  exports/tune_log.json');
