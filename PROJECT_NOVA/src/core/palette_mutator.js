/**
 * palette_mutator.js — Phase 22: Palette mutation engine.
 *
 * Principled operations that derive new palettes from existing ones.
 * Each mutation is a pure function: (palette, params) → new Palette.
 * The AI can describe a desired transformation as a named operation +
 * parameters without reasoning about individual RGB values.
 *
 * Operations:
 *   tint        — shift all body colors toward a target hue
 *   brighten    — scale luminance upward (toward white)
 *   darken      — scale luminance downward (toward black)
 *   contrast    — stretch the luminance range (spread bands apart)
 *   saturate    — increase color saturation
 *   desaturate  — decrease color saturation (toward gray)
 *   invert      — reverse body luminance order (keep outline/transparent)
 *   compose     — chain multiple mutations in sequence
 */

import { paletteFromRGB } from './palette.js';

// ── Color math helpers ────────────────────────────────────────────────────────

/** Clamp a value to [0, 255] and round. */
function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

/** Compute luminance (0-255 range). */
function lum(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

/**
 * Convert RGB to HSL.
 * @returns {{ h: number, s: number, l: number }}  h∈[0,360), s∈[0,1], l∈[0,1]
 */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r)      h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else                h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/**
 * Convert HSL back to RGB (integers 0-255).
 */
function hslToRgb(h, s, l) {
  if (s === 0) { const v = clamp(l * 255); return [v, v, v]; }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hn = h / 360;
  return [
    clamp(hue2rgb(p, q, hn + 1/3) * 255),
    clamp(hue2rgb(p, q, hn)       * 255),
    clamp(hue2rgb(p, q, hn - 1/3) * 255),
  ];
}

// ── Single-color transforms ───────────────────────────────────────────────────

/** Shift a color toward targetHue by `amount` ∈ [0,1]. */
function tintColor(r, g, b, targetHue, amount) {
  const { h, s, l } = rgbToHsl(r, g, b);
  const diff = ((targetHue - h + 540) % 360) - 180;  // shortest path
  const newH = (h + diff * amount + 360) % 360;
  return hslToRgb(newH, s, l);
}

/** Scale luminance by factor, preserving hue. factor > 1 = brighter, < 1 = darker. */
function scaleLuminance(r, g, b, factor) {
  const { h, s, l } = rgbToHsl(r, g, b);
  return hslToRgb(h, s, Math.max(0, Math.min(1, l * factor)));
}

/** Add a fixed delta to lightness. */
function shiftLuminance(r, g, b, delta) {
  const { h, s, l } = rgbToHsl(r, g, b);
  return hslToRgb(h, s, Math.max(0, Math.min(1, l + delta)));
}

/** Scale saturation by factor. */
function scaleSaturation(r, g, b, factor) {
  const { h, s, l } = rgbToHsl(r, g, b);
  return hslToRgb(h, Math.max(0, Math.min(1, s * factor)), l);
}

// ── Mutation operations ───────────────────────────────────────────────────────

/**
 * Apply a transform function to all body colors (indices ≥ 2).
 * Transparent (0) and outline (1) are preserved unchanged.
 * Returns a new Palette via paletteFromRGB.
 */
function transformBody(palette, fn) {
  const entries = palette.colors.map(entry => {
    if (entry.index < 2) {
      return { index: entry.index, rgb: [entry.r ?? 0, entry.g ?? 0, entry.b ?? 0] };
    }
    const [r, g, b] = fn(entry.r, entry.g, entry.b);
    return { index: entry.index, rgb: [r, g, b] };
  });
  return paletteFromRGB(entries);
}

/**
 * Tint: shift all body colors toward targetHue.
 *
 * @param {Palette} palette
 * @param {object}  params
 * @param {number}  params.hue     — target hue in degrees [0, 360)
 * @param {number}  params.amount  — blend strength [0, 1] (default 0.3)
 * @returns {Palette}
 */
export function tint(palette, { hue, amount = 0.3 }) {
  if (hue < 0 || hue >= 360) throw new Error('hue must be in [0, 360)');
  if (amount < 0 || amount > 1) throw new Error('amount must be in [0, 1]');
  return transformBody(palette, (r, g, b) => tintColor(r, g, b, hue, amount));
}

/**
 * Brighten: shift all body colors lighter.
 *
 * @param {Palette} palette
 * @param {object}  params
 * @param {number}  params.amount  — lightness increase [0, 1] (default 0.15)
 * @returns {Palette}
 */
export function brighten(palette, { amount = 0.15 } = {}) {
  if (amount < 0 || amount > 1) throw new Error('amount must be in [0, 1]');
  return transformBody(palette, (r, g, b) => shiftLuminance(r, g, b, +amount));
}

/**
 * Darken: shift all body colors darker.
 *
 * @param {Palette} palette
 * @param {object}  params
 * @param {number}  params.amount  — lightness decrease [0, 1] (default 0.15)
 * @returns {Palette}
 */
export function darken(palette, { amount = 0.15 } = {}) {
  if (amount < 0 || amount > 1) throw new Error('amount must be in [0, 1]');
  return transformBody(palette, (r, g, b) => shiftLuminance(r, g, b, -amount));
}

/**
 * Contrast: stretch luminance range by pulling dark colors darker and
 * bright colors brighter, relative to the body midpoint.
 *
 * @param {Palette} palette
 * @param {object}  params
 * @param {number}  params.factor  — stretch factor > 1 increases contrast,
 *                                   0 < factor < 1 reduces it (default 1.3)
 * @returns {Palette}
 */
