#!/usr/bin/env node
/**
 * generate_variants.js — Phase 15: Sprite variation engine CLI.
 *
 * Generates all pose × palette combinations for a character and exports
 * a complete variant library with PNGs, JSON sidecars, and a quality report.
 *
 * Usage:
 *   node tools/generate_variants.js                          # all poses × 5 built-in palettes
 *   node tools/generate_variants.js --poses=idle,punch       # subset of poses
 *   node tools/generate_variants.js --palettes=crimson,cool  # subset of palettes
 *   node tools/generate_variants.js --scale=4                # output scale (default 6)
 *   node tools/generate_variants.js --max=30                 # iteration budget
 *
 * Output:
 *   exports/variants/<pose>_<palette>.png   — individual variant PNGs
 *   exports/variants/variants.json          — full variant library metadata
 *   exports/variants/summary.txt            — human-readable summary
 */

import { writeFileSync, mkdirSync }   from 'fs';
import { join, dirname }              from 'path';
import { fileURLToPath }              from 'url';
import { PALETTE, paletteFromRGB }    from '../src/core/palette.js';
import { paletteFromHex }             from '../src/core/palette_designer.js';
import { loadBatchReference }         from '../src/eval/reference_lib.js';
import { POSE_NAMES }                 from '../src/authoring/poses.js';
import { buildVariantLibrary }        from '../src/authoring/variant_engine.js';
import { gridToPNG }                  from '../src/export/png_writer.js';
import { gridToAscii }                from '../src/core/ascii.js';

const __dir    = dirname(fileURLToPath(import.meta.url));
const OUT_DIR  = join(__dir, '..', 'exports', 'variants');

// ── Built-in palettes ─────────────────────────────────────────────────────────

const PALETTE_DEFS = {
  crimson: ['#000000','#1c0814','#380c20','#681424','#b8281c','#e86024','#ffa840','#ffe088'],
  cool:    ['#000000','#0a081e','#141450','#282878','#4650b4','#648cdc','#a0c8ff','#dcf0ff'],
  warm:    ['#000000','#1e0a00','#501900','#8c3205','#d26414','#f09628','#ffc850','#fff0a0'],
  forest:  ['#000000','#081408','#0f280f','#1e4619','#326e28','#509b3c','#8cc85a','#c8f096'],
  mono:    ['#000000','#141414','#2d2d2d','#505050','#787878','#a0a0a0','#c8c8c8','#f0f0f0'],
};

function loadPalettes(keys) {
  return keys.map(key => ({
    key,
    palette: paletteFromHex(PALETTE_DEFS[key]),
  }));
}

// ── Args ──────────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const scale       = parseInt(args.find(a => a.startsWith('--scale='))?.slice(8)    ?? '6');
const maxIter     = parseInt(args.find(a => a.startsWith('--max='))?.slice(6)      ?? '25');
const posesArg    = args.find(a => a.startsWith('--poses='))?.slice(8);
const palettesArg = args.find(a => a.startsWith('--palettes='))?.slice(11);

const targetPoses    = posesArg    ? posesArg.split(',').filter(p => POSE_NAMES.includes(p)) : POSE_NAMES;
const targetPalettes = palettesArg ? palettesArg.split(',').filter(p => PALETTE_DEFS[p]) : Object.keys(PALETTE_DEFS);

