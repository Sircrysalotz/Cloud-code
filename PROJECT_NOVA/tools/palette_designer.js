#!/usr/bin/env node
/**
 * palette_designer.js — Phase 14: Custom palette creation and preview.
 *
 * Build any palette from hex colors or two anchor colors, validate it,
 * and preview it applied to a generated warrior sprite.
 *
 * Usage:
 *   # From a list of hex colors (auto-sorts by luminance)
 *   node tools/palette_designer.js --hex "#000,#1c0814,#380c20,#681424,#b8281c,#e86024,#ffa840,#ffe088"
 *
 *   # Interpolate from dark→light anchors
 *   node tools/palette_designer.js --anchors "#0d0020,#ffe8ff"         # 8-color purple
 *   node tools/palette_designer.js --anchors "#0d0020,#ffe8ff" --n=6   # 6-color
 *
 *   # Show info about a built-in palette
 *   node tools/palette_designer.js --preset crimson
 *   node tools/palette_designer.js --preset cool
 *
 *   # Options
 *   node tools/palette_designer.js --hex "..." --ascii    # ASCII sprite preview
 *   node tools/palette_designer.js --hex "..." --png      # Save PNG preview
 *   node tools/palette_designer.js --hex "..." --name=sunset  # Named output
 *
 * Output: prints palette info + optional ASCII/PNG preview
 *         saves exports/palettes/<name>.json
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  paletteFromHex,
  paletteFromAnchors,
  validatePalette,
  paletteInfo,
  luminance,
  toHex,
} from '../src/core/palette_designer.js';
import { PALETTE }            from '../src/core/palette.js';
import { gridToAscii }        from '../src/core/ascii.js';
import { transferStyle }      from './style_transfer.js';
import { loadOrGeneratePose } from './generate_animation.js';
import { loadBatchReference } from '../src/eval/reference_lib.js';
import { gridToPNG }          from '../src/export/png_writer.js';

const __dir    = dirname(fileURLToPath(import.meta.url));
const PAL_DIR  = join(__dir, '..', 'exports', 'palettes');

const BUILTIN = {
  crimson: ['#000000','#1c0814','#380c20','#681424','#b8281c','#e86024','#ffa840','#ffe088'],
  cool:    ['#000000','#0a081e','#141450','#282878','#4650b4','#648cdc','#a0c8ff','#dcf0ff'],
  warm:    ['#000000','#1e0a00','#501900','#8c3205','#d26414','#f09628','#ffc850','#fff0a0'],
  forest:  ['#000000','#081408','#0f280f','#1e4619','#326e28','#509b3c','#8cc85a','#c8f096'],
  mono:    ['#000000','#141414','#2d2d2d','#505050','#787878','#a0a0a0','#c8c8c8','#f0f0f0'],
};

// ── Parse args ────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const hexArg   = args.find(a => a.startsWith('--hex='))?.slice(6);
const anchors  = args.find(a => a.startsWith('--anchors='))?.slice(10);
const preset   = args.find(a => a.startsWith('--preset='))?.slice(9);
const nameArg  = args.find(a => a.startsWith('--name='))?.slice(7);
const nArg     = parseInt(args.find(a => a.startsWith('--n='))?.slice(4) ?? '8');
const doAscii  = args.includes('--ascii');
const doPng    = args.includes('--png');

const __isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (__isMain) {
  mkdirSync(PAL_DIR, { recursive: true });

  // ── Build the palette ────────────────────────────────────────────────────

  let palette;
  let palName = nameArg ?? 'custom';

  if (preset) {
    if (!BUILTIN[preset]) {
      console.error(`Unknown preset: ${preset}. Options: ${Object.keys(BUILTIN).join(', ')}`);
      process.exit(1);
    }
    palette = paletteFromHex(BUILTIN[preset]);
    palName = nameArg ?? preset;
    console.log(`\n  Preset: ${preset}`);
  } else if (anchors) {
    const parts = anchors.split(',').map(s => s.trim());
    if (parts.length !== 2) {
      console.error('--anchors expects exactly 2 colors: "--anchors=#dark,#light"');
      process.exit(1);
    }
    palette = paletteFromAnchors(parts[0], parts[1], nArg);
    console.log(`\n  Anchors: ${parts[0]} → ${parts[1]}  (${nArg} colors)`);
  } else if (hexArg) {
    const hexColors = hexArg.split(',').map(s => s.trim()).filter(Boolean);
    if (hexColors.length < 2) {
      console.error('--hex expects at least 2 colors');
      process.exit(1);
    }
    palette = paletteFromHex(hexColors);
    console.log(`\n  Hex input: ${hexColors.length} colors`);
  } else {
    console.log(`
Usage:
  node tools/palette_designer.js --hex "#000,#1c0814,...,#ffe088"
  node tools/palette_designer.js --anchors "#0d0020,#ffe8ff" [--n=8]
  node tools/palette_designer.js --preset crimson|cool|warm|forest|mono
  Options: --ascii  --png  --name=<name>
`);
    process.exit(0);
  }

  // ── Print info ───────────────────────────────────────────────────────────

  const info = paletteInfo(palette);
  const { valid, errors, warnings } = info.validation;

  console.log('\n' + '─'.repeat(58));
  console.log(`  ${palName.toUpperCase()} PALETTE  (${info.total_colors} colors)`);
  console.log('─'.repeat(58));
  console.log(`\n  Outline: ${info.outline_hex}  (lum ${info.outline_luminance})`);
  console.log(`  Peak:    ${palette.colors.find(c => c.index === palette.peakIndex)?.hex ?? '?'}  (lum ${info.peak_luminance})`);
  console.log(`  Spread:  ${info.luminance_spread}  (contrast range)`);
  console.log(`\n  Body colors (dark → light):`);
  for (const c of info.body) {
    const bar = '█'.repeat(Math.round(c.luminance / 10));
    console.log(`    [${c.index}] ${c.hex}  lum=${String(c.luminance).padStart(5)}  ${bar}`);
  }

  if (errors.length > 0) {
    console.log(`\n  ERRORS (${errors.length}):`);
    for (const e of errors) console.log(`    ✗ ${e}`);
  }
  if (warnings.length > 0) {
    console.log(`\n  Warnings (${warnings.length}):`);
    for (const w of warnings) console.log(`    ~ ${w}`);
  }
  console.log(`\n  Validation: ${valid ? '✓ VALID — pipeline-compatible' : '✗ INVALID — fix errors above'}`);

  // ── ASCII preview ────────────────────────────────────────────────────────

  if (doAscii || doPng) {
    const ref = loadBatchReference();
    if (!ref) {
      console.log('\n  (ASCII/PNG preview requires batch reference — run batch_ingest.py first)');
    } else {
      process.stdout.write('\n  Loading idle pose for preview...');
      const idleGrid  = loadOrGeneratePose('idle', ref.distribution, { maxIter: 15 });
      const remapped  = transferStyle(idleGrid, PALETTE, palette);
      console.log(' done');

      if (doAscii) {
        console.log('\n' + '─'.repeat(58));
        console.log(`  ASCII PREVIEW — idle pose in ${palName}`);
        console.log('─'.repeat(58) + '\n');
        const lines = gridToAscii(remapped, palette).split('\n');
        for (const line of lines) console.log('  ' + line);
      }

      if (doPng) {
        const pngBytes = gridToPNG(remapped, palette, 8);
        const pngPath  = join(PAL_DIR, `${palName}_preview.png`);
        writeFileSync(pngPath, pngBytes);
        console.log(`\n  Preview PNG: ${pngPath}`);
      }
    }
  }

  // ── Save palette JSON ────────────────────────────────────────────────────

  const palData = {
    name:   palName,
    colors: palette.colors
      .filter(c => c.index > 0)
      .map(c => [c.r, c.g, c.b]),
    info,
  };
  const jsonPath = join(PAL_DIR, `${palName}.json`);
  writeFileSync(jsonPath, JSON.stringify(palData, null, 2));
  console.log(`\n  Saved: ${jsonPath}`);
  console.log();
}
