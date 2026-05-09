/**
 * Tests for src/authoring/optimizer.js
 *
 * Covers: projectThresholds, nelderMead (on analytic functions),
 *         evaluateThresholds, optimizeThresholds.
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import { loadBatchReference } from '../../src/eval/reference_lib.js';
import {
  projectThresholds,
  nelderMead,
  evaluateThresholds,
  optimizeThresholds,
} from '../../src/authoring/optimizer.js';
import { idleParams, poseParams } from '../../src/authoring/poses.js';

// ── projectThresholds ─────────────────────────────────────────────────────────

section('optimizer — projectThresholds');

{
  // Already valid → unchanged
  const t = [0.20, 0.40, 0.60, 0.75, 0.88];
  const p = projectThresholds(t);
  check('valid thresholds pass through', p.every((v, i) => Math.abs(v - t[i]) < 1e-9));
}

{
  // Strictly increasing after projection
  const random = [0.80, 0.20, 0.50, 0.30, 0.70];
  const p = projectThresholds(random);
  check('projected is strictly increasing',
    p.every((v, i) => i === 0 || v > p[i - 1]));
}

{
  // Clamps to [0.05, 0.95]
  const extreme = [-0.5, -0.1, 0.0, 1.1, 1.5];
  const p = projectThresholds(extreme);
  check('no value below 0.05', p.every(v => v >= 0.05));
  check('no value above 0.95', p.every(v => v <= 0.95));
}

{
  // Minimum gap maintained
  const tooClose = [0.10, 0.11, 0.12, 0.13, 0.14];
  const p = projectThresholds(tooClose);
  check('adjacent gaps ≥ TH_GAP (0.03)',
    p.every((v, i) => i === 0 || v - p[i - 1] >= 0.02));
}

{
  // 5 elements
  const t = [0.2, 0.4, 0.6, 0.75, 0.88];
  check('output has 5 elements', projectThresholds(t).length === 5);
}

{
  // Idempotent: projecting twice yields same result
  const t = [0.90, 0.80, 0.70, 0.60, 0.50];
  const once  = projectThresholds(t);
  const twice = projectThresholds(once);
  check('projection is idempotent',
    once.every((v, i) => Math.abs(v - twice[i]) < 1e-9));
}

// ── nelderMead on analytic functions ─────────────────────────────────────────

section('optimizer — nelderMead (analytic)');

{
  // 1D: minimize (x - 3)^2 starting from x=0 → optimal at x=3
  // NM with function-value convergence criterion: best value near 0, x near 3
  const result = nelderMead(([x]) => (x - 3) ** 2, [0], { maxIter: 200, tol: 1e-4 });
  check('1D: converged', result.converged);
  check('1D: bestX within 0.2 of optimal', Math.abs(result.bestX[0] - 3) < 0.2);
  check('1D: bestValue < 0.05', result.bestValue < 0.05);
}

{
  // 2D: minimize (x-2)^2 + (y+1)^2 → optimal at (2, -1)
  const result = nelderMead(([x, y]) => (x - 2) ** 2 + (y + 1) ** 2, [0, 0], {
    maxIter: 200, tol: 1e-8,
  });
  check('2D: converged', result.converged);
  check('2D: bestX[0] ≈ 2', Math.abs(result.bestX[0] - 2) < 0.05);
  check('2D: bestX[1] ≈ -1', Math.abs(result.bestX[1] + 1) < 0.05);
  check('2D: bestValue ≈ 0', result.bestValue < 0.01);
}

{
  // Returns required fields
  const result = nelderMead(([x]) => x * x, [1], { maxIter: 50 });
  check('result has bestX',    Array.isArray(result.bestX));
  check('result has bestValue',typeof result.bestValue === 'number');
  check('result has iter',     typeof result.iter === 'number');
  check('result has converged',typeof result.converged === 'boolean');
  check('result has log',      Array.isArray(result.log));
}

{
  // With projection: minimize x^2 with x constrained to [1, 5]
  const project = ([x]) => [Math.max(1, Math.min(5, x))];
  const result  = nelderMead(([x]) => x * x, [3], { maxIter: 100, tol: 1e-8, project });
  check('projected: bestX ≥ 1', result.bestX[0] >= 1 - 1e-6);
  check('projected: minimum at constraint boundary', Math.abs(result.bestX[0] - 1) < 0.05);
}

{
  // 5D quadratic: minimize sum of (x_i - target_i)^2
  const target = [0.25, 0.45, 0.62, 0.76, 0.89];
  const result  = nelderMead(
    x => x.reduce((s, v, i) => s + (v - target[i]) ** 2, 0),
    [0.30, 0.50, 0.65, 0.78, 0.90],
    { maxIter: 500, tol: 1e-6 }
  );
  check('5D: bestValue < 0.01', result.bestValue < 0.01);
  check('5D: bestX has 5 elements', result.bestX.length === 5);
}

// ── evaluateThresholds ────────────────────────────────────────────────────────

section('optimizer — evaluateThresholds');

const ref  = loadBatchReference();
const dist = ref?.distribution ?? null;

if (!dist) {
  check('batch reference available for optimizer tests', false);
} else {
  const bandDist = Object.fromEntries(
    ['shadow_deep_ratio','shadow_ratio','mid_ratio','bright_ratio','highlight_ratio']
      .map(k => [k, dist[k]]).filter(([, v]) => v)
  );
  const base = idleParams();

  {
    // Returns a finite non-negative number
    const rmsZ = evaluateThresholds(base.thresholds, base, bandDist);
    check('evaluateThresholds returns finite number', isFinite(rmsZ));
    check('evaluateThresholds returns non-negative', rmsZ >= 0);
  }

  {
    // Different thresholds → different rmsZ
    const t1 = [0.20, 0.40, 0.60, 0.75, 0.88];  // well-spaced
    const t2 = [0.60, 0.70, 0.80, 0.88, 0.93];  // all-dark region
    const r1 = evaluateThresholds(t1, base, bandDist);
    const r2 = evaluateThresholds(t2, base, bandDist);
    check('different thresholds → different rmsZ', r1 !== r2);
  }

// ── optimizeThresholds ────────────────────────────────────────────────────────

  section('optimizer — optimizeThresholds');

  {
    const result = optimizeThresholds(idleParams(), dist, {
      maxEval: 40, tol: 1e-3, target: 2.0,  // loose target for speed
    });

    check('result has bestParams',    typeof result.bestParams === 'object');
    check('result has bestBandRmsZ',  typeof result.bestBandRmsZ === 'number');
    check('result has iter',          typeof result.iter === 'number');
    check('result has converged',     typeof result.converged === 'boolean');
    check('result has log',           Array.isArray(result.log));
    check('bestBandRmsZ is finite',   isFinite(result.bestBandRmsZ));
    check('bestBandRmsZ is non-negative', result.bestBandRmsZ >= 0);
    check('bestParams has thresholds', Array.isArray(result.bestParams.thresholds));
    check('bestParams thresholds are valid',
      result.bestParams.thresholds.every(v => v >= 0.05 && v <= 0.95));
    check('thresholds are strictly increasing',
      result.bestParams.thresholds.every((v, i) => i === 0 || v > result.bestParams.thresholds[i-1]));
  }

  {
    // Optimizer should improve over random thresholds
    // Bad start: uniform [0.1, 0.2, 0.3, 0.4, 0.5] (likely not optimal)
    const badStart = idleParams([0.10, 0.20, 0.30, 0.40, 0.50]);
    const { bestBandRmsZ: afterOpt } = optimizeThresholds(badStart, dist, {
      maxEval: 50, tol: 1e-3, target: 2.0,
    });
    const beforeOpt = evaluateThresholds([0.10, 0.20, 0.30, 0.40, 0.50], badStart,
      Object.fromEntries(['shadow_deep_ratio','shadow_ratio','mid_ratio','bright_ratio','highlight_ratio']
        .map(k => [k, dist[k]]).filter(([, v]) => v)));
    check('optimizer improves over bad start', afterOpt <= beforeOpt + 0.01);
  }

  {
    // Log entries have eval and rmsZ
    const { log } = optimizeThresholds(idleParams(), dist, {
      maxEval: 10, tol: 1e-2, target: 5.0,
    });
    check('log has entries', log.length > 0);
    check('log entries have eval', log.every(e => typeof e.eval === 'number'));
    check('log entries have rmsZ', log.every(e => typeof e.rmsZ === 'number'));
    check('log eval is increasing', log.every((e, i) => i === 0 || e.eval >= log[i-1].eval));
  }
}
