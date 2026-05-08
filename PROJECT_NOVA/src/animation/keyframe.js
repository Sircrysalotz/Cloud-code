/**
 * Keyframe data structure.
 *
 * A keyframe is a single animation frame: one palette-index grid
 * plus timing metadata. Grids are immutable — each frame owns its data.
 *
 * Per the brief: per-frame timing always. Never uniform sampling.
 */

import { cloneGrid, gridSize } from '../core/grid.js';

// ── Keyframe factory ──────────────────────────────────────────────────────────

/**
 * Create a keyframe.
 *
 * @param {Grid}   grid         — palette-index grid for this frame
 * @param {number} durationMs   — how long this frame is displayed (milliseconds)
 * @param {object} [meta]       — optional metadata (label, tags, notes)
 * @returns {Keyframe}
 */
export function makeKeyframe(grid, durationMs, meta = {}) {
  if (!Array.isArray(grid) || grid.length === 0) throw new Error('grid must be a non-empty array');
  if (typeof durationMs !== 'number' || durationMs <= 0) throw new Error('durationMs must be > 0');

  const [w, h] = gridSize(grid);
  return {
    grid:       cloneGrid(grid), // defensive copy — keyframe owns its data
    durationMs: Math.round(durationMs),
    width:      w,
    height:     h,
    label:      meta.label  ?? '',
    tags:       meta.tags   ?? [],
    notes:      meta.notes  ?? '',
  };
}

// ── Sequence utilities ────────────────────────────────────────────────────────

/**
 * Total duration of a sequence of keyframes (ms).
 */
export function totalDuration(keyframes) {
  return keyframes.reduce((s, kf) => s + kf.durationMs, 0);
}

/**
 * Assert all keyframes in a sequence have the same dimensions.
 * Returns {width, height} or throws.
 */
export function assertUniformSize(keyframes) {
  if (keyframes.length === 0) throw new Error('empty keyframe sequence');
  const { width, height } = keyframes[0];
  for (let i = 1; i < keyframes.length; i++) {
    if (keyframes[i].width !== width || keyframes[i].height !== height) {
      throw new Error(`keyframe ${i} is ${keyframes[i].width}×${keyframes[i].height}, expected ${width}×${height}`);
    }
  }
  return { width, height };
}

/**
 * Serialise a sequence to a plain JSON-safe object (grids as flat row arrays).
 */
export function sequenceToJSON(keyframes, meta = {}) {
  const { width, height } = assertUniformSize(keyframes);
  return {
    version:     1,
    width,
    height,
    frameCount:  keyframes.length,
    totalMs:     totalDuration(keyframes),
    meta,
    frames: keyframes.map((kf, i) => ({
      index:      i,
      durationMs: kf.durationMs,
      label:      kf.label,
      tags:       kf.tags,
      notes:      kf.notes,
      data:       kf.grid.map(row => Array.from(row)),
    })),
  };
}

/**
 * Deserialise a sequence from a JSON-safe object.
 */
export function sequenceFromJSON(obj) {
  return obj.frames.map(f =>
    makeKeyframe(f.data, f.durationMs, { label: f.label, tags: f.tags, notes: f.notes })
  );
}
