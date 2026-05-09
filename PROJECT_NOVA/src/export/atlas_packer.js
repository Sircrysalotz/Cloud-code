/**
 * atlas_packer.js — Phase 20: Sprite atlas packer.
 *
 * Bin-packs variant library cells (or any {grid, palette} list) into a
 * single texture atlas using a shelf-first algorithm.  Outputs:
 *   - RGBA Uint8Array / PNG bytes  — the packed texture
 *   - JSON UV map                  — AI-readable index of every sprite's rect
 *
 * UV map entry:
 * {
 *   id,           — unique key (pose_paletteKey or custom)
 *   pose,         — pose name
 *   paletteKey,   — palette name
 *   x, y,         — top-left pixel in atlas (at scale=1)
 *   width, height — sprite dimensions in pixels (at scale=1)
 * }
 *
 * All coordinates in the UV map are at native (scale=1) resolution.
 * Scale is applied when rendering the final PNG.
 */

import { gridToRGBA }  from './png_writer.js';
import { encodePNG }   from './png_encoder.js';

// ── Shelf-first bin packer ────────────────────────────────────────────────────

/**
 * Pack a list of rectangles into a bin using the shelf-first algorithm.
 * Sorts items tallest-first so shelves are used efficiently.
 *
 * @param {{ id:string, width:number, height:number }[]} items
 * @param {number} [maxWidth]   — atlas width limit (default: auto from sqrt)
 * @returns {{ placements: Map<string,{x,y}>, atlasWidth:number, atlasHeight:number }}
 */
export function packRects(items, maxWidth = 0) {
  if (items.length === 0) {
    return { placements: new Map(), atlasWidth: 0, atlasHeight: 0 };
  }

  // Sort tallest first (stable: tie-break by width desc)
  const sorted = items.slice().sort((a, b) =>
    b.height !== a.height ? b.height - a.height : b.width - a.width
  );

  // Auto width: sqrt of total area, rounded up to nearest multiple of 16
  if (maxWidth <= 0) {
    const totalArea = items.reduce((s, it) => s + it.width * it.height, 0);
    const rawW = Math.ceil(Math.sqrt(totalArea));
    maxWidth = Math.max(rawW + (16 - rawW % 16) % 16, sorted[0].width);
  }

  const placements = new Map();
  let shelfX = 0, shelfY = 0, shelfH = 0;
  let atlasWidth = 0;

  for (const item of sorted) {
    if (shelfX + item.width > maxWidth) {
      // New shelf
      shelfY += shelfH;
      shelfX = 0;
      shelfH = 0;
    }

    placements.set(item.id, { x: shelfX, y: shelfY });
    shelfX += item.width;
    shelfH = Math.max(shelfH, item.height);
    atlasWidth = Math.max(atlasWidth, shelfX);
  }

  const atlasHeight = shelfY + shelfH;
  return { placements, atlasWidth, atlasHeight };
}

// ── Atlas renderer ────────────────────────────────────────────────────────────

/**
 * Render sprite cells into a flat RGBA atlas buffer.
 *
 * @param {AtlasCell[]}              cells     — each with { grid, palette, id }
 * @param {UVEntry[]}                uvMap     — from buildUVMap
 * @param {number}                   scale     — pixel scale factor
 * @param {{ atlasWidth, atlasHeight }} dims
 * @returns {Uint8Array}  — RGBA, (atlasWidth*scale) × (atlasHeight*scale) × 4
 */
export function renderAtlasRGBA(cells, uvMap, scale, dims) {
  const AW = dims.atlasWidth  * scale;
  const AH = dims.atlasHeight * scale;
  const out = new Uint8Array(AW * AH * 4);

  // Default fill: transparent (all zeros — alpha=0)

  const uvById = new Map(uvMap.map(e => [e.id, e]));

  for (const cell of cells) {
    const uv = uvById.get(cell.id);
    if (!uv) continue;

    const sW = uv.width  * scale;
    const sH = uv.height * scale;
    const rgba = gridToRGBA(cell.grid, cell.palette, scale);

    const ox = uv.x * scale;
    const oy = uv.y * scale;

    for (let py = 0; py < sH; py++) {
      for (let px = 0; px < sW; px++) {
        const si = (py * sW + px) * 4;
        if (rgba[si + 3] === 0) continue;  // skip transparent

        const dx = ox + px;
        const dy = oy + py;
        if (dx < 0 || dx >= AW || dy < 0 || dy >= AH) continue;

        const di = (dy * AW + dx) * 4;
        out[di]     = rgba[si];
        out[di + 1] = rgba[si + 1];
        out[di + 2] = rgba[si + 2];
        out[di + 3] = rgba[si + 3];
      }
    }
  }

  return out;
}

