#!/usr/bin/env node
/**
 * Generate a 4-frame idle animation for the warrior sprite.
 *
 * All animation is done in data space — grid transforms, no rendering.
 * The 4 frames represent a breathing cycle:
 *   F0: neutral (base warrior)
 *   F1: inhale  (body shifted up 1px, slightly taller)
 *   F2: neutral (same as F0 — held)
 *   F3: exhale  (body shifted down 1px, slightly compressed)
 *
 * Output:
 *   exports/warrior_idle.png  — 4-frame horizontal spritesheet (8x scale)
 *   exports/warrior_idle.json — timing sidecar with ASCII per-frame
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath }             from 'url';
import { dirname, join }             from 'path';
import { makeGrid, cloneGrid, gridSize } from '../src/core/grid.js';
import { IDX, PALETTE }              from '../src/core/palette.js';
import { asciiDump }                 from '../src/core/ascii.js';
import { runCleanup }                from '../src/cleanup/index.js';
import { makeKeyframe }              from '../src/animation/keyframe.js';
import { idleTiming }                from '../src/animation/timing.js';
import { keyframesToPNG, buildSidecar, animationSummary } from '../src/animation/spritesheet.js';
import { evalGrid }                  from '../src/eval/compare.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT   = join(__dir, '..', 'exports');
mkdirSync(OUT, { recursive: true });

// ── Load base warrior grid ────────────────────────────────────────────────────
const raw      = JSON.parse(readFileSync(join(OUT, 'warrior_post.json'), 'utf8'));
const baseGrid = raw.data.map(row => Array.isArray(row) ? row : Object.values(row).map(Number));
const [W, H]   = gridSize(baseGrid);

console.log(`Base warrior: ${W}×${H}`);

// ── Frame transforms ──────────────────────────────────────────────────────────
// Each transform returns a new grid — pure functions, no mutation.

const T  = IDX.TRANSPARENT;

/** Shift all non-transparent pixels up by `dy` rows (positive = up). */
function shiftVertical(grid, dy) {
  const [w, h] = gridSize(grid);
  const out = makeGrid(w, h, T);
  for (let r = 0; r < h; r++) {
    const srcR = r + dy;
    if (srcR < 0 || srcR >= h) continue;
    for (let c = 0; c < w; c++) {
      out[r][c] = grid[srcR][c];
    }
  }
  return out;
}

/** Add a 1px contact-shadow darkening at the bottom body pixels. */
function emphasizeContactShadow(grid) {
  // pass 9 already handles this — just re-run cleanup
  return runCleanup(grid).grid;
}

/** Squeeze body slightly: compress by removing a row of pixels mid-body (exhale). */
function exhale(grid) {
  // Shift the bottom half down 1px then shift everything up 1px
  const [w, h] = gridSize(grid);
  const mid = Math.floor(h * 0.45); // compress at roughly the waist
  const out = makeGrid(w, h, T);
  for (let r = 0; r < mid; r++) {
    for (let c = 0; c < w; c++) out[r][c] = grid[r][c];
  }
  // bottom half shifted down 1 (skip one row to compress)
  for (let r = mid; r < h - 1; r++) {
    for (let c = 0; c < w; c++) out[r][c] = grid[r + 1][c];
  }
  return out;
}

// ── Build 4 frames ────────────────────────────────────────────────────────────
console.log('\nBuilding frames...');

const frame0Grid = baseGrid;                              // neutral
const frame1Grid = shiftVertical(baseGrid, 1);            // inhale: body up 1px (shifts all content up)
const frame2Grid = cloneGrid(baseGrid);                   // neutral (held)
const frame3Grid = exhale(shiftVertical(baseGrid, -1));   // exhale: body down + compress

const frames = [frame0Grid, frame1Grid, frame2Grid, frame3Grid];

// Run cleanup on frames 1 and 3 (the modified frames)
const cleanFrames = [
  frame0Grid,
  runCleanup(frame1Grid).grid,
  frame2Grid,
  runCleanup(frame3Grid).grid,
];

// ── Per-frame timing ──────────────────────────────────────────────────────────
// Idle breathing: 600ms total
// F0=neutral long, F1=inhale short, F2=neutral long, F3=exhale short
const durations = [180, 90, 180, 90]; // ms — explicit, not derived from FPS

const labels = ['neutral', 'inhale', 'neutral-hold', 'exhale'];

// ── Build keyframes ───────────────────────────────────────────────────────────
const keyframes = cleanFrames.map((g, i) =>
  makeKeyframe(g, durations[i], { label: labels[i], tags: ['idle', 'warrior', 'breathing'] })
);

// ── Evaluate each frame against reference ────────────────────────────────────
console.log('\n── Per-frame evaluation ──────────────────────────────────────');
for (let i = 0; i < keyframes.length; i++) {
  const { comparison } = evalGrid(keyframes[i].grid);
  console.log(`  Frame ${i} (${labels[i]}): rmsZ=${comparison.rms_z} ${comparison.summary}`);
}

// ── ASCII dump of each frame ──────────────────────────────────────────────────
console.log('\n── Frame dumps ───────────────────────────────────────────────');
for (let i = 0; i < keyframes.length; i++) {
  console.log(asciiDump(keyframes[i].grid, `frame_${i}_${labels[i]}`));
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + animationSummary(keyframes, 'warrior_idle'));

// ── Export PNG spritesheet ────────────────────────────────────────────────────
const SCALE = 8;
const pngBytes = keyframesToPNG(keyframes, SCALE);
writeFileSync(join(OUT, 'warrior_idle.png'), pngBytes);
console.log(`\nPNG: exports/warrior_idle.png  (${W * keyframes.length * SCALE}×${H * SCALE}px)`);

// ── Export JSON sidecar ───────────────────────────────────────────────────────
const sidecar = buildSidecar(keyframes, {
  name:       'warrior_idle',
  source:     'procedural',
  characters: ['warrior'],
  totalMs:    durations.reduce((a, b) => a + b, 0),
});
writeFileSync(join(OUT, 'warrior_idle.json'), JSON.stringify(sidecar, null, 2));
console.log('JSON: exports/warrior_idle.json');
