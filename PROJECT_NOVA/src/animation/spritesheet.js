/**
 * Sprite sheet export.
 *
 * Combines a sequence of keyframes into:
 *   1. A horizontal-strip PNG (frames left-to-right)
 *   2. A JSON sidecar with per-frame timing and metadata
 *
 * The PNG is the human-visible output. The JSON sidecar is the
 * AI-readable representation of the animation.
 */

import { assertUniformSize, sequenceToJSON, totalDuration } from './keyframe.js';
import { framesToSpritesheetPNG } from '../export/png_writer.js';
import { gridToAscii }           from '../core/ascii.js';
import { PALETTE }               from '../core/palette.js';

// ── PNG export ────────────────────────────────────────────────────────────────

/**
 * Encode a keyframe sequence to a horizontal-strip spritesheet PNG.
 *
 * @param {Keyframe[]} keyframes
 * @param {number}     [scale=4]  — pixel scale factor
 * @returns {Uint8Array}          — PNG bytes
 */
export function keyframesToPNG(keyframes, scale = 4) {
  const grids = keyframes.map(kf => kf.grid);
  return framesToSpritesheetPNG(grids, PALETTE, scale);
}

// ── JSON sidecar ──────────────────────────────────────────────────────────────

/**
 * Build the JSON sidecar for an animation.
 * Contains timing, labels, and a compact ASCII preview of each frame.
 *
 * @param {Keyframe[]} keyframes
 * @param {object}     [meta]    — animation-level metadata
 * @returns {object}             — plain JSON-safe object
 */
export function buildSidecar(keyframes, meta = {}) {
  const seq = sequenceToJSON(keyframes, meta);

  // Attach ASCII previews — the AI's per-frame perception medium
  seq.frames = seq.frames.map(f => ({
    ...f,
    ascii: gridToAscii(f.data),
  }));

  return seq;
}

// ── Summary ───────────────────────────────────────────────────────────────────

/**
 * Print a human-readable animation summary (text, no rendering).
 * Used for quick inspection during generation.
 */
export function animationSummary(keyframes, label = 'animation') {
  const { width, height } = assertUniformSize(keyframes);
  const total = totalDuration(keyframes);
  const lines = [
    `[${label}] ${keyframes.length} frames, ${width}×${height}px, ${total}ms total`,
  ];
  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i];
    const fps = Math.round(1000 / kf.durationMs);
    lines.push(`  frame ${i}: ${kf.durationMs}ms (~${fps}fps)${kf.label ? ' ' + kf.label : ''}`);
  }
  return lines.join('\n');
}
