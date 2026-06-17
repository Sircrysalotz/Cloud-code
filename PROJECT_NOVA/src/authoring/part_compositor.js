/**
 * part_compositor.js — Phase 28: Body-part extraction and character assembly.
 *
 * Splits real sprite frames into body parts (head / torso / legs) at seams
 * detected from the pixel data itself, then assembles parts from different
 * frames into a new character. Every output pixel comes from a real ingested
 * frame — no gradients, no parametric fills.
 *
 * Seam detection: a humanoid sprite's row-width profile has a sharp local
 * minimum at the neck (between the head's peak width and the shoulders) and
 * a softer minimum at the waist. We find those minima instead of using fixed
 * ratios, so the split adapts to each frame's actual anatomy.
 *
 * Cross-frame palettes: each batch frame has its own dynamic palette, so the
 * same index means different colors in different frames. Before compositing,
 * every part is remapped onto one shared target palette by luminance band
 * rank (the same machinery as style transfer). Pass the donor frame's own
 * palette as the target to keep original colors.
 *
 * API:
 *   rowProfile(grid)                      — per-row body extent (AI-readable)
 *   findSeams(grid)                       — { neckRow, hipRow } from the profile
 *   splitParts(grid)                      — { head, torso, legs } sub-grids + seam info
 *   alignColumns(parts)                   — horizontal offsets that align part centers
 *   compositeParts(parts)                 — stack head/torso/legs into one grid
 *   assembleCharacter(spec, loadFrame)    — full pipeline: parts spec → character grid
 */

import { contentBounds, cropToContent } from '../core/grid_ops.js';
import { transferStyle }                from '../../tools/style_transfer.js';

// ── rowProfile ────────────────────────────────────────────────────────────────

/**
 * Per-row occupancy profile of a sprite.
 *
 * @param {Array<Uint8Array|number[]>} grid
 * @returns {Array<{row, count, left, right, width}>}
 *   One entry per grid row. width = extent of non-transparent run (0 if empty).
 */
export function rowProfile(grid) {
  const H = grid.length, W = grid[0]?.length ?? 0;
  const profile = [];
  for (let r = 0; r < H; r++) {
    let count = 0, left = -1, right = -1;
    for (let c = 0; c < W; c++) {
      if (grid[r][c] !== 0) {
        count++;
        if (left === -1) left = c;
        right = c;
      }
    }
    profile.push({
      row: r, count, left, right,
      width: left === -1 ? 0 : right - left + 1,
    });
  }
  return profile;
}

// ── findSeams ─────────────────────────────────────────────────────────────────

/**
 * Locate the neck and hip seam rows from the row-width profile.
 *
 * Neck: the narrowest row after the head reaches its widest point, searched
 * in the top half of the content. Hip: the narrowest row in the 45-70% body
 * height window (waist), falling back to the 60% row when the profile is flat.
 *
 * @param {Array<Uint8Array|number[]>} grid
 * @returns {{ neckRow, hipRow, profile, bounds }}
 *   Rows are absolute grid rows. neckRow is the LAST row of the head;
 *   hipRow is the LAST row of the torso.
 */
export function findSeams(grid) {
  const bounds  = contentBounds(grid);
  const profile = rowProfile(grid);
  if (bounds.height === 0) {
    return { neckRow: -1, hipRow: -1, profile, bounds };
  }

  const { top, bottom, height } = bounds;
  const rowAt = (frac) => top + Math.round(frac * (height - 1));

  // Head peak: widest row in the top 25% of the body (going deeper risks
  // catching the shoulders, which pushes the neck search past the real neck)
  let headPeakRow = top, headPeakWidth = 0;
  for (let r = top; r <= rowAt(0.25); r++) {
    if (profile[r].width > headPeakWidth) {
      headPeakWidth = profile[r].width;
      headPeakRow   = r;
    }
  }

  // Neck: narrowest row between the head peak and 50% height
  let neckRow = rowAt(0.25), neckWidth = Infinity;
  for (let r = headPeakRow + 1; r <= rowAt(0.50); r++) {
    if (profile[r].width > 0 && profile[r].width < neckWidth) {
      neckWidth = profile[r].width;
      neckRow   = r;
    }
  }

  // Hip: narrowest row in the 45-70% window, below the neck
  const hipStart = Math.max(neckRow + 1, rowAt(0.45));
  let hipRow = rowAt(0.60), hipWidth = Infinity;
  for (let r = hipStart; r <= rowAt(0.70); r++) {
    if (profile[r].width > 0 && profile[r].width < hipWidth) {
      hipWidth = profile[r].width;
      hipRow   = r;
    }
  }

  return { neckRow, hipRow, profile, bounds };
}

// ── splitParts ────────────────────────────────────────────────────────────────

/**
 * Split a sprite into head / torso / legs sub-grids at detected seams.
 *
 * Each part is cropped to its own content bounds. Seam metadata records the
 * horizontal center of the body at each cut so parts can be re-aligned.
 *
 * @param {Array<Uint8Array|number[]>} grid
 * @returns {{ head, torso, legs, seams }}
 *   head/torso/legs: { grid, seamCenter } — seamCenter is the body's center
 *   column at the part's connecting edge (bottom edge for head/torso, top
 *   edge for torso/legs), relative to the part's own cropped grid.
 */
