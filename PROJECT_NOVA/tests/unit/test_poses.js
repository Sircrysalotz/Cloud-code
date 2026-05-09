/**
 * Tests for src/authoring/poses.js — all 5 pose variants.
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import { POSES, POSE_NAMES, POSE_FRAME, poseParams,
         idleParams, guardParams, punchParams, kickParams, powerUpParams } from '../../src/authoring/poses.js';
import { buildFromParams }   from '../../src/authoring/parametric.js';
import { runCleanup }        from '../../src/cleanup/index.js';
import { computeMetrics }    from '../../src/eval/metrics.js';
import { PALETTE }           from '../../src/core/palette.js';

// ── POSE_NAMES + registry ─────────────────────────────────────────────────────

section('poses — registry');

{
  check('POSE_NAMES has 5 entries', POSE_NAMES.length === 5);
  check('POSE_NAMES includes idle',     POSE_NAMES.includes('idle'));
  check('POSE_NAMES includes guard',    POSE_NAMES.includes('guard'));
  check('POSE_NAMES includes punch',    POSE_NAMES.includes('punch'));
  check('POSE_NAMES includes kick',     POSE_NAMES.includes('kick'));
  check('POSE_NAMES includes power_up', POSE_NAMES.includes('power_up'));
}

{
  // POSES maps name → factory function
  check('POSES is an object', typeof POSES === 'object');
  check('all POSE_NAMES have factory in POSES',
    POSE_NAMES.every(n => typeof POSES[n] === 'function'));
}

{
  // poseParams returns params object
  const p = poseParams('idle');
  check('poseParams idle returns W', typeof p.W === 'number');
  check('poseParams idle returns H', typeof p.H === 'number');
  check('poseParams idle returns thresholds array', Array.isArray(p.thresholds));
  check('poseParams idle returns parts object', typeof p.parts === 'object');
  check('poseParams idle returns accents array', Array.isArray(p.accents));
}

{
  // poseParams throws for unknown pose
  let threw = false;
  try { poseParams('unknown_pose'); } catch { threw = true; }
  check('poseParams throws for unknown pose', threw);
}

{
  // Custom thresholds propagate
  const custom = [0.20, 0.40, 0.60, 0.75, 0.88];
  const p = poseParams('idle', custom);
  check('custom thresholds propagated',
    p.thresholds.every((t, i) => Math.abs(t - custom[i]) < 0.001));
}

// ── Each pose builds cleanly ───────────────────────────────────────────────────

section('poses — buildFromParams smoke test');

for (const name of POSE_NAMES) {
  const params = poseParams(name);
  let grid;
  let threw = false;
  try {
    grid = buildFromParams(params);
  } catch (e) {
    threw = true;
  }

  check(`${name}: buildFromParams does not throw`, !threw);
  if (!threw) {
    check(`${name}: grid has correct height`, grid.length === params.H);
    check(`${name}: grid rows have correct width`,
      grid.every(row => row.length === params.W));
  }
}

// ── Canvas sizes differ per pose ─────────────────────────────────────────────

section('poses — canvas dimensions');

{
  const dims = POSE_NAMES.map(n => { const p = poseParams(n); return [p.W, p.H]; });
  // Not all poses should have the same W (poses use different widths)
  const widths = new Set(dims.map(([w]) => w));
  check('poses have distinct canvas widths (pose variety)', widths.size > 1);
}

{
  // idle baseline: 24×40
  const p = idleParams();
  check('idle W=24', p.W === 24);
  check('idle H=40', p.H === 40);
}

{
  // punch is wider than idle (extended arm)
  const pi = idleParams(), pp = punchParams();
  check('punch wider than idle', pp.W > pi.W);
}

{
  // power_up is widest
  const widths = POSE_NAMES.map(n => poseParams(n).W);
  const maxW = Math.max(...widths);
  check('power_up is the widest pose', powerUpParams().W === maxW);
}

// ── Each pose produces a non-trivial sprite after cleanup ─────────────────────

section('poses — cleanup + metrics');

for (const name of POSE_NAMES) {
  const params = poseParams(name);
  const raw = buildFromParams(params);
  const { grid } = runCleanup(raw);
  const m = computeMetrics(grid, PALETTE);

  check(`${name}: body_count > 100`, (m.body_count ?? 0) > 100);
  check(`${name}: outline_count > 50`, (m.outline_count ?? 0) > 50);
  check(`${name}: shadow_deep_ratio > 0`, (m.shadow_deep_ratio ?? 0) > 0);
  check(`${name}: shadow_ratio > 0`,      (m.shadow_ratio ?? 0) > 0);
  check(`${name}: mid_ratio > 0`,         (m.mid_ratio ?? 0) > 0);
}

// ── Band ratios are in plausible range ────────────────────────────────────────

section('poses — band ratio sanity');

// Goku reference: shadow_deep ~38%, shadow ~24%, mid ~19%
// Poses should be in the same ballpark (within ±20 percentage points)
for (const name of POSE_NAMES) {
  const params = poseParams(name);
  const raw = buildFromParams(params);
  const { grid } = runCleanup(raw);
  const m = computeMetrics(grid, PALETTE);

  check(`${name}: shadow_deep in [0.15, 0.65]`,
    m.shadow_deep_ratio >= 0.15 && m.shadow_deep_ratio <= 0.65);

  check(`${name}: band ratios sum to ~1`,
    Math.abs(
      (m.shadow_deep_ratio ?? 0) +
      (m.shadow_ratio      ?? 0) +
      (m.mid_ratio         ?? 0) +
      (m.bright_ratio      ?? 0) +
      (m.highlight_ratio   ?? 0) +
      (m.peak_ratio        ?? 0) - 1
    ) < 0.05);
}

// ── Thresholds shape the distribution ────────────────────────────────────────

section('poses — threshold influence');

{
  // More shadow-heavy thresholds → higher shadow_deep_ratio
  const light = idleParams([0.10, 0.20, 0.40, 0.60, 0.80]);  // low SD threshold
  const heavy = idleParams([0.55, 0.65, 0.80, 0.88, 0.94]);  // high SD threshold
  const { grid: lg } = runCleanup(buildFromParams(light));
  const { grid: hg } = runCleanup(buildFromParams(heavy));
  const ml = computeMetrics(lg, PALETTE);
  const mh = computeMetrics(hg, PALETTE);
  check('higher th[0] → more shadow_deep pixels',
    mh.shadow_deep_ratio > ml.shadow_deep_ratio);
}

// ── Guard has forearm parts ───────────────────────────────────────────────────

section('poses — guard forearms');

{
  const p = guardParams();
  check('guard has forearm_left part',  'forearm_left'  in p.parts);
  check('guard has forearm_right part', 'forearm_right' in p.parts);
  // Guard body_count should be > idle (extra forearm area)
  const pGuard = guardParams();
  const pIdle  = idleParams();
  const { grid: gGuard } = runCleanup(buildFromParams(pGuard));
  const { grid: gIdle  } = runCleanup(buildFromParams(pIdle));
  const mGuard = computeMetrics(gGuard, PALETTE);
  const mIdle  = computeMetrics(gIdle,  PALETTE);
  // Guard canvas is wider, so more body pixels even proportionally
  check('guard body_count > idle body_count (wider canvas with forearms)',
    mGuard.body_count > mIdle.body_count);
}

// ── POSE_FRAME ────────────────────────────────────────────────────────────────

section('poses — POSE_FRAME');

{
  check('POSE_FRAME has entry for every pose name',
    POSE_NAMES.every(n => n in POSE_FRAME));

  check('all POSE_FRAME values are non-negative integers',
    Object.values(POSE_FRAME).every(v => Number.isInteger(v) && v >= 0));

  check('POSE_FRAME idle is frame 0 (upright walk)',  POSE_FRAME.idle     === 0);
  check('POSE_FRAME punch uses wide fighting frame',  POSE_FRAME.punch    === 5);
  check('POSE_FRAME guard uses arms-raised frame',    POSE_FRAME.guard    === 9);
  check('POSE_FRAME kick uses reaching frame',        POSE_FRAME.kick     === 14);
  check('POSE_FRAME power_up uses dramatic frame',    POSE_FRAME.power_up === 18);
}
