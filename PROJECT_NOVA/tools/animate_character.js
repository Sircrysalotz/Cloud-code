#!/usr/bin/env node
/**
 * animate_character.js — Phase 29: Animate a composed (fused) character.
 *
 * Applies one part spec across a range of real animation frames: the body
 * (torso + legs) animates through the base frames while any part pinned to
 * a fixed donor frame (e.g. --head=18) stays constant. All frames share one
 * palette (the target frame's ORIGINAL palette) so the sheet renders
 * consistently.
 *
 * Every pixel in every output frame comes from a real ingested frame.
 *
 * Usage:
 *   node tools/animate_character.js --range=0-7                  # pure reassembly walk
 *   node tools/animate_character.js --range=0-7 --head=18        # fused head, walking body
 *   node tools/animate_character.js --range=0-7 --head=18 --torso=9
 *   node tools/animate_character.js --range=0-7 --head=18 --fps=12 --name=fused_walk
 *
 * Output:
 *   exports/composed/<name>_sheet.png   — horizontal strip, bottom-aligned
 *   exports/composed/<name>_sheet.json  — per-frame timing + grid data
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname }    from 'path';
import { fileURLToPath }    from 'url';
import { paletteFromRGB }   from '../src/core/palette.js';
import { gridToPNG }        from '../src/export/png_writer.js';
import { gridToAscii }      from '../src/core/ascii.js';
import { assembleCharacter } from '../src/authoring/part_compositor.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const BATCH = join(__dir, '..', 'exports', 'batch');
const OUT   = join(__dir, '..', 'exports', 'composed');
mkdirSync(OUT, { recursive: true });

// ── Args ──────────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const getArg   = (k) => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const rangeArg = getArg('range') ?? '0-7';
const headIdx  = getArg('head');
const torsoIdx = getArg('torso');
const legsIdx  = getArg('legs');
const fps      = parseFloat(getArg('fps') ?? '8');
const scale    = parseInt(getArg('scale') ?? '8');
const nameArg  = getArg('name');

const [r0, r1] = rangeArg.split('-').map(Number);
if (!Number.isInteger(r0) || !Number.isInteger(r1) || r1 < r0) {
  console.error(`Bad --range "${rangeArg}" — expected like --range=0-7`);
  process.exit(1);
}
const baseFrames = Array.from({ length: r1 - r0 + 1 }, (_, i) => r0 + i);
const targetIdx  = parseInt(getArg('target') ?? String(headIdx ?? r0));

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

// ── Build each animation frame ────────────────────────────────────────────────
const pin = v => (v != null ? parseInt(v) : null);
const pinned = { head: pin(headIdx), torso: pin(torsoIdx), legs: pin(legsIdx) };

console.log(`\nAnimating composed character over frames ${r0}-${r1}`);
console.log(`  head:  ${pinned.head  ?? 'per-frame'}   torso: ${pinned.torso ?? 'per-frame'}   legs: ${pinned.legs ?? 'per-frame'}`);
console.log(`  palette ← frame_${String(targetIdx).padStart(4,'0')} (original colors)  |  ${fps}fps\n`);

const frames = [];
let sharedPalette = null;

for (const base of baseFrames) {
  const spec = {
    head:  { frame: pinned.head  ?? base },
    torso: { frame: pinned.torso ?? base },
    legs:  { frame: pinned.legs  ?? base },
    targetFrame: targetIdx,
  };
  const { grid, palette } = assembleCharacter(spec, loadFrame);
  sharedPalette = palette;
  frames.push({ base, grid, spec });
  console.log(`  frame_${String(base).padStart(4,'0')}  →  ${grid[0].length}×${grid.length}`);
}

// ── Normalize: common canvas, bottom-aligned, centered ───────────────────────
const maxW = Math.max(...frames.map(f => f.grid[0].length));
const maxH = Math.max(...frames.map(f => f.grid.length));

function normalize(grid) {
  const H = grid.length, W = grid[0].length;
  const out = Array.from({ length: maxH }, () => new Uint8Array(maxW));
  const offC = Math.floor((maxW - W) / 2);
  const offR = maxH - H;  // bottom-align: feet stay on the ground line
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++)
      if (grid[r][c] !== 0) out[offR + r][offC + c] = grid[r][c];
  return out;
}

const normFrames = frames.map(f => normalize(f.grid));

// ── Sheet assembly ────────────────────────────────────────────────────────────
const totalW = maxW * normFrames.length;
const sheet  = Array.from({ length: maxH }, () => new Uint8Array(totalW));
normFrames.forEach((g, i) => {
  for (let r = 0; r < maxH; r++)
    for (let c = 0; c < maxW; c++)
      if (g[r][c] !== 0) sheet[r][i * maxW + c] = g[r][c];
});

const outName    = nameArg ?? `anim_h${pinned.head ?? 'x'}_${r0}-${r1}`;
const msPerFrame = Math.round(1000 / fps);

writeFileSync(join(OUT, `${outName}_sheet.png`), gridToPNG(sheet, sharedPalette, scale));
writeFileSync(join(OUT, `${outName}_sheet.json`), JSON.stringify({
  id:           outName,
  source:       'animate_character',
  base_range:   [r0, r1],
  pinned,
  target_frame: targetIdx,
  fps,
  frame_width:  maxW,
  frame_height: maxH,
  frames: frames.map((f, i) => ({
    index:       i,
    base_frame:  f.base,
    spec:        f.spec,
    x:           i * maxW * scale,
    duration_ms: msPerFrame,
    data:        normFrames[i].map(row => Array.from(row)),
  })),
}, null, 2));

console.log(`\nSheet: exports/composed/${outName}_sheet.png  (${totalW * scale}×${maxH * scale}px, ${frames.length} frames @ ${msPerFrame}ms)`);
console.log(`JSON:  exports/composed/${outName}_sheet.json`);

// ASCII preview of first frame for sanity
console.log(`\n[first frame preview]`);
console.log(gridToAscii(normFrames[0], sharedPalette));