export function contrast(palette, { factor = 1.3 } = {}) {
  if (factor <= 0) throw new Error('factor must be > 0');

  // Find luminance midpoint of body colors
  const bodyColors = palette.colors.filter(e => e.index >= 2);
  if (bodyColors.length === 0) return palette;

  const lums = bodyColors.map(e => lum(e.r, e.g, e.b));
  const mid  = lums.reduce((a, b) => a + b, 0) / lums.length / 255;

  return transformBody(palette, (r, g, b) => {
    const { h, s, l } = rgbToHsl(r, g, b);
    const newL = Math.max(0, Math.min(1, mid + (l - mid) * factor));
    return hslToRgb(h, s, newL);
  });
}

/**
 * Saturate: increase color saturation.
 *
 * @param {Palette} palette
 * @param {object}  params
 * @param {number}  params.factor  — saturation multiplier > 1 (default 1.4)
 * @returns {Palette}
 */
export function saturate(palette, { factor = 1.4 } = {}) {
  if (factor <= 0) throw new Error('factor must be > 0');
  return transformBody(palette, (r, g, b) => scaleSaturation(r, g, b, factor));
}

/**
 * Desaturate: decrease color saturation (toward gray).
 *
 * @param {Palette} palette
 * @param {object}  params
 * @param {number}  params.factor  — saturation multiplier < 1 (default 0.5)
 * @returns {Palette}
 */
export function desaturate(palette, { factor = 0.5 } = {}) {
  if (factor <= 0) throw new Error('factor must be > 0');
  return transformBody(palette, (r, g, b) => scaleSaturation(r, g, b, factor));
}

/**
 * Invert body luminance: swap the brightest and darkest body colors,
 * preserving outline (index 1) and transparent (index 0).
 *
 * Useful for generating a "negative" variant.
 *
 * @param {Palette} palette
 * @returns {Palette}
 */
export function invert(palette) {
  const body = palette.colors.filter(e => e.index >= 2);
  if (body.length === 0) return palette;

  // Map each body color's luminance to its mirror across the midpoint
  const lums = body.map(e => lum(e.r, e.g, e.b));
  const minL = Math.min(...lums);
  const maxL = Math.max(...lums);

  const entries = palette.colors.map(entry => {
    if (entry.index < 2) {
      return { index: entry.index, rgb: [entry.r ?? 0, entry.g ?? 0, entry.b ?? 0] };
    }
    const l    = lum(entry.r, entry.g, entry.b);
    const newL = minL + maxL - l;  // mirror around (minL+maxL)/2
    const frac = maxL > minL ? (newL - minL) / (maxL - minL) : 0.5;
    const { h, s } = rgbToHsl(entry.r, entry.g, entry.b);
    const [r, g, b] = hslToRgb(h, s, frac);
    return { index: entry.index, rgb: [r, g, b] };
  });
  return paletteFromRGB(entries);
}

// ── Compose ───────────────────────────────────────────────────────────────────

/**
 * Chain multiple mutations in sequence.
 *
 * @param {Palette}                                palette
 * @param {{ op: string, params?: object }[]}      steps
 * @returns {Palette}
 *
 * @example
 * compose(palette, [
 *   { op: 'darken',     params: { amount: 0.1 } },
 *   { op: 'tint',       params: { hue: 200, amount: 0.2 } },
 *   { op: 'saturate',   params: { factor: 1.2 } },
 * ])
 */
export function compose(palette, steps) {
  const OPS = { tint, brighten, darken, contrast, saturate, desaturate, invert };
  let p = palette;
  for (const { op, params = {} } of steps) {
    const fn = OPS[op];
    if (!fn) throw new Error(`Unknown palette mutation op: "${op}"`);
    p = fn(p, params);
  }
  return p;
}

/**
 * Return an AI-readable description of how a mutated palette differs
 * from the original: per-color luminance delta and saturation delta.
 *
 * @param {Palette} original
 * @param {Palette} mutated
 * @returns {object}
 */
export function mutationDiff(original, mutated) {
  const origColors  = Object.fromEntries(original.colors.map(e => [e.index, e]));
  const deltaLum    = [];
  const deltaSat    = [];

  for (const entry of mutated.colors) {
    const orig = origColors[entry.index];
    if (!orig) continue;

    const { s: sA, l: lA } = rgbToHsl(orig.r,  orig.g,  orig.b);
    const { s: sB, l: lB } = rgbToHsl(entry.r, entry.g, entry.b);

    deltaLum.push(+(lB - lA).toFixed(4));
    deltaSat.push(+(sB - sA).toFixed(4));
  }

  const meanDeltaLum = deltaLum.length > 0
    ? +(deltaLum.reduce((a, b) => a + b, 0) / deltaLum.length).toFixed(4) : 0;
  const meanDeltaSat = deltaSat.length > 0
    ? +(deltaSat.reduce((a, b) => a + b, 0) / deltaSat.length).toFixed(4) : 0;

  return {
    color_count:    mutated.colors.length,
    mean_delta_lum: meanDeltaLum,
    mean_delta_sat: meanDeltaSat,
    brighter:       meanDeltaLum > 0.01,
    darker:         meanDeltaLum < -0.01,
    more_saturated: meanDeltaSat > 0.01,
    less_saturated: meanDeltaSat < -0.01,
  };
}
