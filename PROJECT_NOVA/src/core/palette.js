/**
 * Palette definitions and quantization for the pixel art pipeline.
 *
 * Default palette: 8-color crimson aesthetic with hue-shifted shadows/highlights.
 * Cool shadows (purple-shifted), warm highlights (orange-gold).
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

// Named index constants for use throughout the pipeline
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

export const BODY_INDICES = [IDX.SHADOW_DEEP, IDX.SHADOW, IDX.MID, IDX.BRIGHT, IDX.HIGHLIGHT, IDX.PEAK];

/**
 * Create a Palette object from a color array.
 * @param {Array} colors - array of color objects (same shape as DEFAULT_PALETTE)
 * @returns {Palette}
 */
export function makePalette(colors = DEFAULT_PALETTE) {
  const byIndex = new Map(colors.map(c => [c.index, c]));
  const byName  = new Map(colors.map(c => [c.name,  c]));

  return {
    colors,
    byIndex,
    byName,
    size: colors.length,

    get(index) { return byIndex.get(index) ?? null; },
    getByName(name) { return byName.get(name) ?? null; },
    ascii(index) { return byIndex.get(index)?.ascii ?? '?'; },
    isTransparent(index) { return byIndex.get(index)?.a === 0; },
    isOutline(index) { return byIndex.get(index)?.name === 'outline'; },
    isBody(index) { return BODY_INDICES.includes(index); },
  };
}

/**
 * Build a Palette from the JSON array emitted by ingest_sprite.py.
 *
 * Input format: [{index: 0, rgb: [r,g,b]}, {index: 1, rgb: [r,g,b]}, ...]
 * Index 0 is always transparent (a=0).  All others are opaque body colors.
 *
 * Colors are sorted by luminance (index 1 = darkest, last = brightest) and
 * assigned sequential ASCII characters '.', '#', 'X', 'x', 'o', 'O', '*', '@', ...
 *
 * @param {Array} rgbArray — [{index, rgb:[r,g,b]}, ...]
 * @returns {Palette}
 */
export function paletteFromRGB(rgbArray) {
  const ASCII = '.#XxoO*@abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const colors = rgbArray.map((entry, i) => {
    const [r, g, b] = entry.rgb ?? [0, 0, 0];
    const idx = entry.index ?? i;
    const isTransparent = idx === 0;
    return {
      index: idx,
      name:  isTransparent ? 'transparent' : `color_${idx}`,
      hex:   isTransparent ? null : `#${[r,g,b].map(v => v.toString(16).padStart(2,'0')).join('')}`,
      r, g, b,
      a:     isTransparent ? 0 : 255,
      ascii: ASCII[Math.min(idx, ASCII.length - 1)],
    };
  });
  return makePalette(colors);
}

export const PALETTE = makePalette();

/**
 * Quantize an RGBA color to the nearest palette index using Euclidean distance in RGB space.
 * Transparent pixels (a < 128) always map to index 0.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @param {Palette} palette
 * @returns {number} palette index
 */
export function quantize(r, g, b, a, palette = PALETTE) {
  if (a < 128) return IDX.TRANSPARENT;

  let bestIdx = 0;
  let bestDist = Infinity;

  for (const color of palette.colors) {
    if (color.a === 0) continue; // skip transparent slot
    const dr = r - color.r;
    const dg = g - color.g;
    const db = b - color.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = color.index;
    }
  }
  return bestIdx;
}

/**
 * Convert palette index to RGBA array [r, g, b, a].
 * @param {number} index
 * @param {Palette} palette
 * @returns {[number, number, number, number]}
 */
export function indexToRGBA(index, palette = PALETTE) {
  const c = palette.get(index);
  if (!c) return [0, 0, 0, 0];
  return [c.r, c.g, c.b, c.a];
}

/**
 * Band level of a palette index: how many steps above shadow_deep.
 * transparent/outline = -1 (not a band)
 * shadow_deep = 0, shadow = 1, mid = 2, bright = 3, highlight = 4, peak = 5
 * @param {number} index
 * @returns {number} -1 if not a body color, 0-5 otherwise
 */
export function bandLevel(index) {
  return BODY_INDICES.indexOf(index); // -1 if not found
}
