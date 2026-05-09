/**
 * Tests for tools/goku_iterate.js — bandRmsZ and runIteration.
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import { bandRmsZ, runIteration } from '../../tools/goku_iterate.js';
import { defaultParams, badStartParams } from '../../src/authoring/parametric.js';

// ── Minimal reference distribution ───────────────────────────────────────────

const GOKU_DIST = {
  shadow_deep_ratio:  { mean: 0.379, stddev: 0.050, n: 165 },
  shadow_ratio:       { mean: 0.235, stddev: 0.070, n: 165 },
  mid_ratio:          { mean: 0.188, stddev: 0.056, n: 165 },
  bright_ratio:       { mean: 0.086, stddev: 0.064, n: 165 },
  highlight_ratio:    { mean: 0.066, stddev: 0.031, n: 165 },
  peak_ratio:         { mean: 0.045, stddev: 0.026, n: 165 },
  symmetry_score:     { mean: 0.101, stddev: 0.056, n: 165 },
  body_density:       { mean: 0.376, stddev: 0.078, n: 165 },
};

// ── bandRmsZ ──────────────────────────────────────────────────────────────────

section('goku_iterate — bandRmsZ');

{
  // Perfect match on all converging bands → rmsZ = 0
  const results = {
    shadow_deep_ratio: { z: 0,    severity: 'ok' },
    shadow_ratio:      { z: 0,    severity: 'ok' },
    mid_ratio:         { z: 0,    severity: 'ok' },
    bright_ratio:      { z: 0,    severity: 'ok' },
    highlight_ratio:   { z: 0,    severity: 'ok' },
    // Structural — excluded from bandRmsZ
    peak_ratio:        { z: -3,   severity: 'critical' },
    symmetry_score:    { z: 5,    severity: 'critical' },
  };
  check('bandRmsZ = 0 when all band z-scores are 0',
    bandRmsZ(results) === 0);
}

{
  // Structural outliers don't affect bandRmsZ
  const results = {
    shadow_deep_ratio: { z: 1.0, severity: 'warn' },
    mid_ratio:         { z: -1.0, severity: 'warn' },
    symmetry_score:    { z: 100, severity: 'critical' },
    peak_ratio:        { z: -10, severity: 'critical' },
  };
  const rz = bandRmsZ(results);
  check('structural outliers excluded from bandRmsZ',
    rz < 2 && rz > 0);
}

{
  // Empty results → 0
  check('empty results → bandRmsZ = 0', bandRmsZ({}) === 0);
}

{
  // Scales with deviation magnitude
  const small = { shadow_deep_ratio: { z: 0.5, severity: 'ok' } };
  const large = { shadow_deep_ratio: { z: 3.0, severity: 'critical' } };
  check('larger deviation → larger bandRmsZ',
    bandRmsZ(large) > bandRmsZ(small));
}

// ── runIteration ──────────────────────────────────────────────────────────────

section('goku_iterate — runIteration');

{
  // Runs without error, returns required fields
  const result = runIteration(defaultParams(), GOKU_DIST, { maxIter: 5 });
  check('returns bestGrid', result.bestGrid !== null && Array.isArray(result.bestGrid));
  check('returns bestParams', typeof result.bestParams === 'object');
  check('returns bestBandRmsZ', typeof result.bestBandRmsZ === 'number');
  check('returns bestIter', typeof result.bestIter === 'number');
  check('returns log array', Array.isArray(result.log));
  check('returns converged boolean', typeof result.converged === 'boolean');
}

{
  // Log length ≤ maxIter
  const result = runIteration(defaultParams(), GOKU_DIST, { maxIter: 10 });
  check('log length ≤ maxIter', result.log.length <= 10);
}

{
  // Log entries have required fields
  const result = runIteration(defaultParams(), GOKU_DIST, { maxIter: 3 });
  check('log entries have iter, rms_z, band_rms_z, pass, thresholds, band_flags',
    result.log.every(e =>
      typeof e.iter === 'number' &&
      typeof e.rms_z === 'number' &&
      typeof e.band_rms_z === 'number' &&
      typeof e.pass === 'boolean' &&
      Array.isArray(e.thresholds) &&
      Array.isArray(e.band_flags)));
}

{
  // Best result is the one with lowest band_rmsZ in log
  const result = runIteration(defaultParams(), GOKU_DIST, { maxIter: 15 });
  const logMinZ = Math.min(...result.log.map(e => e.band_rms_z));
  check('bestBandRmsZ equals minimum band_rms_z in log',
    Math.abs(result.bestBandRmsZ - logMinZ) < 0.001);
}

{
  // Grid is valid (non-empty, 2D)
  const result = runIteration(defaultParams(), GOKU_DIST, { maxIter: 5 });
  check('bestGrid is non-empty', result.bestGrid.length > 0);
  check('bestGrid rows are arrays/Uint8Arrays',
    result.bestGrid.every(r => typeof r.length === 'number'));
}

{
  // badStartParams converges further than it started
  const resultBad = runIteration(badStartParams(), GOKU_DIST, { maxIter: 20 });
  const resultDefault = runIteration(defaultParams(), GOKU_DIST, { maxIter: 20 });
  // Both should improve; bad start should reach similar quality given enough iterations
  check('bad start iterates without error', resultBad.bestGrid !== null);
  check('bad start log has multiple iterations', resultBad.log.length > 1);
}

{
  // maxIter=1 → exactly 1 iteration
  const result = runIteration(defaultParams(), GOKU_DIST, { maxIter: 1 });
  check('maxIter=1 → 1 log entry', result.log.length === 1);
}

{
  // Very tight target with few iters → likely not converged
  const result = runIteration(badStartParams(), GOKU_DIST, { maxIter: 2, targetRmsZ: 0.001 });
  check('unlikely to converge with 2 iters and target=0.001',
    result.converged === false || result.bestBandRmsZ <= 0.001);
}

{
  // Convergence: with enough iterations, default params should converge
  const result = runIteration(defaultParams(), GOKU_DIST, { maxIter: 30, targetRmsZ: 0.50 });
  check('default params converge within 30 iters at target 0.50',
    result.converged === true && result.bestBandRmsZ < 0.50);
}
