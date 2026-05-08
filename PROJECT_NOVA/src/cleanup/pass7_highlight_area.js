/**
 * Pass 7 — Highlight Area Enforcement
 *
 * If peak pixels exceed 10% of body, demote outer-ring peak pixels to highlight.
 */

import { cloneGrid, countPixels, neighbors4, gridSize } from '../core/grid.js';
import { PALETTE } from '../core/palette.js';

const MAX_RATIO  = 0.10;
const MAX_PASSES = 20;

export function pass7HighlightArea(grid, palette = PALETTE) {
  let current = cloneGrid(grid);
  const [w, h] = gridSize(grid);
  const PEAK      = palette.peakIndex;
  const HIGHLIGHT = palette.highlightIndex;

  for (let iter = 0; iter < MAX_PASSES; iter++) {
    const bodyCount = countPixels(current, v => palette.isBody(v));
    const peakCount = countPixels(current, v => v === PEAK);
    if (bodyCount === 0 || peakCount / bodyCount <= MAX_RATIO) break;

    const next = cloneGrid(current);
    let demoted = 0;
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (current[r][c] !== PEAK) continue;
        const nbrs = neighbors4(current, r, c);
        if (nbrs.some(n => palette.isBody(n.value) && n.value !== PEAK)) {
          next[r][c] = HIGHLIGHT;
          demoted++;
        }
      }
    }
    current = next;
    if (demoted === 0) break;
  }
  return current;
}