export function splitParts(grid) {
  const { neckRow, hipRow, profile, bounds } = findSeams(grid);
  if (bounds.height === 0) {
    throw new Error('splitParts: grid is entirely transparent');
  }

  const W = grid[0].length;
  const sliceRows = (r0, r1) => grid.slice(r0, r1 + 1).map(row => Array.from(row));

  // Center column of the body at a given absolute row (fall back to bbox center)
  const centerAt = (r) => {
    const p = profile[Math.max(0, Math.min(r, profile.length - 1))];
    return p.width > 0 ? (p.left + p.right) / 2 : bounds.left + bounds.width / 2;
  };

  const makePart = (r0, r1, seamRowAbs) => {
    const slice   = sliceRows(r0, r1);
    const cropped = cropToContent(slice);
    const b       = contentBounds(slice);
    // seamCenter relative to the cropped grid's left edge (row slicing keeps
    // original column coords, so subtracting the content left re-bases it)
    const seamCenter = centerAt(seamRowAbs) - b.left;
    return { grid: cropped, seamCenter };
  };

  return {
    head:  makePart(bounds.top,  neckRow,       neckRow),
    torso: makePart(neckRow + 1, hipRow,        neckRow + 1),
    legs:  makePart(hipRow + 1,  bounds.bottom, hipRow + 1),
    seams: { neckRow, hipRow, bounds },
  };
}

// ── compositeParts ────────────────────────────────────────────────────────────

/**
 * Stack head / torso / legs into one grid, horizontally aligned so each
 * part's seam center sits on a common vertical axis.
 *
 * @param {{ head, torso, legs }} parts — as returned by splitParts (each
 *   { grid, seamCenter }); any part may be omitted.
 * @returns {Uint8Array[]}
 */
export function compositeParts(parts) {
  const order = ['head', 'torso', 'legs'].filter(k => parts[k]?.grid?.length);
  if (order.length === 0) throw new Error('compositeParts: no parts given');

  const entries = order.map(k => {
    const { grid, seamCenter } = parts[k];
    const w = grid[0]?.length ?? 0;
    return { grid, w, h: grid.length, center: seamCenter ?? w / 2 };
  });

  // Common axis: place every part so its center lands on maxCenter
  const maxCenter = Math.max(...entries.map(e => e.center));
  const offsets   = entries.map(e => Math.round(maxCenter - e.center));
  const totalW    = Math.max(...entries.map((e, i) => offsets[i] + e.w));
  const totalH    = entries.reduce((s, e) => s + e.h, 0);

  const out = Array.from({ length: totalH }, () => new Uint8Array(totalW));
  let rowOffset = 0;
  entries.forEach((e, i) => {
    for (let r = 0; r < e.h; r++) {
      for (let c = 0; c < e.w; c++) {
        const v = e.grid[r][c];
        if (v !== 0) out[rowOffset + r][offsets[i] + c] = v;
      }
    }
    rowOffset += e.h;
  });
  return out;
}

// ── assembleCharacter ─────────────────────────────────────────────────────────

/**
 * Assemble a new character from body parts of different real frames.
 *
 * @param {object} spec
 *   {
 *     head:  { frame: 4 },          — donor frame index per part
 *     torso: { frame: 9 },
 *     legs:  { frame: 14 },
 *     targetFrame: 4,               — frame whose ORIGINAL palette becomes the
 *                                     shared palette (default: head's frame)
 *   }
 * @param {function} loadFrame — (frameIdx) => { grid, palette } | null
 * @returns {{ grid, palette, parts }} — assembled grid in the target palette
 */
export function assembleCharacter(spec, loadFrame) {
  const partKeys = ['head', 'torso', 'legs'].filter(k => spec[k]);
  if (partKeys.length === 0) throw new Error('assembleCharacter: no parts in spec');

  const targetIdx   = spec.targetFrame ?? spec[partKeys[0]].frame;
  const targetFrame = loadFrame(targetIdx);
  if (!targetFrame) throw new Error(`assembleCharacter: target frame ${targetIdx} not found`);
  const targetPalette = targetFrame.palette;

  const parts = {};
  const partInfo = {};
  for (const key of partKeys) {
    const { frame: frameIdx } = spec[key];
    const donor = loadFrame(frameIdx);
    if (!donor) throw new Error(`assembleCharacter: donor frame ${frameIdx} for ${key} not found`);

    // Unify palette FIRST (rank-based band mapping), then split
    const unified = frameIdx === targetIdx
      ? donor.grid
      : transferStyle(donor.grid, donor.palette, targetPalette);

    const split = splitParts(unified);
    parts[key] = split[key];
    partInfo[key] = { frame: frameIdx, seams: split.seams };
  }

  return {
    grid:    compositeParts(parts),
    palette: targetPalette,
    parts:   partInfo,
  };
}
