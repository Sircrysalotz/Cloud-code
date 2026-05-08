/**
 * Pass 3 — Outline Gap Repair
 *
 * Body pixel adjacent to transparent pixel → convert to outline.
 */

import { cloneGrid, neighbors4, gridSize } from '../core/grid.js';
import { PALETTE } from '../core/palette.js';

export function pass3OutlineRepair(grid, palette = PALETTE) {
  const out = cloneGrid(grid);
  const [w, h] = gridSize(grid);
  const OUTLINE = palette.outlineIndex;

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const v = grid[r][c];
      if (!palette.isBody(v)) continue;

      const nbrs = neighbors4(grid, r, c);
      if (nbrs.some(n => palette.isTransparent(n.value))) out[r][c] = OUTLINE;
    }
  }
  return out;
}
