#!/usr/bin/env node
/**
 * build_character.js — Phase 28: Assemble new characters from real frame parts.
 *
 * Takes body parts (head / torso / legs) from different real batch frames and
 * composites them into a new character. Seams are detected from the pixel
 * data (neck = narrowest row after head peak, hip = waist minimum), parts are
 * palette-unified by luminance band rank, and aligned on their body centers.
 *
 * Every pixel in the output comes from a real ingested frame.
 *
 * Usage:
 *   node tools/build_character.js --head=4 --torso=9 --legs=14
 *   node tools/build_character.js --head=18 --torso=5 --legs=0 --name=fusion_a
 *   node tools/build_character.js --head=4 --torso=9 --legs=14 --target=9
 *   node tools/build_character.js --frame=4 --show-seams    # inspect one frame's split
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
import { splitParts, findSeams, assembleCharacter } from '../src/authoring/part_compositor.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const BATCH = join(__dir, '..', 'exports', 'batch');
const OUT   = join(__dir, '..', 'exports', 'composed');
mkdirSync(OUT, { recursive: true });

// ── Args ──────────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const getArg    = (k) => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const headIdx   = getArg('head');
const torsoIdx  = getArg('torso');
const legsIdx   = getArg('legs');
const targetIdx = getArg('target');
const inspectIdx = getArg('frame');
const showSeams = args.includes('--show-seams');
const pngScale  = parseInt(getArg('png-scale') ?? '8');
const nameArg   = getArg('name');

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
    width:   gd.width,
    height:  gd.height,
  };
}

// ── Inspect mode: show one frame's detected seams ─────────────────────────────
if (inspectIdx != null) {
  const frame = loadFrame(inspectIdx);
  if (!frame) { console.error(`Frame ${inspectIdx} not found.`); process.exit(1); }

  const { neckRow, hipRow, bounds } = findSeams(frame.grid);
  console.log(`\nframe_${String(inspectIdx).padStart(4,'0')}  ${frame.width}×${frame.height}`);
  console.log(`Content rows ${bounds.top}-${bounds.bottom}  |  neck seam: row ${neckRow}  |  hip seam: row ${hipRow}`);

  if (showSeams) {
    const { head, torso, legs } = splitParts(frame.grid);
    for (const [name, part] of Object.entries({ head, torso, legs })) {
      console.log(`\n[${name}]  ${part.grid[0]?.length ?? 0}×${part.grid.length}  seamCenter=${part.seamCenter.toFixed(1)}`);
      console.log(gridToAscii(part.grid, frame.palette));
    }
  }
  process.exit(0);
}

// ── Assemble mode ─────────────────────────────────────────────────────────────
if (headIdx == null || torsoIdx == null || legsIdx == null) {
  console.error('Usage: node tools/build_character.js --head=N --torso=N --legs=N [--target=N] [--name=X]');
  console.error('   or: node tools/build_character.js --frame=N --show-seams');
  process.exit(1);
}

const spec = {
  head:  { frame: parseInt(headIdx) },
  torso: { frame: parseInt(torsoIdx) },
  legs:  { frame: parseInt(legsIdx) },
  ...(targetIdx != null ? { targetFrame: parseInt(targetIdx) } : {}),
};

console.log(`\nAssembling character:`);
console.log(`  head  ← frame_${String(spec.head.frame).padStart(4,'0')}`);
console.log(`  torso ← frame_${String(spec.torso.frame).padStart(4,'0')}`);
console.log(`  legs  ← frame_${String(spec.legs.frame).padStart(4,'0')}`);
console.log(`  palette ← frame_${String(spec.targetFrame ?? spec.head.frame).padStart(4,'0')} (original colors)`);

const { grid, palette, parts } = assembleCharacter(spec, loadFrame);
const W = grid[0]?.length ?? 0, H = grid.length;

console.log(`\nResult: ${W}×${H}`);
console.log(gridToAscii(grid, palette));

// ── Save ──────────────────────────────────────────────────────────────────────
const outName = nameArg ?? `char_h${spec.head.frame}_t${spec.torso.frame}_l${spec.legs.frame}`;

writeFileSync(join(OUT, `${outName}.png`), gridToPNG(grid, palette, pngScale));
writeFileSync(join(OUT, `${outName}.json`), JSON.stringify({
  id:      outName,
  source:  'build_character',
  spec,
  parts,
  width:   W,
  height:  H,
  data:    grid.map(row => Array.from(row)),
}, null, 2));

console.log(`Saved: exports/composed/${outName}.png  (${W * pngScale}×${H * pngScale}px)`);
