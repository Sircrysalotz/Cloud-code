#!/usr/bin/env node
/**
 * generate_poses.js — Phase 9: Multi-pose generation from real Goku frame data.
 *
 * Loads the real ingested Goku frame for each pose (via POSE_FRAME mapping),
 * reconstructs it pixel-perfectly from batch data, optionally style-transfers
 * to a target palette, and assembles a spritesheet.
 *
 * The output is accurate pixel art because it comes from real frame data —
 * not parametric rectangles or gradient approximations.
 *
 * Usage:
 *   node tools/generate_poses.js                          # all 5 poses, original palette
 *   node tools/generate_poses.js --poses=idle,punch       # specific poses
 *   node tools/generate_poses.js --palette=crimson        # style-transfer to crimson
 *   node tools/generate_poses.js --scale=8                # PNG scale (default 8)
 *   node tools/generate_poses.js --fps=8                  # spritesheet FPS
 *   node tools/generate_poses.js --no-sheet               # skip spritesheet assembly
 *   node tools/generate_poses.js --no-cleanup             # skip cleanup passes
 *
 * Outputs:
 *   exports/poses/<pose>.png           — individual pose PNG
 *   exports/poses/<pose>.json          — metrics + frame info
 *   exports/poses/pose_sheet.png       — all poses side-by-side
 *   exports/poses/pose_sheet.json      — spritesheet sidecar with timing
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath }         from 'url';
import { dirname, join }         from 'path';
import { paletteFromRGB }        from '../src/core/palette.js';
import { gridToAscii }           from '../src/core/ascii.js';
import { gridToPNG }             from '../src/export/png_writer.js';
import { computeMetrics }        from '../src/eval/metrics.js';
import { compareToReference }    from '../src/eval/compare.js';
import { loadBatchReference }    from '../src/eval/reference_lib.js';
import { POSE_NAMES, POSE_FRAME } from '../src/authoring/poses.js';
import { runCleanup }            from '../src/cleanup/index.js';
import { transferStyle, BUILTIN_PALETTES } from './style_transfer.js';

const __dir   = dirname(fileURLToPath(import.meta.url));
const OUT     = join(__dir, '..', 'exports', 'poses');
const BATCH   = join(__dir, '..', 'exports', 'batch');
mkdirSync(OUT, { recursive: true });

// ── Args ──────────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const scale       = parseInt(args.find(a => a.startsWith('--scale='))?.slice(8)   ?? '8');
const fps         = parseFloat(args.find(a => a.startsWith('--fps='))?.slice(6)   ?? '8');
const noSheet     = args.includes('--no-sheet');
const noCleanup   = args.includes('--no-cleanup');
const paletteName = args.find(a => a.startsWith('--palette='))?.slice(10) ?? 'original';
const posesArg    = args.find(a => a.startsWith('--poses='))?.slice(8);
const targetPoses = posesArg ? posesArg.split(',') : POSE_NAMES;

// ── Load target palette (style transfer; 'original' keeps source colors) ──────
let tgtPalette = null;
if (paletteName && paletteName !== 'original') {
  const colors = BUILTIN_PALETTES[paletteName];
  if (!colors) {
    console.error(`Unknown palette: ${paletteName}. Options: original, ${Object.keys(BUILTIN_PALETTES).join(', ')}`);
    process.exit(1);
  }
  tgtPalette = paletteFromRGB(colors.map((c, i) => ({ index: i, rgb: [c.r, c.g, c.b] })));
}

// ── Load reference distribution ───────────────────────────────────────────────
const ref = loadBatchReference();
if (!ref) {
  console.error('ERROR: No batch reference.\nRun: python3 tools/batch_ingest.py');
  process.exit(1);
}
const { distribution } = ref;

// ── Load a real batch frame ───────────────────────────────────────────────────
function loadFrame(frameIdx) {
  const id      = String(frameIdx).padStart(4, '0');
  const gPath   = join(BATCH, `frame_${id}_grid.json`);
  const pPath   = join(BATCH, `frame_${id}_palette.json`);
  if (!existsSync(gPath) || !existsSync(pPath)) return null;
  const gridData    = JSON.parse(readFileSync(gPath, 'utf8'));
  const paletteData = JSON.parse(readFileSync(pPath, 'utf8'));
  const palette     = paletteFromRGB(paletteData);
  const grid        = gridData.data.map(row =>
    Array.isArray(row) ? [...row] : Object.values(row).map(Number)
  );
  return { grid, palette, width: gridData.width, height: gridData.height,
           accuracy: gridData.accuracy, frameIdx };
}

// ── Header ────────────────────────────────────────────────────────────────────
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║   PROJECT NOVA — Phase 9: Multi-Pose Generation         ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log(`\n  Poses:    ${targetPoses.join(' | ')}`);
console.log(`  Source:   real Goku batch frames (100% reconstruction accuracy)`);
console.log(`  Palette:  ${paletteName}  (use --palette=crimson for SSJ4 crimson style)`);
console.log(`  Cleanup:  ${noCleanup ? 'off' : 'on'}  |  Scale: ${scale}×  |  FPS: ${fps}\n`);

// ── Generate each pose ────────────────────────────────────────────────────────
const results = [];

for (const poseName of targetPoses) {
  if (!POSE_NAMES.includes(poseName)) {
    console.warn(`  SKIP: unknown pose "${poseName}"`);
    continue;
  }

  const frameIdx = POSE_FRAME[poseName];
  process.stdout.write(`  ${poseName.padEnd(10)} frame_${String(frameIdx).padStart(4,'0')}  `);

  const frame = loadFrame(frameIdx);
  if (!frame) {
    console.warn(`missing — run: python3 tools/batch_ingest.py`);
    continue;
  }

  const t0 = Date.now();
  let { grid, palette } = frame;

  // Run cleanup passes on real frame data
  if (!noCleanup) {
    const cleaned = runCleanup(grid, palette);
    grid = cleaned.grid;
  }

  // Style transfer if requested
  let renderPalette = palette;
  if (tgtPalette) {
    grid          = transferStyle(grid, palette, tgtPalette);
    renderPalette = tgtPalette;
  }

  const metrics    = computeMetrics(grid, renderPalette);
  const comparison = compareToReference(metrics, distribution);
  const elapsed    = ((Date.now() - t0) / 1000).toFixed(2);

  const bodyCount = metrics.body_count ?? 0;
  process.stdout.write(
    `${frame.width}×${frame.height}  body=${bodyCount}  acc=${frame.accuracy?.exact_pct ?? '?'}%  ${elapsed}s\n`
  );

  // Save PNG
  const pngPath = join(OUT, `${poseName}.png`);
  writeFileSync(pngPath, gridToPNG(grid, renderPalette, scale));

  // Save JSON sidecar — embed palette_colors so consumers can reconstruct the palette
  const jsonPath = join(OUT, `${poseName}.json`);
  const paletteColors = renderPalette.colors.map(c => ({ index: c.index, rgb: [c.r, c.g, c.b] }));
  writeFileSync(jsonPath, JSON.stringify({
    id:             poseName,
    source:         'generate_poses',
    frame_idx:      frameIdx,
    palette:        paletteName,
    palette_colors: paletteColors,
    width:          frame.width,
    height:         frame.height,
    accuracy:       frame.accuracy,
    data:           grid.map(row => Array.from(row)),
    metrics,
    comparison: {
      rms_z: comparison.rms_z,
      pass:  comparison.pass,
      flags: comparison.flags.map(f => ({ key: f.key, severity: f.severity, z: f.z })),
    },
  }, null, 2));

  results.push({ poseName, grid, renderPalette, metrics, comparison, frameIdx });
}

// ── Summary table ─────────────────────────────────────────────────────────────
if (results.length > 0) {
  console.log('\n  Pose         Frame   W×H     Body  ShadD   Shad    Mid   Brite   Hi');
  console.log('  ' + '─'.repeat(72));
  const fmt = v => v != null ? (v * 100).toFixed(1).padStart(5) + '%' : '   —  ';
  for (const { poseName, grid, metrics: m, frameIdx } of results) {
    const W = grid[0].length, H = grid.length;
    console.log(
      `  ${poseName.padEnd(12)} ${String(frameIdx).padStart(4,'0')}  ${String(W).padStart(2)}×${String(H).padEnd(3)}` +
      `  ${String(m.body_count ?? 0).padStart(4)}` +
      `  ${fmt(m.shadow_deep_ratio)}  ${fmt(m.shadow_ratio)}  ${fmt(m.mid_ratio)}` +
      `  ${fmt(m.bright_ratio)}  ${fmt(m.highlight_ratio)}`
    );
  }
}

// ── ASCII dumps ───────────────────────────────────────────────────────────────
console.log('');
for (const { poseName, grid, renderPalette } of results) {
  console.log(`[${poseName}]`);
  console.log(gridToAscii(grid, renderPalette));
}

// ── Sprite sheet assembly ─────────────────────────────────────────────────────
if (!noSheet && results.length > 1) {
  assembleSheet(results, scale, fps, OUT);
}

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log(`║  ${results.length} poses generated from real Goku pixel data         ║`);
console.log('╚══════════════════════════════════════════════════════════╝');

// ── Sheet assembly ────────────────────────────────────────────────────────────

function assembleSheet(results, scale, fps, outDir) {
  // All frames share the same render palette (or each has original — use first)
  const sheetPalette = results[0].renderPalette;

  const maxH   = Math.max(...results.map(r => r.grid.length));
  const totalW = results.reduce((s, r) => s + r.grid[0].length, 0);

  const sheetGrid = Array.from({ length: maxH }, () => new Uint8Array(totalW).fill(0));
  let colOffset = 0;
  const frameWidths = [];

  for (const { grid } of results) {
    const fW = grid[0].length, fH = grid.length;
    for (let r = 0; r < fH; r++)
      for (let c = 0; c < fW; c++)
        sheetGrid[r][colOffset + c] = grid[r][c];
    frameWidths.push(fW);
    colOffset += fW;
  }

  const sheetPng  = gridToPNG(sheetGrid, sheetPalette, scale);
  const sheetPath = join(outDir, 'pose_sheet.png');
  writeFileSync(sheetPath, sheetPng);

  const msPerFrame = Math.round(1000 / fps);
  const sidecar = {
    id:           'pose_sheet',
    source:       'generate_poses',
    palette:      paletteName ?? 'original',
    total_width:  totalW * scale,
    frame_height: maxH * scale,
    fps,
    frames: results.map((r, i) => ({
      id:          r.poseName,
      frame_idx:   r.frameIdx,
      x:           frameWidths.slice(0, i).reduce((s, w) => s + w, 0) * scale,
      width:       frameWidths[i] * scale,
      height:      r.grid.length * scale,
      duration_ms: msPerFrame,
    })),
  };
  writeFileSync(join(outDir, 'pose_sheet.json'), JSON.stringify(sidecar, null, 2));
  console.log(`\n  Sheet: exports/poses/pose_sheet.png  (${totalW * scale}×${maxH * scale}px)`);
  console.log(`  JSON:  exports/poses/pose_sheet.json`);
}
