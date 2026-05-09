/**
 * Goku-calibrated sprite generator.
 *
 * High-level API that combines the parametric warrior generator with the
 * Goku reference distribution to produce sprites whose band ratios match
 * the Goku reference style.
 *
 * This is the generative authoring engine for Phase 8.
 * It separates WHAT to generate (params) from HOW to calibrate it (iteration).
 */

import { PALETTE }                       from '../core/palette.js';
import { runCleanup }                    from '../cleanup/index.js';
import { computeMetrics }                from '../eval/metrics.js';
import { compareToReference }            from '../eval/compare.js';
import { loadBatchReference }            from '../eval/reference_lib.js';
import { defaultParams, badStartParams, buildFromParams, adjustParams } from './parametric.js';
import { runIteration, bandRmsZ }        from '../../tools/goku_iterate.js';

// ── Exports ───────────────────────────────────────────────────────────────────

export { defaultParams, badStartParams, buildFromParams, adjustParams };

/**
 * Generate a Goku-calibrated warrior sprite.
 *
 * Runs the parametric generator and iterates until the sprite's band ratios
 * match the Goku reference distribution within the given tolerance.
 *
 * @param {object} [opts]
 * @param {object} [opts.params]        — starting params (default: defaultParams())
 * @param {number} [opts.maxIter=30]    — max iterations
 * @param {number} [opts.targetRmsZ=0.50] — convergence threshold
 * @param {object} [opts.distribution]  — reference distribution (default: Goku batch)
 * @returns {{ grid, metrics, comparison, converged, bandRmsZ, iterations }}
 */
export function generateGokuSprite(opts = {}) {
  const {
    params:       startParams  = defaultParams(),
    maxIter       = 30,
    targetRmsZ    = 0.50,
    distribution  = null,
  } = opts;

  // Load reference distribution
  let dist = distribution;
  if (!dist) {
    const ref = loadBatchReference();
    if (!ref) throw new Error('No Goku batch reference found. Run: python3 tools/batch_ingest.py');
    dist = ref.distribution;
  }

  const { bestGrid, bestBandRmsZ, bestIter, log, converged } = runIteration(
    startParams, dist, { maxIter, targetRmsZ }
  );

  const metrics    = computeMetrics(bestGrid, PALETTE);
  const comparison = compareToReference(metrics, dist);

  return {
    grid:        bestGrid,
    metrics,
    comparison,
    converged,
    bandRmsZ:    bestBandRmsZ,
    bestIter,
    iterations:  log,
  };
}

/**
 * Evaluate how well a grid matches the Goku reference distribution.
 *
 * @param {Array} grid
 * @param {object} [distribution]  — defaults to Goku batch reference
 * @returns {{ metrics, comparison, pass, bandRmsZ }}
 */
export function evaluateAgainstGoku(grid, distribution = null) {
  let dist = distribution;
  if (!dist) {
    const ref = loadBatchReference();
    if (!ref) throw new Error('No Goku batch reference found.');
    dist = ref.distribution;
  }

  const metrics    = computeMetrics(grid, PALETTE);
  const comparison = compareToReference(metrics, dist);
  const bRmsZ      = bandRmsZ(comparison.results);

  return {
    metrics,
    comparison,
    pass:     comparison.pass,
    bandRmsZ: bRmsZ,
  };
}
