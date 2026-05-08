/**
 * Pass 9 — Bottom Contact Shadow
 *
 * Find the lowest body pixel in each column. Darken the bottom 1-2 body pixels
 * by one palette band to simulate ground contact shadow.
 */

import { cloneGrid, gridSize } from '../core/grid.js';
import { PALETTE } from '../core/palette.js';

export function pass9ContactShadow(grid, palette = PALETTE) {
  const out = cloneGrid(grid);
  const [w, h] = gridSize(grid);

  for (let c = 0; c < w; c++) {
    let lowestRow = -1;
    for (let r = h - 1; r >= 0; r--) {
      if (palette.isBody(grid[r][c])) { lowestRow = r; break; }
    }
    if (lowestRow < 0) continue;

    out[lowestRow][c] = palette.darkenOne(grid[lowestRow][c]);

    if (lowestRow - 1 >= 0 && palette.isBody(grid[lowestRow - 1][c])) {
      const level = palette.bandLevel(out[lowestRow - 1][c]);
      if (level >= 2) out[lowestRow - 1][c] = palette.darkenOne(grid[lowestRow - 1][c]);
    }
  }
  return out;
}
