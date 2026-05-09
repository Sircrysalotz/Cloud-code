#!/usr/bin/env node
/**
 * style_gallery.js — Phase 10: Cross-palette style gallery.
 *
 * Renders all 5 generated warrior poses in all 5 built-in palettes.
 * Assembles a contact sheet: rows = palettes, cols = poses.
 *
 * If pose exports don't exist, generates them on-the-fly.
 *
 * Usage:
 *   node tools/style_gallery.js              # 5 poses × 5 palettes
 *   node tools/style_gallery.js --scale=4    # smaller cells (default 6)
 *   node tools/style_gallery.js --poses=idle,punch
 *   node tools/style_gallery.js --palettes=crimson,cool
 *
 * Output:
 *   exports/gallery/<palette>_<pose>.png     — individual cell PNGs
 *   exports/gallery/contact_sheet.png        — full grid contact sheet
 *   exports/gallery/gallery.json             — metadata sidecar
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname }       from 'path';
import { fileURLToPath }       from 'url';
import { PALETTE, paletteFromRGB } from '../src/core/palette.js';
import { gridToRGBA, gridToPNG }   from '../src/export/png_writer.js';
import { encodePNG }           from '../src/export/png_encoder.js';
import { transferStyle }       from './style_transfer.js';
import { POSE_NAMES, poseParams }  from '../src/authoring/poses.js';
import { runIteration }        from './goku_iterate.js';
import { loadBatchReference }  from '../src/eval/reference_lib.js';

const __dir       = dirname(fileURLToPath(import.meta.url));
const POSES_DIR   = join(__dir, '..', 'exports', 'poses');
const GALLERY_DIR = join(__dir, '..', 'exports', 'gallery');
mkdirSync(GALLERY_DIR, { recursive: true });

// ── Palette definitions ───────────────────────────────────────────────────────
// [transparent, outline, shadow_deep, shadow, mid, bright, highlight, peak]

const PALETTE_DEFS = {
  crimson: [
    [0,0,0],[28,8,20],[56,12,32],[104,20,36],[184,40,28],[232,96,36],[255,168,64],[255,224,136],
  ],
  cool: [
    [0,0,0],[10,8,30],[20,20,80],[40,40,120],[70,80,180],[100,140,220],[160,200,255],[220,240,255],
  ],
  warm: [
    [0,0,0],[30,10,0],[80,25,0],[140,50,5],[210,100,20],[240,150,40],[255,200,80],[255,240,160],
  ],
  forest: [
    [0,0,0],[8,20,8],[15,40,15],[30,70,25],[50,110,40],[80,155,60],[140,200,90],[200,240,150],
  ],
  mono: [
    [0,0,0],[20,20,20],[45,45,45],[80,80,80],[120,120,120],[160,160,160],[200,200,200],[240,240,240],
  ],
};

const PALETTE_NAMES = Object.keys(PALETTE_DEFS);

function buildPalette(name) {
  return paletteFromRGB(PALETTE_DEFS[name].map(([r,g,b], i) => ({ index: i, rgb: [r,g,b] })));
}

// ── Args ──────────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const scale       = parseInt(args.find(a => a.startsWith('--scale='))?.slice(8)    ?? '6');
const posesArg    = args.find(a => a.startsWith('--poses='))?.slice(8);
const palettesArg = args.find(a => a.startsWith('--palettes='))?.slice(11);
const targetPoses    = posesArg    ? posesArg.split(',').filter(p => POSE_NAMES.includes(p))    : POSE_NAMES;
const targetPalettes = palettesArg ? palettesArg.split(',').filter(p => PALETTE_NAMES.includes(p)) : PALETTE_NAMES;

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║   PROJECT NOVA — Phase 10: Cross-Palette Style Gallery  ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log(`\n  Poses:    ${targetPoses.join(' | ')}`);
console.log(`  Palettes: ${targetPalettes.join(' | ')}`);
console.log(`  Grid:     ${targetPalettes.length} rows × ${targetPoses.length} cols = ${targetPalettes.length * targetPoses.length} cells  |  Scale: ${scale}×\n`);

// ── Load or generate pose grids ───────────────────────────────────────────────

async function loadPoseGrid(poseName) {
  const jsonPath = join(POSES_DIR, `${poseName}.json`);
  if (existsSync(jsonPath)) {
    const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
    return raw.data.map(row => new Uint8Array(row));
  }
  process.stdout.write(`(generating ${poseName}...) `);
  const ref = loadBatchReference();
  if (!ref) throw new Error('No batch reference. Run: python3 tools/batch_ingest.py');
  const { bestGrid } = runIteration(poseParams(poseName), ref.distribution, { maxIter: 30 });
  return bestGrid;
}

console.log('  Loading pose grids...');
const poseGrids = {};
for (const poseName of targetPoses) {
  process.stdout.write(`    ${poseName.padEnd(12)}`);
  poseGrids[poseName] = await loadPoseGrid(poseName);
  console.log(`✓  ${poseGrids[poseName][0].length}×${poseGrids[poseName].length}`);
}

// ── Canvas metrics ────────────────────────────────────────────────────────────

const GAP_PX  = scale * 1;   // 1 grid-cell gap between poses/palettes
const cellWs  = targetPoses.map(p => poseGrids[p][0].length * scale);
const cellH   = Math.max(...targetPoses.map(p => poseGrids[p].length)) * scale;
const sheetW  = cellWs.reduce((s, w) => s + w, 0) + (targetPoses.length - 1) * GAP_PX;
const rowH    = cellH + GAP_PX;
const sheetH  = targetPalettes.length * cellH + (targetPalettes.length - 1) * GAP_PX;

// ── Build contact sheet RGBA ─────────────────────────────────────────────────

const sheetRGBA = new Uint8Array(sheetW * sheetH * 4).fill(30);  // dark background
// Fill alpha=255 on background (non-transparent gaps show as dark gray)
for (let i = 3; i < sheetRGBA.length; i += 4) sheetRGBA[i] = 255;

console.log('\n  Rendering contact sheet...');

let rowOffset = 0;
for (const palName of targetPalettes) {
  const tgtPalette = buildPalette(palName);
  let colOffset = 0;

  for (let pi = 0; pi < targetPoses.length; pi++) {
    const poseName = targetPoses[pi];
    const srcGrid  = poseGrids[poseName];
    const remapped = transferStyle(srcGrid, PALETTE, tgtPalette);
    const cellW_sc = srcGrid[0].length * scale;
    const cellH_sc = srcGrid.length  * scale;

    // Save individual cell PNG
    const cellPng  = gridToPNG(remapped, tgtPalette, scale);
    writeFileSync(join(GALLERY_DIR, `${palName}_${poseName}.png`), cellPng);

    // Blit cell RGBA into sheet
    const cellRGBA = gridToRGBA(remapped, tgtPalette, scale);
    for (let y = 0; y < cellH_sc; y++) {
      for (let x = 0; x < cellW_sc; x++) {
        const si = (y * cellW_sc + x) * 4;
        const dx = colOffset + x;
        const dy = rowOffset + y;
        const di = (dy * sheetW + dx) * 4;
        sheetRGBA[di]   = cellRGBA[si];
        sheetRGBA[di+1] = cellRGBA[si+1];
        sheetRGBA[di+2] = cellRGBA[si+2];
        sheetRGBA[di+3] = cellRGBA[si+3];
      }
    }

    colOffset += cellWs[pi] + GAP_PX;
  }

  process.stdout.write(`    ${palName.padEnd(10)} ✓\n`);
  rowOffset += cellH + GAP_PX;
}

// Encode and save contact sheet
const sheetPng = encodePNG(sheetRGBA, sheetW, sheetH);
writeFileSync(join(GALLERY_DIR, 'contact_sheet.png'), sheetPng);
console.log(`\n  contact_sheet.png  (${sheetW}×${sheetH}px)`);

// ── Metadata ─────────────────────────────────────────────────────────────────

const meta = {
  source:     'style_gallery',
  scale,
  sheet_width:  sheetW,
  sheet_height: sheetH,
  poses:      targetPoses,
  palettes:   targetPalettes,
  cell_count: targetPalettes.length * targetPoses.length,
  cells: targetPoses.flatMap(pose =>
    targetPalettes.map(palette => ({
      pose, palette,
      file:   `${palette}_${pose}.png`,
      width:  poseGrids[pose][0].length * scale,
      height: poseGrids[pose].length    * scale,
    }))
  ),
};
writeFileSync(join(GALLERY_DIR, 'gallery.json'), JSON.stringify(meta, null, 2));
console.log(`  gallery.json`);

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log(`║  Gallery complete: ${meta.cell_count} cells  (${sheetW}×${sheetH}px sheet)       ║`);
console.log('╚══════════════════════════════════════════════════════════╝');
