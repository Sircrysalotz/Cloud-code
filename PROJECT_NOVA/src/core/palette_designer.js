/**
 * palette_designer.js — Tools for creating and validating custom palettes.
 *
 * Extends the palette system beyond pre-defined sets. Any artist can specify
 * colors as hex strings or anchor points and get a pipeline-compatible palette.
 *
 * Convention (same as all palettes in this pipeline):
 *   index 0 = transparent
 *   index 1 = outline (darkest opaque color)
 *   indices 2..N-1 = body, sorted darkest→lightest by perceptual luminance
 */

import { paletteFromRGB } from './palette.js';

// ── Color math ────────────────────────────────────────────────────────────────

/**
 * Parse a CSS hex color string to {r, g, b}.
 * Accepts #rrggbb or #rgb.
 */
export function parseHex(hex) {
  const h = hex.replace('#', '').trim();
  let r, g, b;
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else if (h.length === 6) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  if (isNaN(r) || isNaN(g) || isNaN(b)) throw new Error(`Invalid hex color: ${hex}`);
  return { r, g, b };
}

/**
 * Perceptual luminance (0–255 scale). Higher = brighter.
 */
export function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Format {r,g,b} as a CSS hex string.
 */
export function toHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/**
 * Linearly interpolate between two RGB colors.
 * t=0 → a, t=1 → b.
 */
export function lerpRGB(a, b, t) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

/**
 * Generate n evenly-spaced colors from dark to light (both endpoints included).
 *
 * @param {{ r,g,b }} dark
 * @param {{ r,g,b }} light
 * @param {number}   n     — total number of colors (≥ 2)
 * @returns {{ r,g,b }[]}
 */
export function interpolateColors(dark, light, n) {
  if (n < 2) throw new Error('interpolateColors: n must be ≥ 2');
  return Array.from({ length: n }, (_, i) => lerpRGB(dark, light, i / (n - 1)));
}

// ── Palette builders ──────────────────────────────────────────────────────────

/**
 * Build a pipeline-compatible Palette from an array of CSS hex strings.
 * Colors are auto-sorted darkest→lightest. Transparent (index 0) is added
 * automatically — do NOT include it in the input array.
 *
 * The darkest color becomes index 1 (outline); remaining colors are body
 * indices 2..N-1.
 *
 * @param {string[]} hexColors — e.g. ['#ffe088', '#1c0814', '#681424', ...]
 * @returns {Palette}
 */
export function paletteFromHex(hexColors) {
  if (!Array.isArray(hexColors) || hexColors.length === 0) {
    throw new Error('paletteFromHex: hexColors must be a non-empty array');
  }

  const parsed = hexColors.map(hex => {
    const { r, g, b } = parseHex(hex);
    return { r, g, b, lum: luminance(r, g, b), hex };
  });

  // Sort by luminance (darkest first for outline→body ordering)
  parsed.sort((a, b) => a.lum - b.lum);

  // Build the rgbArray format that paletteFromRGB expects:
  // index 0 = transparent (always [0,0,0]), index 1 = outline (darkest), ...
  const rgbArray = [
    { index: 0, rgb: [0, 0, 0] },  // transparent
    ...parsed.map(({ r, g, b }, i) => ({ index: i + 1, rgb: [r, g, b] })),
  ];

  return paletteFromRGB(rgbArray);
}

/**
 * Build a complete n-color palette from two anchor colors (dark and light).
 * Interpolates n-1 body+outline colors between the two anchors.
 * Total palette size = n+1 (includes transparent).
 *
 * @param {string} darkHex   — hex color for the outline/darkest
 * @param {string} lightHex  — hex color for the peak/brightest
 * @param {number} [n=8]     — number of non-transparent colors (≥ 2)
 * @returns {Palette}
 */
export function paletteFromAnchors(darkHex, lightHex, n = 8) {
  if (n < 2) throw new Error('paletteFromAnchors: n must be ≥ 2');
  const dark  = parseHex(darkHex);
  const light = parseHex(lightHex);
  const colors = interpolateColors(dark, light, n);
  return paletteFromHex(colors.map(toHex));
}

