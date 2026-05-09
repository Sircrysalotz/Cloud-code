/**
 * grid_author.js — Phase 27: AI-native grid authoring primitives.
 *
 * The AI's drawing API. Works entirely in data space — palette index grids,
 * ASCII strings, cell coordinates. No pixels, no images, no visual perception.
 *
 * Every function is pure: inputs are never mutated; a new Grid is always returned.
 *
 * The authoring loop:
 *   canvas() / fromASCII() → draw → cleanup → eval → iterate
 */

import { makeGrid, cloneGrid, gridSize, setPixel, floodFill, getPixel } from './grid.js';
import { asciiToGrid, gridToAscii }                                      from './ascii.js';
import { PALETTE }                                                        from './palette.js';

// ── Canvas creation ───────────────────────────────────────────────────────────

/**
 * Create a blank (all-transparent) canvas of given dimensions.
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array[]}
 */
export function canvas(width, height) {
  return makeGrid(width, height, 0);
}

/**
 * Parse an ASCII string into a Grid.
 * Trims leading/trailing blank lines. Unknown chars → transparent.
 * @param {string} str
 * @param {import('./palette.js').Palette} [palette]
 * @returns {Uint8Array[]}
 */
export function fromASCII(str, palette = PALETTE) {
  const trimmed = str.replace(/^\n+|\n+$/g, '');
  return asciiToGrid(trimmed, palette);
}

// ── Painting primitives ───────────────────────────────────────────────────────

/**
 * Paint a single cell. Returns a new grid.
 * @param {Uint8Array[]} grid
 * @param {number} row
 * @param {number} col
 * @param {number} idx  palette index to set
 * @returns {Uint8Array[]}
 */
export function paintCell(grid, row, col, idx) {
  const out = cloneGrid(grid);
  setPixel(out, row, col, idx);
  return out;
}

/**
 * Paint a list of {row, col} cells with the same palette index.
 * @param {Uint8Array[]} grid
 * @param {{row: number, col: number}[]} cells
 * @param {number} idx
 * @returns {Uint8Array[]}
 */
export function paintCells(grid, cells, idx) {
  const out = cloneGrid(grid);
  for (const { row, col } of cells) setPixel(out, row, col, idx);
  return out;
}

/**
 * Flood-fill paint: fill all pixels connected to (row, col) with newIdx.
 * Connectivity is 4-way. The filled region is pixels matching the original value at (row,col).
 * @param {Uint8Array[]} grid
 * @param {number} row
 * @param {number} col
 * @param {number} newIdx
 * @returns {Uint8Array[]}
 */
export function paintFill(grid, row, col, newIdx) {
  const target = getPixel(grid, row, col);
  if (target === -1 || target === newIdx) return cloneGrid(grid);
  const cells = floodFill(grid, row, col, v => v === target);
  return paintCells(grid, cells, newIdx);
}

/**
 * Replace every occurrence of fromIdx with toIdx across the entire grid.
 * @param {Uint8Array[]} grid
 * @param {number} fromIdx
 * @param {number} toIdx
 * @returns {Uint8Array[]}
 */
export function replaceIndex(grid, fromIdx, toIdx) {
  const [w, h] = gridSize(grid);
  const out = cloneGrid(grid);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (out[r][c] === fromIdx) out[r][c] = toIdx;
    }
  }
  return out;
}

// ── Line and shape drawing ────────────────────────────────────────────────────

/**
 * Enumerate pixels along a line from (r0,c0) to (r1,c1) using Bresenham's algorithm.
 * @param {number} r0
 * @param {number} c0
 * @param {number} r1
 * @param {number} c1
 * @returns {{row: number, col: number}[]}
 */
export function linePixels(r0, c0, r1, c1) {
  const pixels = [];
  let dr = Math.abs(r1 - r0);
  let dc = Math.abs(c1 - c0);
  let sr = r0 < r1 ? 1 : -1;
  let sc = c0 < c1 ? 1 : -1;
  let err = dr - dc;
  let r = r0, c = c0;

  for (let guard = 0; guard < 100000; guard++) {
    pixels.push({ row: r, col: c });
    if (r === r1 && c === c1) break;
    const e2 = 2 * err;
    if (e2 > -dc) { err -= dc; r += sr; }
    if (e2 <  dr) { err += dr; c += sc; }
  }
  return pixels;
}

/**
 * Draw a line from (r0,c0) to (r1,c1) with the given palette index.
 * @param {Uint8Array[]} grid
 * @param {number} r0
 * @param {number} c0
 * @param {number} r1
 * @param {number} c1
 * @param {number} idx
 * @returns {Uint8Array[]}
 */
