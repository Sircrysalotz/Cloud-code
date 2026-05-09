/**
 * Pose library — parametric warrior pose variants.
 *
 * Each pose is a function that returns a full params object compatible with
 * buildFromParams() in parametric.js. Poses differ in body-part bounds,
 * canvas size, and accent placement — not in gradient logic.
 *
 * All poses use the same gradient thresholds by default so goku_iterate.js
 * can calibrate each to match the Goku band distribution.
 *
 * Available poses:
 *   idle       — standing at rest, arms at sides
 *   guard      — defensive stance, forearms raised
 *   punch      — right arm fully extended, left arm cocked back
 *   kick       — right leg raised/extended, planted on left foot
 *   power_up   — arms spread wide, power stance
 */

import { IDX } from '../core/palette.js';

const { SHADOW_DEEP: SD, SHADOW: SH, MID: MI, BRIGHT: BR,
        HIGHLIGHT: HI, PEAK: PK } = IDX;

// Default thresholds — can be overridden by goku_iterate to calibrate bands
const DEFAULT_THRESHOLDS = [0.28, 0.46, 0.82, 0.86, 0.93];

// ── Pose factories ────────────────────────────────────────────────────────────

/**
 * idle — standing at rest. Baseline pose (same as defaultParams in parametric.js).
 */
export function idleParams(thresholds = DEFAULT_THRESHOLDS) {
  return {
    W: 24, H: 40,
    thresholds: [...thresholds],
    parts: {
      hair:        [0,  1,  9, 16,  0.00],
      head:        [2,  7,  9, 15,  0.00],
      neck:        [8,  9, 10, 14, -0.05],
      torso:       [10, 19, 7, 17,  0.00],
      arm_left:    [10, 17, 4,  8, -0.15],
      arm_right:   [10, 17, 17, 21, 0.15],
      hips:        [20, 21, 8, 16,  0.00],
      leg_left:    [22, 37, 6, 11, -0.10],
      leg_right:   [22, 37, 13, 18, 0.10],
      boot_left:   [38, 39, 5, 11,  0.00],
      boot_right:  [38, 39, 12, 18, 0.00],
    },
    accents: [
      [10,  6, HI], [10,  7, HI], [10, 20, HI], [10, 21, HI],
      [30,  8, HI], [30,  9, HI], [30, 13, HI], [30, 14, HI],
      [3,  14, PK], [4,  14, PK], [11, 16, PK], [12, 16, PK],
    ],
  };
}

/**
 * guard — defensive stance, both forearms raised to chest height.
 * Arms are higher and angled inward; slightly wider stance.
 */
export function guardParams(thresholds = DEFAULT_THRESHOLDS) {
  return {
    W: 26, H: 40,
    thresholds: [...thresholds],
    parts: {
      hair:        [0,  1, 10, 17,  0.00],
      head:        [2,  7, 10, 16,  0.00],
      neck:        [8,  9, 11, 15, -0.05],
      torso:       [10, 20, 8, 18,  0.00],
      // Arms raised — upper arms rows 8-13, forearms rows 5-9
      arm_left:    [8,  13, 3,  8, -0.20],
      arm_right:   [8,  13, 18, 23, 0.20],
      forearm_left:  [5, 10, 2,  7, -0.25],
      forearm_right: [5, 10, 19, 24, 0.25],
      hips:        [21, 22, 9, 17,  0.00],
      leg_left:    [23, 37, 7, 12, -0.10],
      leg_right:   [23, 37, 14, 19, 0.10],
      boot_left:   [38, 39, 6, 12,  0.00],
      boot_right:  [38, 39, 13, 19, 0.00],
    },
    accents: [
      // Shoulder guards
      [8, 4, HI], [8, 5, HI], [8, 21, HI], [8, 22, HI],
      // Fist highlights
      [6, 3, HI], [6, 4, HI], [6, 21, HI], [6, 22, HI],
      // Head specular
      [3, 15, PK], [4, 15, PK],
      // Torso specular
      [12, 17, PK], [13, 17, PK],
    ],
  };
}

/**
 * punch — right arm fully extended, left arm cocked back.
 * Canvas is wider to accommodate the extended punch arm.
 */
