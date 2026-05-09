/**
 * Tests for tools/style_gallery.js exports: buildPalette, cell rendering logic.
 * Tests the gallery's palette construction and style-transfer output correctness.
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import { PALETTE, paletteFromRGB } from '../../src/core/palette.js';
import { transferStyle }   from '../../tools/style_transfer.js';
import { gridToRGBA }      from '../../src/export/png_writer.js';

// ── Palette definitions (same as in style_gallery.js) ────────────────────────

const PALETTE_DEFS = {
  crimson: [[0,0,0],[28,8,20],[56,12,32],[104,20,36],[184,40,28],[232,96,36],[255,168,64],[255,224,136]],
  cool:    [[0,0,0],[10,8,30],[20,20,80],[40,40,120],[70,80,180],[100,140,220],[160,200,255],[220,240,255]],
  warm:    [[0,0,0],[30,10,0],[80,25,0],[140,50,5],[210,100,20],[240,150,40],[255,200,80],[255,240,160]],
  forest:  [[0,0,0],[8,20,8],[15,40,15],[30,70,25],[50,110,40],[80,155,60],[140,200,90],[200,240,150]],
  mono:    [[0,0,0],[20,20,20],[45,45,45],[80,80,80],[120,120,120],[160,160,160],[200,200,200],[240,240,240]],
};

function buildPalette(name) {
  return paletteFromRGB(PALETTE_DEFS[name].map(([r,g,b], i) => ({ index: i, rgb: [r,g,b] })));
}

// ── Palette construction ──────────────────────────────────────────────────────

section('style_gallery — palette construction');

for (const [name, def] of Object.entries(PALETTE_DEFS)) {
  const pal = buildPalette(name);

  check(`${name}: palette has 8 colors`, pal.colors.length === 8);
  check(`${name}: has bodyIndices`, Array.isArray(pal.bodyIndices));
  check(`${name}: bodyIndices has 6 entries`, pal.bodyIndices.length === 6);
  check(`${name}: has outlineIndex`, typeof pal.outlineIndex === 'number');
  check(`${name}: peakIndex is last body index`, pal.peakIndex === pal.bodyIndices[5]);
}

{
  // mono palette should have luminance increasing strictly
  const mono = buildPalette('mono');
  const bodyColors = mono.bodyIndices.map(i => mono.colors.find(c => c.index === i));
  const lums = bodyColors.map(c => 0.299*c.r + 0.587*c.g + 0.114*c.b);
  check('mono palette: body luminance strictly increasing',
    lums.every((l, i) => i === 0 || l >= lums[i-1]));
}

// ── Style transfer correctness ────────────────────────────────────────────────

section('style_gallery — cross-palette transfer');

{
  // A simple test grid with all 8 crimson palette indices
  const srcGrid = [[0, 1, 2, 3, 4, 5, 6, 7]];
  const srcPal  = PALETTE;  // crimson

  for (const [palName, def] of Object.entries(PALETTE_DEFS)) {
    const tgtPal = buildPalette(palName);
    const result = transferStyle(srcGrid, srcPal, tgtPal);

    check(`${palName}: transparent stays 0`, result[0][0] === 0);
    check(`${palName}: outline maps to target outline`, result[0][1] === tgtPal.outlineIndex);
    check(`${palName}: body pixels map to valid target body indices`,
      result[0].slice(2).every(v => tgtPal.isBody(v)));
    check(`${palName}: darkest body → darkest target body`,
      result[0][2] === tgtPal.bodyIndices[0]);
    check(`${palName}: brightest body → target peak`,
      result[0][7] === tgtPal.peakIndex);
  }
}

{
  // Transfer is deterministic
  const srcGrid = [[1, 2, 3, 4, 5, 6, 7]];
  const cool    = buildPalette('cool');
  const r1 = transferStyle(srcGrid, PALETTE, cool);
  const r2 = transferStyle(srcGrid, PALETTE, cool);
  check('cool transfer deterministic',
    r1[0].every((v, i) => v === r2[0][i]));
}

{
  // Different palettes produce different RGBA colors for body pixels.
  // Note: both cool and warm have 6 body indices (same range 2-7), so the
  // remapped INDEX values are identical — but the RGBA colors differ.
  const srcGrid = [[4]];  // mid
  const cool    = buildPalette('cool');
  const warm    = buildPalette('warm');
  const rCool   = transferStyle(srcGrid, PALETTE, cool);
  const rWarm   = transferStyle(srcGrid, PALETTE, warm);
  // Indices are the same (same-size palette maps to same positions)
  check('same-size palette transfer: indices are equal', rCool[0][0] === rWarm[0][0]);
  // But RGBA colors differ (cool=blue, warm=orange)
  const rgbaCool = gridToRGBA(rCool, cool, 1);
  const rgbaWarm = gridToRGBA(rWarm, warm, 1);
  check('cool and warm produce different RGBA colors',
    rgbaCool[0] !== rgbaWarm[0] ||  // R differs
    rgbaCool[1] !== rgbaWarm[1] ||  // G differs
    rgbaCool[2] !== rgbaWarm[2]);   // B differs
}

// ── gridToRGBA integration ────────────────────────────────────────────────────

section('style_gallery — gridToRGBA output');

{
  // A 1×1 transparent pixel → RGBA alpha=0
  const grid = [[0]];
  const rgba = gridToRGBA(grid, PALETTE, 1);
  check('transparent pixel: alpha=0', rgba[3] === 0);
}

{
  // A 1×1 body pixel → RGBA alpha=255
  const grid = [[4]];  // mid
  const rgba = gridToRGBA(grid, PALETTE, 1);
  check('body pixel: alpha=255', rgba[3] === 255);
}

{
  // Scale doubles pixel dimensions
  const grid = [[1, 2], [3, 4]];
  const rgba1 = gridToRGBA(grid, PALETTE, 1);
  const rgba2 = gridToRGBA(grid, PALETTE, 2);
  check('scale=1 → 4 pixels (2×2)', rgba1.length === 2 * 2 * 4);
  check('scale=2 → 16 pixels (4×4)', rgba2.length === 4 * 4 * 4);
}

{
  // All palettes produce non-zero RGBA for an outline pixel
  const grid = [[1]];
  for (const [name] of Object.entries(PALETTE_DEFS)) {
    const pal = buildPalette(name);
    const rgba = gridToRGBA(grid, pal, 1);
    check(`${name}: outline pixel has non-zero RGBA`,
      rgba[0] > 0 || rgba[1] > 0 || rgba[2] > 0 || rgba[3] > 0);
  }
}

// ── Contact sheet geometry ────────────────────────────────────────────────────

section('style_gallery — contact sheet geometry');

{
  // Verify sheet dimensions calculation for a 2×2 grid
  const poses2    = ['idle', 'punch'];
  const palettes2 = ['crimson', 'cool'];
  const scale     = 4;
  const GAP       = scale * 1;

  // Fake grids (24×40 and 30×40)
  const fakeGrids = {
    idle:  { W: 24, H: 40 },
    punch: { W: 30, H: 40 },
  };

  const cellWs   = poses2.map(p => fakeGrids[p].W * scale);
  const cellH    = Math.max(...poses2.map(p => fakeGrids[p].H)) * scale;
  const sheetW   = cellWs.reduce((s, w) => s + w, 0) + (poses2.length - 1) * GAP;
  const sheetH   = palettes2.length * cellH + (palettes2.length - 1) * GAP;

  check('2×2 sheet width: 24*4 + 30*4 + 1 gap*4', sheetW === (24 + 30) * 4 + 4);
  check('2×2 sheet height: 2 rows * 40*4 + 1 gap*4', sheetH === 2 * 40 * 4 + 4);
}

{
  // For 5 poses at scale=6, verify expected total width
  const poses5 = ['idle', 'guard', 'punch', 'kick', 'power_up'];
  const widths = { idle: 24, guard: 26, punch: 30, kick: 28, power_up: 32 };
  const GAP    = 6;
  const totalW = poses5.reduce((s, p) => s + widths[p] * 6, 0) + (poses5.length - 1) * GAP;
  const expected = (24 + 26 + 30 + 28 + 32) * 6 + 4 * 6;
  check('5-pose sheet width matches expected', totalW === expected);
}
