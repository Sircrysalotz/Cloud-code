/**
 * Pass 7 — Highlight Area Enforcement
 *
 * Count peak pixels. If >10% of body pixels, demote outer-ring peak pixels to highlight.
 * Iterates until peak ratio is within target range (2-10%).
 *
 * WHY: Peak highlight should be 2-8% of body area in well-formed sprites.
 * Specular overshoot from shaders can blow this out significantly.
 */

import { cloneGrid, countPixels, neighbors4, gridSize } from '../core/grid.js';
import { IDX, BODY_INDICES } from '../core/palette.js';

const PEAK         = IDX.PEAK;
const HIGHLIGHT    = IDX.HIGHLIGHT;
const MAX_RATIO    = 0.10; // 10% — above this, demote outer ring
const MAX_PASSES   = 20;   // safety valve

function isBodyPixel(v) { return BODY_INDICES.includes(v); }

/**
 * @param {Uint8Array[]} grid
 * @returns {Uint8Array[]}
 */
export function pass7HighlightArea(grid) {
  let current = cloneGrid(grid);
  const [w, h] = gridSize(grid);

  for (let iter = 0; iter < MAX_PASSES; iter++) {
    const bodyCount = countPixels(current, isBodyPixel);
    const peakCount = countPixels(current, v => v === PEAK);
    if (bodyCount === 0 || peakCount / bodyCount <= MAX_RATIO) break;

    // Demote peak pixels that have at least one non-peak body neighbor (outer ring)
    const next = cloneGrid(current);
    let demoted = 0;
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (current[r][c] !== PEAK) continue;
        const nbrs = neighbors4(current, r, c);
        const hasNonPeakBodyNeighbor = nbrs.some(n => isBodyPixel(n.value) && n.value !== PEAK);
        if (hasNonPeakBodyNeighbor) {
          next[r][c] = HIGHLIGHT;
          demoted++;
        }
      }
    }
    current = next;
    if (demoted === 0) break; // can't demote any more
  }
  return current;
}