export function punchParams(thresholds = DEFAULT_THRESHOLDS) {
  return {
    W: 30, H: 40,
    thresholds: [...thresholds],
    parts: {
      hair:        [0,  1, 10, 17,  0.00],
      head:        [2,  7, 10, 16,  0.00],
      neck:        [8,  9, 11, 15, -0.05],
      torso:       [10, 20, 8, 18,  0.00],
      // Left arm cocked back (tight, at side)
      arm_left:    [10, 16, 4,  8, -0.25],
      // Right arm fully extended (rows 9-12, cols 17-28)
      arm_right:   [9,  12, 17, 28, 0.30],
      hips:        [21, 22, 9, 17,  0.00],
      leg_left:    [23, 37, 7, 12, -0.12],
      leg_right:   [23, 37, 14, 19, 0.08],
      boot_left:   [38, 39, 6, 12,  0.00],
      boot_right:  [38, 39, 13, 19, 0.00],
    },
    accents: [
      // Shoulder socket
      [10, 7, HI], [10, 17, HI],
      // Fist knuckles (extended arm tip)
      [10, 26, HI], [10, 27, HI], [11, 26, HI],
      [10, 27, PK], [11, 27, PK],
      // Head specular
      [3, 15, PK], [4, 15, PK],
    ],
  };
}

/**
 * kick — right leg raised and extended, weight on left leg.
 * Canvas is wider; right leg extends to the side.
 */
export function kickParams(thresholds = DEFAULT_THRESHOLDS) {
  return {
    W: 28, H: 40,
    thresholds: [...thresholds],
    parts: {
      hair:        [0,  1, 10, 17,  0.00],
      head:        [2,  7, 10, 16,  0.00],
      neck:        [8,  9, 11, 15, -0.05],
      torso:       [10, 20, 7, 17,  0.05],  // slight lean
      // Left arm up for balance
      arm_left:    [7,  15, 2,  7, -0.20],
      arm_right:   [11, 18, 16, 20, 0.10],
      hips:        [21, 22, 8, 16,  0.00],
      // Left leg planted
      leg_left:    [23, 37, 5, 10, -0.10],
      // Right leg raised and extended (rows 20-26, cols 14-26)
      leg_right:   [20, 26, 13, 26, 0.20],
      boot_left:   [38, 39, 4, 10,  0.00],
      // Kick foot (at the tip of extended leg)
      boot_right:  [24, 25, 22, 27, 0.15],
    },
    accents: [
      // Balance arm highlight
      [8, 3, HI], [9, 3, HI],
      // Kick impact point
      [24, 24, HI], [24, 25, HI], [25, 24, HI],
      [24, 25, PK], [25, 25, PK],
      // Head specular
      [3, 15, PK], [4, 15, PK],
      // Knee highlight
      [22, 15, HI], [22, 16, HI],
    ],
  };
}

/**
 * power_up — dramatic energy stance, arms spread wide, feet planted wide.
 * Symmetrical but dynamic — widest canvas.
 */
export function powerUpParams(thresholds = DEFAULT_THRESHOLDS) {
  return {
    W: 32, H: 40,
    thresholds: [...thresholds],
    parts: {
      hair:        [0,  2, 12, 20,  0.00],
      head:        [3,  8, 12, 20,  0.00],
      neck:        [9, 10, 13, 19, -0.05],
      torso:       [11, 21, 9, 23,  0.00],
      // Arms fully spread — nearly horizontal
      arm_left:    [10, 16, 0,  9, -0.30],
      arm_right:   [10, 16, 23, 32, 0.30],
      hips:        [22, 23, 10, 22,  0.00],
      // Wide stance
      leg_left:    [24, 37, 4, 11, -0.15],
      leg_right:   [24, 37, 21, 28, 0.15],
      boot_left:   [38, 39, 3, 11,  0.00],
      boot_right:  [38, 39, 21, 29, 0.00],
    },
    accents: [
      // Shoulder caps (wide)
      [10, 1, HI], [10, 2, HI], [10, 30, HI], [10, 31, HI],
      // Chest energy cluster
      [14, 15, HI], [14, 16, HI], [14, 17, HI],
      [15, 15, HI], [15, 17, HI],
      [15, 16, PK], [14, 16, PK],
      // Head specular
      [4, 19, PK], [5, 19, PK],
      // Knee highlights
      [30, 6, HI], [30, 7, HI], [30, 23, HI], [30, 24, HI],
    ],
  };
}

// ── All poses registry ────────────────────────────────────────────────────────

export const POSES = {
  idle:     idleParams,
  guard:    guardParams,
  punch:    punchParams,
  kick:     kickParams,
  power_up: powerUpParams,
};

export const POSE_NAMES = Object.keys(POSES);

/**
 * Build params for a named pose with optional threshold override.
 *
 * @param {string} name  — one of POSE_NAMES
 * @param {number[]} [thresholds]
 * @returns {object}
 */
export function poseParams(name, thresholds) {
  const factory = POSES[name];
  if (!factory) throw new Error(`Unknown pose: "${name}". Available: ${POSE_NAMES.join(', ')}`);
  return factory(thresholds);
}
