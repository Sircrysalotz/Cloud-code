/**
 * batch_eval.js — Phase 24: Batch evaluation engine.
 *
 * Evaluates a population of sprites in a single pass and returns ranked
 * results with per-metric breakdowns, z-scores, grades, and summary stats.
 *
 * This is the AI's search interface: generate N candidates, batch-evaluate,
 * pick the best, iterate.  All output is text-readable structured data.
 *
 * API:
 *   batchEval(candidates, distribution, opts) → BatchResult
 *   rankBatch(results, key)                   → sorted copy
 *   batchSummary(batchResult)                 → AI-readable summary object
 *   filterBatch(results, predicate)           → filtered subset
 */

import { runCleanup }         from '../cleanup/index.js';
import { computeMetrics }     from './metrics.js';
import { compareToReference } from './compare.js';
import { PALETTE }            from '../core/palette.js';

// Band keys used for rmsZ scoring (peak_ratio excluded from optimization target)
const BAND_KEYS = [
  'shadow_deep_ratio', 'shadow_ratio', 'mid_ratio',
  'bright_ratio', 'highlight_ratio',
];

// All metric keys (informational)
const ALL_METRIC_KEYS = [
  'shadow_deep_ratio', 'shadow_ratio', 'mid_ratio',
  'bright_ratio', 'highlight_ratio', 'peak_ratio',
  'symmetry_score', 'body_density',
];

// ── Band rmsZ ─────────────────────────────────────────────────────────────────

/**
 * Compute band-only rmsZ for a metrics object against the distribution.
 */
function computeBandRmsZ(metrics, distribution) {
  let sum2 = 0, n = 0;
  for (const k of BAND_KEYS) {
    const d = distribution[k];
    if (!d || d.stddev < 0.0001) continue;
    const z = (metrics[k] - d.mean) / d.stddev;
    sum2 += z * z;
    n++;
  }
  return n > 0 ? Math.sqrt(sum2 / n) : 0;
}

// ── Grade from rmsZ ───────────────────────────────────────────────────────────

const GRADE_CUTOFFS = [
  { max: 0.5,  grade: 'S' },
  { max: 1.0,  grade: 'A' },
  { max: 1.5,  grade: 'B' },
  { max: 2.5,  grade: 'C' },
  { max: Infinity, grade: 'D' },
];

function gradeFromRmsZ(rmsZ) {
  return GRADE_CUTOFFS.find(c => rmsZ <= c.max)?.grade ?? 'D';
}

// ── batchEval ─────────────────────────────────────────────────────────────────

/**
 * Evaluate a population of sprite candidates.
 *
 * @param {Candidate[]} candidates
 *   Each candidate: { id, grid, palette? }
 *   If palette is omitted, PALETTE (default) is used.
 *
 * @param {object} distribution    — reference distribution (from loadBatchReference)
 * @param {object} [opts]
 * @param {boolean} opts.runCleanup  — run 9-pass cleanup before eval (default true)
 * @param {boolean} opts.zScores     — include per-metric z-scores in output (default true)
 *
 * @returns {EvalResult[]}
 *   Each result: { id, metrics, bandRmsZ, grade, pass, zScores?, grid }
 */
export function batchEval(candidates, distribution, opts = {}) {
  const { runCleanup: doCleanup = true, zScores: includeZ = true } = opts;

  return candidates.map(candidate => {
    const palette = candidate.palette ?? PALETTE;
    let grid = candidate.grid;

    if (doCleanup) {
      const cleaned = runCleanup(grid);
      grid = cleaned.grid ?? cleaned;
    }

    const metrics   = computeMetrics(grid, palette);
    const bandRmsZ  = +computeBandRmsZ(metrics, distribution).toFixed(4);
    const grade     = gradeFromRmsZ(bandRmsZ);
    const pass      = bandRmsZ < 1.5;

    let zScores = null;
    if (includeZ) {
      zScores = {};
      for (const k of ALL_METRIC_KEYS) {
        const d = distribution[k];
        if (d && d.stddev > 0.0001) {
          zScores[k] = +((metrics[k] - d.mean) / d.stddev).toFixed(3);
        } else {
          zScores[k] = null;
        }
      }
    }

    return {
      id:       candidate.id,
      metrics,
      bandRmsZ,
      grade,
      pass,
      zScores,
      grid,
    };
  });
}

// ── rankBatch ─────────────────────────────────────────────────────────────────

/**
 * Sort batch results by a key (ascending by default).
 *
 * @param {EvalResult[]} results
 * @param {string}       [key]       — field to sort by (default 'bandRmsZ')
 * @param {boolean}      [descending]
 * @returns {EvalResult[]}  — sorted copy (original unchanged)
 */
export function rankBatch(results, key = 'bandRmsZ', descending = false) {
  const sorted = results.slice().sort((a, b) => {
    const va = a[key] ?? a.metrics?.[key] ?? 0;
    const vb = b[key] ?? b.metrics?.[key] ?? 0;
    return descending ? vb - va : va - vb;
  });
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ── filterBatch ───────────────────────────────────────────────────────────────

/**
 * Filter batch results by a predicate.
 *
 * @param {EvalResult[]} results
 * @param {Function}     predicate  — (result) => boolean
 * @returns {EvalResult[]}
 */
export function filterBatch(results, predicate) {
  return results.filter(predicate);
}

// ── batchSummary ──────────────────────────────────────────────────────────────

/**
 * Build an AI-readable summary of a batch evaluation.
 *
 * @param {EvalResult[]} results
 * @returns {object}
 */
export function batchSummary(results) {
  const n = results.length;
  if (n === 0) {
    return {
      count: 0, passCount: 0, passRate: 0,
      meanBandRmsZ: 0, minBandRmsZ: 0, maxBandRmsZ: 0,
      gradeDistribution: {},
      bestId: null, worstId: null,
    };
  }

  const rmsZs    = results.map(r => r.bandRmsZ);
  const passCount = results.filter(r => r.pass).length;
  const mean     = rmsZs.reduce((a, b) => a + b, 0) / n;
  const minRmsZ  = Math.min(...rmsZs);
  const maxRmsZ  = Math.max(...rmsZs);

  const gradeDistribution = {};
  for (const r of results) {
    gradeDistribution[r.grade] = (gradeDistribution[r.grade] ?? 0) + 1;
  }

  const best  = results.reduce((a, b) => a.bandRmsZ < b.bandRmsZ ? a : b);
  const worst = results.reduce((a, b) => a.bandRmsZ > b.bandRmsZ ? a : b);

  // Per-metric means
  const metricMeans = {};
  for (const k of ALL_METRIC_KEYS) {
    metricMeans[k] = +(results.reduce((s, r) => s + (r.metrics[k] ?? 0), 0) / n).toFixed(4);
  }

  return {
    count:            n,
    passCount,
    passRate:         +(passCount / n).toFixed(4),
    meanBandRmsZ:     +mean.toFixed(4),
    minBandRmsZ:      +minRmsZ.toFixed(4),
    maxBandRmsZ:      +maxRmsZ.toFixed(4),
    gradeDistribution,
    bestId:           best.id,
    worstId:          worst.id,
    metricMeans,
  };
}

/**
 * Return the top-N results from a ranked batch.
 *
 * @param {EvalResult[]} results  — already evaluated (need not be ranked)
 * @param {number}       n        — how many to return
 * @param {string}       [key]    — sort key (default 'bandRmsZ', lower=better)
 * @returns {EvalResult[]}
 */
export function topN(results, n, key = 'bandRmsZ') {
  return rankBatch(results, key, false).slice(0, n);
}
