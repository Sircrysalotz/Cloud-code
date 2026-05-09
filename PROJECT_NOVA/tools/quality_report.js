#!/usr/bin/env node
/**
 * quality_report.js — Phase 13: Pipeline quality report.
 *
 * Quantifies how close generated sprites are to real ingested Goku frames.
 * Evaluates all 5 warrior poses and compares against:
 *   - The Goku reference distribution (z-scores)
 *   - The ingested frames themselves (how does generated stack up vs real?)
 *
 * Usage:
 *   node tools/quality_report.js
 *   node tools/quality_report.js --verbose   (per-metric z rows)
 *   node tools/quality_report.js --ascii     (ASCII side-by-side)
 *
 * Output: structured report to stdout + exports/quality_report.json
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname }    from 'path';
import { fileURLToPath }    from 'url';
import { PALETTE, paletteFromRGB } from '../src/core/palette.js';
import { runCleanup }       from '../src/cleanup/index.js';
import { computeMetrics }   from '../src/eval/metrics.js';
import { compareToReference } from '../src/eval/compare.js';
import { loadBatchReference } from '../src/eval/reference_lib.js';
import { gridToAscii }      from '../src/core/ascii.js';
import { loadOrGeneratePose } from './generate_animation.js';
import { POSE_NAMES }       from '../src/authoring/poses.js';

const __dir    = dirname(fileURLToPath(import.meta.url));
const BATCH    = join(__dir, '..', 'exports', 'batch');
const EXPORTS  = join(__dir, '..', 'exports');
const MAX_PAL  = 40;

const BAND_KEYS = [
  'shadow_deep_ratio','shadow_ratio','mid_ratio',
  'bright_ratio','highlight_ratio','peak_ratio',
];

// ── Core evaluation functions ─────────────────────────────────────────────────

/**
 * Evaluate a grid against the Goku reference distribution.
 * Returns metrics, band rmsZ, full rmsZ, and the full comparison result.
 *
 * @param {Uint8Array[]} grid
 * @param {object}       palette
 * @param {object}       distribution  — from loadBatchReference().distribution
 * @returns {{ metrics, bandRmsZ, fullRmsZ, comparison }}
 */
export function evaluateGridAgainstRef(grid, palette, distribution) {
  const metrics    = computeMetrics(grid, palette);
  const comparison = compareToReference(metrics, distribution);
  const bandRmsZ   = computeBandRmsZ(comparison.results);
  return { metrics, bandRmsZ, fullRmsZ: comparison.rms_z, comparison };
}

/**
 * Compute band-only rmsZ from a comparison.results object.
 */