export function drawLine(grid, r0, c0, r1, c1, idx) {
  return paintCells(grid, linePixels(r0, c0, r1, c1), idx);
}

/**
 * Draw a rectangle outline (or filled) from (r0,c0) to (r1,c1) inclusive.
 * @param {Uint8Array[]} grid
 * @param {number} r0
 * @param {number} c0
 * @param {number} r1
 * @param {number} c1
 * @param {number} idx
 * @param {boolean} [filled=false]
 * @returns {Uint8Array[]}
 */
export function drawRect(grid, r0, c0, r1, c1, idx, filled = false) {
  const rMin = Math.min(r0, r1), rMax = Math.max(r0, r1);
  const cMin = Math.min(c0, c1), cMax = Math.max(c0, c1);
  const cells = [];
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      if (filled || r === rMin || r === rMax || c === cMin || c === cMax) {
        cells.push({ row: r, col: c });
      }
    }
  }
  return paintCells(grid, cells, idx);
}

/**
 * Enumerate pixels along an ellipse outline using parametric sampling.
 * Guarantees the 4 cardinal extremes (top/bottom/left/right) are always present.
 * @param {number} cr  center row
 * @param {number} cc  center col
 * @param {number} ra  row radius (semi-axis along rows)
 * @param {number} rb  col radius (semi-axis along cols)
 * @returns {{row: number, col: number}[]}
 */
export function ellipsePixels(cr, cc, ra, rb) {
  const seen   = new Set();
  const pixels = [];
  const add = (r, c) => {
    const key = r * 65536 + c;
    if (!seen.has(key)) { seen.add(key); pixels.push({ row: r, col: c }); }
  };

  // Enough steps to sample every pixel at least once on a typical ellipse
  const steps = Math.ceil(Math.max(4, 4 * (ra + rb)));
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    add(Math.round(cr + ra * Math.sin(t)), Math.round(cc + rb * Math.cos(t)));
  }

  // Guarantee the four cardinal extremes are always included
  add(cr - ra, cc);  // top
  add(cr + ra, cc);  // bottom
  add(cr, cc - rb);  // left
  add(cr, cc + rb);  // right

  return pixels;
}

/**
 * Draw an ellipse (outline) centered at (cr, cc) with row-radius ra and col-radius rb.
 * @param {Uint8Array[]} grid
 * @param {number} cr
 * @param {number} cc
 * @param {number} ra
 * @param {number} rb
 * @param {number} idx
 * @returns {Uint8Array[]}
 */
export function drawEllipse(grid, cr, cc, ra, rb, idx) {
  return paintCells(grid, ellipsePixels(cr, cc, ra, rb), idx);
}

// ── Compositing ───────────────────────────────────────────────────────────────

/**
 * Stamp (composite) src grid onto dst grid at the given offset.
 * Transparent pixels in src (index 0) are skipped — they don't overwrite dst.
 * Returns a new grid the same size as dst.
 * @param {Uint8Array[]} dst
 * @param {Uint8Array[]} src
 * @param {number} offsetRow
 * @param {number} offsetCol
 * @returns {Uint8Array[]}
 */
export function stamp(dst, src, offsetRow, offsetCol) {
  const out = cloneGrid(dst);
  const [dstW, dstH] = gridSize(dst);
  const [srcW, srcH] = gridSize(src);
  for (let r = 0; r < srcH; r++) {
    for (let c = 0; c < srcW; c++) {
      const v = src[r][c];
      if (v === 0) continue;
      const dr = r + offsetRow;
      const dc = c + offsetCol;
      if (dr < 0 || dr >= dstH || dc < 0 || dc >= dstW) continue;
      out[dr][dc] = v;
    }
  }
  return out;
}

/**
 * Erase a rectangular region (set all cells to transparent index 0).
 * @param {Uint8Array[]} grid
 * @param {number} r0
 * @param {number} c0
 * @param {number} r1
 * @param {number} c1
 * @returns {Uint8Array[]}
 */
export function eraseRect(grid, r0, c0, r1, c1) {
  return drawRect(grid, r0, c0, r1, c1, 0, true);
}

// ── Symmetry ──────────────────────────────────────────────────────────────────

/**
 * Mirror the left half of the grid to the right half.
 * Pixel at column c is copied to column (width-1-c) for all c < width/2.
 * The center column (if odd width) is left unchanged.
 * @param {Uint8Array[]} grid
 * @returns {Uint8Array[]}
 */
