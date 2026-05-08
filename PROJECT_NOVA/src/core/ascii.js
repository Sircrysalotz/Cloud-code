/**
 * ASCII perception loop — render palette-index grids as text.
 *
 * This is the critical infrastructure that lets an LLM "see" pixel output
 * by reading text. Every stage's output should be dumpable as ASCII.
 *
 * Character mapping:
 *   .  transparent
 *   #  outline
 *   X  shadow_deep
 *   x  shadow
 *   o  mid
 *   O  bright
 *   *  highlight
 *   @  peak
 */

import { PALETTE, makePalette } from './palette.js';

/**
 * Render a grid to an ASCII string.
 * @param {Uint8Array[]} grid
 * @param {Palette} [palette]
 * @returns {string}
 */
export function gridToAscii(grid, palette = PALETTE) {
  return grid.map(row =>
    Array.from(row).map(idx => palette.ascii(idx)).join('')
  ).join('\n');
}

/**
 * Parse an ASCII string back to a palette-index grid.
 * Unknown characters map to transparent (index 0).
 * @param {string} ascii
 * @param {Palette} [palette]
 * @returns {Uint8Array[]}
 */
export function asciiToGrid(ascii, palette = PALETTE) {
  const charToIndex = new Map(palette.colors.map(c => [c.ascii, c.index]));
  const lines = ascii.split('\n').filter(l => l.length > 0);
  return lines.map(line =>
    new Uint8Array(Array.from(line).map(ch => charToIndex.get(ch) ?? 0))
  );
}

/**
 * Render a grid to a labeled ASCII block suitable for logging/debugging.
 * @param {Uint8Array[]} grid
 * @param {string} [label]
 * @param {Palette} [palette]
 * @returns {string}
 */
export function asciiDump(grid, label = '', palette = PALETTE) {
  const [w, h] = [grid[0]?.length ?? 0, grid.length];
  const header = label ? `[${label}] ${w}x${h}\n` : `${w}x${h}\n`;
  return header + gridToAscii(grid, palette);
}

/**
 * Diff two grids as ASCII — show changed pixels with '!' and unchanged with space.
 * Useful for visualizing what a cleanup pass changed.
 * @param {Uint8Array[]} before
 * @param {Uint8Array[]} after
 * @returns {string}
 */
export function asciiDiff(before, after) {
  const h = Math.max(before.length, after.length);
  const w = Math.max(before[0]?.length ?? 0, after[0]?.length ?? 0);
  const lines = [];
  for (let r = 0; r < h; r++) {
    let line = '';
    for (let c = 0; c < w; c++) {
      const bv = before[r]?.[c] ?? 0;
      const av = after[r]?.[c] ?? 0;
      line += bv !== av ? '!' : ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * Annotate specific pixels on an ASCII render with a custom marker.
 * @param {Uint8Array[]} grid
 * @param {{row: number, col: number}[]} pixels  pixels to annotate
 * @param {string} marker  single character to use as annotation
 * @param {Palette} [palette]
 * @returns {string}
 */
export function asciiAnnotate(grid, pixels, marker = '?', palette = PALETTE) {
  const annotated = new Set(pixels.map(p => `${p.row},${p.col}`));
  return grid.map((row, r) =>
    Array.from(row).map((idx, c) =>
      annotated.has(`${r},${c}`) ? marker : palette.ascii(idx)
    ).join('')
  ).join('\n');
}

/**
 * Serialize a grid to JSON (for file storage / piping between tools).
 * @param {Uint8Array[]} grid
 * @param {object} [meta]  optional metadata to include
 * @returns {string} JSON string
 */
export function gridToJSON(grid, meta = {}) {
  return JSON.stringify({
    ...meta,
    width:  grid[0]?.length ?? 0,
    height: grid.length,
    data:   grid.map(row => Array.from(row)),
  }, null, 2);
}

/**
 * Deserialize a grid from JSON.
 * @param {string|object} json  JSON string or already-parsed object
 * @returns {Uint8Array[]}
 */
export function gridFromJSON(json) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  return obj.data.map(row => new Uint8Array(row));
}
