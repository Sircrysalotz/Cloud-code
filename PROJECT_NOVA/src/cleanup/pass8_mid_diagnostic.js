/**
 * Pass 8 — Mid-tone Dominance Diagnostic
 *
 * Count mid-color ratio. If <30% or >70% of body pixels, flag as unbalanced.
 * This pass is diagnostic only — it does NOT modify the grid.
 *
 * WHY: Mid tone should dominate body (~40-60%) per reference analysis.
 * Outside 30-70% indicates a structurally broken bake.
 *
 * Returns { grid, flags } where flags is an array of diagnostic messages.
 */

import { countPixels, gridSize } from '../core/grid.js';
import { IDX, BODY_INDICES } from '../core/palette.js';

const MID = IDX.MID;
const MIN_MID_RATIO = 0.30;
const MAX_MID_RATIO = 0.70;

function isBodyPixel(v) { return BODY_INDICES.includes(v); }

/**
 * @param {Uint8Array[]} grid
 * @returns {{ grid: Uint8Array[], flags: string[] }}
 */
export function pass8MidDiagnostic(grid) {
  const flags = [];
  const bodyCount = countPixels(grid, isBodyPixel);

  if (bodyCount === 0) {
    flags.push('EMPTY: no body pixels found — sprite is blank or all outline/transparent');
    return { grid, flags };
  }

  const midCount = countPixels(grid, v => v === MID);
  const midRatio = midCount / bodyCount;

  if (midRatio < MIN_MID_RATIO) {
    flags.push(
      `LOW_MID: mid-tone is ${(midRatio * 100).toFixed(1)}% of body (min ${(MIN_MID_RATIO * 100).toFixed(0)}%) — sprite may be too dark or highlight-heavy`
    );
  } else if (midRatio > MAX_MID_RATIO) {
    flags.push(
      `HIGH_MID: mid-tone is ${(midRatio * 100).toFixed(1)}% of body (max ${(MAX_MID_RATIO * 100).toFixed(0)}%) — sprite may be too flat, lacking highlight/shadow variation`
    );
  }

  // Also report key ratios for reference
  const ratios = {};
  for (const idx of BODY_INDICES) {
    const count = countPixels(grid, v => v === idx);
    ratios[idx] = count / bodyCount;
  }

  return { grid, flags, ratios };
}
