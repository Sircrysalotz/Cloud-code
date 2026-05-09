#!/usr/bin/env node
/**
 * ai_draw.js — Phase 29: AI-native authoring workflow.
 *
 * The complete loop: scaffold → ASCII edit → cleanup → eval → export.
 * Designed for use BY the AI: every output is text-readable data.
 *
 * Modes:
 *   node tools/ai_draw.js --from frame_0004           # dump reference frame as ASCII
 *   node tools/ai_draw.js --scaffold --style goku     # generate scaffold from style profile
 *   node tools/ai_draw.js --ascii-file sprite.txt     # load ASCII → grid
 *   node tools/ai_draw.js --ascii-file sprite.txt --cleanup               # + run cleanup
 *   node tools/ai_draw.js --ascii-file sprite.txt --eval --style goku    # + score
 *   node tools/ai_draw.js --ascii-file sprite.txt --export [--out f.png] # + export PNG
 *   node tools/ai_draw.js --legend                    # print ASCII char legend
 *
 * Options:
 *   --from <name>          Reference frame to dump (e.g. frame_0004)
 *   --scaffold             Generate scaffold from style profile
 *   --style <name>         Style profile to use (from exports/style_profiles/<name>.json)
 *   --ascii-file <file>    Load ASCII art from a text file
 *   --ascii-string <str>   Load ASCII art from a quoted string (newlines as \n)
 *   --cleanup              Run all 9 cleanup passes on the grid
 *   --eval                 Score the grid against a style profile (requires --style)
 *   --export               Export the grid as PNG
 *   --out <file>           Output PNG path (default: exports/ai_draw/<source>.png)
 *   --scale <n>            PNG scale factor (default: 6)
 *   --save-grid <file>     Save the grid as JSON
 *   --legend               Print the ASCII character mapping and exit
 *   --verbose              Extra detail on spatial bias, cleanup changes
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PALETTE, paletteFromRGB }        from '../src/core/palette.js';
import { gridToAscii, asciiToGrid }       from '../src/core/ascii.js';
import { gridSize }                        from '../src/core/grid.js';
import { runCleanup }                      from '../src/cleanup/index.js';
import { computeMetrics }                  from '../src/eval/metrics.js';
import { gridToPNG }                       from '../src/export/png_writer.js';
import {
  scaffoldFromProfile,
  scoreAgainstProfile,
  styleProfileFromJSON,
} from '../src/eval/style_profile.js';

const __dir     = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dir, '..');
const BATCH     = join(ROOT, 'exports', 'batch');
const PROFILES  = join(ROOT, 'exports', 'style_profiles');
const DRAWOUT   = join(ROOT, 'exports', 'ai_draw');

// ── Args ──────────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const flag    = k => args.includes(k);
const opt     = (k, def) => { const i = args.indexOf(k); return i !== -1 ? args[i + 1] : def; };

const fromFrame   = opt('--from', null);
const doScaffold  = flag('--scaffold');
const styleName   = opt('--style', null);
const asciiFile   = opt('--ascii-file', null);
const asciiString = opt('--ascii-string', null);
const doCleanup   = flag('--cleanup');
const doEval      = flag('--eval');
const doExport    = flag('--export');
const outFile     = opt('--out', null);
const scale       = parseInt(opt('--scale', '6'), 10);
const saveGrid    = opt('--save-grid', null);
const doLegend    = flag('--legend');
const verbose     = flag('--verbose');

// ── Legend ────────────────────────────────────────────────────────────────────

if (doLegend) {
  console.log('\n  ASCII Character Legend (default palette)\n');
  console.log('  ┌─────┬──────────────┬───────────┐');
  console.log('  │ Chr │ Name         │ Index     │');
  console.log('  ├─────┼──────────────┼───────────┤');
  for (const c of PALETTE.colors) {
    console.log(`  │  ${c.ascii}  │ ${c.name.padEnd(12)} │ ${String(c.index).padEnd(9)} │`);
  }
  console.log('  └─────┴──────────────┴───────────┘');
  console.log('\n  Drawing tips:');
  console.log('   . = transparent (background)');
  console.log('   # = outline (always wraps the body)');
  console.log('   X x o O * @ = body bands (dark → bright)');
  console.log('   Mirror: left half only, then use mirrorLeftToRight()');
  console.log('   Shadow: darker bands go at bottom, brighter at top');
  console.log('');
  process.exit(0);
}

// ── Validate args ─────────────────────────────────────────────────────────────

const modes = [fromFrame, doScaffold, asciiFile, asciiString].filter(Boolean);
if (modes.length === 0) {
  console.error(
    'Error: specify a mode: --from <frame> | --scaffold | --ascii-file <file> | --ascii-string <str>'
  );
  console.error('       Run with --legend to see the ASCII character map.');
  process.exit(1);
}

// ── Load helpers ──────────────────────────────────────────────────────────────

function loadStyleProfile(name) {
  const path = join(PROFILES, `${name}.json`);
  if (!existsSync(path)) {
    console.error(`Style profile not found: ${path}`);
    console.error(`  Run: node tools/extract_style.js --source ${name}`);
    process.exit(1);
  }
  return styleProfileFromJSON(readFileSync(path, 'utf8'));
}

function loadReferenceFrame(name) {
  const gridPath    = join(BATCH, `${name}_grid.json`);
  const palettePath = join(BATCH, `${name}_palette.json`);
  if (!existsSync(gridPath)) {
    console.error(`Frame not found: ${gridPath}`);
    console.error(`  Run: python3 tools/batch_ingest.py`);
    process.exit(1);
  }
  const gridData    = JSON.parse(readFileSync(gridPath,    'utf8'));
  const paletteData = JSON.parse(readFileSync(palettePath, 'utf8'));
  const palette     = paletteFromRGB(paletteData);
  const grid        = gridData.data.map(row =>
    Array.isArray(row) ? new Uint8Array(row) : new Uint8Array(Object.values(row).map(Number))
  );
  return { grid, palette };
}

// ── Mode: --from <frame> ──────────────────────────────────────────────────────

if (fromFrame) {
  const { grid, palette } = loadReferenceFrame(fromFrame);
  const [w, h] = gridSize(grid);
  const ascii  = gridToAscii(grid, palette);

  console.log(`\n  Frame: ${fromFrame}  (${w}×${h})`);
  console.log('  ┌' + '─'.repeat(w) + '┐');
  for (const line of ascii.split('\n')) console.log('  │' + line + '│');
  console.log('  └' + '─'.repeat(w) + '┘');

  if (verbose) {
    const m = computeMetrics(grid, palette);
    console.log('\n  Band ratios:');
    for (const b of ['shadow_deep','shadow','mid','bright','highlight','peak']) {
      const v = m[`${b}_ratio`] ?? 0;
      const bar = '█'.repeat(Math.round(v * 20)).padEnd(20);
      console.log(`    ${b.padEnd(12)} ${bar} ${(v*100).toFixed(1)}%`);
    }
  }

  console.log('\n  Copy the ASCII block above into a .txt file,');
  console.log('  edit it, then run:');
  console.log(`    node tools/ai_draw.js --ascii-file your_edit.txt --cleanup --eval --style <name> --export`);
  console.log('');
  process.exit(0);
}

// ── Mode: --scaffold ──────────────────────────────────────────────────────────

let workingGrid   = null;
let workingPalette = PALETTE;
let sourceLabel   = 'ai_draw';

if (doScaffold) {
  if (!styleName) {
    console.error('Error: --scaffold requires --style <name>');
    process.exit(1);
  }
  const profile = loadStyleProfile(styleName);
  workingGrid   = scaffoldFromProfile(profile, PALETTE);
  workingPalette = PALETTE;
  sourceLabel    = `scaffold_${styleName}`;

  const [w, h] = gridSize(workingGrid);
  const ascii  = gridToAscii(workingGrid, PALETTE);
  console.log(`\n  Scaffold from style: ${styleName}  (${w}×${h})`);
  console.log('  ┌' + '─'.repeat(w) + '┐');
  for (const line of ascii.split('\n')) console.log('  │' + line + '│');
  console.log('  └' + '─'.repeat(w) + '┘');
  console.log('\n  This is your starting point. Copy, edit, then:');
  console.log(`    node tools/ai_draw.js --ascii-file your_edit.txt --cleanup --eval --style ${styleName} --export`);
  console.log('');

  if (!doCleanup && !doEval && !doExport && !saveGrid) process.exit(0);
}

// ── Mode: --ascii-file / --ascii-string ───────────────────────────────────────

if (asciiFile) {
  if (!existsSync(asciiFile)) {
    console.error(`File not found: ${asciiFile}`);
    process.exit(1);
  }
  const raw  = readFileSync(asciiFile, 'utf8');
  workingGrid = asciiToGrid(raw.replace(/^\n+|\n+$/g, ''), PALETTE);
  workingPalette = PALETTE;
  sourceLabel = asciiFile.replace(/.*\//, '').replace(/\.[^.]+$/, '');
}

if (asciiString) {
  const raw   = asciiString.replace(/\\n/g, '\n');
  workingGrid = asciiToGrid(raw.replace(/^\n+|\n+$/g, ''), PALETTE);
  workingPalette = PALETTE;
  sourceLabel = 'ascii_string';
}

if (!workingGrid) {
  console.error('Internal error: no grid produced.');
  process.exit(1);
}

// ── Print initial ASCII ───────────────────────────────────────────────────────

if (asciiFile || asciiString) {
  const [w, h] = gridSize(workingGrid);
  const ascii  = gridToAscii(workingGrid, workingPalette);
  console.log(`\n  Loaded: ${sourceLabel}  (${w}×${h})`);
  console.log('  ┌' + '─'.repeat(w) + '┐');
  for (const line of ascii.split('\n')) console.log('  │' + line + '│');
  console.log('  └' + '─'.repeat(w) + '┘');
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

if (doCleanup) {
  const before  = gridToAscii(workingGrid, workingPalette);
  const cleaned = runCleanup(workingGrid, workingPalette);
  workingGrid   = cleaned.grid;
  const after   = gridToAscii(workingGrid, workingPalette);
  const changed = before !== after;

  console.log(`\n  Cleanup: ${changed ? 'changes applied' : 'no changes needed'}`);
  if (changed) {
    const [w, h] = gridSize(workingGrid);
    console.log('  ┌' + '─'.repeat(w) + '┐');
    for (const line of after.split('\n')) console.log('  │' + line + '│');
    console.log('  └' + '─'.repeat(w) + '┘');
  }
}

// ── Eval ──────────────────────────────────────────────────────────────────────

if (doEval) {
  if (!styleName) {
    console.error('Error: --eval requires --style <name>');
    process.exit(1);
  }
  const profile = loadStyleProfile(styleName);
  const result  = scoreAgainstProfile(workingGrid, profile, workingPalette);
  const grade   = result.score >= 0.9 ? 'S' : result.score >= 0.75 ? 'A' : result.score >= 0.55 ? 'B' : result.score >= 0.35 ? 'C' : 'D';

  console.log(`\n  Style score vs ${styleName}: ${(result.score * 100).toFixed(1)}%  (grade ${grade})  rmsZ=${result.rmsZ.toFixed(3)}`);
  console.log('');
  console.log('  Band deviations:');
  for (const d of result.deviations) {
    const dir  = d.z > 0 ? 'high' : 'low';
    const flag = Math.abs(d.z) > 1.5 ? '  ← !' : '';
    console.log(`    ${d.band.padEnd(12)} ${(d.value*100).toFixed(1)}%  (ref ${(d.mean*100).toFixed(1)}% ± ${(d.sigma*100).toFixed(1)}%)  z=${d.z.toFixed(2)}${flag}`);
  }

  if (verbose) {
    const m = computeMetrics(workingGrid, workingPalette);
    console.log('\n  Structural metrics:');
    console.log(`    symmetry:   ${(m.symmetry_score * 100).toFixed(1)}%`);
    console.log(`    outline_cv: ${m.outline_cv !== undefined ? m.outline_cv.toFixed(3) : 'n/a'}`);
    console.log(`    unique_col: ${m.unique_colors}`);
  }
}

// ── Save grid ─────────────────────────────────────────────────────────────────

if (saveGrid) {
  const rows = workingGrid.map(row => Array.from(row));
  writeFileSync(saveGrid, JSON.stringify({ data: rows }, null, 2));
  console.log(`\n  Grid saved: ${saveGrid}`);
}

// ── Export PNG ────────────────────────────────────────────────────────────────

if (doExport) {
  mkdirSync(DRAWOUT, { recursive: true });
  const outPath = outFile ?? join(DRAWOUT, `${sourceLabel}.png`);
  const png     = gridToPNG(workingGrid, workingPalette, scale);
  writeFileSync(outPath, png);
  const [w, h] = gridSize(workingGrid);
  console.log(`\n  Exported: ${outPath}  (${w * scale}×${h * scale}px)`);
}

console.log('');
