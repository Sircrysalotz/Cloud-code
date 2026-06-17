#!/usr/bin/env node
/**
 * goku_iterate.js — Phase 8: Goku-calibrated parametric iteration.
 *
 * Generates a warrior sprite and tunes its band-ratio distribution to match
 * the Goku reference (165-frame batch). Iterates threshold params until the
 * sprite's shadow/mid/bright/highlight distribution converges.
 *
 * BAND metrics (threshold-adjustable): shadow_deep, shadow, mid, bright, highlight
 * STRUCTURAL metrics (informational):  peak, symmetry, body_density
 *
 * Structural metrics are reported but don't block convergence — a standing
 * warrior is geometrically different from Goku's action poses.
 *
 * Usage:
 *   node tools/goku_iterate.js                  # default params, 30 iters
 *   node tools/goku_iterate.js --bad            # start from imbalanced params
 *   node tools/goku_iterate.js --max 50         # extend budget
 *   node tools/goku_iterate.js --target 0.40    # tighter threshold
 *   node tools/goku_iterate.js --scale 12       # output PNG scale (px/cell)
 *   node tools/goku_iterate.js --scale 4,8,16   # multiple scales
 *
 * Outputs:
 *   exports/goku_warrior.png        — best result
 *   exports/goku_warrior_4x.png     — thumbnail
 *   exports/goku_warrior.json       — metrics + iteration log
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath }             from 'url';
import { dirname, join }             from 'path';
import { PALETTE }                   from '../src/core/palette.js';
import { asciiDump }                 from '../src/core/ascii.js';
import { runCleanup }                from '../src/cleanup/index.js';
import { gridToPNG }                 from '../src/export/png_writer.js';
import { computeMetrics }            from '../src/eval/metrics.js';
import { compareToReference, adjustmentHints } from '../src/eval/compare.js';
import { loadBatchReference }        from '../src/eval/reference_lib.js';
import { defaultParams, badStartParams, buildFromParams, buildFromSilhouette, adjustParams } from '../src/authoring/parametric.js';

const __isMain = process.argv[1] === fileURLToPath(import.meta.url);

// ── Converging band metrics ───────────────────────────────────────────────────
// peak_ratio excluded: parametric warrior's gradient-based peak pixels are
// stripped by pass6_band_skip at body-part boundaries. Reported as structural.
const CONVERGE_BANDS = new Set([
  'shadow_deep_ratio', 'shadow_ratio', 'mid_ratio',
  'bright_ratio', 'highlight_ratio',
]);

export function bandRmsZ(results) {
  let sum2 = 0, n = 0;
  for (const [k, r] of Object.entries(results)) {
    if (CONVERGE_BANDS.has(k)) { sum2 += r.z * r.z; n++; }
  }
  return n > 0 ? Math.sqrt(sum2 / n) : 0;
}

// ── Core iteration loop ───────────────────────────────────────────────────────

/**
 * Run the Goku-calibrated iteration loop.
 *
 * @param {object}  params0       — starting parametric warrior params
 * @param {object}  distribution  — Goku reference distribution
 * @param {object}  opts
 * @param {number}  opts.maxIter
 * @param {number}  opts.targetRmsZ  — converge when band rmsZ falls below this
 * @param {boolean} opts.verbose
 * @returns {{ bestGrid, bestParams, bestBandRmsZ, log, converged }}
 */
