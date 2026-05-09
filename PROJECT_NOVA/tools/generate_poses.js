#!/usr/bin/env node
/**
 * generate_poses.js — Phase 9: Multi-pose generation + animated sprite sheet.
 *
 * Generates all 5 pose variants (idle, guard, punch, kick, power_up), iterates
 * each to match the Goku band distribution, then assembles them into an
 * animated sprite sheet.
 *
 * Usage:
 *   node tools/generate_poses.js                   # all 5 poses
 *   node tools/generate_poses.js --poses idle,punch # specific poses
 *   node tools/generate_poses.js --max 30           # iteration budget per pose
 *   node tools/generate_poses.js --scale 8          # PNG scale
 *   node tools/generate_poses.js --fps 8            # animation FPS
 *   node tools/generate_poses.js --no-sheet         # skip spritesheet assembly
 *
 * Outputs:
 *   exports/poses/<pose>.png           — individual pose PNG (8× scale)
 *   exports/poses/<pose>.json          — metrics + iteration log
 *   exports/poses/pose_sheet.png       — all poses in one spritesheet
 *   exports/poses/pose_sheet.json      — spritesheet sidecar with timing
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath }                    from 'url';
import { dirname, join }                    from 'path';
import { PALETTE }                          from '../src/core/palette.js';
import { asciiDump }                        from '../src/core/ascii.js';
import { gridToPNG }                        from '../src/export/png_writer.js';
import { computeMetrics }                   from '../src/eval/metrics.js';
import { compareToReference }               from '../src/eval/compare.js';
import { loadBatchReference }               from '../src/eval/reference_lib.js';
import { POSE_NAMES, POSE_FRAME, poseParams } from '../src/authoring/poses.js';
import { buildFromParams }                  from '../src/authoring/parametric.js';
import { runCleanup }                       from '../src/cleanup/index.js';
import { runIteration, bandRmsZ }           from './goku_iterate.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT   = join(__dir, '..', 'exports', 'poses');
mkdirSync(OUT, { recursive: true });

// ── Args ──────────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const maxIter   = parseInt(args.find(a => a.startsWith('--max='))?.slice(6)  ?? '30');
const scale     = parseInt(args.find(a => a.startsWith('--scale='))?.slice(8) ?? '8');
const fps       = parseFloat(args.find(a => a.startsWith('--fps='))?.slice(6) ?? '8');
const noSheet   = args.includes('--no-sheet');
const noTemplate = args.includes('--no-template');
const posesArg  = args.find(a => a.startsWith('--poses='))?.slice(8);
const targetPoses = posesArg ? posesArg.split(',') : POSE_NAMES;

const BATCH_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'exports', 'batch');

function loadSilhouette(frameIdx) {
  const id   = String(frameIdx).padStart(4, '0');
  const path = join(BATCH_DIR, `frame_${id}_grid.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

// ── Load reference ────────────────────────────────────────────────────────────
const ref = loadBatchReference();
if (!ref) {
  console.error('ERROR: No batch reference.\nRun: python3 tools/batch_ingest.py');
  process.exit(1);
}
const { distribution } = ref;

// ── Header ────────────────────────────────────────────────────────────────────
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║   PROJECT NOVA — Phase 9: Multi-Pose Generation         ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log(`\n  Poses:     ${targetPoses.join(' | ')}`);
console.log(`  Reference: ${ref.entries?.length ?? 0} Goku frames`);
console.log(`  Shape:     ${noTemplate ? 'parametric' : 'real Goku silhouettes'}`);
console.log(`  Budget:    ${maxIter} iters/pose  |  Scale: ${scale}×  |  FPS: ${fps}\n`);

// ── Generate each pose ────────────────────────────────────────────────────────
const results = [];

for (const poseName of targetPoses) {
  if (!POSE_NAMES.includes(poseName)) {
    console.warn(`  SKIP: unknown pose "${poseName}"`);
    continue;
  }

  process.stdout.write(`  ${poseName.padEnd(10)} generating... `);
  const t0 = Date.now();

  const params0 = poseParams(poseName);
  const silhouetteData = noTemplate ? null : loadSilhouette(POSE_FRAME[poseName] ?? 4);
  const { bestGrid, bestParams, bestBandRmsZ, bestIter, log, converged } =
    runIteration(params0, distribution, { maxIter, targetRmsZ: 0.50, silhouetteData });

  const metrics    = computeMetrics(bestGrid, PALETTE);
  const comparison = compareToReference(metrics, distribution);
  const elapsed    = ((Date.now() - t0) / 1000).toFixed(1);

  process.stdout.write(
    `band=${bestBandRmsZ.toFixed(3)}  iter=${bestIter}  ${converged ? '✓' : '~'}  ${elapsed}s\n`
  );

  // Save individual PNG
  const pngPath  = join(OUT, `${poseName}.png`);
  const pngData  = gridToPNG(bestGrid, PALETTE, scale);
  writeFileSync(pngPath, pngData);

  // Save JSON
  const jsonPath = join(OUT, `${poseName}.json`);
  writeFileSync(jsonPath, JSON.stringify({
    id:          poseName,
    source:      'generate_poses',
    converged,
    best_iter:   bestIter,
    band_rms_z:  +bestBandRmsZ.toFixed(4),
    full_rms_z:  comparison.rms_z,
    width:       bestGrid[0].length,
    height:      bestGrid.length,
    thresholds:  bestParams.thresholds,
    data:        bestGrid.map(row => Array.from(row)),
    metrics,
    comparison: {
      rms_z:   comparison.rms_z,
      pass:    comparison.pass,
      flags:   comparison.flags.map(f => ({ key: f.key, severity: f.severity, z: f.z })),
    },
  }, null, 2));

  results.push({ poseName, grid: bestGrid, metrics, comparison, converged, bestBandRmsZ });
}

// ── Summary table ─────────────────────────────────────────────────────────────
console.log('\n  Pose         W×H    Body  ShadowD  Shadow    Mid    Bright    Hi   bRmsZ');
console.log('  ' + '─'.repeat(76));
for (const { poseName, grid, metrics: m, bestBandRmsZ } of results) {
  const W = grid[0].length, H = grid.length;
  const fmt = (v) => (v != null ? (v*100).toFixed(1).padStart(5) + '%' : '   —  ');
  console.log(
    `  ${poseName.padEnd(12)} ${String(W).padStart(2)}×${String(H).padEnd(2)}` +
    `  ${String(m.body_count ?? 0).padStart(4)}` +
    `  ${fmt(m.shadow_deep_ratio)}  ${fmt(m.shadow_ratio)}  ${fmt(m.mid_ratio)}` +
    `  ${fmt(m.bright_ratio)}  ${fmt(m.highlight_ratio)}  ${bestBandRmsZ.toFixed(3)}`
  );
}

// ── ASCII dumps ───────────────────────────────────────────────────────────────
console.log('');
for (const { poseName, grid } of results) {
  console.log(asciiDump(grid, poseName));
}

// ── Sprite sheet assembly ─────────────────────────────────────────────────────
if (!noSheet && results.length > 1) {
  const pngModule = await import('../src/export/png_writer.js');
  assembleSheet(results, scale, fps, OUT, pngModule);
}

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log(`║  ${results.length} poses generated and calibrated to Goku style      ║`);
console.log('╚══════════════════════════════════════════════════════════╝');

// ── Sheet assembly ────────────────────────────────────────────────────────────

function assembleSheet(results, scale, fps, outDir, pngModule) {
  const { makeRGBACanvas, canvasToPNG } = pngModule;

  // Normalize: all frames same height (tallest), left-aligned, padded with transparent
  const maxH = Math.max(...results.map(r => r.grid.length));
  const totalW = results.reduce((s, r) => s + r.grid[0].length, 0);

  // Build combined pixel grid (each frame side by side)
  const sheetGrid = Array.from({ length: maxH }, () => new Uint8Array(totalW).fill(0));
  let colOffset = 0;
  const frameWidths = [];

  for (const { grid } of results) {
    const fW = grid[0].length, fH = grid.length;
    for (let r = 0; r < fH; r++) {
      for (let c = 0; c < fW; c++) {
        sheetGrid[r][colOffset + c] = grid[r][c];
      }
    }
    frameWidths.push(fW);
    colOffset += fW;
  }

  // Render to PNG
  const sheetPng = gridToPNG(sheetGrid, PALETTE, scale);
  const sheetPath = join(outDir, 'pose_sheet.png');
  writeFileSync(sheetPath, sheetPng);

  const msPerFrame = Math.round(1000 / fps);
  const sidecar = {
    id:          'pose_sheet',
    source:      'generate_poses',
    total_width:  totalW * scale,
    frame_height: maxH * scale,
    fps,
    frames: results.map((r, i) => ({
      id:          r.poseName,
      x:           frameWidths.slice(0, i).reduce((s,w)=>s+w,0) * scale,
      width:       frameWidths[i] * scale,
      height:      r.grid.length * scale,
      duration_ms: msPerFrame,
      band_rms_z:  r.bestBandRmsZ,
    })),
  };
  writeFileSync(join(outDir, 'pose_sheet.json'), JSON.stringify(sidecar, null, 2));
  console.log(`\n  Sheet: exports/poses/pose_sheet.png  (${totalW * scale}×${maxH * scale}px)`);
  console.log(`  JSON:  exports/poses/pose_sheet.json`);
}