export function mirrorLeftToRight(grid) {
  const out = cloneGrid(grid);
  const [w, h] = gridSize(grid);
  const mid = Math.floor(w / 2);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < mid; c++) {
      out[r][w - 1 - c] = out[r][c];
    }
  }
  return out;
}

/**
 * Mirror the right half of the grid to the left half.
 * @param {Uint8Array[]} grid
 * @returns {Uint8Array[]}
 */
export function mirrorRightToLeft(grid) {
  const out = cloneGrid(grid);
  const [w, h] = gridSize(grid);
  const mid = Math.ceil(w / 2);
  for (let r = 0; r < h; r++) {
    for (let c = mid; c < w; c++) {
      out[r][w - 1 - c] = out[r][c];
    }
  }
  return out;
}

// ── Outline helpers ───────────────────────────────────────────────────────────

/**
 * Add outline pixels: any body pixel (index > 1) adjacent to transparent (index 0)
 * is replaced with outlineIdx.
 * Useful for sealing a hand-authored interior shape.
 * @param {Uint8Array[]} grid
 * @param {number} [outlineIdx=1]
 * @returns {Uint8Array[]}
 */
export function outlineBody(grid, outlineIdx = 1) {
  const [w, h] = gridSize(grid);
  const out = cloneGrid(grid);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (grid[r][c] <= 1) continue;
      const touchesTransparent =
        (r > 0     && grid[r - 1][c] === 0) ||
        (r < h - 1 && grid[r + 1][c] === 0) ||
        (c > 0     && grid[r][c - 1] === 0) ||
        (c < w - 1 && grid[r][c + 1] === 0);
      if (touchesTransparent) out[r][c] = outlineIdx;
    }
  }
  return out;
}

/**
 * Extract the outline mask: return a new grid where outline pixels stay as-is
 * and all body pixels become transparent. Useful for templating.
 * @param {Uint8Array[]} grid
 * @param {number} [outlineIdx=1]
 * @returns {Uint8Array[]}
 */
export function extractOutline(grid, outlineIdx = 1) {
  const [w, h] = gridSize(grid);
  const out = makeGrid(w, h, 0);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (grid[r][c] === outlineIdx) out[r][c] = outlineIdx;
    }
  }
  return out;
}

/**
 * Extract the silhouette mask: return a new grid where all non-transparent pixels
 * are set to fillIdx. Useful for region-fill authoring.
 * @param {Uint8Array[]} grid
 * @param {number} [fillIdx=4]  default = mid palette index
 * @returns {Uint8Array[]}
 */
export function extractSilhouette(grid, fillIdx = 4) {
  const [w, h] = gridSize(grid);
  const out = makeGrid(w, h, 0);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (grid[r][c] > 0) out[r][c] = fillIdx;
    }
  }
  return out;
}

// ── Region fill ───────────────────────────────────────────────────────────────

/**
 * Fill a rectangular region of the grid with idx (always includes all cells in rect).
 * @param {Uint8Array[]} grid
 * @param {number} r0
 * @param {number} c0
 * @param {number} r1
 * @param {number} c1
 * @param {number} idx
 * @returns {Uint8Array[]}
 */
export function fillRect(grid, r0, c0, r1, c1, idx) {
  return drawRect(grid, r0, c0, r1, c1, idx, true);
}

/**
 * Apply a gradient fill inside a silhouette region: each pixel's palette index
 * is determined by its normalized vertical position (0 = top → brightIdx, 1 = bottom → darkIdx).
 * Only pixels matching `targetIdx` in the input are replaced.
 * @param {Uint8Array[]} grid
 * @param {number} darkIdx    palette index for the bottom
 * @param {number} brightIdx  palette index for the top
 * @param {number} [targetIdx=4]  only replace pixels with this index
 * @returns {Uint8Array[]}
 */
export function gradientFill(grid, darkIdx, brightIdx, targetIdx = 4) {
  const [w, h] = gridSize(grid);
  const out = cloneGrid(grid);
  // find actual row extent of targetIdx pixels
  let minR = h, maxR = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (grid[r][c] === targetIdx) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); }
    }
  }
  if (minR > maxR) return out;
  const span = maxR - minR || 1;
  for (let r = minR; r <= maxR; r++) {
    const t = (r - minR) / span;  // 0 = top, 1 = bottom
    const idx = t < 0.5 ? brightIdx : darkIdx;
    for (let c = 0; c < w; c++) {
      if (grid[r][c] === targetIdx) out[r][c] = idx;
    }
  }
  return out;
}

// ── Serialisation helpers ─────────────────────────────────────────────────────

/**
 * Render a grid to ASCII (convenience re-export so callers only need grid_author).
 */
export { gridToAscii as toASCII } from './ascii.js';
