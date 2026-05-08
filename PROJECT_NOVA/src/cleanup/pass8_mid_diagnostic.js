/**
 * Pass 8 — Mid-tone Dominance Diagnostic
 *
 * Diagnostic only — does NOT modify the grid.
 * Flags if the mid-tone band is outside 30-70% of body pixels.
 */

import { countPixels } from '../core/grid.js';
import { PALETTE } from '../core/palette.js';

const MIN_MID_RATIO = 0.30;
const MAX_MID_RATIO = 0.70;

export function pass8MidDiagnostic(grid, palette = PALETTE) {
  const flags = [];
  const MID = palette.midIndex;

  const bodyCount = countPixels(grid, v => palette.isBody(v));
  if (bodyCount === 0) {
    flags.push('EMPTY: no body pixels found — sprite is blank or all outline/transparent');
    return { grid, flags };
  }

  const midCount = countPixels(grid, v => v === MID);
  const midRatio = midCount / bodyCount;

  if (midRatio < MIN_MID_RATIO) {
    flags.push(
      `LOW_MID: mid-tone is ${(midRatio * 100).toFixed(1)}% of body ` +
      `(min ${(MIN_MID_RATIO * 100).toFixed(0)}%) — sprite may be too dark or highlight-heavy`
    );
  } else if (midRatio > MAX_MID_RATIO) {
    flags.push(
      `HIGH_MID: mid-tone is ${(midRatio * 100).toFixed(1)}% of body ` +
      `(max ${(MAX_MID_RATIO * 100).toFixed(0)}%) — too flat, lacking highlight/shadow variation`
    );
  }

  const ratios = {};
  for (const idx of palette.bodyIndices) {
    const count = countPixels(grid, v => v === idx);
    ratios[idx] = count / bodyCount;
  }

  return { grid, flags, ratios };
}
