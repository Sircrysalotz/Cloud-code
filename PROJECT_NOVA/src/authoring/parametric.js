/**
 * Parametric warrior generator.
 *
 * All generation behaviour is controlled by a single params object so the
 * auto-iteration loop can mutate params between runs without touching
 * generator logic.  Every function is pure — same params, same grid.
 */

import { makeGrid, cloneGrid, gridSize } from '../core/grid.js';
import { IDX } from '../core/palette.js';

const T  = IDX.TRANSPARENT;
const OL = IDX.OUTLINE;
const SD = IDX.SHADOW_DEEP;
const SH = IDX.SHADOW;
const MI = IDX.MID;
const BR = IDX.BRIGHT;
const HI = IDX.HIGHLIGHT;
const PK = IDX.PEAK;

// ── Default parameters ────────────────────────────────────────────────────────

/**
 * Return a fresh copy of the default warrior parameters.
 *
 * Gradient thresholds: cumulative breakpoints over t ∈ [0,1].
 * Each breakpoint is the upper edge of that band:
 *   t < th[0] → SD, t < th[1] → SH, t < th[2] → MI,
 *   t < th[3] → BR, t < th[4] → HI, else PK
 */
export function defaultParams() {
  return _baseParams([0.28, 0.46, 0.82, 0.86, 0.93]);
}

/**
 * Deliberately imbalanced start — very shadow-heavy, almost no mid or bright.
 * Used by the auto-iteration demo to force several correction rounds.
 */
export function badStartParams() {
  return _baseParams([0.55, 0.68, 0.75, 0.78, 0.82]);
}

function _baseParams(thresholds) {
  return {
    // Canvas size
    W: 24,
    H: 40,

    // Gradient thresholds (6 breakpoints for 6 body bands SD→PK)
    thresholds,  // passed in — do not hardcode here

    // Body-part definitions: [r0, r1, c0, c1, colBias]
    parts: {
      hair:       [0,  1,  9, 16,  0.00],
      head:       [2,  7,  9, 15,  0.00],
      neck:       [8,  9, 10, 14, -0.05],
      torso:      [10, 19, 7, 17,  0.00],
      arm_left:   [10, 17, 4,  8, -0.15],
      arm_right:  [10, 17, 17, 21, 0.15],
      hips:       [20, 21, 8, 16,  0.00],
      leg_left:   [22, 37, 6, 11, -0.10],
      leg_right:  [22, 37, 13, 18, 0.10],
      boot_left:  [38, 39, 5, 11,  0.00],
      boot_right: [38, 39, 12, 18, 0.00],
    },

    // Accent pixels: [r, c, index]
    accents: [
      [10, 6, HI], [10, 7, HI], [10, 20, HI], [10, 21, HI],  // shoulder pads
      [30, 8, HI], [30, 9, HI], [30, 13, HI], [30, 14, HI],  // knee highlights
      [3, 14, PK], [4, 14, PK], [11, 16, PK], [12, 16, PK],  // chest specular
    ],
  };
}

// ── Gradient function ─────────────────────────────────────────────────────────

/**
 * Map a normalised position t ∈ [0,1] to a palette index using the
 * 5 threshold breakpoints in params.
 */
export function gradientIndex(t, params) {
  const [t0, t1, t2, t3, t4] = params.thresholds;
  if (t < t0) return SD;
  if (t < t1) return SH;
  if (t < t2) return MI;
  if (t < t3) return BR;
  if (t < t4) return HI;
  return PK;
}

// ── Region fill ───────────────────────────────────────────────────────────────

function fillRegion(grid, r0, r1, c0, c1, params, colBias = 0) {
  const span = c1 - c0;
  if (span <= 0) return;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c < c1; c++) {
      const t = Math.max(0, Math.min(1, (c - c0) / span + colBias));
      grid[r][c] = gradientIndex(t, params);
    }
  }
}

// ── Hair special gradient ─────────────────────────────────────────────────────

function hairIndex(t) {
  if (t < 0.3) return SD;
  if (t < 0.6) return SH;
  return MI;
}

// ── Boot special gradient ─────────────────────────────────────────────────────

function bootIndex(t, side) {
  if (side === 'left')  return t < 0.6 ? SD : SH;
  return t < 0.4 ? SH : MI;
}

// ── Outline pass ──────────────────────────────────────────────────────────────

function addOutline(grid, W, H) {
  const g = cloneGrid(grid);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (grid[r][c] === T) {
        const neighbors = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]];
        if (neighbors.some(([nr,nc]) =>
          nr >= 0 && nr < H && nc >= 0 && nc < W && grid[nr][nc] !== T
        )) {
          g[r][c] = OL;
        }
      }
    }
  }
  return g;
}

// ── Build grid from params ────────────────────────────────────────────────────

/**
 * Generate a warrior grid from params.
 * Returns a raw grid (before cleanup).
 *
 * @param {object} params  — from defaultParams(), may be mutated by adjuster
 * @returns {Grid}
 */
