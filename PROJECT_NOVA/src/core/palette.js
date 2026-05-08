/**
 * Palette definitions and quantization for the pixel art pipeline.
 *
 * Palettes are palette-agnostic: any N-color set works, not just crimson.
 * Convention (applies to ALL palettes):
 *   index 0          → transparent (a=0)
 *   index 1          → outline (darkest opaque color, name='outline')
 *   indices 2..N-1   → body, sorted darkest→lightest by luminance
 *
 * The Palette object exposes luminance-ordered band helpers so cleanup
 * passes and eval work identically on the crimson 8-color palette and on
 * any dynamically extracted palette.
 */

export const DEFAULT_PALETTE = [
  { index: 0, name: 'transparent', hex: null,      r: 0,   g: 0,   b: 0,   a: 0,   ascii: '.' },
  { index: 1, name: 'outline',     hex: '#1c0814', r: 28,  g: 8,   b: 20,  a: 255, ascii: '#' },
  { index: 2, name: 'shadow_deep', hex: '#380c20', r: 56,  g: 12,  b: 32,  a: 255, ascii: 'X' },
  { index: 3, name: 'shadow',      hex: '#681424', r: 104, g: 20,  b: 36,  a: 255, ascii: 'x' },
  { index: 4, name: 'mid',         hex: '#b8281c', r: 184, g: 40,  b: 28,  a: 255, ascii: 'o' },
  { index: 5, name: 'bright',      hex: '#e86024', r: 232, g: 96,  b: 36,  a: 255, ascii: 'O' },
  { index: 6, name: 'highlight',   hex: '#ffa840', r: 255, g: 168, b: 64,  a: 255, ascii: '*' },
  { index: 7, name: 'peak',        hex: '#ffe088', r: 255, g: 224, b: 136, a: 255, ascii: '@' },
];

// Named index constants for the default crimson palette
export const IDX = {
  TRANSPARENT:  0,
  OUTLINE:      1,
  SHADOW_DEEP:  2,
  SHADOW:       3,
  MID:          4,
  BRIGHT:       5,
  HIGHLIGHT:    6,
  PEAK:         7,
};

// Default body-index list (crimson palette) — kept for backward compat
export const BODY_INDICES = [IDX.SHADOW_DEEP, IDX.SHADOW, IDX.MID, IDX.BRIGHT, IDX.HIGHLIGHT, IDX.PEAK];

// ── makePalette ───────────────────────────────────────────────────────────────

/**
 * Create a Palette object from a color array.
 *
 * Works for any palette size.  The returned object exposes:
 *   • Standard queries: get, getByName, ascii, isTransparent, isOutline, isBody
 *   • Band helpers (palette-agnostic): bandLevel, darkenOne, brightenOne
 *   • Named band indices: outlineIndex, shadowDeepIndex, midIndex, peakIndex, …
 *
 * @param {Array} colors — array of color objects (same shape as DEFAULT_PALETTE)
 * @returns {Palette}
 */
