/**
 * search.js — Phase 25: Search strategy engine.
 *
 * Higher-level search patterns that compose with batchEval and
 * optimizeThresholds to find well-calibrated sprite parameters.
 *
 * Strategies:
 *   randomRestart  — try N random starting points, keep best
 *   hillClimb      — greedy single-parameter perturbation
 *   beamSearch     — maintain top-K beam, perturb each each step
 *   multiStart     — restart from multiple preset seeds
 *
 * All strategies emit a structured log so the AI can reason about the
 * search trajectory, not just the final result.
 */

import { buildFromParams }    from './parametric.js';
import { runCleanup }         from '../cleanup/index.js';
import { computeMetrics }     from '../eval/metrics.js';
import { PALETTE }            from '../core/palette.js';
import { projectThresholds }  from './optimizer.js';

// ── Objective function ────────────────────────────────────────────────────────

const BAND_KEYS = [
  'shadow_deep_ratio','shadow_ratio','mid_ratio',
  'bright_ratio','highlight_ratio',
];

const TH_MIN = 0.05;
const TH_MAX = 0.95;

/**
 * Evaluate params against distribution → band rmsZ.
 */
function evalParams(params, distribution) {
  const rawGrid = buildFromParams(params);
  const { grid } = runCleanup(rawGrid);
  const metrics  = computeMetrics(grid, PALETTE);

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

/**
 * Perturb thresholds by small random steps.
 */
function perturbThresholds(thresholds, stepSize = 0.05) {
  const t = thresholds.map(v => v + (Math.random() * 2 - 1) * stepSize);
  return projectThresholds(t);
}

/**
 * Generate a random valid threshold vector.
 */
function randomThresholds() {
  const raw = Array.from({ length: 5 }, () => TH_MIN + Math.random() * (TH_MAX - TH_MIN));
  return projectThresholds(raw.sort((a, b) => a - b));
}

// ── randomRestart ─────────────────────────────────────────────────────────────

/**
 * Try N random starting threshold vectors, evaluate each, return the best.
 *
 * @param {object}  baseParams    — pose params (thresholds overridden each trial)
 * @param {object}  distribution
 * @param {object}  [opts]
 * @param {number}  opts.trials   — number of random starts (default 10)
 * @param {number}  opts.target   — early-stop if rmsZ < target (default 0.5)
 * @returns {{ bestParams, bestRmsZ, trials, log }}
 */
export function randomRestart(baseParams, distribution, opts = {}) {
  const { trials = 10, target = 0.5 } = opts;

  let bestParams = baseParams;
  let bestRmsZ   = evalParams(baseParams, distribution);
  const log      = [{ trial: 0, rmsZ: +bestRmsZ.toFixed(4), thresholds: baseParams.thresholds.slice() }];

  for (let i = 1; i <= trials; i++) {
    const thresholds = randomThresholds();
    const params     = { ...baseParams, thresholds };
    const rmsZ       = evalParams(params, distribution);
    log.push({ trial: i, rmsZ: +rmsZ.toFixed(4), thresholds: thresholds.slice() });

    if (rmsZ < bestRmsZ) {
      bestRmsZ   = rmsZ;
      bestParams = params;
    }

    if (bestRmsZ < target) break;
  }

  return {
    bestParams,
    bestRmsZ:  +bestRmsZ.toFixed(4),
    trials:    log.length - 1,
    converged: bestRmsZ < target,
    log,
  };
}

// ── hillClimb ─────────────────────────────────────────────────────────────────

/**
 * Greedy hill climbing: try random perturbations of the current best,
 * accept any improvement, stop when no improvement found in patience steps.
 *
 * @param {object}  baseParams
 * @param {object}  distribution
 * @param {object}  [opts]
 * @param {number}  opts.maxSteps  — max perturbation attempts (default 50)
 * @param {number}  opts.stepSize  — threshold step magnitude (default 0.05)
 * @param {number}  opts.patience  — steps without improvement before stopping (default 10)
 * @param {number}  opts.target    — early-stop threshold (default 0.5)
 * @returns {{ bestParams, bestRmsZ, steps, converged, log }}
 */
export function hillClimb(baseParams, distribution, opts = {}) {
  const { maxSteps = 50, stepSize = 0.05, patience = 10, target = 0.5 } = opts;

  let current  = baseParams;
  let currentZ = evalParams(current, distribution);
  const log    = [{ step: 0, rmsZ: +currentZ.toFixed(4), improved: false }];

  let noImpCount = 0;

  for (let step = 1; step <= maxSteps; step++) {
    const thresholds = perturbThresholds(current.thresholds, stepSize);
    const candidate  = { ...current, thresholds };
    const z          = evalParams(candidate, distribution);
    const improved   = z < currentZ;

    log.push({ step, rmsZ: +z.toFixed(4), improved });

    if (improved) {
      current    = candidate;
      currentZ   = z;
      noImpCount = 0;
    } else {
      noImpCount++;
    }

    if (currentZ < target || noImpCount >= patience) break;
  }

  return {
    bestParams: current,
    bestRmsZ:   +currentZ.toFixed(4),
    steps:      log.length - 1,
    converged:  currentZ < target,
    log,
  };
}

// ── beamSearch ────────────────────────────────────────────────────────────────

/**
 * Beam search: maintain a beam of K candidates, expand each by generating
 * M perturbations, keep the top K, repeat for maxIter rounds.
 *
 * @param {object}  baseParams
 * @param {object}  distribution
 * @param {object}  [opts]
 * @param {number}  opts.beamWidth    — beam size K (default 3)
 * @param {number}  opts.expand       — perturbations per beam member (default 4)
 * @param {number}  opts.maxIter      — rounds (default 10)
 * @param {number}  opts.stepSize     — perturbation magnitude (default 0.06)
 * @param {number}  opts.target       — early-stop (default 0.5)
 * @returns {{ bestParams, bestRmsZ, iter, converged, beam, log }}
 */
export function beamSearch(baseParams, distribution, opts = {}) {
  const {
    beamWidth = 3, expand = 4, maxIter = 10,
    stepSize = 0.06, target = 0.5,
  } = opts;

  // Seed beam with base params + random variants
  let beam = [{ params: baseParams, rmsZ: evalParams(baseParams, distribution) }];
  while (beam.length < beamWidth) {
    const thresholds = randomThresholds();
    const params     = { ...baseParams, thresholds };
    beam.push({ params, rmsZ: evalParams(params, distribution) });
  }
  beam.sort((a, b) => a.rmsZ - b.rmsZ);

  const log = [{ iter: 0, beamRmsZs: beam.map(b => +b.rmsZ.toFixed(4)) }];
  let iter  = 0;

  for (iter = 1; iter <= maxIter; iter++) {
    // Expand each beam member
    const candidates = [...beam];
    for (const member of beam) {
      for (let e = 0; e < expand; e++) {
        const thresholds = perturbThresholds(member.params.thresholds, stepSize);
        const params     = { ...baseParams, thresholds };
        const rmsZ       = evalParams(params, distribution);
        candidates.push({ params, rmsZ });
      }
    }

    // Keep top K
    candidates.sort((a, b) => a.rmsZ - b.rmsZ);
    beam = candidates.slice(0, beamWidth);

    log.push({ iter, beamRmsZs: beam.map(b => +b.rmsZ.toFixed(4)) });

    if (beam[0].rmsZ < target) break;
  }

  const best = beam[0];
  return {
    bestParams: best.params,
    bestRmsZ:   +best.rmsZ.toFixed(4),
    iter,
    converged:  best.rmsZ < target,
    beam:       beam.map(b => ({ rmsZ: +b.rmsZ.toFixed(4), thresholds: b.params.thresholds.slice() })),
    log,
  };
}

// ── multiStart ────────────────────────────────────────────────────────────────

/**
 * Run hill climbing from multiple preset threshold seeds and return the
 * best result across all starts.
 *
 * Seeds are the five preset distributions:
 *   uniform, low, mid, high, spread
 *
 * @param {object}  baseParams
 * @param {object}  distribution
 * @param {object}  [opts]       — passed through to hillClimb
 * @returns {{ bestParams, bestRmsZ, seedResults, log }}
 */
export function multiStart(baseParams, distribution, opts = {}) {
  const SEEDS = [
    [0.15, 0.30, 0.50, 0.65, 0.80],  // uniform
    [0.10, 0.20, 0.30, 0.40, 0.50],  // low
    [0.30, 0.45, 0.55, 0.68, 0.80],  // mid
    [0.50, 0.60, 0.70, 0.80, 0.90],  // high
    [0.10, 0.30, 0.55, 0.75, 0.90],  // spread
  ];

  const seedResults = SEEDS.map((rawSeed, i) => {
    const seed   = projectThresholds(rawSeed);
    const params = { ...baseParams, thresholds: seed };
    return { seedIndex: i, ...hillClimb(params, distribution, opts) };
  });

  const best = seedResults.reduce((a, b) => a.bestRmsZ < b.bestRmsZ ? a : b);

  return {
    bestParams: best.bestParams,
    bestRmsZ:   best.bestRmsZ,
    seedResults,
    log:        seedResults.map(r => ({ seedIndex: r.seedIndex, finalRmsZ: r.bestRmsZ, steps: r.steps })),
  };
}
