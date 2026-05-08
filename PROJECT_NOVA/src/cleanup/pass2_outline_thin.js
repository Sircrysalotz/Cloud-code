/**
 * Pass 2 — Outline Thinning
 *
 * Rule A: Outline pixel with 3+ outline neighbors AND a body neighbor → demote to shadow color.
 * Rule B: 2x2 block of outline pixels → demote bottom-right to shadow.
 *
 * WHY: Real pixel art outlines are exactly 1px thick. Blob outlines break this.
 */

import { cloneGrid, getPixel, neighbors4, gridSize } from '../core/grid.js';
import { IDX } from '../core/palette.js';

const OUTLINE = IDX.OUTLINE;
const DEMOTE_TO = IDX.SHADOW_DEEP;

/**
 * @param {Uint8Array[]} grid
 * @returns {Uint8Array[]}
 */
export function pass2OutlineThin(grid) {
  const out = cloneGrid(grid);
  const [w, h] = gridSize(grid);

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (grid[r][c] !== OUTLINE) continue;

      const nbrs = neighbors4(grid, r, c);
      const outlineNeighbors = nbrs.filter(n => n.value === OUTLINE).length;
      const bodyNeighbors    = nbrs.filter(n => n.value > OUTLINE && n.value !== 0).length;

      // Rule A: thick blob outline
      if (outlineNeighbors >= 3 && bodyNeighbors >= 1) {
        out[r][c] = DEMOTE_TO;
        continue;
      }

      // Rule B: bottom-right of a 2x2 outline block
      const tl = getPixel(grid, r - 1, c - 1);
      const t  = getPixel(grid, r - 1, c);
      const l  = getPixel(grid, r,     c - 1);
      if (tl === OUTLINE && t === OUTLINE && l === OUTLINE) {
        out[r][c] = DEMOTE_TO;
      }
    }
  }
  return out;
}
