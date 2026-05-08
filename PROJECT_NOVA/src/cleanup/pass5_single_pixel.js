/**
 * Pass 5 — Single-Pixel Limb Removal
 *
 * Body pixel with 3+ transparent neighbors → set transparent.
 *
 * WHY: 1-pixel protrusions from the silhouette are almost always rendering
 * artifacts from the cel shader sampling geometry edges incorrectly.
 */

import { cloneGrid, neighbors4, gridSize } from '../core/grid.js';
import { IDX, BODY_INDICES } from '../core/palette.js';

const TRANSPARENT = IDX.TRANSPARENT;

/**
 * @param {Uint8Array[]} grid
 * @returns {Uint8Array[]}
 */
export function pass5SinglePixel(grid) {
  const out = cloneGrid(grid);
  const [w, h] = gridSize(grid);

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const v = grid[r][c];
      if (!BODY_INDICES.includes(v)) continue;

      const nbrs = neighbors4(grid, r, c);
      // Count transparent + out-of-bounds as "transparent" (edge pixels count too)
      const transparentCount =
        nbrs.filter(n => n.value === TRANSPARENT).length +
        (4 - nbrs.length); // out-of-bounds neighbors treated as transparent

      if (transparentCount >= 3) {
        out[r][c] = TRANSPARENT;
      }
    }
  }
  return out;
}