export function buildFromParams(params) {
  const { W, H, parts, accents } = params;
  let g = makeGrid(W, H, T);

  const { hair, head, neck, torso, arm_left, arm_right,
          hips, leg_left, leg_right, boot_left, boot_right } = parts;

  // Hair — special gradient
  for (let r = hair[0]; r <= hair[1]; r++) {
    const span = hair[3] - hair[2];
    for (let c = hair[2]; c < hair[3]; c++) {
      const t = span > 0 ? (c - hair[2]) / span : 0;
      if (r < H && c < W) g[r][c] = hairIndex(t);
    }
  }

  // Body parts — warm gradient with per-part bias
  for (const [part, def] of Object.entries({ head, neck, torso, arm_left, arm_right, hips, leg_left, leg_right })) {
    const [r0, r1, c0, c1, bias] = def;
    fillRegion(g, r0, r1, c0, c1, params, bias);
  }

  // Boots — special gradient
  const [bl0, bl1, blc0, blc1] = boot_left;
  const bspan_l = blc1 - blc0;
  for (let r = bl0; r <= bl1; r++) {
    for (let c = blc0; c < blc1; c++) {
      if (r < H && c < W) g[r][c] = bootIndex((c - blc0) / Math.max(bspan_l, 1), 'left');
    }
  }
  const [br0, br1, brc0, brc1] = boot_right;
  const bspan_r = brc1 - brc0;
  for (let r = br0; r <= br1; r++) {
    for (let c = brc0; c < brc1; c++) {
      if (r < H && c < W) g[r][c] = bootIndex((c - brc0) / Math.max(bspan_r, 1), 'right');
    }
  }

  // Accents
  for (const [r, c, idx] of accents) {
    if (r < H && c < W) g[r][c] = idx;
  }

  // Outline
  g = addOutline(g, W, H);
  return g;
}

// ── Parameter adjuster ────────────────────────────────────────────────────────

/**
 * Apply one round of corrections to params based on eval flags.
 *
 * Each flag is an object: { metric, direction, severity }
 * direction: 'low' | 'high'
 *
 * Returns a new params object (does not mutate the input).
 */
export function adjustParams(params, flags) {
  const p = JSON.parse(JSON.stringify(params));  // deep clone
  const th = p.thresholds;

  const STEP = {
    warn:     0.03,
    bad:      0.06,
    critical: 0.10,
  };

  for (const flag of flags) {
    const step = STEP[flag.severity] ?? STEP.warn;
    const { key: metric, direction } = flag;  // compare.js uses 'key', not 'metric'

    // Thresholds array: [SD|SH split, SH|MI split, MI|BR split, BR|HI split, HI|PK split]
    //   index:               0              1              2             3             4
    // Raising a lower threshold → widens that band.
    // Lowering an upper threshold → widens that band.

    if (metric === 'shadow_deep_ratio') {
      if (direction === 'low')  th[0] = clamp(th[0] + step, 0.05, th[1] - 0.05);
      if (direction === 'high') th[0] = clamp(th[0] - step, 0.05, th[1] - 0.05);
    }

    if (metric === 'shadow_ratio') {
      if (direction === 'low')  th[1] = clamp(th[1] + step, th[0] + 0.05, th[2] - 0.05);
      if (direction === 'high') th[1] = clamp(th[1] - step, th[0] + 0.05, th[2] - 0.05);
    }

    if (metric === 'mid_ratio') {
      if (direction === 'low') {
        // Widen mid: push both its boundaries outward
        const orig1 = th[1], orig2 = th[2];
        th[1] = clamp(orig1 - step, th[0] + 0.03, orig2 - 0.03);
        th[2] = clamp(orig2 + step, orig1 + 0.03, th[3] - 0.02);
      }
      if (direction === 'high') {
        const orig1 = th[1], orig2 = th[2];
        th[1] = clamp(orig1 + step, th[0] + 0.03, orig2 - 0.03);
        th[2] = clamp(orig2 - step, orig1 + 0.03, th[3] - 0.02);
      }
    }

    if (metric === 'bright_ratio') {
      if (direction === 'low')  th[3] = clamp(th[3] + step, th[2] + 0.02, th[4] - 0.02);
      if (direction === 'high') th[3] = clamp(th[3] - step, th[2] + 0.02, th[4] - 0.02);
    }

    if (metric === 'highlight_ratio') {
      if (direction === 'low')  th[4] = clamp(th[4] + step, th[3] + 0.02, 0.98);
      if (direction === 'high') th[4] = clamp(th[4] - step, th[3] + 0.02, 0.98);
    }

    // peak_ratio is the remainder above th[4]; to raise peak lower th[4], to lower peak raise th[4]
    if (metric === 'peak_ratio') {
      if (direction === 'low')  th[4] = clamp(th[4] - step, th[3] + 0.02, 0.98);
      if (direction === 'high') th[4] = clamp(th[4] + step, th[3] + 0.02, 0.98);
    }
  }

  p.thresholds = th;
  return p;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