// ── Validation ────────────────────────────────────────────────────────────────

const MIN_OUTLINE_DARKNESS   = 80;   // outline luminance must be < this
const MIN_PEAK_BRIGHTNESS    = 140;  // peak luminance must be > this
const MIN_LUMINANCE_SPREAD   = 100;  // peak_lum - outline_lum must be > this
const MIN_BODY_COLORS        = 2;    // at least 2 body colors (shadow_deep + peak)
const MONOTONE_TOLERANCE     = 1;    // adjacent body colors must differ by > this in lum

/**
 * Validate a palette for pipeline compatibility.
 *
 * @param {object} palette — from makePalette / paletteFromRGB / paletteFromHex
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validatePalette(palette) {
  const errors   = [];
  const warnings = [];

  // Transparent must exist at index 0
  const trans = palette.colors.find(c => c.index === 0);
  if (!trans) errors.push('Missing transparent color at index 0');

  // Outline must exist
  const outline = palette.colors.find(c => c.index === 1);
  if (!outline) {
    errors.push('Missing outline color at index 1');
  } else {
    const olum = luminance(outline.r, outline.g, outline.b);
    if (olum > MIN_OUTLINE_DARKNESS) {
      warnings.push(`Outline too bright (lum=${olum.toFixed(0)}, expected < ${MIN_OUTLINE_DARKNESS}): won't produce clean pixel art`);
    }
  }

  // Body colors
  const body = palette.bodyIndices;
  if (body.length < MIN_BODY_COLORS) {
    errors.push(`Too few body colors (${body.length}, need ≥ ${MIN_BODY_COLORS})`);
  }

  if (body.length >= 2) {
    const bodyColors = body.map(i => palette.colors.find(c => c.index === i));
    const lums       = bodyColors.map(c => luminance(c.r, c.g, c.b));

    // Luminance spread
    const spread = lums[lums.length - 1] - lums[0];
    if (spread < MIN_LUMINANCE_SPREAD) {
      warnings.push(`Narrow luminance spread (${spread.toFixed(0)}, recommended ≥ ${MIN_LUMINANCE_SPREAD}): low contrast`);
    }

    // Peak must be bright enough
    if (lums[lums.length - 1] < MIN_PEAK_BRIGHTNESS) {
      warnings.push(`Peak color too dark (lum=${lums[lums.length-1].toFixed(0)}, recommended > ${MIN_PEAK_BRIGHTNESS})`);
    }

    // Monotone check — adjacent body colors should have distinct luminance
    for (let i = 1; i < lums.length; i++) {
      if (lums[i] - lums[i - 1] <= MONOTONE_TOLERANCE) {
        warnings.push(`Body colors ${i-1} and ${i} are nearly identical in luminance (diff=${(lums[i]-lums[i-1]).toFixed(1)})`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Return a plain-object description of a palette (AI-readable).
 *
 * @param {object} palette
 * @returns {object}
 */
export function paletteInfo(palette) {
  const body = palette.bodyIndices.map(i => {
    const c = palette.colors.find(col => col.index === i);
    return {
      index: i,
      hex:   c.hex ?? toHex(c),
      r: c.r, g: c.g, b: c.b,
      luminance: +luminance(c.r, c.g, c.b).toFixed(1),
    };
  });

  const outline = palette.colors.find(c => c.index === 1);
  const outlineLum = outline ? luminance(outline.r, outline.g, outline.b) : 0;
  const peakLum    = body.length > 0 ? body[body.length - 1].luminance : 0;

  return {
    total_colors:     palette.colors.length,
    body_count:       body.length,
    outline_hex:      outline?.hex ?? toHex(outline ?? { r: 0, g: 0, b: 0 }),
    outline_luminance: +outlineLum.toFixed(1),
    peak_luminance:   peakLum,
    luminance_spread: +(peakLum - outlineLum).toFixed(1),
    body,
    validation:       validatePalette(palette),
  };
}
