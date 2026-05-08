/**
 * Pass 1 — Orphan Removal
 *
 * Pixel whose color appears in NONE of its 4 neighbors AND is rare globally
 * (<= threshold pixels of that color total) → replace with most common neighbor color.
 */

import { cloneGrid, neighbors4, mostCommon, gridSize } from '../core/grid.js';
import { PALETTE } from '../core/palette.js';

const RARITY_THRESHOLD = 5;

export function pass1Orphan(grid, palette = PALETTE) {
  const out = cloneGrid(grid);
  const [w, h] = gridSize(grid);

  const freq = new Map();
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const v = grid[r][c];
      freq.set(v, (freq.get(v) ?? 0) + 1);
    }

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const v = grid[r][c];
      if (palette.isTransparent(v)) continue;
      if ((freq.get(v) ?? 0) > RARITY_THRESHOLD) continue;

      const nbrs = neighbors4(grid, r, c);
      if (nbrs.some(n => n.value === v)) continue;
      if (nbrs.length > 0) out[r][c] = mostCommon(nbrs.map(n => n.value));
    }
  }
  return out;
}
