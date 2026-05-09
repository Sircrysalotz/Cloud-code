#!/usr/bin/env node
/**
 * compose_character.js — Phase 28: Create new characters from real batch data.
 *
 * Takes one or more real Goku batch frames and transforms them (scale, flip,
 * recolor) to produce new character sprites that share the same pixel art
 * structure and shading logic — no gradients, no parametic blobs.
 *
 * Every output pixel comes from real ingested data. Transformations are:
 *   - scale:   resize the sprite to new dimensions
 *   - flipH:   mirror horizontally (face the other direction)
 *   - palette: remap to any target palette (style transfer)
 *   - crop:    extract a body-zone slice (head, torso, legs)
 *
 * Usage:
 *   node tools/compose_character.js --frame=4              # reconstruct frame 4
 *   node tools/compose_character.js --frame=4 --scale=1.5  # 1.5× bigger
 *   node tools/compose_character.js --frame=4 --flipH      # mirror
 *   node tools/compose_character.js --frame=4 --palette=cool
 *   node tools/compose_character.js --frame=4 --zone=head  # head region only
 *   node tools/compose_character.js --frame=4 --zone=torso
 *   node tools/compose_character.js --frame=4 --scale=1.2 --flipH --palette=cool
 *
 * Output:
 *   exports/composed/<name>.png
 *   exports/composed/<name>.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { paletteFromRGB } from '../src/core/palette.js';
import { gridToPNG }       from '../src/export/png_writer.js';
import { gridToAscii }     from '../src/core/ascii.js';
import { flipH, contentBounds } from '../src/core/grid_ops.js';
import { transferStyle, BUILTIN_PALETTES } from './style_transfer.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const BATCH = join(__dir, '..', 'exports', 'batch');
const OUT   = join(__dir, '..', 'exports', 'composed');
mkdirSync(OUT, { recursive: true });

// ── Args ──────────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const frameArg    = args.find(a => a.startsWith('--frame='))?.slice(8) ?? '4';
const scaleArg    = parseFloat(args.find(a => a.startsWith('--scale='))?.slice(8) ?? '1');
const pngScale    = parseInt(args.find(a => a.startsWith('--png-scale='))?.slice(12) ?? '8');
const doFlipH     = args.includes('--flipH');
const paletteName = args.find(a => a.startsWith('--palette='))?.slice(10) ?? null;
const zoneArg     = args.find(a => a.startsWith('--zone='))?.slice(7) ?? null;
const nameArg     = args.find(a => a.startsWith('--name='))?.slice(7) ?? null;

// ── Load frame ────────────────────────────────────────────────────────────────
const frameId  = String(frameArg).padStart(4, '0');
const gridPath = join(BATCH, `frame_${frameId}_grid.json`);
const palPath  = join(BATCH, `frame_${frameId}_palette.json`);

if (!existsSync(gridPath) || !existsSync(palPath)) {
  console.error(`Frame ${frameId} not found. Run: python3 tools/batch_ingest.py`);
  process.exit(1);
}

const gridData    = JSON.parse(readFileSync(gridPath,  'utf8'));
const paletteData = JSON.parse(readFileSync(palPath,   'utf8'));
const srcPalette  = paletteFromRGB(paletteData);
let   grid        = gridData.data.map(row => Array.isArray(row) ? [...row] : Object.values(row).map(Number));
const srcW = gridData.width, srcH = gridData.height;

console.log(`\nSource: frame_${frameId}  ${srcW}×${srcH}  body=${gridData.accuracy?.body_pixels ?? '?'}px  acc=${gridData.accuracy?.exact_pct ?? 100}%`);

// ── Zone crop (before scale so we crop real pixel resolution) ─────────────────
if (zoneArg) {
  // Find bounding box of non-transparent pixels
  let minR = srcH, maxR = 0;
  for (let r = 0; r < srcH; r++)
    for (let c = 0; c < srcW; c++)
      if (grid[r][c] !== 0) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); }

  const bodyH = maxR - minR + 1;
  const ZONE_BOUNDS = {
    hair:    [0.00, 0.18],
    head:    [0.08, 0.30],
    torso:   [0.28, 0.60],
    hips:    [0.55, 0.72],
    legs:    [0.65, 0.92],
    feet:    [0.85, 1.00],
    upper:   [0.00, 0.50],
    lower:   [0.50, 1.00],
  };

  const zb = ZONE_BOUNDS[zoneArg];
  if (!zb) {
    console.error(`Unknown zone "${zoneArg}". Options: ${Object.keys(ZONE_BOUNDS).join(', ')}`);
    process.exit(1);
  }

  const rowStart = minR + Math.floor(zb[0] * bodyH);
  const rowEnd   = minR + Math.ceil( zb[1] * bodyH);
  grid = grid.slice(rowStart, rowEnd + 1);
  console.log(`Zone: ${zoneArg}  rows ${rowStart}-${rowEnd}  →  ${grid[0].length}×${grid.length}`);
}

// ── Scale (nearest-neighbor, supports floats) ─────────────────────────────────
function resizeGrid(g, factor) {
  const srcH = g.length, srcW = g[0]?.length ?? 0;
  const dstH = Math.max(1, Math.round(srcH * factor));
  const dstW = Math.max(1, Math.round(srcW * factor));
  return Array.from({ length: dstH }, (_, r) => {
    const srcR = Math.min(Math.floor(r / factor), srcH - 1);
    return Array.from({ length: dstW }, (_, c) => {
      const srcC = Math.min(Math.floor(c / factor), srcW - 1);
      return g[srcR][srcC];
    });
  });
}

if (scaleArg !== 1) {
  grid = resizeGrid(grid, scaleArg);
  console.log(`Scaled: ×${scaleArg}  →  ${grid[0].length}×${grid.length}`);
}

// ── Flip ──────────────────────────────────────────────────────────────────────
if (doFlipH) {
  grid = flipH(grid);
  console.log('Flipped horizontally');
}

// ── Palette transfer ──────────────────────────────────────────────────────────
let renderPalette = srcPalette;
if (paletteName) {
  const colors = BUILTIN_PALETTES[paletteName];
  if (!colors) {
    console.error(`Unknown palette: ${paletteName}. Options: ${Object.keys(BUILTIN_PALETTES).join(', ')}`);
    process.exit(1);
  }
  const tgtPalette = paletteFromRGB(colors.map((c, i) => ({ index: i, rgb: [c.r, c.g, c.b] })));
  grid = transferStyle(grid, srcPalette, tgtPalette);
  renderPalette = tgtPalette;
  console.log(`Palette: ${paletteName}`);
}

// ── Output name ───────────────────────────────────────────────────────────────
const transforms = [
  zoneArg   ? `zone_${zoneArg}`       : null,
  scaleArg !== 1 ? `scale${scaleArg}` : null,
  doFlipH   ? 'flipH'                 : null,
  paletteName ? `pal_${paletteName}`  : null,
].filter(Boolean).join('_') || 'raw';

const outName = nameArg ?? `frame_${frameId}_${transforms}`;
const W = grid[0]?.length ?? 0;
const H = grid.length;

// ── ASCII dump ────────────────────────────────────────────────────────────────
console.log(`\nOutput: ${outName}  ${W}×${H}`);
console.log(gridToAscii(grid, renderPalette));

// ── Save PNG ──────────────────────────────────────────────────────────────────
const pngPath  = join(OUT, `${outName}.png`);
const jsonPath = join(OUT, `${outName}.json`);

writeFileSync(pngPath, gridToPNG(grid, renderPalette, pngScale));

writeFileSync(jsonPath, JSON.stringify({
  id:          outName,
  source:      'compose_character',
  source_frame: parseInt(frameId),
  transforms:  { zone: zoneArg, scale: scaleArg, flipH: doFlipH, palette: paletteName },
  width:       W,
  height:      H,
  data:        grid.map(row => Array.from(row)),
}, null, 2));

console.log(`\nSaved: exports/composed/${outName}.png  (${W * pngScale}×${H * pngScale}px)`);
