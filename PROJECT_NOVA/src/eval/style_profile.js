/**
 * style_profile.js — Phase 28: Structural style extraction and scaffold generation.
 *
 * Extracts a data-driven style profile from a set of reference grids, then uses
 * that profile to generate new grids that match the style.
 *
 * Profile schema:
 * {
 *   source:        string
 *   frameCount:    number
 *   dims:          { medianWidth, medianHeight, aspectRatio }
 *   bands:         { shadow_deep|shadow|mid|bright|highlight|peak: { mean, sigma } }
 *   spatial:       { bandName: { topBias, centerBias } }
 *   highlight:     { centroidRowNorm, centroidColNorm }
 *   outline:       { coverageRatio }
 *   symmetry:      { meanScore }
 *   templateFrame: number[][]   — most-average frame as plain index array
 * }
 */

import { makeGrid, cloneGrid, gridSize, countPixels } from '../core/grid.js';
import { computeMetrics }                              from './metrics.js';
import { loadBatchReference }                          from './reference_lib.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const BAND_NAMES = ['shadow_deep', 'shadow', 'mid', 'bright', 'highlight', 'peak'];
const N_BANDS    = 6;

// ── Stat helpers ──────────────────────────────────────────────────────────────

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sigma(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, v) => a + (v - m) ** 2, 0) / (arr.length - 1));
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Band-level → band-name mapping (mirrors metrics.js bandRatios) ────────────

/**
 * Given a body-list level (0-based index in palette.bodyIndices), return
 * the 6-bucket band name. Uses same formula as metrics.js bandRatios().
 */
function levelToBandName(level, n) {
  return BAND_NAMES[Math.min(Math.floor(level / n * N_BANDS), N_BANDS - 1)];
}

/**
 * Given a palette index, return the band name ('shadow_deep'…'peak'), or null.
 */
function pixelBandName(paletteIdx, palette) {
  const level = palette.bandLevel(paletteIdx);
  if (level === -1) return null;
  return levelToBandName(level, palette.bodyIndices.length);
}

/**
 * Return the representative palette index for a band name.
 * Uses the center index of each bucket.
 */
function bandNameToIndex(bandName, palette) {
  const bandIdx = BAND_NAMES.indexOf(bandName);
  if (bandIdx === -1) return palette.midIndex;
  const n = palette.bodyIndices.length;
  const lo = Math.floor(bandIdx       / N_BANDS * n);
  const hi = Math.floor((bandIdx + 1) / N_BANDS * n) - 1;
  const mid = Math.floor((lo + Math.max(lo, hi)) / 2);
  return palette.bodyIndices[Math.min(mid, n - 1)] ?? palette.midIndex;
}

// ── Spatial analysis ──────────────────────────────────────────────────────────

/**
 * Compute where each palette band tends to appear spatially.
 * topBias:    mean normalized row (0=top, 1=bottom)
 * centerBias: mean normalized distance from center col (0=center, 1=edge)
 */
function computeSpatialBias(grids, palette) {
  const rowAccum = {};
  const colAccum = {};
  for (const b of BAND_NAMES) { rowAccum[b] = []; colAccum[b] = []; }

  for (const grid of grids) {
    const [w, h] = gridSize(grid);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const v = grid[r][c];
        if (v === 0 || v === 1) continue;
        const band = pixelBandName(v, palette);
        if (!band) continue;
        rowAccum[band].push(r / (h - 1 || 1));
        colAccum[band].push(Math.abs(c - (w - 1) / 2) / ((w - 1) / 2 || 1));
      }
    }
  }

  const spatial = {};
  for (const b of BAND_NAMES) {
    spatial[b] = {
      topBias:    mean(rowAccum[b]),
      centerBias: mean(colAccum[b]),
    };
  }
  return spatial;
}

/**
 * Compute mean normalized centroid of highlight+peak pixels.
 */
function computeHighlightCentroid(grids, palette) {
  const rows = [], cols = [];
  for (const grid of grids) {
    const [w, h] = gridSize(grid);
    let sr = 0, sc = 0, n = 0;
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const v = grid[r][c];
        if (v <= 1) continue;
        const band = pixelBandName(v, palette);
        if (band !== 'highlight' && band !== 'peak') continue;
        sr += r; sc += c; n++;
      }
    }
    if (n > 0) {
      rows.push(sr / n / (h - 1 || 1));
      cols.push(sc / n / (w - 1 || 1));
    }
  }
  return { centroidRowNorm: mean(rows), centroidColNorm: mean(cols) };
}

/**
 * Mean ratio of outline pixels to total non-transparent pixels.
 */
function computeOutlineCoverage(grids) {
  const ratios = [];
  for (const grid of grids) {
    const total   = countPixels(grid, v => v > 0);
    const outline = countPixels(grid, v => v === 1);
    if (total > 0) ratios.push(outline / total);
  }
  return mean(ratios);
}

/**
 * Find the frame whose band ratios are closest to the population mean.
 */
