/**
 * grid_ops.js — Phase 23: Grid surgery operations.
 *
 * Pure functions that reshape palette-index grids without touching color data.
 * All operations return new Uint8Array[] grids; inputs are never mutated.
 *
 * Operations:
 *   contentBounds  — bounding box of non-transparent pixels
 *   cropToContent  — remove transparent border rows/cols
 *   padGrid        — add transparent padding on any side
 *   padToSize      — pad (not crop) to a minimum width × height
 *   flipH          — mirror left↔right
 *   flipV          — mirror top↔bottom
 *   rotateGrid     — rotate 90°/180°/270° clockwise
 *   scaleGrid      — nearest-neighbor integer upscale
 *   centerIn       — center a smaller grid in a larger canvas
 *   normalizeSize  — crop-then-pad to exact target dimensions
 */

import { cloneGrid }     from './grid.js';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Create an empty (all-zero) grid of given dimensions. */
function emptyGrid(w, h) {
  return Array.from({ length: h }, () => new Uint8Array(w));
}

// ── contentBounds ─────────────────────────────────────────────────────────────

/**
 * Find the bounding box of all non-transparent (index > 0) pixels.
 *
 * @param {Uint8Array[]} grid
 * @returns {{ top, left, bottom, right, width, height }}
 *   Returns { top:0, left:0, bottom:-1, right:-1, width:0, height:0 }
 *   if grid is entirely transparent.
 */
export function contentBounds(grid) {
  const H = grid.length;
  const W = grid[0]?.length ?? 0;

  let top = H, left = W, bottom = -1, right = -1;

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (grid[r][c] !== 0) {
        if (r < top)    top    = r;
        if (r > bottom) bottom = r;
        if (c < left)   left   = c;
        if (c > right)  right  = c;
      }
    }
  }

  if (bottom === -1) {
    return { top: 0, left: 0, bottom: -1, right: -1, width: 0, height: 0 };
  }

  return {
    top, left, bottom, right,
    width:  right - left + 1,
    height: bottom - top + 1,
  };
}

// ── cropToContent ─────────────────────────────────────────────────────────────

/**
 * Remove all fully-transparent border rows and columns.
 *
 * @param {Uint8Array[]} grid
 * @returns {Uint8Array[]}  — cropped grid (or empty 1×1 if all transparent)
 */
export function cropToContent(grid) {
  const b = contentBounds(grid);
  if (b.width === 0) return emptyGrid(1, 1);

  return Array.from({ length: b.height }, (_, r) => {
    const row = new Uint8Array(b.width);
    for (let c = 0; c < b.width; c++) {
      row[c] = grid[b.top + r][b.left + c];
    }
    return row;
  });
}

// ── padGrid ───────────────────────────────────────────────────────────────────

/**
 * Add transparent padding on any combination of sides.
 *
 * @param {Uint8Array[]} grid
 * @param {object}       padding  — { top, bottom, left, right } (all default 0)
 * @returns {Uint8Array[]}
 */
export function padGrid(grid, { top = 0, bottom = 0, left = 0, right = 0 } = {}) {
  const H  = grid.length;
  const W  = grid[0]?.length ?? 0;
  const nW = W + left + right;
  const nH = H + top + bottom;

  const out = emptyGrid(nW, nH);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      out[r + top][c + left] = grid[r][c];
    }
  }
  return out;
}

// ── padToSize ─────────────────────────────────────────────────────────────────

/**
 * Pad a grid to at least targetW × targetH by adding equal padding on
 * each axis (content stays centered).  If already larger, returns a clone.
 *
 * @param {Uint8Array[]} grid
 * @param {number}       targetW
 * @param {number}       targetH
 * @returns {Uint8Array[]}
 */
export function padToSize(grid, targetW, targetH) {
  const H = grid.length;
  const W = grid[0]?.length ?? 0;

  const extraW = Math.max(0, targetW - W);
  const extraH = Math.max(0, targetH - H);

  const padL = Math.floor(extraW / 2);
  const padR = extraW - padL;
  const padT = Math.floor(extraH / 2);
  const padB = extraH - padT;

  return padGrid(grid, { top: padT, bottom: padB, left: padL, right: padR });
}

// ── flipH / flipV ─────────────────────────────────────────────────────────────

/**
 * Mirror grid left↔right (horizontal flip).
 * @param {Uint8Array[]} grid
 * @returns {Uint8Array[]}
 */
export function flipH(grid) {
  return grid.map(row => {
    const r = new Uint8Array(row.length);
    for (let c = 0; c < row.length; c++) r[c] = row[row.length - 1 - c];
    return r;
  });
}

/**
 * Mirror grid top↔bottom (vertical flip).
 * @param {Uint8Array[]} grid
 * @returns {Uint8Array[]}
 */
