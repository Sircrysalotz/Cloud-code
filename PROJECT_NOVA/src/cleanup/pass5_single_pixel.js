/**
 * Pass 5 — Single-Pixel Limb Removal
 *
 * Body pixel with 3+ transparent neighbors → set transparent.
 */

import { cloneGrid, neighbors4, gridSize } from '../core/grid.js';
import { PALETTE } from '../core/palette.js';

export function pass5SinglePixel(grid, palette = PALETTE) {
  const out = cloneGrid(grid);
  const [w, h] = gridSize(grid);

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const v = grid[r][c];
      if (!palette.isBody(v)) continue;

      const nbrs = neighbors4(grid, r, c);
      const transparentCount =
        nbrs.filter(n => palette.isTransparent(n.value)).length +
        (4 - nbrs.length); // out-of-bounds = transparent

      if (transparentCount >= 3) out[r][c] = 0; // IDX.TRANSPARENT is always 0
    }
  }
  return out;
}
