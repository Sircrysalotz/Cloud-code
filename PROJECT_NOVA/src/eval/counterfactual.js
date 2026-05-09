/**
 * counterfactual.js — Phase 26: Counterfactual analysis.
 *
 * Given a sprite that scores poorly, answers: "what threshold changes
 * would most improve the score?" by computing:
 *
 *   1. Sensitivity: how much does each threshold affect each band metric?
 *      (finite-difference Jacobian in threshold space)
 *
 *   2. Gradient: which direction to move thresholds to reduce each z-score?
 *
 *   3. Prescription: a concrete action list ("increase threshold 2 by ~0.05
 *      to reduce shadow_ratio z-score from 2.1 to ~1.0")
 *
 * All output is text-readable structured data.
 */

import { buildFromParams }    from '../authoring/parametric.js';
import { runCleanup }         from '../cleanup/index.js';
import { computeMetrics }     from './metrics.js';
import { projectThresholds }  from '../authoring/optimizer.js';
import { PALETTE }            from '../core/palette.js';

const BAND_KEYS = [
  'shadow_deep_ratio', 'shadow_ratio', 'mid_ratio',
  'bright_ratio', 'highlight_ratio',
];

const TH_DIM  = 5;
const EPSILON = 0.04;  // finite-difference step

// ── Core evaluation ───────────────────────────────────────────────────────────

function evalBands(params) {
  const raw   = buildFromParams(params);
  const { grid } = runCleanup(raw);
  return computeMetrics(grid, PALETTE);
}

// ── Sensitivity (Jacobian) ────────────────────────────────────────────────────

/**
 * Compute finite-difference sensitivity of each band metric to each threshold.
 *
 * Returns a 5×5 matrix J where J[bandIdx][thIdx] = dBand/dThreshold.
 *
 * @param {object} params     — base params
 * @returns {object}
 *   { jacobian: number[][], bandKeys: string[], thresholdIndices: number[] }
 */
export function computeSensitivity(params) {
  const base  = evalBands(params);
  const jacobian = BAND_KEYS.map(() => new Array(TH_DIM).fill(0));

  for (let ti = 0; ti < TH_DIM; ti++) {
    // Forward perturbation
    const thUp = projectThresholds(
      params.thresholds.map((t, i) => i === ti ? t + EPSILON : t)
    );
    const paramsUp = { ...params, thresholds: thUp };
    const metricsUp = evalBands(paramsUp);

    // Backward perturbation
    const thDn = projectThresholds(
      params.thresholds.map((t, i) => i === ti ? t - EPSILON : t)
    );
    const paramsDn = { ...params, thresholds: thDn };
    const metricsDn = evalBands(paramsDn);

    for (let bi = 0; bi < BAND_KEYS.length; bi++) {
      const k = BAND_KEYS[bi];
      jacobian[bi][ti] = (metricsUp[k] - metricsDn[k]) / (2 * EPSILON);
    }
  }

  return {
    jacobian,
    bandKeys:         BAND_KEYS.slice(),
    thresholdIndices: Array.from({ length: TH_DIM }, (_, i) => i),
  };
}

// ── Z-score gradient ──────────────────────────────────────────────────────────

/**
 * Compute the gradient of band rmsZ with respect to each threshold.
 * A positive gradient means increasing that threshold increases rmsZ (worse).
 *
 * @param {object} params
 * @param {object} distribution
 * @returns {number[5]}  — gradient vector (one value per threshold)
 */
export function rmsZGradient(params, distribution) {
  const metrics = evalBands(params);
  const gradient = new Array(TH_DIM).fill(0);
  const { jacobian } = computeSensitivity(params);

  // rmsZ = sqrt(mean_i( z_i^2 )) where z_i = (m_i - mean_i) / std_i
  // d(rmsZ)/d(th_j) ≈ (1/rmsZ) * mean_i( z_i * (1/std_i) * J[i][j] )
  // Handle rmsZ=0 gracefully
  const zs   = [];
  const stds = [];
  for (const k of BAND_KEYS) {
    const d = distribution[k];
    if (!d || d.stddev < 0.0001) { zs.push(0); stds.push(1); continue; }
    zs.push((metrics[k] - d.mean) / d.stddev);
    stds.push(d.stddev);
  }

  const sumZ2 = zs.reduce((s, z) => s + z * z, 0);
  const rmsZ  = Math.sqrt(sumZ2 / zs.length);

  for (let tj = 0; tj < TH_DIM; tj++) {
    let grad = 0;
    for (let bi = 0; bi < BAND_KEYS.length; bi++) {
      grad += (zs[bi] / stds[bi]) * jacobian[bi][tj];
    }
    gradient[tj] = rmsZ > 0.001 ? grad / (zs.length * rmsZ) : 0;
  }

  return gradient;
}