function findTemplateFrame(grids, palette, bandStats) {
  let bestIdx = 0, bestScore = Infinity;
  for (let i = 0; i < grids.length; i++) {
    const m = computeMetrics(grids[i], palette);
    let score = 0;
    for (const b of BAND_NAMES) {
      const key = `${b}_ratio`;
      const s   = bandStats[b].sigma || 0.01;
      const z   = ((m[key] ?? 0) - bandStats[b].mean) / s;
      score += z * z;
    }
    if (score < bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a complete style profile from an array of grids.
 * @param {Uint8Array[][]} grids
 * @param {import('../core/palette.js').Palette} palette
 * @param {string} [source='unknown']
 * @returns {Object} StyleProfile
 */
export function buildStyleProfile(grids, palette, source = 'unknown') {
  if (!grids.length) throw new Error('buildStyleProfile: need at least one grid');

  const widths  = grids.map(g => gridSize(g)[0]);
  const heights = grids.map(g => gridSize(g)[1]);
  const medW    = median(widths);
  const medH    = median(heights);

  // Band distribution (uses _ratio keys from computeMetrics)
  const bandSamples = {};
  for (const b of BAND_NAMES) bandSamples[b] = [];
  for (const grid of grids) {
    const m = computeMetrics(grid, palette);
    for (const b of BAND_NAMES) {
      const v = m[`${b}_ratio`];
      if (v !== undefined) bandSamples[b].push(v);
    }
  }
  const bands = {};
  for (const b of BAND_NAMES) {
    bands[b] = { mean: mean(bandSamples[b]), sigma: sigma(bandSamples[b]) };
  }

  const spatial   = computeSpatialBias(grids, palette);
  const highlight = computeHighlightCentroid(grids, palette);
  const outline   = { coverageRatio: computeOutlineCoverage(grids) };

  const symScores = grids.map(g => computeMetrics(g, palette).symmetry_score ?? 0);
  const symmetry  = { meanScore: mean(symScores) };

  const tplIdx      = findTemplateFrame(grids, palette, bands);
  const templateFrame = grids[tplIdx].map(row => Array.from(row));

  return {
    source,
    frameCount: grids.length,
    dims:       { medianWidth: medW, medianHeight: medH, aspectRatio: medW / (medH || 1) },
    bands,
    spatial,
    highlight,
    outline,
    symmetry,
    templateFrame,
  };
}

/**
 * Generate a scaffold grid from a style profile.
 *
 * Uses the template frame's outline + fills the interior using the profile's
 * spatial band distribution. The result stylistically matches the reference
 * without being a copy of any single frame.
 *
 * @param {Object} profile
 * @param {import('../core/palette.js').Palette} palette
 * @returns {Uint8Array[]}
 */
export function scaffoldFromProfile(profile, palette) {
  const tpl = profile.templateFrame.map(row => new Uint8Array(row));
  const [w, h] = gridSize(tpl);

  // Start from the outline skeleton only
  const out = makeGrid(w, h, 0);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (tpl[r][c] === 1) out[r][c] = 1;
    }
  }

  // Fill interior pixels using spatial band biases
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (tpl[r][c] === 0 || tpl[r][c] === 1) continue;

      const rowNorm = r / (h - 1 || 1);
      const colNorm = Math.abs(c - (w - 1) / 2) / ((w - 1) / 2 || 1);

      // Pick the band whose spatial bias is closest to this pixel's position,
      // weighted by mean band ratio so dominant bands win ties
      let bestBand = 'mid', bestScore = Infinity;
      for (const b of BAND_NAMES) {
        const sp    = profile.spatial[b];
        const dRow  = rowNorm - sp.topBias;
        const dCol  = colNorm - sp.centerBias;
        const dist  = dRow * dRow + dCol * dCol;
        const score = dist / (profile.bands[b].mean + 0.01);
        if (score < bestScore) { bestScore = score; bestBand = b; }
      }

      out[r][c] = bandNameToIndex(bestBand, palette);
    }
  }

  return out;
}

/**
 * Score how well a grid matches a style profile.
 * @param {Uint8Array[]} grid
 * @param {Object} profile
 * @param {import('../core/palette.js').Palette} palette
 * @returns {{ score: number, rmsZ: number, deviations: Object[] }}
 */
export function scoreAgainstProfile(grid, profile, palette) {
  const m = computeMetrics(grid, palette);
  const deviations = [];
  let sumZ2 = 0, count = 0;

  for (const b of BAND_NAMES) {
    const ref = profile.bands[b];
    const val = m[`${b}_ratio`];
    if (!ref || val === undefined) continue;
    const s = ref.sigma || 0.01;
    const z = (val - ref.mean) / s;
    sumZ2 += z * z;
    count++;
    deviations.push({ band: b, value: val, mean: ref.mean, sigma: ref.sigma, z });
  }

  const rmsZ = count > 0 ? Math.sqrt(sumZ2 / count) : Infinity;
  const score = Math.max(0, 1 - rmsZ / 3);

  return {
    score:      Math.round(score * 1000) / 1000,
    rmsZ:       Math.round(rmsZ  * 1000) / 1000,
    deviations,
  };
}

/**
 * Load the Goku batch reference and build its style profile.
 * @param {import('../core/palette.js').Palette} palette
 * @returns {Promise<Object>} StyleProfile
 */
export async function buildGokuStyleProfile(palette) {
  const ref = await loadBatchReference();
  return buildStyleProfile(ref.grids, palette, 'goku_batch');
}

/**
 * Serialise a StyleProfile to JSON string.
 */
export function styleProfileToJSON(profile) {
  return JSON.stringify(profile, null, 2);
}

/**
 * Deserialise a StyleProfile from JSON string or object.
 */
export function styleProfileFromJSON(json) {
  return typeof json === 'string' ? JSON.parse(json) : json;
}