// ── UV map builder ────────────────────────────────────────────────────────────

/**
 * Build the UV map from pack results.
 *
 * @param {AtlasCell[]}                              cells
 * @param {Map<string,{x,y}>}                        placements
 * @returns {UVEntry[]}
 */
export function buildUVMap(cells, placements) {
  return cells.map(cell => {
    const pos = placements.get(cell.id) ?? { x: 0, y: 0 };
    const h   = cell.grid.length;
    const w   = cell.grid[0]?.length ?? 0;
    return {
      id:         cell.id,
      pose:       cell.pose       ?? '',
      paletteKey: cell.paletteKey ?? '',
      x:          pos.x,
      y:          pos.y,
      width:      w,
      height:     h,
    };
  });
}

// ── Top-level API ─────────────────────────────────────────────────────────────

/**
 * Build a complete sprite atlas from a list of cells.
 *
 * Each cell must have: { id, grid, palette, pose?, paletteKey? }
 *
 * @param {AtlasCell[]} cells
 * @param {object}      [opts]
 * @param {number}      opts.scale     — pixel scale for PNG output (default 4)
 * @param {number}      opts.maxWidth  — atlas width cap in grid cells (default: auto)
 * @returns {{ uvMap, atlasWidth, atlasHeight, rgba, png }}
 *   uvMap       — AI-readable UV entry list
 *   atlasWidth  — native atlas width (grid cells)
 *   atlasHeight — native atlas height (grid cells)
 *   rgba        — flat RGBA Uint8Array at given scale
 *   png         — PNG bytes
 */
export function buildAtlas(cells, opts = {}) {
  const { scale = 4, maxWidth = 0 } = opts;

  if (cells.length === 0) {
    return {
      uvMap:       [],
      atlasWidth:  0,
      atlasHeight: 0,
      rgba:        new Uint8Array(0),
      png:         encodePNG(new Uint8Array(0), 0, 0),
    };
  }

  // Build rect list for packer
  const rects = cells.map(cell => ({
    id:     cell.id,
    width:  cell.grid[0]?.length ?? 0,
    height: cell.grid.length,
  }));

  const { placements, atlasWidth, atlasHeight } = packRects(rects, maxWidth);
  const uvMap = buildUVMap(cells, placements);
  const dims  = { atlasWidth, atlasHeight };
  const rgba  = renderAtlasRGBA(cells, uvMap, scale, dims);
  const png   = encodePNG(rgba, atlasWidth * scale, atlasHeight * scale);

  return { uvMap, atlasWidth, atlasHeight, rgba, png };
}

/**
 * Convert a variant library (from buildVariantLibrary) into atlas cells.
 *
 * @param {object} library  — result of buildVariantLibrary
 * @returns {AtlasCell[]}
 */
export function libraryCells(library) {
  return (library.cells ?? []).map(cell => ({
    id:         cell.id ?? `${cell.pose}_${cell.paletteKey}`,
    pose:       cell.pose,
    paletteKey: cell.paletteKey,
    grid:       cell.grid,
    palette:    cell.palette,
  }));
}

/**
 * Build an AI-readable summary of the atlas.
 *
 * @param {{ uvMap, atlasWidth, atlasHeight }} atlas
 * @returns {object}
 */
export function atlasInfo(atlas) {
  const poses    = [...new Set(atlas.uvMap.map(e => e.pose).filter(Boolean))];
  const palettes = [...new Set(atlas.uvMap.map(e => e.paletteKey).filter(Boolean))];
  return {
    sprite_count:  atlas.uvMap.length,
    atlas_width:   atlas.atlasWidth,
    atlas_height:  atlas.atlasHeight,
    poses,
    palettes,
    entries: atlas.uvMap,
  };
}
