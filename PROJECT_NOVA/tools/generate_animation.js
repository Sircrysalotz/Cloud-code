#!/usr/bin/env node
/**
 * generate_animation.js — Phase 12: Animated sprite from generative pipeline.
 *
 * Builds two animations from scratch (no ingested Goku frames needed):
 *   1. idle_loop: 4-frame breathing cycle using threshold variation
 *   2. pose_sequence: 5 generated warrior poses as a hold-based sequence
 *
 * Every frame is Goku-calibrated and AI-readable (ASCII previews in sidecar).
 *
 * Usage:
 *   node tools/generate_animation.js                  # both animations
 *   node tools/generate_animation.js --anim=idle      # idle breathing only
 *   node tools/generate_animation.js --anim=poses     # pose sequence only
 *   node tools/generate_animation.js --palette=cool   # style-transfer output
 *   node tools/generate_animation.js --scale=4        # output scale (default 6)
 *   node tools/generate_animation.js --fps=8          # idle loop FPS (default 8)
 *
 * Output:
 *   exports/generated_animation/idle_loop[_palette].png  + .json
 *   exports/generated_animation/pose_sequence[_palette].png + .json
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname }           from 'path';
import { fileURLToPath }           from 'url';
import { PALETTE, paletteFromRGB } from '../src/core/palette.js';
import { runIteration }            from './goku_iterate.js';
import { idleParams, poseParams, POSE_NAMES } from '../src/authoring/poses.js';
import { buildFromParams }         from '../src/authoring/parametric.js';
import { loadBatchReference }      from '../src/eval/reference_lib.js';
import { makeKeyframe, totalDuration } from '../src/animation/keyframe.js';
import { buildSidecar }            from '../src/animation/spritesheet.js';
import { framesToSpritesheetPNG }  from '../src/export/png_writer.js';
import { transferStyle }           from './style_transfer.js';
import { distributeDurations }     from '../src/animation/timing.js';

const __dir    = dirname(fileURLToPath(import.meta.url));
const POSES_DIR = join(__dir, '..', 'exports', 'poses');
const OUT_DIR   = join(__dir, '..', 'exports', 'generated_animation');

// ── Breathing offsets for 4-frame idle cycle ─────────────────────────────────
// Threshold delta per frame: neutral → expand → neutral → compress
export const BREATHE_OFFSETS = [0, -0.025, 0, +0.025];

// ── Pose-sequence hold durations (ms) ────────────────────────────────────────
export const POSE_SEQUENCE_TIMING = {
  idle:     500,
  guard:    400,
  punch:    250,  // fast strike
  kick:     250,  // fast kick
  power_up: 800,  // dramatic hold
};

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Pad a grid to w×h with transparent (0) pixels.
 * Returns a new grid (array of plain number arrays).
 */
export function padGridToSize(grid, w, h) {
  return Array.from({ length: h }, (_, r) => {
    const row = r < grid.length ? Array.from(grid[r]) : [];
    while (row.length < w) row.push(0);
    return row;
  });
}

/**
 * Generate n breathing-variant frames from already-calibrated params.
 * Applies BREATHE_OFFSETS cyclically as pure parametric threshold shifts —
 * no iteration, so the breathing direction is deterministic.
 *
 * @param {object} calibratedParams — params (e.g. bestParams from runIteration)
 * @param {number} n                — number of frames (typically 4)
 * @returns {Uint8Array[][]}        — array of n grids
 */
export function buildFrameVariants(calibratedParams, n) {
  return Array.from({ length: n }, (_, i) => {
    const delta = BREATHE_OFFSETS[i % BREATHE_OFFSETS.length];
    if (delta === 0) return buildFromParams(calibratedParams);
    const params = {
      ...calibratedParams,
      thresholds: calibratedParams.thresholds.map(t =>
        Math.max(0.05, Math.min(0.95, t + delta))
      ),
    };
    return buildFromParams(params);
  });
}

/**
 * Load a pose grid from exports/poses/<name>.json, or generate it freshly.
 * Returns a Uint8Array[] grid.
 */
