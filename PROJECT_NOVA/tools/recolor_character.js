#!/usr/bin/env node
/**
 * recolor_character.js — Phase 30: Region-aware recoloring of real frames.
 *
 * Classifies a frame's palette into hue regions (red fur, skin, neutrals...)
 * and retargets chosen regions to new colors. The pixel grid is NEVER
 * modified — only the palette changes — so the sprite keeps its exact
 * structure and shading while becoming a new character variant.
 *
 * Usage:
 *   node tools/recolor_character.js --frame=4 --list
 *       → show region classification + pixel counts for the frame
 *
 *   node tools/recolor_character.js --frame=4 --map="red:#3060ff"
 *       → red region becomes blue (fur swap), everything else untouched
 *
 *   node tools/recolor_character.js --frame=4 --map="red:#3060ff,orange:#40c060" --name=blue_variant
 *
 * Output:
 *   exports/composed/<name>.png + .json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname }   from 'path';
import { fileURLToPath }   from 'url';
import { paletteFromRGB }  from '../src/core/palette.js';
import { gridToPNG }       from '../src/export/png_writer.js';
import { gridToAscii }     from '../src/core/ascii.js';
import { classifyRegions, recolorRegions, regionPixelCounts } from '../src/authoring/region_recolor.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const BATCH = join(__dir, '..', 'exports', 'batch');
const OUT   = join(__dir, '..', 'exports', 'composed');
mkdirSync(OUT, { recursive: true });

// ── Args ──────────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const getArg   = (k) => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const frameArg = getArg('frame') ?? '4';
const mapArg   = getArg('map');
const nameArg  = getArg('name');
const listOnly = args.includes('--list');
const scale    = parseInt(getArg('scale') ?? '8');

// ── Load frame ────────────────────────────────────────────────────────────────
const id    = String(frameArg).padStart(4, '0');
const gPath = join(BATCH, `frame_${id}_grid.json`);
const pPath = join(BATCH, `frame_${id}_palette.json`);
if (!existsSync(gPath) || !existsSync(pPath)) {
  console.error(`Frame ${id} not found. Run: python3 tools/batch_ingest.py`);
  process.exit(1);
}
const gd      = JSON.parse(readFileSync(gPath, 'utf8'));
const palette = paletteFromRGB(JSON.parse(readFileSync(pPath, 'utf8')));
const grid    = gd.data.map(row => Array.isArray(row) ? [...row] : Object.values(row).map(Number));

// ── List mode ─────────────────────────────────────────────────────────────────
const classification = classifyRegions(palette);
const counts = regionPixelCounts(grid, classification);

console.log(`\nframe_${id}  ${gd.width}×${gd.height}  (${palette.colors.length} colors)`);
console.log(`\nRegions (by pixel count):`);
const sorted = Object.entries(classification.regions)
  .sort((a, b) => (counts[b[0]] ?? 0) - (counts[a[0]] ?? 0));
for (const [name, info] of sorted) {
  const hexes = info.indices.map(i => {
    const c = palette.colors.find(e => e.index === i);
    return c.hex ?? `#${[c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  });
  console.log(
    `  ${name.padEnd(9)} ${String(counts[name] ?? 0).padStart(5)} px` +
    `  hue≈${Math.round(info.meanHue)}°  sat≈${info.meanSat.toFixed(2)}` +
    `  ${info.indices.length} colors: ${hexes.join(' ')}`
  );
}
console.log(`  ${'outline'.padEnd(9)} ${String(counts.outline ?? 0).padStart(5)} px`);

if (listOnly || !mapArg) process.exit(0);

// ── Parse map and recolor ─────────────────────────────────────────────────────
const spec = {};
for (const pair of mapArg.split(',')) {
  const [region, hex] = pair.split(':');
  if (!region || !hex) {
    console.error(`Bad --map entry "${pair}" — expected region:#hex`);
    process.exit(1);
  }
  spec[region.trim()] = hex.trim();
}

const { palette: newPalette } = recolorRegions(palette, spec);

console.log(`\nRecolor spec: ${Object.entries(spec).map(([k, v]) => `${k}→${v}`).join('  ')}`);
console.log(`Grid untouched: ${gd.width}×${gd.height} indices identical to source\n`);
console.log(gridToAscii(grid, newPalette));

// ── Save ──────────────────────────────────────────────────────────────────────
const outName = nameArg ??
  `frame_${id}_recolor_${Object.keys(spec).join('_')}`;

writeFileSync(join(OUT, `${outName}.png`), gridToPNG(grid, newPalette, scale));
writeFileSync(join(OUT, `${outName}.json`), JSON.stringify({
  id:           outName,
  source:       'recolor_character',
  source_frame: parseInt(frameArg),
  recolor_spec: spec,
  grid_modified: false,
  width:        gd.width,
  height:       gd.height,
  palette:      newPalette.colors.map(c => ({ index: c.index, rgb: [c.r, c.g, c.b] })),
  data:         grid.map(row => Array.from(row)),
}, null, 2));

console.log(`Saved: exports/composed/${outName}.png  (${gd.width * scale}×${gd.height * scale}px)`);
