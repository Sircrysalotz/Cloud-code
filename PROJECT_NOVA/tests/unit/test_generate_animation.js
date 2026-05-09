/**
 * Tests for tools/generate_animation.js
 *
 * Covers: buildFrameVariants, padGridToSize, buildIdleAnimation,
 *         buildPoseAnimation, assembleAnimation, timing constants.
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import { PALETTE }        from '../../src/core/palette.js';
import { computeMetrics } from '../../src/eval/metrics.js';
import { loadBatchReference } from '../../src/eval/reference_lib.js';
import {
  BREATHE_OFFSETS,
  POSE_SEQUENCE_TIMING,
  padGridToSize,
  buildFrameVariants,
  buildIdleAnimation,
  buildPoseAnimation,
  assembleAnimation,
} from '../../tools/generate_animation.js';
import { idleParams, POSE_NAMES } from '../../src/authoring/poses.js';

// ── Constants ─────────────────────────────────────────────────────────────────

section('generate_animation — constants');

{
  check('BREATHE_OFFSETS has 4 entries', BREATHE_OFFSETS.length === 4);
  check('BREATHE_OFFSETS[0] is 0 (neutral start)',  BREATHE_OFFSETS[0] === 0);
  check('BREATHE_OFFSETS[1] is negative (expand)',  BREATHE_OFFSETS[1] < 0);
  check('BREATHE_OFFSETS[2] is 0 (neutral return)', BREATHE_OFFSETS[2] === 0);
  check('BREATHE_OFFSETS[3] is positive (compress)',BREATHE_OFFSETS[3] > 0);
}

{
  check('POSE_SEQUENCE_TIMING has 5 entries', Object.keys(POSE_SEQUENCE_TIMING).length === 5);
  check('all POSE_NAMES have timing',
    POSE_NAMES.every(n => typeof POSE_SEQUENCE_TIMING[n] === 'number' && POSE_SEQUENCE_TIMING[n] > 0));
  check('power_up hold is longest pose',
    POSE_SEQUENCE_TIMING.power_up >= Math.max(
      POSE_SEQUENCE_TIMING.idle, POSE_SEQUENCE_TIMING.guard,
      POSE_SEQUENCE_TIMING.punch, POSE_SEQUENCE_TIMING.kick));
  check('punch hold is shorter than idle (fast strike)',
    POSE_SEQUENCE_TIMING.punch < POSE_SEQUENCE_TIMING.idle);
}

// ── padGridToSize ─────────────────────────────────────────────────────────────

section('generate_animation — padGridToSize');

{
  const g = [[1, 2], [3, 4]];
  const p = padGridToSize(g, 4, 3);
  check('padded to correct width', p[0].length === 4);
  check('padded to correct height', p.length === 3);
  check('original pixels preserved', p[0][0] === 1 && p[0][1] === 2 && p[1][0] === 3);
  check('padding fills with 0 (transparent)', p[0][2] === 0 && p[0][3] === 0);
  check('extra row is transparent', p[2].every(v => v === 0));
}

{
  // Same-size grid: no change
  const g = [[1, 2], [3, 4]];
  const p = padGridToSize(g, 2, 2);
  check('no-op when already correct size', p[0][0] === 1 && p[1][1] === 4);
}

{
  // Uint8Array rows are handled correctly
  const g = [new Uint8Array([5, 6, 7])];
  const p = padGridToSize(g, 5, 2);
  check('Uint8Array row: original values copied', p[0][0] === 5 && p[0][2] === 7);
  check('Uint8Array row: padding is 0', p[0][3] === 0 && p[0][4] === 0);
  check('extra row from Uint8Array input: transparent', p[1].every(v => v === 0));
}

// ── buildFrameVariants ────────────────────────────────────────────────────────

section('generate_animation — buildFrameVariants');

const ref = loadBatchReference();
const dist = ref?.distribution ?? null;

if (!dist) {
  // Skip distribution-dependent tests if batch not ingested
  check('batch reference available for generate_animation tests', false);
} else {
  const base = idleParams();

  {
    // n=1 returns one grid (takes calibrated params, no distribution)
    const grids = buildFrameVariants(base, 1);
    check('buildFrameVariants n=1: returns 1 grid', grids.length === 1);
    check('buildFrameVariants n=1: grid has correct height', grids[0].length === base.H);
    check('buildFrameVariants n=1: grid has correct width', grids[0][0].length === base.W);
  }

  {
    // n=4 returns 4 grids, all same size
    const grids = buildFrameVariants(base, 4);
    check('buildFrameVariants n=4: returns 4 grids', grids.length === 4);
    check('buildFrameVariants: all grids have correct height',
      grids.every(g => g.length === base.H));
    check('buildFrameVariants: all grids have correct width',
      grids.every(g => g[0].length === base.W));
  }

  {
    // BREATHE_OFFSETS[1] is negative → lower shadow_deep threshold → fewer shadow_deep pixels
    // BREATHE_OFFSETS[3] is positive → higher shadow_deep threshold → more shadow_deep pixels
    // buildFrameVariants uses buildFromParams directly (deterministic, no iteration)
    const grids = buildFrameVariants(base, 4);
    const m1 = computeMetrics(grids[1], PALETTE);
    const m3 = computeMetrics(grids[3], PALETTE);

    // Expand frame (lower thresholds) should have less shadow_deep than compress frame (higher thresholds)
    check('frame 1 (expand) has less shadow_deep than frame 3 (compress)',
      m1.shadow_deep_ratio < m3.shadow_deep_ratio);

    // All frames should have valid band ratios
    for (let i = 0; i < grids.length; i++) {
      const m = computeMetrics(grids[i], PALETTE);
      check(`frame ${i}: band ratios sum to ~1`,
        Math.abs(
          m.shadow_deep_ratio + m.shadow_ratio + m.mid_ratio +
          m.bright_ratio + m.highlight_ratio + m.peak_ratio - 1
        ) < 0.05);
    }
  }

  {
    // Thresholds are clamped to [0.05, 0.95] so extreme offsets don't crash
    const extreme = idleParams([0.01, 0.02, 0.03, 0.04, 0.05]);
    let threw = false;
    try { buildFrameVariants(extreme, 4); } catch { threw = true; }
    check('extreme thresholds do not throw (clamped)', !threw);
  }

// ── buildIdleAnimation ────────────────────────────────────────────────────────

  section('generate_animation — buildIdleAnimation');

  {
    const { grids, timings } = buildIdleAnimation(dist, { fps: 8, maxIter: 10, targetRmsZ: 1.0 });
    check('buildIdleAnimation: 4 grids', grids.length === 4);
    check('buildIdleAnimation: 4 timings', timings.length === 4);
    check('buildIdleAnimation: all timings equal (constant fps)',
      timings.every(t => t === timings[0]));
    check('buildIdleAnimation: timing is 1000/fps ms',
      timings[0] === Math.round(1000 / 8));
    check('buildIdleAnimation: grids have correct idle dimensions',
      grids.every(g => g.length === 40 && g[0].length === 24));
  }

  {
    // Different fps → different timing
    const { timings: t12 } = buildIdleAnimation(dist, { fps: 12, maxIter: 5, targetRmsZ: 2.0 });
    const { timings: t6  } = buildIdleAnimation(dist, { fps: 6,  maxIter: 5, targetRmsZ: 2.0 });
    check('fps=12: timing ~83ms', Math.abs(t12[0] - 83) <= 1);
    check('fps=6: timing ~167ms', Math.abs(t6[0] - 167) <= 1);
  }

// ── buildPoseAnimation ────────────────────────────────────────────────────────

  section('generate_animation — buildPoseAnimation');

  {
    const { grids, timings, labels } = buildPoseAnimation(dist);
    check('buildPoseAnimation: 5 grids', grids.length === 5);
    check('buildPoseAnimation: 5 timings', timings.length === 5);
    check('buildPoseAnimation: 5 labels', labels.length === 5);
    check('buildPoseAnimation: labels match POSE_NAMES',
      labels.every((l, i) => l === POSE_NAMES[i]));
    check('buildPoseAnimation: all timings > 0', timings.every(t => t > 0));
    check('buildPoseAnimation: all grids non-empty',
      grids.every(g => g.length > 0 && g[0].length > 0));
  }

  {
    // Poses have different widths (variety check)
    const { grids } = buildPoseAnimation(dist);
    const widths = grids.map(g => g[0]?.length ?? 0);
    const unique = new Set(widths);
    check('pose grids have distinct widths (variety)', unique.size > 1);
  }

  {
    // All poses have same height (40px for Goku-style warrior)
    const { grids } = buildPoseAnimation(dist);
    check('all pose grids have same height (40)',
      grids.every(g => g.length === 40));
  }

// ── assembleAnimation ─────────────────────────────────────────────────────────

  section('generate_animation — assembleAnimation');

  {
    // Simple 2-frame assembly with uniform grids
    const g1 = [[1, 2, 3], [4, 5, 6]];
    const g2 = [[7, 1, 2], [3, 4, 5]];
    const { keyframes, pngBytes, sidecar, width, height } =
      assembleAnimation([g1, g2], [100, 200], PALETTE, 2, ['a', 'b'], { test: true });

    check('assembleAnimation: 2 keyframes', keyframes.length === 2);
    check('assembleAnimation: width matches grid width', width === 3);
    check('assembleAnimation: height matches grid height', height === 2);
    check('assembleAnimation: pngBytes is Uint8Array', pngBytes instanceof Uint8Array);
    check('assembleAnimation: pngBytes non-empty', pngBytes.length > 0);
    check('assembleAnimation: sidecar has frameCount', sidecar.frameCount === 2);
    check('assembleAnimation: sidecar has totalMs', sidecar.totalMs === 300);
    check('assembleAnimation: keyframe[0] duration 100ms', keyframes[0].durationMs === 100);
    check('assembleAnimation: keyframe[1] duration 200ms', keyframes[1].durationMs === 200);
    check('assembleAnimation: sidecar has frames array', Array.isArray(sidecar.frames));
    check('assembleAnimation: each frame has ASCII', sidecar.frames.every(f => typeof f.ascii === 'string'));
    check('assembleAnimation: sidecar meta propagated', sidecar.meta?.test === true);
  }

  {
    // Mixed-width grids get padded to uniform size
    const narrow = [[1, 2]];       // 2 wide
    const wide   = [[1, 2, 3, 4]]; // 4 wide
    const { width, height, keyframes } =
      assembleAnimation([narrow, wide], [100, 100], PALETTE, 1);

    check('padded to max width (4)', width === 4);
    check('padded to max height (1)', height === 1);
    check('narrow grid padded: transparent fill',
      keyframes[0].grid[0][2] === 0 && keyframes[0].grid[0][3] === 0);
    check('wide grid unchanged',
      keyframes[1].grid[0][3] === 4);
  }

  {
    // Spritesheet PNG dimensions: width = sum(cell_widths) * scale, height = maxH * scale
    // For 2 frames of identical 3×2 grids at scale=3 → sheet is 18×6
    const g = [[1, 2, 3], [4, 5, 6]];
    const { pngBytes, sidecar } =
      assembleAnimation([g, g], [100, 100], PALETTE, 3, ['x', 'y']);
    // PNG signature + header presence
    check('PNG has correct signature', pngBytes[0] === 137 && pngBytes[1] === 80);
    check('sidecar frames have correct labels',
      sidecar.frames[0].label === 'x' && sidecar.frames[1].label === 'y');
  }
}