// ── Counterfactual prescription ───────────────────────────────────────────────

/**
 * Generate a concrete action list: which thresholds to adjust and by how much
 * to move the worst-scoring band metric toward its reference mean.
 *
 * @param {object}  params
 * @param {object}  distribution
 * @param {object}  [opts]
 * @param {number}  opts.topK       — number of top actions to return (default 3)
 * @param {number}  opts.maxDelta   — max threshold change per step (default 0.08)
 * @returns {object}
 *   {
 *     currentRmsZ,
 *     zScores: { [bandKey]: number },
 *     worstBand: string,
 *     actions: [{ thresholdIndex, direction, delta, predictedImprovement, rationale }],
 *     gradient: number[],
 *   }
 */
export function prescribe(params, distribution, opts = {}) {
  const { topK = 3, maxDelta = 0.08 } = opts;

  const metrics  = evalBands(params);
  const { jacobian } = computeSensitivity(params);

  // Compute z-scores
  const zScores = {};
  let sumZ2 = 0, n = 0;
  for (const k of BAND_KEYS) {
    const d = distribution[k];
    if (!d || d.stddev < 0.0001) { zScores[k] = 0; continue; }
    const z = (metrics[k] - d.mean) / d.stddev;
    zScores[k] = +z.toFixed(3);
    sumZ2 += z * z;
    n++;
  }
  const currentRmsZ = n > 0 ? +(Math.sqrt(sumZ2 / n)).toFixed(4) : 0;

  // Worst band (highest |z|)
  const worstBand = BAND_KEYS.reduce((a, b) =>
    Math.abs(zScores[a] ?? 0) >= Math.abs(zScores[b] ?? 0) ? a : b
  );
  const worstBandIdx = BAND_KEYS.indexOf(worstBand);
  const worstZ       = zScores[worstBand] ?? 0;

  // For the worst band, find thresholds with high sensitivity
  // Direction: if worstZ > 0 (metric too high), we want to decrease it
  //            dBand/dTh tells us which threshold to move
  const actions = [];
  for (let ti = 0; ti < TH_DIM; ti++) {
    const sensitivity = jacobian[worstBandIdx][ti];
    if (Math.abs(sensitivity) < 1e-4) continue;

    // To reduce worstZ: decrease band if worstZ > 0 (move opposite to sensitivity sign)
    const direction = (worstZ > 0) === (sensitivity > 0) ? 'decrease' : 'increase';
    const delta     = Math.min(maxDelta, Math.abs(worstZ) * 0.03 / (Math.abs(sensitivity) + 0.01));
    const predictedDeltaBand   = -sensitivity * delta * (worstZ > 0 ? 1 : -1);
    const predictedNewZ        = worstZ - predictedDeltaBand / ((distribution[worstBand]?.stddev ?? 1) + 0.001);

    actions.push({
      thresholdIndex:       ti,
      direction,
      delta:                +delta.toFixed(4),
      sensitivity:          +sensitivity.toFixed(5),
      predictedImprovement: +Math.abs(worstZ - predictedNewZ).toFixed(3),
      rationale: `th[${ti}] has sensitivity ${sensitivity.toFixed(3)} on ${worstBand} (z=${worstZ.toFixed(2)}); ${direction} by ~${delta.toFixed(3)} to reduce |z|`,
    });
  }

  // Sort by predicted improvement descending
  actions.sort((a, b) => b.predictedImprovement - a.predictedImprovement);
  const gradient = rmsZGradient(params, distribution);

  return {
    currentRmsZ,
    zScores,
    worstBand,
    actions:  actions.slice(0, topK),
    gradient: gradient.map(v => +v.toFixed(5)),
  };
}

/**
 * Run a single gradient-descent step using the rmsZ gradient.
 *
 * @param {object}  params
 * @param {object}  distribution
 * @param {number}  [stepSize]    — gradient step size (default 0.03)
 * @returns {{ newParams, deltaRmsZ }}
 */
export function gradientStep(params, distribution, stepSize = 0.03) {
  const gradient = rmsZGradient(params, distribution);

  // Move opposite to gradient (minimize rmsZ)
  const newThresholds = projectThresholds(
    params.thresholds.map((t, i) => t - stepSize * gradient[i])
  );

  const newParams  = { ...params, thresholds: newThresholds };
  const oldMetrics = evalBands(params);
  const newMetrics = evalBands(newParams);

  const oldZ = computeRmsZ(oldMetrics, distribution);
  const newZ = computeRmsZ(newMetrics, distribution);

  return {
    newParams,
    oldRmsZ:    +oldZ.toFixed(4),
    newRmsZ:    +newZ.toFixed(4),
    deltaRmsZ:  +(newZ - oldZ).toFixed(4),
    improved:   newZ < oldZ,
  };
}

function computeRmsZ(metrics, distribution) {
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