export function flipV(grid) {
  return grid.slice().reverse().map(row => new Uint8Array(row));
}

// ── rotateGrid ────────────────────────────────────────────────────────────────

/**
 * Rotate grid clockwise by 90°, 180°, or 270°.
 *
 * @param {Uint8Array[]} grid
 * @param {90|180|270}   degrees
 * @returns {Uint8Array[]}
 */
export function rotateGrid(grid, degrees) {
  if (![90, 180, 270].includes(degrees)) {
    throw new Error(`rotateGrid: degrees must be 90, 180, or 270 (got ${degrees})`);
  }

  const H = grid.length;
  const W = grid[0]?.length ?? 0;

  if (degrees === 180) {
    return Array.from({ length: H }, (_, r) => {
      const row = new Uint8Array(W);
      for (let c = 0; c < W; c++) row[c] = grid[H - 1 - r][W - 1 - c];
      return row;
    });
  }

  if (degrees === 90) {
    // new dims: W×H
    return Array.from({ length: W }, (_, r) => {
      const row = new Uint8Array(H);
      for (let c = 0; c < H; c++) row[c] = grid[H - 1 - c][r];
      return row;
    });
  }

  // 270° = three 90° rotations = transpose + flip horizontally
  return Array.from({ length: W }, (_, r) => {
    const row = new Uint8Array(H);
    for (let c = 0; c < H; c++) row[c] = grid[c][W - 1 - r];
    return row;
  });
}

// ── scaleGrid ─────────────────────────────────────────────────────────────────

/**
 * Scale a grid up by an integer factor (nearest-neighbor).
 * Each cell becomes factor×factor cells with the same index.
 *
 * @param {Uint8Array[]} grid
 * @param {number}       factor  — integer ≥ 1
 * @returns {Uint8Array[]}
 */
export function scaleGrid(grid, factor) {
  if (!Number.isInteger(factor) || factor < 1) {
    throw new Error(`scaleGrid: factor must be an integer ≥ 1 (got ${factor})`);
  }
  if (factor === 1) return cloneGrid(grid);

  const H  = grid.length;
  const W  = grid[0]?.length ?? 0;
  const nH = H * factor;
  const nW = W * factor;

  return Array.from({ length: nH }, (_, r) => {
    const srcRow = grid[Math.floor(r / factor)];
    const row    = new Uint8Array(nW);
    for (let c = 0; c < nW; c++) row[c] = srcRow[Math.floor(c / factor)];
    return row;
  });
}

// ── centerIn ─────────────────────────────────────────────────────────────────

/**
 * Center a sprite grid inside a larger canvas of size canvasW × canvasH.
 * Transparent padding fills the surrounding area.
 * If the sprite is already larger, it is placed at (0,0) and clipped.
 *
 * @param {Uint8Array[]} grid
 * @param {number}       canvasW
 * @param {number}       canvasH
 * @returns {Uint8Array[]}
 */
export function centerIn(grid, canvasW, canvasH) {
  const H  = grid.length;
  const W  = grid[0]?.length ?? 0;

  const offsetX = Math.floor((canvasW - W) / 2);
  const offsetY = Math.floor((canvasH - H) / 2);

  const out = emptyGrid(canvasW, canvasH);
  for (let r = 0; r < H; r++) {
    const dr = r + offsetY;
    if (dr < 0 || dr >= canvasH) continue;
    for (let c = 0; c < W; c++) {
      const dc = c + offsetX;
      if (dc < 0 || dc >= canvasW) continue;
      out[dr][dc] = grid[r][c];
    }
  }
  return out;
}

// ── normalizeSize ─────────────────────────────────────────────────────────────

/**
 * Normalize a sprite to exactly targetW × targetH:
 *   1. Crop to content bounds
 *   2. If larger than target: center-crop (clip) to target
 *   3. If smaller: center in target canvas (pad with transparent)
 *
 * @param {Uint8Array[]} grid
 * @param {number}       targetW
 * @param {number}       targetH
 * @returns {Uint8Array[]}
 */
export function normalizeSize(grid, targetW, targetH) {
  const cropped = cropToContent(grid);
  const cH = cropped.length;
  const cW = cropped[0]?.length ?? 0;

  if (cW <= targetW && cH <= targetH) {
    return centerIn(cropped, targetW, targetH);
  }

  // Need to clip: take center region of size targetW×targetH
  const clipX = Math.floor((cW - targetW) / 2);
  const clipY = Math.floor((cH - targetH) / 2);

  return Array.from({ length: targetH }, (_, r) => {
    const row = new Uint8Array(targetW);
    const srcR = r + Math.max(0, clipY);
    if (srcR >= cH) return row;
    for (let c = 0; c < targetW; c++) {
      const srcC = c + Math.max(0, clipX);
      if (srcC < cW) row[c] = cropped[srcR][srcC];
    }
    return row;
  });
}
