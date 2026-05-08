/**
 * Structural metrics for palette-index grids.
 *
 * All inputs are Grid (2D array of palette indices 0-7).
 * All outputs are plain numbers / plain objects — no rendering, no pixels.
 *
 * The AI works with these numbers. The renderer translates to PNG at the end.
 */

import { gridSize, countPixels, neighbors4 } from '../core/grid.js';
import { IDX, BODY_INDICES, PALETTE } from '../core/palette.js';

// ── Counts ────────────────────────────────────────────────────────────────────

export function countByIndex(grid) {
  const [w, h] = gridSize(grid);
  const counts = new Array(PALETTE.size).fill(0); // size = number of colors (8)
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++)
      counts[grid[r][c]]++;
  return counts; // index → pixel count
}

export function bodyCount(counts) {
  return BODY_INDICES.reduce((s, i) => s + counts[i], 0);
}

export function outlineCount(counts) {
  return counts[IDX.OUTLINE];
}

export function transparentCount(counts) {
  return counts[IDX.TRANSPARENT];
}

// ── Band ratios ───────────────────────────────────────────────────────────────
// Each ratio = count[idx] / bodyCount (not total pixels).
// These are the primary style metrics compared against references.

export function bandRatios(counts) {
  const body = bodyCount(counts);
  if (body === 0) return BODY_INDICES.reduce((o, i) => { o[i] = 0; return o; }, {});
  return BODY_INDICES.reduce((o, i) => { o[i] = counts[i] / body; return o; }, {});
}

// ── Symmetry score ────────────────────────────────────────────────────────────
// Compare left/right halves of body pixels.
// score = fraction of symmetric body pixel pairs (0 = none, 1 = perfect).

export function symmetryScore(grid) {
  const [w, h] = gridSize(grid);
  const mid = Math.floor(w / 2);
  let matches = 0, comparisons = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < mid; c++) {
      const lv = grid[r][c];
      const rv = grid[r][w - 1 - c];
      if (BODY_INDICES.includes(lv) || BODY_INDICES.includes(rv)) {
        comparisons++;
        if (lv === rv) matches++;
      }
    }
  }
  return comparisons === 0 ? 1 : matches / comparisons;
}

// ── Outline thickness variance ────────────────────────────────────────────────
// For each outline pixel, count its outline 4-neighbors.
// Low variance = consistent 1px outline; high variance = clumped/broken outlines.

export function outlineThicknessVariance(grid) {
  const [w, h] = gridSize(grid);
  const thicknesses = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (grid[r][c] !== IDX.OUTLINE) continue;
      const outlineNbrs = neighbors4(grid, r, c)
        .filter(n => n.value === IDX.OUTLINE).length;
      thicknesses.push(outlineNbrs);
    }
  }
  if (thicknesses.length === 0) return 0;
  const mean = thicknesses.reduce((a, b) => a + b, 0) / thicknesses.length;
  const variance = thicknesses.reduce((s, t) => s + (t - mean) ** 2, 0) / thicknesses.length;
  return Math.sqrt(variance);
}

// ── Unique body colors ─────────────────────────────────────────────────────────

export function uniqueBodyColors(counts) {
  return BODY_INDICES.filter(i => counts[i] > 0).length;
}

// ── Body fill density ──────────────────────────────────────────────────────────
// Fraction of total pixels (inc. transparent) that are body pixels.
// Low density = open/airy design. High density = compact/heavy silhouette.

export function bodyDensity(grid, counts) {
  const [w, h] = gridSize(grid);
  const total = w * h;
  return total === 0 ? 0 : bodyCount(counts) / total;
}

// ── Highlight centroid ────────────────────────────────────────────────────────
// Normalized centroid of peak + highlight pixels within the bounding box.
// Per the brief: "highlight cluster centroid should be in upper-left quadrant."
// Returns {x, y} in [0,1] relative to bounding box (0,0=top-left 1,1=bottom-right).

export function highlightCentroid(grid) {
  const [w, h] = gridSize(grid);
  // Find body bounding box
  let rMin = h, rMax = -1, cMin = w, cMax = -1;
  let hx = 0, hy = 0, hn = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const v = grid[r][c];
      if (BODY_INDICES.includes(v)) {
        rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
        cMin = Math.min(cMin, c); cMax = Math.max(cMax, c);
      }
      if (v === IDX.HIGHLIGHT || v === IDX.PEAK) {
        hx += c; hy += r; hn++;
      }
    }
  }
  if (hn === 0 || rMax < 0) return { x: 0.5, y: 0.5 };
  const bw = (cMax - cMin) || 1;
  const bh = (rMax - rMin) || 1;
  return {
    x: (hx / hn - cMin) / bw,
    y: (hy / hn - rMin) / bh,
  };
}

// ── Full metric bundle ─────────────────────────────────────────────────────────
// Returns a plain object with all structural metrics.
// This is the canonical AI-readable representation of a sprite's quality.

export function computeMetrics(grid) {
  const [w, h] = gridSize(grid);
  const counts = countByIndex(grid);
  const body   = bodyCount(counts);
  const ratios = bandRatios(counts);

  return {
    width:   w,
    height:  h,
    total_pixels:      w * h,
    body_count:        body,
    outline_count:     outlineCount(counts),
    transparent_count: transparentCount(counts),

    // Band ratios (primary style metrics)
    shadow_deep_ratio: ratios[IDX.SHADOW_DEEP] ?? 0,
    shadow_ratio:      ratios[IDX.SHADOW]      ?? 0,
    mid_ratio:         ratios[IDX.MID]         ?? 0,
    bright_ratio:      ratios[IDX.BRIGHT]      ?? 0,
    highlight_ratio:   ratios[IDX.HIGHLIGHT]   ?? 0,
    peak_ratio:        ratios[IDX.PEAK]        ?? 0,

    // Structural quality indicators
    symmetry_score:             symmetryScore(grid),
    outline_thickness_variance: outlineThicknessVariance(grid),
    unique_body_colors:         uniqueBodyColors(counts),
    body_density:               bodyDensity(grid, counts),
    highlight_centroid:         highlightCentroid(grid),
  };
}
