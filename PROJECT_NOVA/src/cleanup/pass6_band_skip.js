/**
 * Pass 6 — Band Skip Prevention
 *
 * If two horizontally or vertically adjacent body pixels are 3+ palette levels
 * apart, replace the lighter one with the intermediate level.
 *
 * WHY: Real pixel art transitions through bands sequentially. A jump from
 * shadow directly to highlight (skipping mid and bright) is always an
 * artifact, never intentional.
 */

import { cloneGrid, getPixel, gridSize } from '../core/grid.js';
import { bandLevel, BODY_INDICES, IDX } from '../core/palette.js';

/**
 * @param {Uint8Array[]} grid
 * @returns {Uint8Array[]}
 */
export function pass6BandSkip(grid) {
  const out = cloneGrid(grid);
  const [w, h] = gridSize(grid);

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const v = grid[r][c];
      const vLevel = bandLevel(v);
      if (vLevel < 0) continue;

      // Check right and down neighbors
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const nv = getPixel(grid, r + dr, c + dc);
        if (nv < 0) continue;
        const nvLevel = bandLevel(nv);
        if (nvLevel < 0) continue;

        const diff = Math.abs(vLevel - nvLevel);
        if (diff >= 3) {
          // Insert intermediate band at the higher-level pixel
          const intermediateLevel = Math.min(vLevel, nvLevel) + 1;
          const intermediateIndex = BODY_INDICES[intermediateLevel];
          // Replace the lighter (higher level) pixel
          if (vLevel > nvLevel) {
            out[r][c] = intermediateIndex;
          } else {
            out[r + dr][c + dc] = intermediateIndex;
          }
        }
      }
    }
  }
  return out;
}
