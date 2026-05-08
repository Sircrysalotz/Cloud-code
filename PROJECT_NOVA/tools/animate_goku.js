#!/usr/bin/env node
/**
 * animate_goku.js — Assemble a sequence of Goku batch frames into an animation.
 *
 * Reads a named sequence (or auto-detects by frame range), runs cleanup on each,
 * optionally applies style transfer, and exports:
 *   - PNG spritesheet (horizontal strip)
 *   - JSON sidecar with per-frame timing and ASCII previews
 *   - Terminal ASCII preview of every frame
 *
 * Usage:
 *   node tools/animate_goku.js --frames 0,1,2,3,4,5,6,7   # by index list
 *   node tools/animate_goku.js --range 0-7                 # by range
 *   node tools/animate_goku.js --range 0-7 --palette cool  # with style transfer
 *   node tools/animate_goku.js --range 0-7 --fps 12        # timing
 *   node tools/animate_goku.js --sequence walk             # named sequence
 *
 * Named sequences (detected from Goku sheet structure):
 *   walk  — frames 0-7   (walk cycle, 8 frames)
 *   idle  — frames 8-11  (idle breathing, 4 frames)
 *   kick  — frames 12-19 (kick animation, 8 frames)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname }    from 'path';
import { fileURLToPath }    from 'url';
import { paletteFromRGB }   from '../src/core/palette.js';
import { gridToAscii }      from '../src/core/ascii.js';
import { runCleanup }       from '../src/cleanup/index.js';
import { makeKeyframe }     from '../src/animation/keyframe.js';
import { keyframesToPNG, buildSidecar } from '../src/animation/spritesheet.js';
import { transferStyle }    from './style_transfer.js';
import { PALETTE }          from '../src/core/palette.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const BATCH = join(__dir, '..', 'exports', 'batch');
const OUT   = join(__dir, '..', 'exports', 'animations');
mkdirSync(OUT, { recursive: true });

// ── Named sequences ───────────────────────────────────────────────────────────

const SEQUENCES = {
  walk:  { frames: [0,1,2,3,4,5,6,7],   label: 'Walk cycle' },
  idle:  { frames: [8,9,10,11],          label: 'Idle breathe' },
  kick:  { frames: [12,13,14,15,16,17,18,19], label: 'Kick' },
  run:   { frames: [20,21,22,23,24,25],  label: 'Run' },
  punch: { frames: [26,27,28,29,30,31],  label: 'Punch' },
};

// ── Built-in palettes (same as style_transfer.js) ────────────────────────────

const BUILTIN_PALETTES = {
  crimson: [[0,0,0],[28,8,20],[56,12,32],[104,20,36],[184,40,28],[232,96,36],[255,168,64],[255,224,136]],
  cool:    [[0,0,0],[10,8,30],[20,20,80],[40,40,120],[70,80,180],[100,140,220],[160,200,255],[220,240,255]],
  warm:    [[0,0,0],[30,10,0],[80,25,0],[140,50,5],[210,100,20],[240,150,40],[255,200,80],[255,240,160]],
  forest:  [[0,0,0],[8,20,8],[15,40,15],[30,70,25],[50,110,40],[80,155,60],[130,200,90],[200,240,160]],
  mono:    [[0,0,0],[20,20,20],[45,45,45],[80,80,80],[120,120,120],[160,160,160],[200,200,200],[235,235,235]],
};

function getTargetPalette(name) {
  if (!name || name === 'source') return null;
  const colors = BUILTIN_PALETTES[name];
  if (!colors) throw new Error(`Unknown palette: ${name}. Options: ${Object.keys(BUILTIN_PALETTES).join(', ')}`);
  return paletteFromRGB(colors.map(([r,g,b], i) => ({ index: i, rgb: [r, g, b] })));
}

// ── Load and prep a frame ─────────────────────────────────────────────────────

function loadAndPrep(frameIdx, tgtPalette) {
  const name        = `frame_${String(frameIdx).padStart(4, '0')}`;
  const gridData    = JSON.parse(readFileSync(join(BATCH, `${name}_grid.json`),    'utf8'));
  const paletteData = JSON.parse(readFileSync(join(BATCH, `${name}_palette.json`), 'utf8'));
  const srcPalette  = paletteFromRGB(paletteData);
  const raw         = gridData.data.map(row => Array.isArray(row) ? [...row] : Object.values(row).map(Number));

  const { grid: cleaned } = runCleanup(raw, srcPalette);

  if (tgtPalette) {
    const transferred = transferStyle(cleaned, srcPalette, tgtPalette);
    return { grid: transferred, palette: tgtPalette, name };
  }
  return { grid: cleaned, palette: srcPalette, name };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const scale    = (() => { const i = args.indexOf('--scale'); return i >= 0 ? parseInt(args[i+1]) : 4; })();
const fps      = (() => { const i = args.indexOf('--fps'); return i >= 0 ? parseFloat(args[i+1]) : 8; })();
const palName  = (() => { const i = args.indexOf('--palette'); return i >= 0 ? args[i+1] : null; })();
const seqName  = (() => { const i = args.indexOf('--sequence'); return i >= 0 ? args[i+1] : null; })();
const rangeArg = (() => { const i = args.indexOf('--range'); return i >= 0 ? args[i+1] : null; })();
const framesArg= (() => { const i = args.indexOf('--frames'); return i >= 0 ? args[i+1] : null; })();

// Resolve frame indices
let frameIndices;
let label = 'animation';
if (seqName) {
  const seq = SEQUENCES[seqName];
  if (!seq) { console.error(`Unknown sequence: ${seqName}. Options: ${Object.keys(SEQUENCES).join(', ')}`); process.exit(1); }
  frameIndices = seq.frames;
  label        = seq.label;
} else if (rangeArg) {
  const [start, end] = rangeArg.split('-').map(Number);
  frameIndices = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  label        = `frames ${start}-${end}`;
} else if (framesArg) {
  frameIndices = framesArg.split(',').map(Number);
  label        = `frames [${framesArg}]`;
} else {
  frameIndices = SEQUENCES.walk.frames;
  label        = SEQUENCES.walk.label;
}

const tgtPalette  = getTargetPalette(palName);
const msPer       = Math.round(1000 / fps);
const palSuffix   = palName ? `_${palName}` : '_source';
const outBase     = `goku_${label.replace(/\s+/g, '_').toLowerCase()}${palSuffix}`;

console.log(`\nAssembling: ${label}  (${frameIndices.length} frames, ${fps}fps, palette: ${palName ?? 'source'})`);

// Load all frames
const frames = [];
for (const idx of frameIndices) {
  try {
    const f = loadAndPrep(idx, tgtPalette);
    frames.push(f);
    console.log(`  [${idx}] ${f.name}  ${f.grid[0]?.length ?? 0}×${f.grid.length}`);
  } catch (e) {
    console.warn(`  SKIP [${idx}]: ${e.message}`);
  }
}

if (frames.length === 0) { console.error('No frames loaded.'); process.exit(1); }

// Normalize to same size (pad to max w×h)
const maxW = Math.max(...frames.map(f => f.grid[0]?.length ?? 0));
const maxH = Math.max(...frames.map(f => f.grid.length));

function padGrid(grid, w, h) {
  const padded = Array.from({ length: h }, (_, r) => {
    const row = grid[r] ?? [];
    return [...row, ...Array(w - row.length).fill(0)];
  });
  return padded;
}

// Use the palette from the first frame (all should share one after transfer)
const sharedPalette = tgtPalette ?? frames[0].palette;

// Build keyframes with explicit per-frame timing
const keyframes = frames.map((f, i) => {
  const grid = padGrid(f.grid, maxW, maxH);
  return makeKeyframe(grid, msPer, { label: f.name, tags: ['goku'] });
});

// ASCII preview of each frame
console.log(`\nFrame previews (${maxW}×${maxH} px):`);
for (let i = 0; i < keyframes.length; i++) {
  console.log(`\n--- Frame ${i} (${frames[i].name}, ${msPer}ms) ---`);
  console.log(gridToAscii(keyframes[i].grid, sharedPalette));
}

// Export PNG spritesheet
// Build PNG using sharedPalette — patch keyframesToPNG to accept palette
const grids    = keyframes.map(kf => kf.grid);
const { framesToSpritesheetPNG } = await import('../src/export/png_writer.js');
const pngBytes = framesToSpritesheetPNG(grids, sharedPalette, scale);
const pngPath  = join(OUT, `${outBase}.png`);
writeFileSync(pngPath, pngBytes);

// Export JSON sidecar
const sidecar  = buildSidecar(keyframes, {
  label,
  palette:    palName ?? 'source',
  fps,
  frame_size: { width: maxW, height: maxH },
});
const jsonPath = join(OUT, `${outBase}.json`);
writeFileSync(jsonPath, JSON.stringify(sidecar, null, 2));

console.log(`\nSpritesheet: ${pngPath}  (${maxW * frameIndices.length * scale}×${maxH * scale}px)`);
console.log(`Sidecar:     ${jsonPath}`);
console.log(`Total:       ${keyframes.length} frames  ${keyframes.reduce((s,k)=>s+k.durationMs,0)}ms`);
