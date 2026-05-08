/**
 * Pass 3 — Outline Gap Repair
 *
 * Body pixel adjacent to transparent pixel → convert to outline.
 *
 * WHY: Edge detector occasionally misses pixels just below threshold,
 * leaving gaps where the sprite bleeds directly to transparency.
 */

import { cloneGrid, neighbors4, gridSize } from '../core/grid.js';
import { IDX, BODY_INDICES } from '../core/palette.js';

const TRANSPARENT = IDX.TRANSPARENT;
const OUTLINE     = IDX.OUTLINE;

/**
 * @param {Uint8Array[]} grid
 * @returns {Uint8Array[]}
 */
export function pass3OutlineRepair(grid) {
  const out = cloneGrid(grid);
  const [w, h] = gridSize(grid);

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const v = grid[r][c];
      if (!BODY_INDICES.includes(v)) continue;

      const nbrs = neighbors4(grid, r, c);
      const touchesTransparent = nbrs.some(n => n.value === TRANSPARENT);
      if (touchesTransparent) {
        out[r][c] = OUTLINE;
      }
    }
  }
  return out;
}