export function loadOrGeneratePose(poseName, distribution, opts = {}) {
  const { maxIter = 30, targetRmsZ = 0.70 } = opts;
  const jsonPath = join(POSES_DIR, `${poseName}.json`);
  if (existsSync(jsonPath)) {
    const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
    return raw.data.map(row => new Uint8Array(row));
  }
  const { bestGrid } = runIteration(poseParams(poseName), distribution, { maxIter, targetRmsZ });
  return bestGrid;
}

/**
 * Build the idle breathing animation (4 frames).
 *
 * @param {object} distribution — Goku reference distribution
 * @param {object} [opts]
 * @returns {{ grids: Uint8Array[][], timings: number[] }}
 */
export function buildIdleAnimation(distribution, opts = {}) {
  const { fps = 8, maxIter = 20, targetRmsZ = 0.70 } = opts;
  // Calibrate once to get Goku-distribution-aligned thresholds
  const { bestParams } = runIteration(idleParams(), distribution, { maxIter, targetRmsZ });
  // Apply breathing offsets as pure parametric shifts (deterministic)
  const grids  = buildFrameVariants(bestParams, 4);
  const msPerFrame = Math.round(1000 / fps);
  return { grids, timings: [msPerFrame, msPerFrame, msPerFrame, msPerFrame] };
}

/**
 * Build the pose sequence animation (one frame per pose, hold durations).
 *
 * @param {object} distribution
 * @param {object} [opts]
 * @returns {{ grids: Uint8Array[][], timings: number[], labels: string[] }}
 */
export function buildPoseAnimation(distribution, opts = {}) {
  const { maxIter = 30, targetRmsZ = 0.70 } = opts;
  const grids  = [];
  const labels = [];
  for (const name of POSE_NAMES) {
    grids.push(loadOrGeneratePose(name, distribution, { maxIter, targetRmsZ }));
    labels.push(name);
  }
  const timings = POSE_NAMES.map(n => POSE_SEQUENCE_TIMING[n] ?? 400);
  return { grids, timings, labels };
}

/**
 * Assemble grids + timings into keyframes + PNG bytes + sidecar object.
 * Pads grids to uniform size automatically.
 *
 * @param {Uint8Array[][]} grids
 * @param {number[]} timings        — per-frame ms
 * @param {object}   palette        — palette for PNG encoding
 * @param {number}   scale
 * @param {string[]} [labels]
 * @param {object}   [meta]
 * @returns {{ keyframes, pngBytes, sidecar, width, height }}
 */
export function assembleAnimation(grids, timings, palette, scale, labels = [], meta = {}) {
  const maxW = Math.max(...grids.map(g => g[0]?.length ?? 0));
  const maxH = Math.max(...grids.map(g => g.length));

  const keyframes = grids.map((g, i) => {
    const padded = padGridToSize(g, maxW, maxH);
    return makeKeyframe(padded, timings[i], { label: labels[i] ?? `frame_${i}`, tags: ['generated'] });
  });

  const frameGrids = keyframes.map(kf => kf.grid);
  const pngBytes   = framesToSpritesheetPNG(frameGrids, palette, scale);
  const sidecar    = buildSidecar(keyframes, meta);

  return { keyframes, pngBytes, sidecar, width: maxW, height: maxH };
}

// ── Built-in palettes ─────────────────────────────────────────────────────────

const PALETTE_DEFS = {
  crimson: [[0,0,0],[28,8,20],[56,12,32],[104,20,36],[184,40,28],[232,96,36],[255,168,64],[255,224,136]],
  cool:    [[0,0,0],[10,8,30],[20,20,80],[40,40,120],[70,80,180],[100,140,220],[160,200,255],[220,240,255]],
  warm:    [[0,0,0],[30,10,0],[80,25,0],[140,50,5],[210,100,20],[240,150,40],[255,200,80],[255,240,160]],
  forest:  [[0,0,0],[8,20,8],[15,40,15],[30,70,25],[50,110,40],[80,155,60],[140,200,90],[200,240,150]],
  mono:    [[0,0,0],[20,20,20],[45,45,45],[80,80,80],[120,120,120],[160,160,160],[200,200,200],[240,240,240]],
};