export function runIteration(params0, distribution, opts = {}) {
  const { maxIter = 30, targetRmsZ = 0.50, verbose = false, silhouetteData = null } = opts;

  // Restrict distribution to converging bands
  const bandDist = {};
  for (const [k, v] of Object.entries(distribution)) {
    if (CONVERGE_BANDS.has(k)) bandDist[k] = v;
  }

  let params    = params0;
  let bestGrid  = null;
  let bestParams = null;
  let bestBandZ  = Infinity;
  let bestIter   = 0;
  let converged  = false;
  const log = [];

  for (let iter = 0; iter < maxIter; iter++) {
    const rawGrid             = silhouetteData
      ? buildFromSilhouette(silhouetteData, params)
      : buildFromParams(params);
    const { grid: cleanGrid } = runCleanup(rawGrid);
    const metrics             = computeMetrics(cleanGrid, PALETTE);

    // Full comparison (all metrics) + band-only rmsZ
    const fullComp  = compareToReference(metrics, distribution);
    const bandComp  = compareToReference(metrics, bandDist);
    const bRmsZ     = bandRmsZ(fullComp.results);
    const bandFlags = fullComp.flags.filter(f => CONVERGE_BANDS.has(f.key));
    const structFlags = fullComp.flags.filter(f => !CONVERGE_BANDS.has(f.key));

    log.push({
      iter,
      rms_z:      fullComp.rms_z,
      band_rms_z: +bRmsZ.toFixed(4),
      pass:       bandComp.pass,
      thresholds: [...params.thresholds],
      band_flags: bandFlags.map(f => `${f.key.replace('_ratio','')}:${f.direction}:${f.severity}`),
    });

    if (bRmsZ < bestBandZ) {
      bestBandZ  = bRmsZ;
      bestGrid   = cleanGrid;
      bestParams = params;
      bestIter   = iter;
    }

    const passIcon = bandComp.pass ? '✓' : '✗';
    const structInfo = structFlags.length
      ? `  [${structFlags.map(f => `${f.key.replace('_ratio','').replace('_score','')}:${f.direction[0]}`).join(' ')}]`
      : '';
    if (verbose) {
      process.stdout.write(
        `  ${String(iter).padStart(2)} ${passIcon}  band=${bRmsZ.toFixed(3)}` +
        `  full=${fullComp.rms_z.toFixed(3)}  flags=${bandFlags.length}${structInfo}\n`
      );
    }

    if (bandComp.pass && bRmsZ < targetRmsZ) {
      converged = true;
      if (verbose) process.stdout.write(`\n  Converged at iter ${iter}.\n`);
      break;
    }

    // When no hard flags but still above target, generate soft flags (|z|>1.0)
    // so adjustParams can continue nudging thresholds toward convergence.
    let adjustFlags = bandFlags;
    if (bandFlags.length === 0 && bRmsZ > targetRmsZ) {
      adjustFlags = Object.entries(fullComp.results)
        .filter(([k, r]) => CONVERGE_BANDS.has(k) && Math.abs(r.z) > 1.0)
        .map(([k, r]) => ({ key: k, direction: r.z > 0 ? 'high' : 'low', severity: 'warn' }));
    }
    if (adjustFlags.length === 0) break;
    params = adjustParams(params, adjustFlags);
  }

  return { bestGrid, bestParams, bestBandRmsZ: bestBandZ, bestIter, log, converged };
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (__isMain) {
  const args = process.argv.slice(2);
  const maxIter    = parseInt(args.find(a => a.startsWith('--max='))?.slice(6)    ?? '30');
  const targetRmsZ = parseFloat(args.find(a => a.startsWith('--target='))?.slice(9) ?? '0.50');
  const scaleArg   = args.find(a => a.startsWith('--scale='))?.slice(8) ?? '8';
  const scales     = scaleArg.split(',').map(Number).filter(Boolean);
  const badStart   = args.includes('--bad');
  const verbose    = args.includes('--verbose');
  const noTemplate = args.includes('--no-template');
  const templateArg = args.find(a => a.startsWith('--template='));
  const templateFrame = templateArg ? parseInt(templateArg.slice(11)) : 4;

  const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'exports');
  mkdirSync(OUT, { recursive: true });

  // ── Load Goku reference ─────────────────────────────────────────────────────
  const ref = loadBatchReference();
  if (!ref) {
    console.error('ERROR: No batch reference found.\nRun: python3 tools/batch_ingest.py');
    process.exit(1);
  }
  const { distribution } = ref;

  const startParams = badStart ? badStartParams() : defaultParams();
  const startLabel  = badStart ? 'imbalanced start' : 'default start';

  // Load silhouette template from a real Goku frame (default: frame 4)
  let silhouetteData = null;
  if (!noTemplate) {
    const frameId   = String(templateFrame).padStart(4, '0');
    const framePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'exports', 'batch', `frame_${frameId}_grid.json`);
    if (existsSync(framePath)) {
      silhouetteData = JSON.parse(readFileSync(framePath, 'utf8'));
    }
  }

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   PROJECT NOVA — Goku-Calibrated Iteration (Ph.8)   ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\n  Reference: ${ref.entries?.length ?? 0} Goku frames`);
  console.log(`  Start:     ${startLabel}`);
  console.log(`  Shape:     ${silhouetteData ? `frame_${String(templateFrame).padStart(4,'0')} silhouette (${silhouetteData.width}×${silhouetteData.height})` : 'parametric'}`);
  console.log(`  Target:    band rmsZ < ${targetRmsZ}`);
  console.log(`  Budget:    ${maxIter} iterations\n`);
  console.log('  Converging on: shadow_deep | shadow | mid | bright | highlight');
  console.log('  Structural (informational): peak | symmetry | body_density\n');

  const t0 = Date.now();
  const result = runIteration(startParams, distribution, { maxIter, targetRmsZ, verbose: true, silhouetteData });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const { bestGrid, bestParams, bestBandRmsZ, bestIter, log, converged } = result;
  const metrics = computeMetrics(bestGrid, PALETTE);
  const { results, flags, rms_z } = compareToReference(metrics, distribution);

  console.log('\n' + '─'.repeat(54));
  console.log(`  Best: iter=${bestIter}  band_rmsZ=${bestBandRmsZ.toFixed(3)}  full_rmsZ=${rms_z.toFixed(3)}`);
  console.log(`  Status: ${converged ? 'CONVERGED ✓' : `best at iter ${bestIter}`}  (${elapsed}s)`);

  // ── Reference comparison table ─────────────────────────────────────────────
  console.log('\n  Metric               Actual   Target   z-score');
  console.log('  ' + '─'.repeat(50));
  const BAND_KEYS = ['shadow_deep_ratio','shadow_ratio','mid_ratio','bright_ratio','highlight_ratio','peak_ratio'];
  for (const k of BAND_KEYS) {
    if (!results[k]) continue;
    const { actual, mean, z, severity } = results[k];
    const flag  = severity === 'ok' ? '  ' : severity === 'warn' ? '~ ' : severity === 'bad' ? '! ' : '!!';
    const conv  = CONVERGE_BANDS.has(k) ? '' : ' (struct)';
    const label = k.replace('_ratio','').padEnd(20);
    console.log(`  ${flag}${label} ${(actual*100).toFixed(1).padStart(5)}%  ${(mean*100).toFixed(1).padStart(5)}%  ${z >= 0 ? '+' : ''}${z.toFixed(2)}${conv}`);
  }

  // ── Hints ─────────────────────────────────────────────────────────────────
  const actionFlags = flags.filter(f => CONVERGE_BANDS.has(f.key) && f.severity !== 'warn');
  if (actionFlags.length > 0) {
    console.log('\n  Remaining hints:');
    for (const h of adjustmentHints(actionFlags)) console.log(`    → ${h}`);
  }

  // ── ASCII output ───────────────────────────────────────────────────────────
  console.log('\n' + asciiDump(bestGrid, 'goku_warrior'));

  // ── PNG export ─────────────────────────────────────────────────────────────
  for (const scale of scales) {
    const suffix = scale === scales[0] ? '' : `_${scale}x`;
    const path = join(OUT, `goku_warrior${suffix}.png`);
    writeFileSync(path, gridToPNG(bestGrid, PALETTE, scale));
    const W = bestGrid[0]?.length ?? 0, H = bestGrid.length;
    console.log(`  PNG: exports/goku_warrior${suffix}.png  (${W*scale}×${H*scale}px)`);
  }

  // ── JSON export ────────────────────────────────────────────────────────────
  const output = {
    id:           'goku_warrior',
    source:       'goku_iterate',
    converged,
    best_iter:    bestIter,
    band_rms_z:   +bestBandRmsZ.toFixed(4),
    full_rms_z:   rms_z,
    thresholds:   bestParams.thresholds,
    tags:         ['warrior', 'humanoid', 'standing', 'goku-calibrated'],
    width:        bestGrid[0].length,
    height:       bestGrid.length,
    data:         bestGrid.map(row => Array.from(row)),
    metrics,
    comparison:   { rms_z, pass: flags.filter(f => f.severity === 'bad' || f.severity === 'critical').length === 0,
                    flags: flags.map(f => ({ key: f.key, severity: f.severity, direction: f.direction, z: f.z })) },
    iterations:   log,
  };
  const jsonPath = join(OUT, 'goku_warrior.json');
  writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`  JSON: exports/goku_warrior.json`);
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(`║  ${converged ? 'Pipeline converged — sprite matches Goku style ✓' : 'Pipeline complete — best result exported          '} ║`);
  console.log('╚══════════════════════════════════════════════════════╝');
}
