/**
 * Pass 6 — Band Skip Prevention
 *
 * Two adjacent body pixels 3+ band-levels apart → replace the lighter one
 * with the intermediate level.
 */

import { cloneGrid, getPixel, gridSize } from '../core/grid.js';
import { PALETTE } from '../core/palette.js';

export function pass6BandSkip(grid, palette = PALETTE) {
  const out = cloneGrid(grid);
  const [w, h] = gridSize(grid);

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const v      = grid[r][c];
      const vLevel = palette.bandLevel(v);
      if (vLevel < 0) continue;

      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const nv = getPixel(grid, r + dr, c + dc);
        if (nv < 0) continue;
        const nvLevel = palette.bandLevel(nv);
        if (nvLevel < 0) continue;

        const diff = Math.abs(vLevel - nvLevel);
        if (diff >= 3) {
          const intermediateLevel = Math.min(vLevel, nvLevel) + 1;
          const intermediateIndex = palette.bodyIndices[intermediateLevel];
          if (intermediateIndex === undefined) continue;
          if (vLevel > nvLevel) out[r][c] = intermediateIndex;
          else                  out[r + dr][c + dc] = intermediateIndex;
        }
      }
    }
  }
  return out;
}
