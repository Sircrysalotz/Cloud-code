/**
 * Tests for src/eval/metrics.js — palette-agnostic behavior.
 * Verifies band ratios, counts, and symmetry work for any palette size.
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import { paletteFromRGB, PALETTE } from '../../src/core/palette.js';
import {
  countByIndex, bodyCount, outlineCount, bandRatios,
  symmetryScore, uniqueBodyColors, bodyDensity, computeMetrics,
} from '../../src/eval/metrics.js';

// ── Build test palettes ───────────────────────────────────────────────────────

function make8Palette() {
  const colors = [
    [0,0,0],[20,8,16],[40,10,24],[80,18,30],
    [150,35,25],[210,90,30],[255,160,60],[255,220,130],
  ];
  return paletteFromRGB(colors.map(([r,g,b],i) => ({ index: i, rgb: [r,g,b] })));
}

function make20Palette() {
  const colors = Array.from({ length: 21 }, (_, i) => ({
    index: i,
    rgb: i === 0 ? [0,0,0] : [i*11, i*7, i*3],
  }));
  return paletteFromRGB(colors);
}

// ── Tiny test grid helpers ────────────────────────────────────────────────────

// 3×3: outline ring, mid body center
function makeRingGrid(mid = 4) {
  return [
    [1, 1, 1],
    [1, mid, 1],
    [1, 1, 1],
  ];
}

// 4×4: left half shadow, right half highlight
function makeSplitGrid(sd = 2, pk = 7) {
  return [
    [sd, sd, pk, pk],
    [sd, sd, pk, pk],
    [sd, sd, pk, pk],
    [sd, sd, pk, pk],
  ];
}

// ── countByIndex ──────────────────────────────────────────────────────────────

section('metrics_dynamic — countByIndex');

{
  const pal  = make8Palette();
  const grid = makeRingGrid(4);
  const c    = countByIndex(grid, pal);

  check('outline count correct', c[1] === 8);
  check('mid count correct',     c[4] === 1);
  check('transparent count correct', c[0] === 0);
  check('all other indices zero',
    Object.entries(c).filter(([k,v]) => ![0,1,4].includes(+k)).every(([,v]) => v === 0));
}

{
  const pal  = make20Palette();
  const grid = [[0, 1, 2, 10, 19, 20]];
  const c    = countByIndex(grid, pal);
  check('20-pal: transparent counted', c[0] === 1);
  check('20-pal: outline counted',     c[1] === 1);
  check('20-pal: body-2 counted',      c[2] === 1);
  check('20-pal: body-10 counted',     c[10] === 1);
}

// ── bodyCount ─────────────────────────────────────────────────────────────────

section('metrics_dynamic — bodyCount');

{
  const pal  = make8Palette();
  const grid = makeRingGrid(4);
  const c    = countByIndex(grid, pal);
  check('body count = 1 (center pixel)', bodyCount(c, pal) === 1);
}

{
  const pal  = make8Palette();
  const grid = makeSplitGrid(2, 7);
  const c    = countByIndex(grid, pal);
  check('body count = 16 (all pixels are body)', bodyCount(c, pal) === 16);
}

{
  const pal  = make20Palette();
  const grid = [[1, 2, 10, 15, 20]];
  const c    = countByIndex(grid, pal);
  check('20-pal body count excludes outline', bodyCount(c, pal) === 4);
}

// ── bandRatios ────────────────────────────────────────────────────────────────

section('metrics_dynamic — bandRatios');

{
  const pal = make8Palette();
  // All pixels in lowest band (index 2 = shadow_deep)
  const grid = [[2, 2, 2, 2]];
  const c    = countByIndex(grid, pal);
  const r    = bandRatios(c, pal);

  check('shadow_deep_ratio = 1 when all shadow_deep', Math.abs(r.shadow_deep_ratio - 1) < 0.001);
  check('all other ratios = 0', ['shadow','mid','bright','highlight','peak'].every(n => r[`${n}_ratio`] === 0));
  check('ratios sum to 1', Math.abs(Object.values(r).reduce((a,b)=>a+b,0) - 1) < 0.001);
}

{
  const pal = make8Palette();
  // One pixel in each of the 6 body slots (indices 2-7)
  const grid = [[2, 3, 4, 5, 6, 7]];
  const c    = countByIndex(grid, pal);
  const r    = bandRatios(c, pal);

  check('each band has equal ratio when one pixel per slot',
    Object.values(r).every(v => Math.abs(v - 1/6) < 0.001));
  check('sum = 1', Math.abs(Object.values(r).reduce((a,b)=>a+b,0) - 1) < 0.001);
}

{
  const pal = make20Palette();
  // One pixel per body index (19 body slots)
  const grid = [pal.bodyIndices.slice()];
  const c    = countByIndex(grid, pal);
  const r    = bandRatios(c, pal);

  check('20-pal: 6 named ratios returned', Object.keys(r).length === 6);
  check('20-pal: all ratios are numbers', Object.values(r).every(v => typeof v === 'number'));
  check('20-pal: sum ≈ 1', Math.abs(Object.values(r).reduce((a,b)=>a+b,0) - 1) < 0.001);
  check('20-pal: shadow_deep_ratio > 0', r.shadow_deep_ratio > 0);
  check('20-pal: peak_ratio > 0',        r.peak_ratio > 0);
}

{
  const pal = make8Palette();
  // Empty body
  const grid = [[0, 0, 1, 1]];
  const c    = countByIndex(grid, pal);
  const r    = bandRatios(c, pal);
  check('empty body returns all zeros', Object.values(r).every(v => v === 0));
}

// ── symmetryScore ─────────────────────────────────────────────────────────────

section('metrics_dynamic — symmetryScore');

{
  const pal = make8Palette();

  // Perfect mirror
  const sym = [[2, 3, 4, 4, 3, 2], [2, 3, 4, 4, 3, 2]];
  check('perfect symmetric grid scores 1', symmetryScore(sym, pal) === 1);

  // Fully asymmetric
  const asym = [[2, 3, 4, 5, 6, 7], [7, 6, 5, 4, 3, 2]];
  check('fully asymmetric grid scores 0', symmetryScore(asym, pal) === 0);
}

{
  const pal = make20Palette();
  const sym = [[2, 5, 10, 10, 5, 2]];
  check('20-pal symmetric → score 1', symmetryScore(sym, pal) === 1);
}

// ── computeMetrics full bundle ────────────────────────────────────────────────

section('metrics_dynamic — computeMetrics');

{
  const pal  = make8Palette();
  const grid = makeRingGrid(4);
  const m    = computeMetrics(grid, pal);

  check('has width',  m.width === 3);
  check('has height', m.height === 3);
  check('has body_count', typeof m.body_count === 'number');
  check('has outline_count', typeof m.outline_count === 'number');
  check('has shadow_deep_ratio', typeof m.shadow_deep_ratio === 'number');
  check('has peak_ratio', typeof m.peak_ratio === 'number');
  check('has symmetry_score', typeof m.symmetry_score === 'number');
  check('has body_density', typeof m.body_density === 'number');
  check('has highlight_centroid', typeof m.highlight_centroid === 'object');

  // body_count = 1 (center), outline_count = 8
  check('body_count correct', m.body_count === 1);
  check('outline_count correct', m.outline_count === 8);
}

{
  const pal  = make20Palette();
  // One pixel per body index
  const grid = [pal.bodyIndices.slice()];
  const m    = computeMetrics(grid, pal);

  check('20-pal: 6 band ratios present',
    ['shadow_deep_ratio','shadow_ratio','mid_ratio','bright_ratio','highlight_ratio','peak_ratio'].every(k => typeof m[k] === 'number'));

  check('20-pal: unique_body_colors = 19', m.unique_body_colors === 19);
  check('20-pal: band ratio sum ≈ 1',
    Math.abs(['shadow_deep_ratio','shadow_ratio','mid_ratio','bright_ratio','highlight_ratio','peak_ratio']
      .reduce((s,k) => s + m[k], 0) - 1) < 0.001);
}

{
  // Default PALETTE (8-color crimson) — backward compatibility
  const grid = [[0,1,2,3,4,5,6,7]];
  const m    = computeMetrics(grid);  // no palette arg — uses default
  check('default palette: no error', typeof m.body_count === 'number');
  check('default palette: 6 body pixels', m.body_count === 6);
}
