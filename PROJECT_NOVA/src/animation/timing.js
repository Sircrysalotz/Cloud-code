/**
 * Per-frame timing utilities.
 *
 * All timing is explicit per-keyframe — never inferred from uniform FPS.
 * Easing functions operate on normalized t ∈ [0,1] and return a duration
 * multiplier that gets applied to a base duration.
 */

// ── Easing functions (t → multiplier) ────────────────────────────────────────

export const ease = {
  /** Constant — all frames identical duration. */
  linear: (_t) => 1,

  /** Ease in: slow start, faster end (quadratic). */
  easeIn: (t) => 1 + t,

  /** Ease out: fast start, slower end (quadratic). */
  easeOut: (t) => 2 - t,

  /** Ease in-out: slow at both ends, fast in the middle. */
  easeInOut: (t) => 1 + Math.sin(Math.PI * t - Math.PI / 2),

  /** Hold-and-pop: long hold on first frame, short pop on last. */
  holdPop: (t) => t < 0.8 ? 1.5 : 0.3,

  /** Anticipation: quick frames before a hold, then a long hold. */
  anticipation: (t) => t < 0.5 ? 0.5 : 2.0,
};

// ── Duration builders ─────────────────────────────────────────────────────────

/**
 * Distribute a total duration across N frames using an easing curve.
 *
 * @param {number} n           — number of frames
 * @param {number} totalMs     — total animation duration (ms)
 * @param {Function} [easeFn]  — easing function (default: linear)
 * @returns {number[]}         — per-frame durations (ms), integers, sum = totalMs
 */
export function distributeDurations(n, totalMs, easeFn = ease.linear) {
  if (n <= 0) throw new Error('n must be > 0');
  const weights = Array.from({ length: n }, (_, i) => easeFn(i / Math.max(n - 1, 1)));
  const total = weights.reduce((a, b) => a + b, 0);
  const raw   = weights.map(w => (w / total) * totalMs);
  // Round to integers, distribute remainder
  const floors = raw.map(Math.floor);
  const remainder = totalMs - floors.reduce((a, b) => a + b, 0);
  const indices = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let i = 0; i < remainder; i++) floors[indices[i][1]]++;
  return floors;
}

/**
 * Standard idle animation timing: 4 frames, ~600ms total.
 * Slightly longer on neutral frame (0 and 2), shorter on peak offset frames (1 and 3).
 */
export function idleTiming(totalMs = 600) {
  return distributeDurations(4, totalMs, (t) => {
    // Frame 0: neutral (long) → frame 1: offset (short) → frame 2: neutral (long) → frame 3: offset (short)
    const cycle = Math.abs(Math.sin(t * Math.PI)); // peaks at t=0.5
    return 0.6 + 0.8 * (1 - cycle); // long on ends (0,1), short in middle
  });
}

/**
 * Walk cycle timing: 4 frames, ~400ms total.
 * Even timing with a slight ease on the contact frames.
 */
export function walkTiming(totalMs = 400) {
  return distributeDurations(4, totalMs, ease.linear);
}

// ── FPS helpers ───────────────────────────────────────────────────────────────

/** Convert a frame count + FPS to per-frame duration (ms). */
export function fpsToMs(fps) { return Math.round(1000 / fps); }

/** Convert an array of durations to approximate FPS values for display. */
export function durationsToFps(durations) {
  return durations.map(d => Math.round(1000 / d));
}
