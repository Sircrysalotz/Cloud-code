/**
 * Grid → PNG export.
 *
 * Converts a palette-index grid to an actual PNG file.
 * Transparent pixels render as transparent (alpha=0).
 * Output is upscaled for visibility — sprite grids are small (16-64px),
 * exported PNGs are upscaled 4x by default so they're readable on GitHub.
 */

import { encodePNG }   from './png_encoder.js';
import { indexToRGBA } from '../core/palette.js';
import { gridSize }    from '../core/grid.js';

/**
 * Convert a palette-index grid to RGBA flat array.
 * @param {Uint8Array[]} grid
 * @param {Palette} palette
 * @param {number} scale  pixel scale factor (1 = native, 4 = 4x upscale)
 * @returns {Uint8Array} flat RGBA, length = (width*scale) * (height*scale) * 4
 */
export function gridToRGBA(grid, palette, scale = 1) {
  const [w, h] = gridSize(grid);
  const sw = w * scale;
  const sh = h * scale;
  const rgba = new Uint8Array(sw * sh * 4);

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const idx = grid[r][c];
      const [pr, pg, pb, pa] = indexToRGBA(idx, palette);
      // Fill scale×scale block
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const pos = ((r * scale + dy) * sw + (c * scale + dx)) * 4;
          rgba[pos]     = pr;
          rgba[pos + 1] = pg;
          rgba[pos + 2] = pb;
          rgba[pos + 3] = pa;
        }
      }
    }
  }
  return rgba;
}

/**
 * Encode a palette-index grid to PNG bytes.
 * @param {Uint8Array[]} grid
 * @param {Palette} palette
 * @param {number} scale  upscale factor (default 4 for visibility)
 * @returns {Uint8Array} PNG bytes
 */
export function gridToPNG(grid, palette, scale = 4) {
  const [w, h] = gridSize(grid);
  const rgba = gridToRGBA(grid, palette, scale);
  return encodePNG(rgba, w * scale, h * scale);
}

/**
 * Composite multiple frames side by side into a horizontal sprite sheet.
 * All frames must have the same dimensions.
 * @param {Uint8Array[][]} frames  array of grids
 * @param {Palette} palette
 * @param {number} scale
 * @returns {Uint8Array} PNG bytes of horizontal strip
 */
export function framesToSpritesheetPNG(frames, palette, scale = 4) {
  if (frames.length === 0) throw new Error('No frames provided');
  const [fw, fh] = gridSize(frames[0]);
  const totalWidth  = fw * frames.length;
  const totalHeight = fh;
  const sw = totalWidth * scale;
  const sh = totalHeight * scale;
  const rgba = new Uint8Array(sw * sh * 4);

  for (let fi = 0; fi < frames.length; fi++) {
    const frame = frames[fi];
    for (let r = 0; r < fh; r++) {
      for (let c = 0; c < fw; c++) {
        const idx = frame[r][c];
        const [pr, pg, pb, pa] = indexToRGBA(idx, palette);
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const destX = (fi * fw + c) * scale + dx;
            const destY = r * scale + dy;
            const pos = (destY * sw + destX) * 4;
            rgba[pos]     = pr;
            rgba[pos + 1] = pg;
            rgba[pos + 2] = pb;
            rgba[pos + 3] = pa;
          }
        }
      }
    }
  }
  return encodePNG(rgba, sw, sh);
}
