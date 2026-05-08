/**
 * Pass 1 — Orphan Removal
 *
 * Pixel whose color appears in NONE of its 4 neighbors AND is rare globally
 * (<= threshold pixels of that color total) → replace with most common neighbor color.
 *
 * WHY: Quantization edge cases produce single stray pixels that don't belong.
 */

import { cloneGrid, getPixel, neighbors4, countPixels, mostCommon, gridSize } from '../core/grid.js';

const RARITY_THRESHOLD = 5;

/**
 * @param {Uint8Array[]} grid
 * @returns {Uint8Array[]} new cleaned grid
 */
export function pass1Orphan(grid) {
  const out = cloneGrid(grid);
  const [w, h] = gridSize(grid);

  // Build global frequency map for rarity check
  const freq = new Map();
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const v = grid[r][c];
      freq.set(v, (freq.get(v) ?? 0) + 1);
    }
  }

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const v = grid[r][c];
      if (v === 0) continue; // skip transparent

      const globalCount = freq.get(v) ?? 0;
      if (globalCount > RARITY_THRESHOLD) continue; // not rare enough

      const nbrs = neighbors4(grid, r, c);
      const neighborValues = nbrs.map(n => n.value);
      const matchesNeighbor = neighborValues.some(nv => nv === v);
      if (matchesNeighbor) continue; // not isolated

      // Replace with most common neighbor
      if (neighborValues.length > 0) {
        out[r][c] = mostCommon(neighborValues);
      }
    }
  }
  return out;
}
