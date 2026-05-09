#!/usr/bin/env node
/**
 * style_transfer.js — Remap a Goku frame into any color palette.
 *
 * Takes a source grid (from exports/batch/) and remaps each pixel's
 * luminance band position to the corresponding position in a target palette.
 * Transparent = transparent, outline = outline, body bands matched by rank.
 *
 * Usage:
 *   node tools/style_transfer.js frame_0004 crimson
 *   node tools/style_transfer.js frame_0004 cool
 *   node tools/style_transfer.js frame_0004 warm
 *   node tools/style_transfer.js frame_0004 --target r,g,b:r,g,b:...  (hex or RGB triplets)
 *   node tools/style_transfer.js --all crimson   (all frames)
 *
 * Built-in palettes:
 *   crimson  — the default 8-color crimson warrior
 *   cool     — purple-blue cel shading
 *   warm     — orange-gold desert shading
 *   forest   — green earthy shading
 *   mono     — grayscale
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname }   from 'path';
import { fileURLToPath }   from 'url';

const __isMain = process.argv[1] === fileURLToPath(import.meta.url);
import { paletteFromRGB, makePalette } from '../src/core/palette.js';
import { gridToAscii }     from '../src/core/ascii.js';
import { gridToPNG }       from '../src/export/png_writer.js';
import { runCleanup }      from '../src/cleanup/index.js';

const __dir  = dirname(fileURLToPath(import.meta.url));
const BATCH  = join(__dir, '..', 'exports', 'batch');
const OUT    = join(__dir, '..', 'exports', 'style_transfer');
mkdirSync(OUT, { recursive: true });

// ── Built-in target palettes ──────────────────────────────────────────────────
// Each palette: [transparent, outline, shadow_deep, shadow, mid, bright, highlight, peak]
// stored as {r,g,b} — index 0=transparent (a=0), index 1=outline, 2-7=body (dark→bright)

export const BUILTIN_PALETTES = {
  crimson: [
    { r:0,   g:0,   b:0   },  // 0: transparent
    { r:28,  g:8,   b:20  },  // 1: outline  #1c0814
    { r:56,  g:12,  b:32  },  // 2: shadow_deep #380c20
    { r:104, g:20,  b:36  },  // 3: shadow #681424
    { r:184, g:40,  b:28  },  // 4: mid #b8281c
    { r:232, g:96,  b:36  },  // 5: bright #e86024
    { r:255, g:168, b:64  },  // 6: highlight #ffa840
    { r:255, g:224, b:136 },  // 7: peak #ffe088
  ],
  cool: [
    { r:0,   g:0,   b:0   },
    { r:10,  g:8,   b:30  },  // outline
    { r:20,  g:20,  b:80  },  // shadow_deep — deep blue-purple
    { r:40,  g:40,  b:120 },  // shadow
    { r:70,  g:80,  b:180 },  // mid
    { r:100, g:140, b:220 },  // bright
    { r:160, g:200, b:255 },  // highlight
    { r:220, g:240, b:255 },  // peak
  ],
  warm: [
    { r:0,   g:0,   b:0   },
    { r:30,  g:10,  b:0   },
    { r:80,  g:25,  b:0   },  // shadow_deep
    { r:140, g:50,  b:5   },  // shadow
    { r:210, g:100, b:20  },  // mid
    { r:240, g:150, b:40  },  // bright
    { r:255, g:200, b:80  },  // highlight
    { r:255, g:240, b:160 },  // peak
  ],
  forest: [
    { r:0,   g:0,   b:0   },
    { r:8,   g:20,  b:8   },
    { r:15,  g:40,  b:15  },  // shadow_deep
    { r:30,  g:70,  b:25  },  // shadow
    { r:50,  g:110, b:40  },  // mid
    { r:80,  g:155, b:60  },  // bright
    { r:130, g:200, b:90  },  // highlight
    { r:200, g:240, b:160 },  // peak
  ],
  mono: [
    { r:0,   g:0,   b:0   },
    { r:20,  g:20,  b:20  },
    { r:45,  g:45,  b:45  },
    { r:80,  g:80,  b:80  },
    { r:120, g:120, b:120 },
    { r:160, g:160, b:160 },
    { r:200, g:200, b:200 },
    { r:235, g:235, b:235 },
  ],
};

// ── Build a palette from built-in color list ──────────────────────────────────

function builtinPalette(name) {
  const colors = BUILTIN_PALETTES[name];
  if (!colors) throw new Error(`Unknown palette: ${name}. Options: ${Object.keys(BUILTIN_PALETTES).join(', ')}`);
  return paletteFromRGB(colors.map((c, i) => ({ index: i, rgb: [c.r, c.g, c.b] })));
}

// ── Style transfer core ───────────────────────────────────────────────────────
//
// Algorithm: for each pixel, find its luminance band rank (0..N-1) in the
// source palette's bodyIndices, then map to the same fractional rank in the
// target palette's bodyIndices.  Transparent/outline are identity-mapped.

export function transferStyle(grid, srcPalette, tgtPalette) {
  const srcBody = srcPalette.bodyIndices;  // sorted dark→bright
  const tgtBody = tgtPalette.bodyIndices;
  const tgtN    = tgtBody.length;

  // Build remapping: srcIndex → tgtIndex
  const remap = new Map();
  remap.set(0, 0);  // transparent → transparent
  remap.set(srcPalette.outlineIndex, tgtPalette.outlineIndex);  // outline → outline

  for (let i = 0; i < srcBody.length; i++) {
    const t        = srcBody.length === 1 ? 0 : i / (srcBody.length - 1);
    const tgtPos   = Math.min(Math.round(t * (tgtN - 1)), tgtN - 1);
    remap.set(srcBody[i], tgtBody[tgtPos]);
  }

  return grid.map(row => row.map(v => remap.has(v) ? remap.get(v) : v));
}

// ── Load a batch frame ────────────────────────────────────────────────────────

function loadFrame(name) {
  const gridData    = JSON.parse(readFileSync(join(BATCH, `${name}_grid.json`),    'utf8'));
  const paletteData = JSON.parse(readFileSync(join(BATCH, `${name}_palette.json`), 'utf8'));
  const palette     = paletteFromRGB(paletteData);
  const grid        = gridData.data.map(row => Array.isArray(row) ? [...row] : Object.values(row).map(Number));
  return { name, grid, palette, gridData };
}

// ── Process one frame ─────────────────────────────────────────────────────────

function processFrame(frameName, tgtPaletteName, tgtPalette, scale = 8) {
  const { grid: rawGrid, palette: srcPalette, gridData } = loadFrame(frameName);

  // Run cleanup on source first (using source palette)
  const { grid: cleanSrc } = runCleanup(rawGrid, srcPalette);

  // Transfer to target palette
  const transferred = transferStyle(cleanSrc, srcPalette, tgtPalette);

  // Render
  const pngBytes = gridToPNG(transferred, tgtPalette, scale);
  const outName  = `${frameName}_${tgtPaletteName}.png`;
  const outPath  = join(OUT, outName);
  writeFileSync(outPath, pngBytes);

  console.log(`${frameName}  ${gridData.width}×${gridData.height}  → ${outName}  (${tgtPalette.colors.length} target colors)`);
  console.log(gridToAscii(transferred, tgtPalette));

  return outPath;
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (__isMain) {
const args         = process.argv.slice(2);
const allFrames    = args.includes('--all');
const scale        = (() => { const i = args.indexOf('--scale'); return i >= 0 ? parseInt(args[i+1]) : 8; })();
const positional   = args.filter(a => !a.startsWith('--'));
const frameName    = positional[0] ?? 'frame_0004';
const paletteName  = positional[1] ?? 'crimson';

let tgtPalette;
try {
  tgtPalette = builtinPalette(paletteName);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

if (allFrames) {
  const { readdirSync } = await import('fs');
  const names = readdirSync(BATCH)
    .filter(f => f.endsWith('_palette.json'))
    .map(f => f.replace('_palette.json', ''))
    .filter(name => {
      try {
        const p = JSON.parse(readFileSync(join(BATCH, `${name}_palette.json`), 'utf8'));
        return p.length <= 40;
      } catch { return false; }
    })
    .sort();
  console.log(`Processing ${names.length} frames → ${paletteName} palette`);
  for (const name of names) {
    try { processFrame(name, paletteName, tgtPalette, scale); }
    catch (e) { console.error(`  SKIP ${name}: ${e.message}`); }
  }
} else {
  processFrame(frameName, paletteName, tgtPalette, scale);
}
} // end __isMain
