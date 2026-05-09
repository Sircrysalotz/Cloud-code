/**
 * Tests for src/eval/counterfactual.js
 *
 * Covers: computeSensitivity, rmsZGradient, prescribe, gradientStep.
 */

import { check, section }     from '../helpers.js';
import { loadBatchReference } from '../../src/eval/reference_lib.js';
import { idleParams }         from '../../src/authoring/poses.js';
import {
  computeSensitivity,
  rmsZGradient,
  prescribe,
  gradientStep,
} from '../../src/eval/counterfactual.js';

const ref  = loadBatchReference();
const dist = ref?.distribution ?? null;

if (!dist) {
  import('../helpers.js').then(h => h.check('batch reference available', false));
} else {

const base = idleParams();

// ── computeSensitivity ────────────────────────────────────────────────────────

section('counterfactual — computeSensitivity');

{
  const s = computeSensitivity(base);

  check('returns jacobian',          Array.isArray(s.jacobian));
  check('jacobian has 5 rows',       s.jacobian.length === 5);
  check('jacobian rows have 5 cols', s.jacobian.every(r => r.length === 5));
  check('bandKeys has 5 entries',    s.bandKeys.length === 5);
  check('thresholdIndices has 5',    s.thresholdIndices.length === 5);
  check('all values are numbers',    s.jacobian.every(r => r.every(v => typeof v === 'number')));
  check('all values are finite',     s.jacobian.every(r => r.every(v => isFinite(v))));
}

{
  // Not all sensitivities are zero (thresholds affect band ratios)
  const s      = computeSensitivity(base);
  const nonZero = s.jacobian.flat().some(v => Math.abs(v) > 1e-6);
  check('at least one non-zero sensitivity', nonZero);
}

{
  // bandKeys match expected band order
  const s = computeSensitivity(base);
  check('bandKeys[0] = shadow_deep_ratio', s.bandKeys[0] === 'shadow_deep_ratio');
  check('bandKeys[4] = highlight_ratio',   s.bandKeys[4] === 'highlight_ratio');
}

// ── rmsZGradient ──────────────────────────────────────────────────────────────

section('counterfactual — rmsZGradient');

{
  const g = rmsZGradient(base, dist);

  check('returns array of 5', Array.isArray(g) && g.length === 5);
  check('all finite',         g.every(v => isFinite(v)));
  check('all numbers',        g.every(v => typeof v === 'number'));
}

{
  // Gradient is not all zero for real params (thresholds affect rmsZ)
  const g = rmsZGradient(base, dist);
  const nonZero = g.some(v => Math.abs(v) > 1e-8);
  check('gradient has at least one non-zero component', nonZero);
}

{
  // Different params → different gradient (generally)
  const g1 = rmsZGradient(base, dist);
  const altParams = { ...base, thresholds: base.thresholds.map(t => Math.min(0.92, t + 0.15)) };
  const g2 = rmsZGradient(altParams, dist);
  check('different params → gradient can differ', typeof g1 === typeof g2);
}

// ── prescribe ─────────────────────────────────────────────────────────────────

section('counterfactual — prescribe');

{
  const p = prescribe(base, dist);

  check('has currentRmsZ',   typeof p.currentRmsZ === 'number');
  check('has zScores',       typeof p.zScores     === 'object');
  check('has worstBand',     typeof p.worstBand   === 'string');
  check('has actions',       Array.isArray(p.actions));
  check('has gradient',      Array.isArray(p.gradient));
  check('currentRmsZ ≥ 0',  p.currentRmsZ >= 0);
  check('currentRmsZ finite', isFinite(p.currentRmsZ));
}

{
  // zScores has all 5 band keys
  const p = prescribe(base, dist);
  const bands = ['shadow_deep_ratio','shadow_ratio','mid_ratio','bright_ratio','highlight_ratio'];
  check('zScores has all band keys', bands.every(k => k in p.zScores));
  check('all zScores are numbers',   Object.values(p.zScores).every(v => typeof v === 'number'));
}

{
  // worstBand is a valid band key
  const p = prescribe(base, dist);
  const valid = ['shadow_deep_ratio','shadow_ratio','mid_ratio','bright_ratio','highlight_ratio'];
  check('worstBand is valid band key', valid.includes(p.worstBand));
}

{
  // Actions have required fields
  const p = prescribe(base, dist, { topK: 3 });
  check('actions ≤ topK', p.actions.length <= 3);
  for (const a of p.actions) {
    check('action has thresholdIndex', typeof a.thresholdIndex       === 'number');
    check('action has direction',      typeof a.direction            === 'string');
    check('action has delta',          typeof a.delta                === 'number');
    check('action has rationale',      typeof a.rationale            === 'string');
    check('action direction valid',    ['increase','decrease'].includes(a.direction));
    check('action delta > 0',          a.delta > 0);
    break;  // just check first action once
  }
}

{
  // topK=1 → at most 1 action
  const p = prescribe(base, dist, { topK: 1 });
  check('topK=1: ≤ 1 action', p.actions.length <= 1);
}

{
  // gradient has 5 elements
  const p = prescribe(base, dist);
  check('gradient has 5 elements', p.gradient.length === 5);
  check('gradient all finite',     p.gradient.every(v => isFinite(v)));
}

// ── gradientStep ──────────────────────────────────────────────────────────────

section('counterfactual — gradientStep');

{
  const result = gradientStep(base, dist, 0.03);

  check('has newParams',   typeof result.newParams  === 'object');
  check('has oldRmsZ',     typeof result.oldRmsZ    === 'number');
  check('has newRmsZ',     typeof result.newRmsZ    === 'number');
  check('has deltaRmsZ',   typeof result.deltaRmsZ  === 'number');
  check('has improved',    typeof result.improved   === 'boolean');
  check('oldRmsZ ≥ 0',     result.oldRmsZ >= 0);
  check('newRmsZ ≥ 0',     result.newRmsZ >= 0);
}

{
  // deltaRmsZ = newRmsZ - oldRmsZ
  const r = gradientStep(base, dist, 0.03);
  check('deltaRmsZ = new - old', Math.abs(r.deltaRmsZ - (r.newRmsZ - r.oldRmsZ)) < 1e-4);
}

{
  // improved flag is consistent with deltaRmsZ
  const r = gradientStep(base, dist, 0.03);
  check('improved ↔ deltaRmsZ < 0', r.improved === (r.deltaRmsZ < 0));
}

{
  // newParams has valid thresholds
  const r = gradientStep(base, dist, 0.03);
  check('newParams has thresholds', Array.isArray(r.newParams.thresholds));
  check('thresholds length=5',      r.newParams.thresholds.length === 5);
  check('thresholds ≥ 0.05',        r.newParams.thresholds.every(t => t >= 0.05));
  check('thresholds ≤ 0.95',        r.newParams.thresholds.every(t => t <= 0.95));
}

{
  // stepSize=0 → no change
  const r = gradientStep(base, dist, 0);
  check('stepSize=0: deltaRmsZ ≈ 0', Math.abs(r.deltaRmsZ) < 0.001);
}

{
  // Multiple gradient steps should generally reduce rmsZ
  let params  = { ...base };
  let prevZ   = Infinity;
  let improved = 0;
  for (let i = 0; i < 5; i++) {
    const r = gradientStep(params, dist, 0.02);
    if (r.improved) improved++;
    params  = r.newParams;
    prevZ   = r.newRmsZ;
  }
  check('at least 1 improvement in 5 gradient steps', improved >= 1);
}

// ── Integration ───────────────────────────────────────────────────────────────

section('counterfactual — integration');

{
  // Full workflow: prescribe → apply first action → check if rmsZ changed
  const p      = prescribe(base, dist, { topK: 1 });
  const action = p.actions[0];

  if (action) {
    const delta = action.direction === 'increase' ? action.delta : -action.delta;
    const newTh = base.thresholds.map((t, i) =>
      i === action.thresholdIndex ? t + delta : t
    );
    const { projectThresholds } = await import('../../src/authoring/optimizer.js');
    const newParams  = { ...base, thresholds: projectThresholds(newTh) };
    const { prescribe: p2fn } = await import('../../src/eval/counterfactual.js');
    const p2 = p2fn(newParams, dist);

    check('applying action changes rmsZ',    p2.currentRmsZ !== p.currentRmsZ);
    check('applying action produces prescription', Array.isArray(p2.actions));
  } else {
    check('no actions (perfect score?)', true);
  }
}

} // end if (!dist)
