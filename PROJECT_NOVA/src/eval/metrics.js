/**
 * Structural metrics for palette-index grids.
 *
 * All inputs are Grid (2D array of palette indices).
 * All outputs are plain numbers / plain objects — no rendering, no pixels.
 * All functions accept an optional palette (default: crimson 8-color).
 *
 * Band ratios use a 6-bucket luminance approach that works for any palette size,
 * consistent with tools/batch_ingest.py compute_band_ratios().
 */

import { gridSize, countPixels, neighbors4 } from '../core/grid.js';
import { PALETTE } from '../core/palette.js';

const BAND_NAMES = ['shadow_deep', 'shadow', 'mid', 'bright', 'highlight', 'peak'];
const N_BANDS    = 6;

// ── Counts ────────────────────────────────────────────────────────────────────

export function countByIndex(grid, palette = PALETTE) {
  const [w, h] = gridSize(grid);
  const counts = {};
  for (const c of palette.colors) counts[c.index] = 0;
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const v = grid[r][c];
      if (v in counts) counts[v]++;
    }
  return counts;
}

export function bodyCount(counts, palette = PALETTE) {
  return palette.bodyIndices.reduce((s, i) => s + (counts[i] ?? 0), 0);
}

export function outlineCount(counts, palette = PALETTE) {
  return counts[palette.outlineIndex] ?? 0;
}

export function transparentCount(counts) {
  return counts[0] ?? 0;
}

// ── Band ratios ───────────────────────────────────────────────────────────────
// Body indices are divided into N_BANDS equal luminance groups.
// Each group maps to a named band: shadow_deep … peak.
// Matches tools/batch_ingest.py compute_band_ratios() exactly.

export function bandRatios(counts, palette = PALETTE) {
  const body = bodyCount(counts, palette);
  const zero = {};
  for (const name of BAND_NAMES) zero[`${name}_ratio`] = 0;
  if (body === 0) return zero;

  const indices = palette.bodyIndices;
  const n       = indices.length;
  const bandCounts = new Array(N_BANDS).fill(0);

  for (let i = 0; i < n; i++) {
    const band = Math.min(Math.floor(i / n * N_BANDS), N_BANDS - 1);
    bandCounts[band] += counts[indices[i]] ?? 0;
  }

  const result = {};
  for (let i = 0; i < N_BANDS; i++) {
    result[`${BAND_NAMES[i]}_ratio`] = bandCounts[i] / body;
  }
  return result;
}

// ── Symmetry score ────────────────────────────────────────────────────────────

export function symmetryScore(grid, palette = PALETTE) {
  const [w, h] = gridSize(grid);
  const mid = Math.floor(w / 2);
  let matches = 0, comparisons = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < mid; c++) {
      const lv = grid[r][c];
      const rv = grid[r][w - 1 - c];
      if (palette.isBody(lv) || palette.isBody(rv)) {
        comparisons++;
        if (lv === rv) matches++;
      }
    }
  }
  return comparisons === 0 ? 1 : matches / comparisons;
}

// ── Outline thickness variance ────────────────────────────────────────────────

export function outlineThicknessVariance(grid, palette = PALETTE) {
  const [w, h] = gridSize(grid);
  const OUTLINE = palette.outlineIndex;
  const thicknesses = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (grid[r][c] !== OUTLINE) continue;
      const outlineNbrs = neighbors4(grid, r, c)
        .filter(n => n.value === OUTLINE).length;
      thicknesses.push(outlineNbrs);
    }
  }
  if (thicknesses.length === 0) return 0;
  const mean = thicknesses.reduce((a, b) => a + b, 0) / thicknesses.length;
  const variance = thicknesses.reduce((s, t) => s + (t - mean) ** 2, 0) / thicknesses.length;
  return Math.sqrt(variance);
}

// ── Unique body colors ─────────────────────────────────────────────────────────

export function uniqueBodyColors(counts, palette = PALETTE) {
  return palette.bodyIndices.filter(i => (counts[i] ?? 0) > 0).length;
}

// ── Body fill density ──────────────────────────────────────────────────────────

export function bodyDensity(grid, counts, palette = PALETTE) {
  const [w, h] = gridSize(grid);
  const total = w * h;
  return total === 0 ? 0 : bodyCount(counts, palette) / total;
}

// ── Highlight centroid ────────────────────────────────────────────────────────
// Normalized centroid of the top-2 luminance band pixels within the bounding box.
// Per the brief: "highlight cluster centroid should be in upper-left quadrant."

export function highlightCentroid(grid, palette = PALETTE) {
  const [w, h] = gridSize(grid);
  const indices   = palette.bodyIndices;
  const n         = indices.length;
  // Top-2 bands = highlight + peak positions
  const topBands  = new Set(indices.slice(Math.max(0, n - 2)));

  let rMin = h, rMax = -1, cMin = w, cMax = -1;
  let hx = 0, hy = 0, hn = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const v = grid[r][c];
      if (palette.isBody(v)) {
        rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
        cMin = Math.min(cMin, c); cMax = Math.max(cMax, c);
      }
      if (topBands.has(v)) { hx += c; hy += r; hn++; }
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

export function computeMetrics(grid, palette = PALETTE) {
  const [w, h] = gridSize(grid);
  const counts = countByIndex(grid, palette);
  const body   = bodyCount(counts, palette);
  const ratios = bandRatios(counts, palette);

  return {
    width:   w,
    height:  h,
    total_pixels:      w * h,
    body_count:        body,
    outline_count:     outlineCount(counts, palette),
    transparent_count: transparentCount(counts),

    // Band ratios (primary style metrics)
    ...ratios,

    // Structural quality indicators
    symmetry_score:             symmetryScore(grid, palette),
    outline_thickness_variance: outlineThicknessVariance(grid, palette),
    unique_body_colors:         uniqueBodyColors(counts, palette),
    body_density:               bodyDensity(grid, counts, palette),
    highlight_centroid:         highlightCentroid(grid, palette),
  };
}