const __isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (__isMain) {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  PROJECT NOVA — Phase 15: Sprite Variation Engine       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\n  Poses:    ${targetPoses.join(' | ')}`);
  console.log(`  Palettes: ${targetPalettes.join(' | ')}`);
  console.log(`  Total:    ${targetPoses.length * targetPalettes.length} variants  |  Scale: ${scale}×  |  Max iter: ${maxIter}\n`);

  const ref = loadBatchReference();
  if (!ref) { console.error('No batch reference. Run: python3 tools/batch_ingest.py'); process.exit(1); }

  const palettes = loadPalettes(targetPalettes);

  let lastPose = null;
  const library = buildVariantLibrary({
    poses: targetPoses,
    palettes,
    distribution: ref.distribution,
    opts: {
      maxIter,
      targetRmsZ: 0.70,
      onProgress({ done, total, msg }) {
        const pose = msg.split(' ')[msg.startsWith('generated') ? 1 : 0];
        if (pose !== lastPose) { lastPose = pose; process.stdout.write(`\n  ${pose.padEnd(12)}`); }
        process.stdout.write('.');
      },
    },
  });

  console.log('\n');

  // ── Export variant PNGs ──────────────────────────────────────────────────

  console.log('  Exporting variant PNGs...');
  for (const cell of library.cells) {
    const pngBytes = gridToPNG(cell.grid, cell.palette, scale);
    const fname    = `${cell.pose}_${cell.paletteKey}.png`;
    writeFileSync(join(OUT_DIR, fname), pngBytes);
  }
  console.log(`  ✓  ${library.cells.length} PNGs`);

  // ── Export library JSON ──────────────────────────────────────────────────

  const libraryJson = {
    generated_at:  new Date().toISOString(),
    poses:         library.poses,
    palettes:      library.palettes.map(p => p.key),
    scale,
    total_cells:   library.summary.totalCells,
    mean_band_rmsZ: library.summary.meanBandRmsZ,
    pass_rate:     library.summary.passRate,
    best:          library.summary.bestCell,
    worst:         library.summary.worstCell,
    cells: library.cells.map(c => ({
      pose:       c.pose,
      palette:    c.paletteKey,
      file:       `${c.pose}_${c.paletteKey}.png`,
      band_rmsZ:  +c.bandRmsZ.toFixed(4),
      full_rmsZ:  +c.fullRmsZ.toFixed(4),
      pass:       c.pass,
      width:      c.grid[0]?.length ?? 0,
      height:     c.grid.length,
    })),
  };
  writeFileSync(join(OUT_DIR, 'variants.json'), JSON.stringify(libraryJson, null, 2));

  // ── Summary text ─────────────────────────────────────────────────────────

  const { summary } = library;
  const lines = [
    'PROJECT NOVA — Variant Library Summary',
    '═'.repeat(50),
    `Generated: ${libraryJson.generated_at}`,
    `Poses (${library.poses.length}):    ${library.poses.join(', ')}`,
    `Palettes (${library.palettes.length}): ${library.palettes.map(p => p.key).join(', ')}`,
    `Total cells: ${summary.totalCells}`,
    `Mean band rmsZ: ${summary.meanBandRmsZ}`,
    `Pass rate: ${(summary.passRate * 100).toFixed(1)}%  (${summary.passCount}/${summary.totalCells})`,
    `Best:  ${summary.bestCell.pose} × ${summary.bestCell.paletteKey}  (rmsZ=${summary.bestCell.bandRmsZ?.toFixed(3)})`,
    `Worst: ${summary.worstCell.pose} × ${summary.worstCell.paletteKey}  (rmsZ=${summary.worstCell.bandRmsZ?.toFixed(3)})`,
    '',
    'Per-pose band rmsZ:',
    ...library.poses.map(pose => {
      const cells = library.cells.filter(c => c.pose === pose);
      const mean  = cells.reduce((s, c) => s + c.bandRmsZ, 0) / cells.length;
      return `  ${pose.padEnd(12)} ${mean.toFixed(3)}  [${cells.map(c => c.bandRmsZ.toFixed(2)).join(', ')}]`;
    }),
  ];
  const summaryText = lines.join('\n');
  writeFileSync(join(OUT_DIR, 'summary.txt'), summaryText);

  console.log('\n' + '─'.repeat(50));
  console.log(summaryText);
  console.log('─'.repeat(50));
  console.log(`\n  Output: ${OUT_DIR}`);
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  Complete: ${summary.totalCells} variants  (${(summary.passRate * 100).toFixed(1)}% pass rate)                      ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
}
