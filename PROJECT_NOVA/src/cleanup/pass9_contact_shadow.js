/**
 * Pass 9 — Bottom Contact Shadow
 *
 * Find the lowest body pixel in each column. Darken the bottom 1-2 body
 * pixels by one palette band (e.g. mid → shadow, shadow → shadow_deep).
 *
 * WHY: Ground-resting creatures need contact shadow to look grounded.
 * Without it, sprites float. This is a subtle but universally present
 * feature in shipped pixel art characters.
 */

import { cloneGrid, gridSize, getPixel } from '../core/grid.js';
import { BODY_INDICES, IDX, bandLevel } from '../core/palette.js';

const TRANSPARENT = IDX.TRANSPARENT;
const SHADOW_DEEP = IDX.SHADOW_DEEP;

function darkenOne(index) {
  const level = bandLevel(index);
  if (level <= 0) return SHADOW_DEEP; // can't go darker
  return BODY_INDICES[level - 1];
}

function isBodyPixel(v) { return BODY_INDICES.includes(v); }

/**
 * @param {Uint8Array[]} grid
 * @returns {Uint8Array[]}
 */
export function pass9ContactShadow(grid) {
  const out = cloneGrid(grid);
  const [w, h] = gridSize(grid);

  for (let c = 0; c < w; c++) {
    // Find lowest body pixel row in this column
    let lowestRow = -1;
    for (let r = h - 1; r >= 0; r--) {
      if (isBodyPixel(grid[r][c])) { lowestRow = r; break; }
    }
    if (lowestRow < 0) continue;

    // Darken bottom 1 pixel (and row above if it's also body)
    out[lowestRow][c] = darkenOne(grid[lowestRow][c]);
    if (lowestRow - 1 >= 0 && isBodyPixel(grid[lowestRow - 1][c])) {
      const current = out[lowestRow - 1][c];
      const level = bandLevel(current);
      // Only darken the second row if it's mid or above (don't over-darken)
      if (level >= 2) {
        out[lowestRow - 1][c] = darkenOne(current);
      }
    }
  }
  return out;
}
