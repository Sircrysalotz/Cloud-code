/**
 * Pass 2 — Outline Thinning
 *
 * Rule A: Outline pixel with 3+ outline neighbors AND a body neighbor → demote to shadow_deep.
 * Rule B: 2x2 block of outline pixels → demote bottom-right to shadow_deep.
 */

import { cloneGrid, getPixel, neighbors4, gridSize } from '../core/grid.js';
import { PALETTE } from '../core/palette.js';

export function pass2OutlineThin(grid, palette = PALETTE) {
  const out = cloneGrid(grid);
  const [w, h] = gridSize(grid);
  const OUTLINE    = palette.outlineIndex;
  const DEMOTE_TO  = palette.shadowDeepIndex;

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (grid[r][c] !== OUTLINE) continue;

      const nbrs = neighbors4(grid, r, c);
      const outlineNbrs = nbrs.filter(n => n.value === OUTLINE).length;
      const bodyNbrs    = nbrs.filter(n => palette.isBody(n.value)).length;

      if (outlineNbrs >= 3 && bodyNbrs >= 1) { out[r][c] = DEMOTE_TO; continue; }

      const tl = getPixel(grid, r - 1, c - 1);
      const t  = getPixel(grid, r - 1, c);
      const l  = getPixel(grid, r,     c - 1);
      if (tl === OUTLINE && t === OUTLINE && l === OUTLINE) out[r][c] = DEMOTE_TO;
    }
  }
  return out;
}