function buildPalette(name) {
  const def = PALETTE_DEFS[name];
  if (!def) throw new Error(`Unknown palette: ${name}. Options: ${Object.keys(PALETTE_DEFS).join(', ')}`);
  return paletteFromRGB(def.map(([r,g,b], i) => ({ index: i, rgb: [r,g,b] })));
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const __isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (__isMain) {
  mkdirSync(OUT_DIR, { recursive: true });

  const args      = process.argv.slice(2);
  const scale     = parseInt(args.find(a => a.startsWith('--scale='))?.slice(8)   ?? '6');
  const fps       = parseInt(args.find(a => a.startsWith('--fps='))?.slice(6)     ?? '8');
  const palName   = args.find(a => a.startsWith('--palette='))?.slice(10) ?? null;
  const animArg   = args.find(a => a.startsWith('--anim='))?.slice(7) ?? 'both';

  const doIdle  = animArg === 'both' || animArg === 'idle';
  const doPoses = animArg === 'both' || animArg === 'poses';

  const palSuffix  = palName ? `_${palName}` : '';
  const tgtPalette = palName ? buildPalette(palName) : null;

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  PROJECT NOVA — Phase 12: Generated Animation           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\n  Scale: ${scale}×  |  FPS: ${fps}  |  Palette: ${palName ?? 'crimson (default)'}`);
  console.log(`  Animations: ${animArg}\n`);

  const ref = loadBatchReference();
  if (!ref) { console.error('No batch reference. Run: python3 tools/batch_ingest.py'); process.exit(1); }
  const { distribution } = ref;

  // ── Idle breathing loop ──────────────────────────────────────────────────

  if (doIdle) {
    console.log('  [1/2] Idle breathing loop (4 frames)...');
    const { grids, timings } = buildIdleAnimation(distribution, { fps });

    let srcPalette = PALETTE;
    let finalGrids = grids;
    if (tgtPalette) {
      finalGrids = grids.map(g => transferStyle(g, PALETTE, tgtPalette));
      srcPalette = tgtPalette;
    }

    const { pngBytes, sidecar, width, height } = assembleAnimation(
      finalGrids, timings, srcPalette, scale,
      ['neutral', 'expand', 'neutral', 'compress'],
      { animation: 'idle_loop', fps, palette: palName ?? 'crimson',
        breathe_offsets: BREATHE_OFFSETS },
    );

    const base = `idle_loop${palSuffix}`;
    writeFileSync(join(OUT_DIR, `${base}.png`),  pngBytes);
    writeFileSync(join(OUT_DIR, `${base}.json`), JSON.stringify(sidecar, null, 2));

    const totalMs = timings.reduce((s, t) => s + t, 0);
    console.log(`    ✓  ${base}.png  (${width * 4 * scale}×${height * scale}px, ${totalMs}ms loop)`);
    console.log(`    ✓  ${base}.json`);
  }

  // ── Pose sequence animation ──────────────────────────────────────────────

  if (doPoses) {
    console.log(`\n  [2/2] Pose sequence (${POSE_NAMES.length} poses)...`);
    const { grids, timings, labels } = buildPoseAnimation(distribution);

    let srcPalette = PALETTE;
    let finalGrids = grids;
    if (tgtPalette) {
      finalGrids = grids.map(g => transferStyle(g, PALETTE, tgtPalette));
      srcPalette = tgtPalette;
    }

    const { pngBytes, sidecar, width, height } = assembleAnimation(
      finalGrids, timings, srcPalette, scale, labels,
      { animation: 'pose_sequence', poses: POSE_NAMES,
        palette: palName ?? 'crimson', timings: Object.fromEntries(POSE_NAMES.map((n, i) => [n, timings[i]])) },
    );

    const base = `pose_sequence${palSuffix}`;
    writeFileSync(join(OUT_DIR, `${base}.png`),  pngBytes);
    writeFileSync(join(OUT_DIR, `${base}.json`), JSON.stringify(sidecar, null, 2));

    const totalMs = timings.reduce((s, t) => s + t, 0);
    const sheetW  = grids.reduce((s, g) => s + (g[0]?.length ?? 0), (grids.length - 1)) * scale;
    console.log(`    ✓  ${base}.png  (${sheetW}×${height * scale}px, ${totalMs}ms total)`);
    console.log(`    ✓  ${base}.json`);
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  Generated animation complete                           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
}