export function computeBandRmsZ(results) {
  let sum = 0, n = 0;
  for (const k of BAND_KEYS) {
    const r = results[k];
    if (r && typeof r.z === 'number') { sum += r.z * r.z; n++; }
  }
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

/**
 * Compute band rmsZ statistics from an array of ingested frame grids.
 * Samples up to `maxFrames` frames for speed.
 *
 * @param {string[]} frameNames  — base names from exports/batch/
 * @param {object}   distribution
 * @param {number}   [maxFrames=50]
 * @returns {{ mean, stddev, min, max, count, values: number[] }}
 */
export function buildIngestedStats(frameNames, distribution, maxFrames = 50) {
  const step   = Math.max(1, Math.floor(frameNames.length / maxFrames));
  const sample = frameNames.filter((_, i) => i % step === 0).slice(0, maxFrames);
  const values = [];

  for (const name of sample) {
    try {
      const gridRaw = JSON.parse(readFileSync(join(BATCH, `${name}_grid.json`), 'utf8'));
      const palRaw  = JSON.parse(readFileSync(join(BATCH, `${name}_palette.json`), 'utf8'));
      const palette = paletteFromRGB(palRaw);
      const grid    = gridRaw.data.map(row => new Uint8Array(row));
      const { grid: clean } = runCleanup(grid, palette);
      const { bandRmsZ } = evaluateGridAgainstRef(clean, palette, distribution);
      values.push(bandRmsZ);
    } catch { /* skip bad frames */ }
  }

  if (values.length === 0) return { mean: 0, stddev: 0, min: 0, max: 0, count: 0, values };
  const mean   = values.reduce((s, v) => s + v, 0) / values.length;
  const stddev = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return { mean, stddev, min: Math.min(...values), max: Math.max(...values), count: values.length, values };
}

/**
 * Compute a generation quality assessment.
 *
 * @param {number[]} generatedBandRmsZs — one per generated pose
 * @param {{ mean, stddev }} referenceStats — from buildIngestedStats
 * @returns {{ genMean, refMean, ratio, grade, verdict }}
 */
export function computeGenerationQuality(generatedBandRmsZs, referenceStats) {
  if (generatedBandRmsZs.length === 0) {
    return { genMean: 0, refMean: 0, ratio: 1, grade: 'unknown', verdict: 'no generated poses' };
  }
  const genMean = generatedBandRmsZs.reduce((s, v) => s + v, 0) / generatedBandRmsZs.length;
  const refMean = referenceStats.mean || 1;
  const ratio   = genMean / refMean;

  let grade, verdict;
  if (ratio <= 0.85)        { grade = 'S'; verdict = 'EXCEPTIONAL — generated beats ingested average'; }
  else if (ratio <= 1.00)   { grade = 'A'; verdict = 'EXCELLENT — generated within ingested distribution'; }
  else if (ratio <= 1.20)   { grade = 'B'; verdict = 'GOOD — generated slightly above ingested average'; }
  else if (ratio <= 1.50)   { grade = 'C'; verdict = 'FAIR — notable gap from ingested distribution'; }
  else                      { grade = 'D'; verdict = 'NEEDS WORK — significant gap from ingested distribution'; }

  return { genMean, refMean, ratio, grade, verdict };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const __isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (__isMain) {
  const args    = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const ascii   = args.includes('--ascii');

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  PROJECT NOVA — Phase 13: Pipeline Quality Report       ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Load reference
  const ref = loadBatchReference();
  if (!ref) { console.error('No batch reference. Run: python3 tools/batch_ingest.py'); process.exit(1); }
  const { distribution } = ref;

  // Load ingested frame names
  const frameNames = existsSync(BATCH)
    ? readdirSync(BATCH)
        .filter(f => f.endsWith('_palette.json'))
        .map(f => f.replace('_palette.json', ''))
        .filter(name => {
          try { return JSON.parse(readFileSync(join(BATCH, `${name}_palette.json`), 'utf8')).length <= MAX_PAL; }
          catch { return false; }
        })
        .sort()
    : [];

  // ── Evaluate generated poses ───────────────────────────────────────────────

  console.log(`  Evaluating ${POSE_NAMES.length} generated poses...`);
  const poseResults = [];

  for (const poseName of POSE_NAMES) {
    process.stdout.write(`    ${poseName.padEnd(12)}`);
    const grid = loadOrGeneratePose(poseName, distribution, { maxIter: 20 });
    const result = evaluateGridAgainstRef(grid, PALETTE, distribution);
    poseResults.push({ name: poseName, grid, ...result });
    console.log(`band_rmsZ=${result.bandRmsZ.toFixed(3)}  full_rmsZ=${result.fullRmsZ.toFixed(3)}`);
  }

  // ── Sample ingested frames for comparison ─────────────────────────────────

  if (frameNames.length > 0) {
    process.stdout.write(`\n  Sampling ${Math.min(frameNames.length, 50)} ingested frames...`);
  }
  const ingestedStats = buildIngestedStats(frameNames, distribution, 50);
  if (frameNames.length > 0) console.log(` done (${ingestedStats.count} frames)`);

  // ── Quality assessment ─────────────────────────────────────────────────────

  const genRmsZs = poseResults.map(r => r.bandRmsZ);
  const quality  = computeGenerationQuality(genRmsZs, ingestedStats);

  // ── Print report ───────────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(60));
  console.log('  GENERATED POSES vs GOKU DISTRIBUTION');
  console.log('─'.repeat(60));

  const bandLabels = ['sdp','sha','mid','brt','hlt','pk'];
  console.log(`\n  ${'Pose'.padEnd(12)} ${'band_Z'.padEnd(8)} ${'full_Z'.padEnd(8)} ${bandLabels.map(l => l.padStart(6)).join('')}`);
  console.log('  ' + '─'.repeat(56));

  for (const r of poseResults) {
    const zRow = BAND_KEYS.map(k => {
      const z = r.comparison.results[k]?.z ?? 0;
      const s = (z >= 0 ? '+' : '') + z.toFixed(1) + 'σ';
      return s.padStart(6);
    }).join('');
    const flag = r.bandRmsZ < 1.0 ? '✓' : r.bandRmsZ < 1.5 ? '~' : '✗';
    console.log(`  ${r.name.padEnd(12)} ${flag} ${r.bandRmsZ.toFixed(3).padEnd(7)} ${r.fullRmsZ.toFixed(3).padEnd(7)}${zRow}`);
  }

  if (ingestedStats.count > 0) {
    console.log('\n' + '─'.repeat(60));
    console.log('  INGESTED FRAMES BASELINE');
    console.log('─'.repeat(60));
    console.log(`\n  Frames sampled:  ${ingestedStats.count}`);
    console.log(`  Band rmsZ mean:  ${ingestedStats.mean.toFixed(3)}`);
    console.log(`  Band rmsZ σ:     ${ingestedStats.stddev.toFixed(3)}`);
    console.log(`  Band rmsZ range: ${ingestedStats.min.toFixed(3)} – ${ingestedStats.max.toFixed(3)}`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log('  GENERATION QUALITY');
  console.log('─'.repeat(60));
  console.log(`\n  Generated mean band_rmsZ: ${quality.genMean.toFixed(3)}`);
  if (ingestedStats.count > 0) {
    console.log(`  Ingested  mean band_rmsZ: ${quality.refMean.toFixed(3)}`);
    console.log(`  Quality ratio:            ${quality.ratio.toFixed(3)}  (lower is better)`);
  }
  console.log(`\n  Grade:   ${quality.grade}`);
  console.log(`  Verdict: ${quality.verdict}`);

  // ── Verbose: per-metric z-score table ────────────────────────────────────

  if (verbose) {
    console.log('\n' + '─'.repeat(60));
    console.log('  PER-METRIC Z-SCORES');
    console.log('─'.repeat(60));
    const allKeys = [...BAND_KEYS, 'symmetry_score', 'body_density'];
    const header  = 'Metric'.padEnd(30) + POSE_NAMES.map(n => n.slice(0,7).padStart(9)).join('');
    console.log('\n  ' + header);
    console.log('  ' + '─'.repeat(header.length));
    for (const k of allKeys) {
      const row = POSE_NAMES.map((_, i) => {
        const z = poseResults[i]?.comparison.results[k]?.z ?? 0;
        return ((z >= 0 ? '+' : '') + z.toFixed(2)).padStart(9);
      }).join('');
      console.log(`  ${k.padEnd(30)}${row}`);
    }
  }

  // ── ASCII side-by-side ────────────────────────────────────────────────────

  if (ascii && poseResults.length > 0 && frameNames.length > 0) {
    console.log('\n' + '─'.repeat(60));
    console.log('  ASCII COMPARISON: generated idle vs real Goku frame');
    console.log('─'.repeat(60));
    try {
      const genGrid = poseResults[0].grid;
      const rName   = frameNames[Math.floor(frameNames.length / 2)];
      const rGridRaw = JSON.parse(readFileSync(join(BATCH, `${rName}_grid.json`), 'utf8'));
      const rPalRaw  = JSON.parse(readFileSync(join(BATCH, `${rName}_palette.json`), 'utf8'));
      const rPalette = paletteFromRGB(rPalRaw);
      const rGrid    = rGridRaw.data.map(row => new Uint8Array(row));
      const genAscii = gridToAscii(genGrid, PALETTE).split('\n');
      const refAscii = gridToAscii(rGrid, rPalette).split('\n');
      const maxRows  = Math.max(genAscii.length, refAscii.length);
      const maxGenW  = Math.max(...genAscii.map(l => l.length));
      console.log('\n  Generated idle' + ' '.repeat(maxGenW - 14 + 4) + `Real Goku (${rName})`);
      for (let r = 0; r < maxRows; r++) {
        const gLine = (genAscii[r] ?? '').padEnd(maxGenW);
        const rLine = refAscii[r] ?? '';
        console.log(`  ${gLine}    ${rLine}`);
      }
    } catch (e) { console.log(`  (ASCII comparison unavailable: ${e.message})`); }
  }

  // ── JSON export ───────────────────────────────────────────────────────────

  const reportData = {
    generated_at: new Date().toISOString(),
    poses: poseResults.map(r => ({
      name:       r.name,
      band_rmsZ:  +r.bandRmsZ.toFixed(4),
      full_rmsZ:  +r.fullRmsZ.toFixed(4),
      metrics:    r.metrics,
      z_scores:   Object.fromEntries(
        Object.entries(r.comparison.results).map(([k, v]) => [k, v.z])
      ),
    })),
    ingested_baseline: ingestedStats.count > 0 ? {
      count:  ingestedStats.count,
      mean:   +ingestedStats.mean.toFixed(4),
      stddev: +ingestedStats.stddev.toFixed(4),
      min:    +ingestedStats.min.toFixed(4),
      max:    +ingestedStats.max.toFixed(4),
    } : null,
    quality: {
      gen_mean:  +quality.genMean.toFixed(4),
      ref_mean:  +quality.refMean.toFixed(4),
      ratio:     +quality.ratio.toFixed(4),
      grade:     quality.grade,
      verdict:   quality.verdict,
    },
  };
  writeFileSync(join(EXPORTS, 'quality_report.json'), JSON.stringify(reportData, null, 2));
  console.log('\n  quality_report.json written\n');

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log(`║  Grade ${quality.grade}  —  ${quality.verdict.padEnd(48)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
}