export function makePalette(colors = DEFAULT_PALETTE) {
  const byIndex = new Map(colors.map(c => [c.index, c]));
  const byName  = new Map(colors.map(c => [c.name,  c]));

  // Body = all opaque non-outline slots, sorted by index (index order = luminance order)
  const bodyList = colors
    .filter(c => c.a > 0 && c.name !== 'transparent' && c.name !== 'outline')
    .sort((a, b) => a.index - b.index);
  const bodyIdxList = bodyList.map(c => c.index);
  const bodySet     = new Set(bodyIdxList);

  const n = bodyIdxList.length;

  // Named band indices — gracefully degrade for small palettes
  const outlineIndex    = colors.find(c => c.name === 'outline')?.index ?? 1;
  const shadowDeepIndex = bodyIdxList[0]                                ?? 2;
  const shadowIndex     = bodyIdxList[1]                                ?? 3;
  const midIndex        = bodyIdxList[Math.floor(n * 0.40)]             ?? 4;
  const brightIndex     = bodyIdxList[Math.floor(n * 0.67)]             ?? 5;
  const highlightIndex  = bodyIdxList[n - 2]                            ?? 6;
  const peakIndex       = bodyIdxList[n - 1]                            ?? 7;

  return {
    colors,
    byIndex,
    byName,
    size: colors.length,

    // ── Named band indices ─────────────────────────────────────────────────
    outlineIndex,
    shadowDeepIndex,
    shadowIndex,
    midIndex,
    brightIndex,
    highlightIndex,
    peakIndex,

    // ── Body index list (sorted dark→light) ────────────────────────────────
    bodyIndices: bodyIdxList,

    // ── Standard queries ───────────────────────────────────────────────────
    get(index)       { return byIndex.get(index) ?? null; },
    getByName(name)  { return byName.get(name)   ?? null; },
    ascii(index)     { return byIndex.get(index)?.ascii ?? '?'; },
    isTransparent(index) { return byIndex.get(index)?.a === 0; },
    isOutline(index)     { return byIndex.get(index)?.name === 'outline'; },
    isBody(index)        { return bodySet.has(index); },

    // ── Luminance-band helpers ─────────────────────────────────────────────

    /**
     * Position of index in the luminance-ordered body list (0 = darkest).
     * Returns -1 if not a body index.
     */
    bandLevel(index) { return bodyIdxList.indexOf(index); },

    /** Next darker body index (clamps at darkest). */
    darkenOne(index) {
      const pos = bodyIdxList.indexOf(index);
      if (pos <= 0) return bodyIdxList[0] ?? index;
      return bodyIdxList[pos - 1];
    },

    /** Next brighter body index (clamps at brightest). */
    brightenOne(index) {
      const pos = bodyIdxList.indexOf(index);
      if (pos < 0 || pos >= bodyIdxList.length - 1) return bodyIdxList[bodyIdxList.length - 1] ?? index;
      return bodyIdxList[pos + 1];
    },
  };
}

// ── paletteFromRGB ────────────────────────────────────────────────────────────

/**
 * Build a Palette from the JSON array emitted by ingest_sprite.py.
 *
 * Input format: [{index: 0, rgb: [r,g,b]}, {index: 1, rgb: [r,g,b]}, ...]
 * Index 0 = transparent, index 1 = outline (darkest), indices 2..N-1 = body.
 * Colors must already be sorted by luminance (darkest=low index).
 *
 * @param {Array} rgbArray — [{index, rgb:[r,g,b]}, ...]
 * @returns {Palette}
 */
export function paletteFromRGB(rgbArray) {
  const ASCII = '.#XxoO*@abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const colors = rgbArray.map(entry => {
    const [r, g, b] = entry.rgb ?? [0, 0, 0];
    const idx = entry.index ?? 0;
    const isTransparent = idx === 0;
    const isOutline     = idx === 1;
    return {
      index: idx,
      name:  isTransparent ? 'transparent' : isOutline ? 'outline' : `color_${idx}`,
      hex:   isTransparent ? null : `#${[r,g,b].map(v => v.toString(16).padStart(2,'0')).join('')}`,
      r, g, b,
      a:     isTransparent ? 0 : 255,
      ascii: ASCII[Math.min(idx, ASCII.length - 1)],
    };
  });
  return makePalette(colors);
}

// ── Default palette singleton ─────────────────────────────────────────────────

export const PALETTE = makePalette();

// ── Quantization ──────────────────────────────────────────────────────────────

/**
 * Quantize an RGBA color to the nearest palette index (Euclidean RGB distance).
 * Transparent pixels (a < 128) always map to index 0.
 */
export function quantize(r, g, b, a, palette = PALETTE) {
  if (a < 128) return IDX.TRANSPARENT;

  let bestIdx = 0;
  let bestDist = Infinity;

  for (const color of palette.colors) {
    if (color.a === 0) continue;
    const dr = r - color.r, dg = g - color.g, db = b - color.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) { bestDist = dist; bestIdx = color.index; }
  }
  return bestIdx;
}

/**
 * Convert palette index to RGBA array [r, g, b, a].
 */
export function indexToRGBA(index, palette = PALETTE) {
  const c = palette.get(index);
  if (!c) return [0, 0, 0, 0];
  return [c.r, c.g, c.b, c.a];
}

/**
 * Band level of a palette index in the DEFAULT crimson palette.
 * transparent/outline = -1, shadow_deep = 0 … peak = 5.
 * For palette-agnostic code use palette.bandLevel(index) instead.
 */
export function bandLevel(index) {
  return BODY_INDICES.indexOf(index);
}
