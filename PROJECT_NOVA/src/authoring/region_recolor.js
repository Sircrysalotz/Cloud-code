/**
 * region_recolor.js — Phase 30: Region-aware palette recoloring.
 *
 * Global style transfer remaps colors by luminance rank, which recolors
 * everything at once — hair, fur, and skin all shift together. This module
 * classifies a frame's palette into HUE REGIONS (red family, skin tones,
 * neutrals, ...) so each region can be retargeted independently:
 * "make the red fur blue, keep the skin" = { red: '#3060ff' }.
 *
 * The crucial property: recoloring changes ONLY the palette. The pixel grid
 * (indices) stays bit-identical, so 100% reconstruction fidelity carries
 * straight through — shading inside each region is preserved because every
 * color keeps its own luminance and only takes the target's hue/saturation.
 *
 * API:
 *   classifyRegions(palette, opts)     — cluster body colors into hue regions
 *   recolorRegions(palette, spec)      — new palette with regions retargeted
 *   regionPixelCounts(grid, regions)   — pixels per region (AI-readable)
 *   hexToRgb(hex)                      — '#3060ff' → [48, 96, 255]
 */

import { paletteFromRGB }       from '../core/palette.js';
import { rgbToHsl, hslToRgb }   from '../core/palette_mutator.js';

// ── hex parsing ───────────────────────────────────────────────────────────────

/** Parse '#rgb' or '#rrggbb' into [r, g, b]. */
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`hexToRgb: bad hex color "${hex}"`);
  let s = m[1];
  if (s.length === 3) s = [...s].map(ch => ch + ch).join('');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

// ── hue families ──────────────────────────────────────────────────────────────

/** Map a hue in degrees to a coarse family name. */
export function hueName(h) {
  const families = [
    [15,  'red'], [45, 'orange'], [70, 'yellow'], [160, 'green'],
    [200, 'cyan'], [260, 'blue'], [310, 'purple'], [345, 'magenta'],
  ];
  for (const [limit, name] of families) if (h < limit) return name;
  return 'red';  // wraps around
}

// ── classifyRegions ───────────────────────────────────────────────────────────

/**
 * Cluster a palette's body colors into hue regions.
 *
 * Colors with saturation below `satFloor` (grays, near-blacks) go to the
 * 'neutral' region. The rest are grouped by hue family. Within each region,
 * indices are sorted dark → bright so shading order is explicit.
 *
 * @param {Palette} palette
 * @param {object}  [opts]   — { satFloor = 0.12 }
 * @returns {{ regions, byIndex }}
 *   regions: { name: { indices, meanHue, meanSat, meanLum } }
 *   byIndex: Map<paletteIndex, regionName> (body indices only)
 */
export function classifyRegions(palette, { satFloor = 0.12 } = {}) {
  const buckets = new Map();   // name → array of { index, h, s, l }

  for (const entry of palette.colors) {
    if (entry.index < 2) continue;            // skip transparent + outline
    const { h, s, l } = rgbToHsl(entry.r, entry.g, entry.b);
    const name = s < satFloor ? 'neutral' : hueName(h);
    if (!buckets.has(name)) buckets.set(name, []);
    buckets.get(name).push({ index: entry.index, h, s, l });
  }

  // Circular mean so red hues straddling 0°/360° don't average to cyan
  const circularMeanHue = (members) => {
    const x = members.reduce((s2, m) => s2 + Math.cos(m.h * Math.PI / 180), 0);
    const y = members.reduce((s2, m) => s2 + Math.sin(m.h * Math.PI / 180), 0);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };

  const regions = {};
  const byIndex = new Map();
  for (const [name, members] of buckets) {
    members.sort((a, b) => a.l - b.l);        // dark → bright
    regions[name] = {
      indices: members.map(m => m.index),
      meanHue: circularMeanHue(members),
      meanSat: members.reduce((s2, m) => s2 + m.s, 0) / members.length,
      meanLum: members.reduce((s2, m) => s2 + m.l, 0) / members.length,
    };
    for (const m of members) byIndex.set(m.index, name);
  }

  return { regions, byIndex };
}

// ── recolorRegions ────────────────────────────────────────────────────────────

/**
 * Build a new palette with chosen regions retargeted to new colors.
 *
 * Each spec value is either:
 *   - a hex string '#3060ff'        — region takes that color's hue + sat
 *   - { hue, sat? }                 — explicit hue in degrees, optional sat ∈ [0,1]
 *
 * Every color in a retargeted region keeps its OWN luminance, so the
 * dark→bright shading ramp inside the region is preserved exactly.
 * Regions not named in the spec are left untouched. The grid never changes.
 *
 * @param {Palette} palette
 * @param {object}  spec    — e.g. { red: '#3060ff', neutral: { hue: 280, sat: 0.5 } }
 * @param {object}  [opts]  — passed to classifyRegions
 * @returns {{ palette, regions }} — the new palette + the classification used
 */
export function recolorRegions(palette, spec, opts = {}) {
  const { regions, byIndex } = classifyRegions(palette, opts);

  for (const name of Object.keys(spec)) {
    if (!regions[name]) {
      throw new Error(
        `recolorRegions: region "${name}" not found. Available: ${Object.keys(regions).join(', ')}`);
    }
  }

  // Resolve each spec entry to { hue, sat|null }
  const targets = {};
  for (const [name, value] of Object.entries(spec)) {
    if (typeof value === 'string') {
      const [r, g, b] = hexToRgb(value);
      const { h, s } = rgbToHsl(r, g, b);
      targets[name] = { hue: h, sat: s };
    } else {
      targets[name] = { hue: value.hue, sat: value.sat ?? null };
    }
  }

  const entries = palette.colors.map(entry => {
    const region = byIndex.get(entry.index);
    const target = region != null ? targets[region] : null;
    if (!target) {
      return { index: entry.index, rgb: [entry.r ?? 0, entry.g ?? 0, entry.b ?? 0] };
    }
    const { s, l } = rgbToHsl(entry.r, entry.g, entry.b);
    const rgb = hslToRgb(target.hue, target.sat ?? s, l);   // keep own luminance
    return { index: entry.index, rgb };
  });

  return { palette: paletteFromRGB(entries), regions };
}

// ── regionPixelCounts ─────────────────────────────────────────────────────────

/**
 * Count how many grid pixels fall in each region — tells the AI which
 * region is the fur, which is trim, etc. (biggest region = dominant surface).
 *
 * @param {Array<Uint8Array|number[]>} grid
 * @param {{ byIndex }} classification — from classifyRegions
 * @returns {object} — { regionName: pixelCount }, plus 'outline'
 */
export function regionPixelCounts(grid, { byIndex }) {
  const counts = {};
  for (const row of grid) {
    for (const v of row) {
      if (v === 0) continue;
      const name = v === 1 ? 'outline' : (byIndex.get(v) ?? 'unclassified');
      counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  return counts;
}
