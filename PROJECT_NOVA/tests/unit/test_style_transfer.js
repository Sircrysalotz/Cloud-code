/**
 * Tests for tools/style_transfer.js (transferStyle function)
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import { PALETTE, paletteFromRGB } from '../../src/core/palette.js';
import { transferStyle } from '../../tools/style_transfer.js';

// ── Build test palettes ───────────────────────────────────────────────────────

// 8-color source palette (same structure as crimson)
function makeSrcPalette() {
  const colors = [
    [0,0,0], [20,8,16], [40,10,24], [80,18,30],
    [150,35,25], [210,90,30], [255,160,60], [255,220,130],
  ];
  return paletteFromRGB(colors.map(([r,g,b], i) => ({ index: i, rgb: [r,g,b] })));
}

// 8-color target palette (cool blues)
function makeTgtPalette() {
  const colors = [
    [0,0,0], [10,8,30], [20,20,80], [40,40,120],
    [70,80,180], [100,140,220], [160,200,255], [220,240,255],
  ];
  return paletteFromRGB(colors.map(([r,g,b], i) => ({ index: i, rgb: [r,g,b] })));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

section('style_transfer — transferStyle');

{
  const src = makeSrcPalette();
  const tgt = makeTgtPalette();

  // Simple 3×3 grid: transparent, outline, mid-body, peak-body
  //  [0, 0, 0]
  //  [1, 4, 7]  (outline, mid, peak)
  //  [2, 3, 5]  (shadow_deep, shadow, bright)
  const grid = [
    [0, 0, 0],
    [1, 4, 7],
    [2, 3, 5],
  ];

  const result = transferStyle(grid, src, tgt);

  check('transparent stays 0',
    result[0][0] === 0);

  check('outline maps to target outline index',
    result[1][0] === tgt.outlineIndex);

  check('result has same dimensions',
    result.length === 3 && result[0].length === 3);

  check('body indices are valid target body indices',
    result[1][1] !== undefined && tgt.isBody(result[1][1]));

  check('peak (highest src band) maps to highest tgt band',
    result[1][2] === tgt.peakIndex);

  check('shadow_deep (lowest src band) maps to lowest tgt band',
    result[2][0] === tgt.bodyIndices[0]);

  check('transfer is deterministic',
    result[1][1] === transferStyle(grid, src, tgt)[1][1]);

  check('source grid is not mutated',
    grid[1][1] === 4 && grid[1][2] === 7);

  // Verify ordering preserved: shadow_deep < shadow < mid < bright < highlight < peak
  const sdIdx = result[2][0]; // shadow_deep
  const shIdx = result[2][1]; // shadow
  const miIdx = result[1][1]; // mid
  const brIdx = result[2][2]; // bright
  const pkIdx = result[1][2]; // peak

  const tBody = tgt.bodyIndices;
  check('luminance order preserved: shadow_deep < shadow',
    tBody.indexOf(sdIdx) < tBody.indexOf(shIdx));
  check('luminance order preserved: shadow < mid',
    tBody.indexOf(shIdx) < tBody.indexOf(miIdx));
  check('luminance order preserved: mid < bright',
    tBody.indexOf(miIdx) < tBody.indexOf(brIdx));
  check('luminance order preserved: bright < peak',
    tBody.indexOf(brIdx) < tBody.indexOf(pkIdx));
}

// ── Different palette sizes ───────────────────────────────────────────────────

section('style_transfer — cross-size palettes');

{
  // Source: 20-color palette (like a Goku frame)
  const gokuColors = Array.from({ length: 21 }, (_, i) => ({
    index: i,
    rgb: i === 0 ? [0,0,0] : [Math.round(i*11), Math.round(i*7), Math.round(i*3)],
  }));
  const gokuPalette = paletteFromRGB(gokuColors);

  // Target: 8-color palette
  const tgt8 = makeTgtPalette();

  const grid = gokuPalette.bodyIndices.map((idx, i) => [idx]);  // one column per body color

  const result = transferStyle(grid, gokuPalette, tgt8);

  check('all result indices are valid target palette indices',
    result.every(row => row.every(v => v === 0 || tgt8.colors.some(c => c.index === v))));

  check('result maps to body indices in target',
    result.every(row => row.every(v => tgt8.isBody(v))));

  // First and last body row should map to darkest and brightest target body
  check('darkest source body → darkest target body',
    result[0][0] === tgt8.bodyIndices[0]);
  check('brightest source body → brightest target body',
    result[result.length - 1][0] === tgt8.peakIndex);
}

{
  // Reverse: 8-color source → 20-color target
  const src8  = makeSrcPalette();
  const tgt20Colors = Array.from({ length: 21 }, (_, i) => ({
    index: i,
    rgb: i === 0 ? [0,0,0] : [Math.round(i*11), Math.round(i*7), Math.round(i*3)],
  }));
  const tgt20 = paletteFromRGB(tgt20Colors);

  const grid = [[1, 2, 3, 4, 5, 6, 7]];  // outline + all 6 body

  const result = transferStyle(grid, src8, tgt20);

  check('8→20: outline maps correctly',
    result[0][0] === tgt20.outlineIndex);

  check('8→20: darkest body maps to darkest tgt body',
    result[0][1] === tgt20.bodyIndices[0]);

  check('8→20: peak maps to tgt peak',
    result[0][6] === tgt20.peakIndex);

  check('8→20: result indices are valid',
    result[0].every(v => v === 0 || tgt20.colors.some(c => c.index === v)));
}

// ── Edge cases ────────────────────────────────────────────────────────────────

section('style_transfer — edge cases');

{
  const src = makeSrcPalette();
  const tgt = makeTgtPalette();

  check('empty grid returns empty grid',
    transferStyle([], src, tgt).length === 0);

  check('all-transparent grid stays transparent',
    transferStyle([[0,0],[0,0]], src, tgt).every(r => r.every(v => v === 0)));

  check('all-outline grid maps to target outline',
    transferStyle([[1,1],[1,1]], src, tgt).every(r => r.every(v => v === tgt.outlineIndex)));
}

// ── Identity palette ──────────────────────────────────────────────────────────

section('style_transfer — identity transfer');

{
  const pal = makeSrcPalette();
  const grid = [[0,1,2,3,4,5,6,7]];
  const result = transferStyle(grid, pal, pal);

  check('transferring to same palette is identity',
    result[0].every((v, i) => v === grid[0][i]));
}
