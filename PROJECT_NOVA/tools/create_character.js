#!/usr/bin/env node
/**
 * create_character.js — Phase 31: Full character creation from one spec.
 *
 * Chains the whole real-data pipeline: part fusion (Phase 28) + animation
 * over real frame ranges (Phase 29) + region-aware recoloring (Phase 30).
 * One spec in, a complete new character out: portrait PNG + animated
 * spritesheet + AI-readable JSON. Every pixel from real ingested frames;
 * recoloring touches only the palette.
 *
 * Spec (JSON file or inline flags):
 *   {
 *     "name":    "azure",
 *     "parts":   { "head": 4, "torso": null, "legs": null },   // null = animate per-frame
 *     "recolor": { "red": "#3060ff" },                          // region → hex
 *     "animation": { "range": [0, 7], "fps": 8 },
 *     "target_frame": 4                                         // palette donor
 *   }
 *
 * Usage:
 *   node tools/create_character.js --spec=characters/azure.json
 *   node tools/create_character.js --name=azure --head=4 --range=0-7 --map="red:#3060ff"
 *
 * Output:
 *   exports/characters/<name>.png         — portrait (first animation frame)
 *   exports/characters/<name>_sheet.png   — animated strip, bottom-aligned
 *   exports/characters/<name>.json        — full definition + frame data
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname }     from 'path';
import { fileURLToPath }     from 'url';
import { paletteFromRGB }    from '../src/core/palette.js';
import { gridToPNG }         from '../src/export/png_writer.js';
import { gridToAscii }       from '../src/core/ascii.js';
import { assembleCharacter } from '../src/authoring/part_compositor.js';
import { recolorRegions, regionPixelCounts, classifyRegions } from '../src/authoring/region_recolor.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const BATCH = join(__dir, '..', 'exports', 'batch');
const OUT   = join(__dir, '..', 'exports', 'characters');
mkdirSync(OUT, { recursive: true });

// ── Args / spec ───────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const getArg = (k) => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);

let spec;
const specPath = getArg('spec');
if (specPath) {
  spec = JSON.parse(readFileSync(specPath, 'utf8'));
} else {
  const pin = v => (v != null ? parseInt(v) : null);
  const [a0, a1] = (getArg('range') ?? '0-7').split('-').map(Number);
  const mapArg = getArg('map');
  const recolor = {};
  if (mapArg) {
    for (const pair of mapArg.split(',')) {
      const [region, hex] = pair.split(':');
      recolor[region.trim()] = hex.trim();
    }
  }
  spec = {
    name:  getArg('name') ?? 'unnamed',
    parts: { head: pin(getArg('head')), torso: pin(getArg('torso')), legs: pin(getArg('legs')) },
    recolor,
    animation: { range: [a0, a1], fps: parseFloat(getArg('fps') ?? '8') },
    target_frame: getArg('target') != null ? parseInt(getArg('target')) : undefined,
  };
}

const scale = parseInt(getArg('scale') ?? '8');
const [r0, r1] = spec.animation?.range ?? [0, 7];
const fps      = spec.animation?.fps ?? 8;
const targetIdx = spec.target_frame ??
  spec.parts?.head ?? spec.parts?.torso ?? spec.parts?.legs ?? r0;

// ── Frame loader ──────────────────────────────────────────────────────────────
function loadFrame(frameIdx) {
  const id = String(frameIdx).padStart(4, '0');
  const gPath = join(BATCH, `frame_${id}_grid.json`);
  const pPath = join(BATCH, `frame_${id}_palette.json`);
  if (!existsSync(gPath) || !existsSync(pPath)) return null;
  const gd = JSON.parse(readFileSync(gPath, 'utf8'));
  const pd = JSON.parse(readFileSync(pPath, 'utf8'));
  return {
    grid:    gd.data.map(row => Array.isArray(row) ? [...row] : Object.values(row).map(Number)),
    palette: paletteFromRGB(pd),
  };
}

// ── Header ────────────────────────────────────────────────────────────────────
console.log(`\n╔══════════════════════════════════════════════════════════╗`);
console.log(`║   PROJECT NOVA — Phase 31: Character Creation            ║`);
console.log(`╚══════════════════════════════════════════════════════════╝`);
console.log(`\n  Name:     ${spec.name}`);
console.log(`  Parts:    head=${spec.parts?.head ?? 'per-frame'}  torso=${spec.parts?.torso ?? 'per-frame'}  legs=${spec.parts?.legs ?? 'per-frame'}`);
console.log(`  Recolor:  ${Object.keys(spec.recolor ?? {}).length ? Object.entries(spec.recolor).map(([k,v]) => `${k}→${v}`).join('  ') : 'none (original colors)'}`);
console.log(`  Animate:  frames ${r0}-${r1} @ ${fps}fps  |  palette ← frame_${String(targetIdx).padStart(4,'0')}\n`);

// ── 1. Compose every animation frame (Phase 28/29) ────────────────────────────
const baseFrames = Array.from({ length: r1 - r0 + 1 }, (_, i) => r0 + i);
const frames = [];
let basePalette = null;

for (const base of baseFrames) {
  const partSpec = {
    head:  { frame: spec.parts?.head  ?? base },
    torso: { frame: spec.parts?.torso ?? base },
    legs:  { frame: spec.parts?.legs  ?? base },
    targetFrame: targetIdx,
  };
  const { grid, palette } = assembleCharacter(partSpec, loadFrame);
  basePalette = palette;
  frames.push({ base, grid });
  console.log(`  frame_${String(base).padStart(4,'0')}  composed  ${grid[0].length}×${grid.length}`);
}

// ── 2. Recolor regions (Phase 30) — palette only, grids untouched ─────────────
let renderPalette = basePalette;
let regionInfo = null;
if (spec.recolor && Object.keys(spec.recolor).length > 0) {
  const result = recolorRegions(basePalette, spec.recolor);
  renderPalette = result.palette;
  regionInfo    = result.regions;
  console.log(`\n  Recolored regions: ${Object.keys(spec.recolor).join(', ')}  (grids untouched)`);
}

// ── 3. Normalize + assemble sheet ─────────────────────────────────────────────
const maxW = Math.max(...frames.map(f => f.grid[0].length));
const maxH = Math.max(...frames.map(f => f.grid.length));

function normalize(grid) {
  const H = grid.length, W = grid[0].length;
  const out = Array.from({ length: maxH }, () => new Uint8Array(maxW));
  const offC = Math.floor((maxW - W) / 2);
  const offR = maxH - H;   // bottom-aligned
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++)
      if (grid[r][c] !== 0) out[offR + r][offC + c] = grid[r][c];
  return out;
}

const normFrames = frames.map(f => normalize(f.grid));
const totalW = maxW * normFrames.length;
const sheet  = Array.from({ length: maxH }, () => new Uint8Array(totalW));
normFrames.forEach((g, i) => {
  for (let r = 0; r < maxH; r++)
    for (let c = 0; c < maxW; c++)
      if (g[r][c] !== 0) sheet[r][i * maxW + c] = g[r][c];
});

// ── 4. Export ─────────────────────────────────────────────────────────────────
const msPerFrame = Math.round(1000 / fps);
const name = spec.name;

writeFileSync(join(OUT, `${name}.png`),       gridToPNG(normFrames[0], renderPalette, scale));
writeFileSync(join(OUT, `${name}_sheet.png`), gridToPNG(sheet, renderPalette, scale));
writeFileSync(join(OUT, `${name}.json`), JSON.stringify({
  id:      name,
  source:  'create_character',
  spec,
  palette: renderPalette.colors.map(c => ({ index: c.index, rgb: [c.r, c.g, c.b] })),
  regions: regionInfo,
  region_pixels: regionPixelCounts(normFrames[0], classifyRegions(basePalette)),
  frame_width:  maxW,
  frame_height: maxH,
  fps,
  frames: frames.map((f, i) => ({
    index: i, base_frame: f.base,
    duration_ms: msPerFrame,
    data: normFrames[i].map(row => Array.from(row)),
  })),
}, null, 2));

console.log(`\n  Portrait: exports/characters/${name}.png  (${maxW * scale}×${maxH * scale}px)`);
console.log(`  Sheet:    exports/characters/${name}_sheet.png  (${totalW * scale}×${maxH * scale}px, ${frames.length} frames)`);
console.log(`  JSON:     exports/characters/${name}.json`);

console.log(`\n[portrait preview]`);
console.log(gridToAscii(normFrames[0], renderPalette));
