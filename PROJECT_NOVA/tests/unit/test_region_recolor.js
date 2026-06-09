/**
 * Tests for src/authoring/region_recolor.js — Phase 30.
 *
 * Covers: hexToRgb, hueName, classifyRegions, recolorRegions,
 *         regionPixelCounts — plus a real-frame round trip.
 */

import { existsSync, readFileSync } from 'fs';
import { join }            from 'path';
import { check, section }  from '../helpers.js';
import { paletteFromRGB }  from '../../src/core/palette.js';
import { rgbToHsl }        from '../../src/core/palette_mutator.js';
import {
  hexToRgb,
  hueName,
  classifyRegions,
  recolorRegions,
  regionPixelCounts,
} from '../../src/authoring/region_recolor.js';

// ── Synthetic palette: red fur ramp + grays + skin tones ──────────────────────
function syntheticPalette() {
  return paletteFromRGB([
    { index: 0, rgb: [0, 0, 0] },          // transparent
    { index: 1, rgb: [12, 4, 8] },         // outline
    { index: 2, rgb: [60, 0, 4] },         // red dark
    { index: 3, rgb: [140, 8, 12] },       // red mid
    { index: 4, rgb: [230, 30, 20] },      // red bright
    { index: 5, rgb: [40, 40, 40] },       // gray dark (neutral)
    { index: 6, rgb: [200, 200, 205] },    // gray bright (neutral)
    { index: 7, rgb: [245, 180, 140] },    // skin (orange family)
  ]);
}

// ── hexToRgb ──────────────────────────────────────────────────────────────────

section('region_recolor — hexToRgb');

{
  check('6-digit hex', hexToRgb('#3060ff').join(',') === '48,96,255');
  check('3-digit hex expands', hexToRgb('#f00').join(',') === '255,0,0');
  check('no leading # accepted', hexToRgb('00ff00').join(',') === '0,255,0');

  let threw = false;
  try { hexToRgb('#12345'); } catch { threw = true; }
  check('bad hex throws', threw);
}

// ── hueName ───────────────────────────────────────────────────────────────────

section('region_recolor — hueName');

{
  check('0° is red',        hueName(0)   === 'red');
  check('30° is orange',    hueName(30)  === 'orange');
  check('60° is yellow',    hueName(60)  === 'yellow');
  check('120° is green',    hueName(120) === 'green');
  check('180° is cyan',     hueName(180) === 'cyan');
  check('240° is blue',     hueName(240) === 'blue');
  check('290° is purple',   hueName(290) === 'purple');
  check('330° is magenta',  hueName(330) === 'magenta');
  check('355° wraps to red', hueName(355) === 'red');
}

// ── classifyRegions ───────────────────────────────────────────────────────────

section('region_recolor — classifyRegions');

{
  const pal = syntheticPalette();
  const { regions, byIndex } = classifyRegions(pal);

  check('red region found with 3 colors',
    regions.red?.indices.length === 3);
  check('neutral region holds the grays',
    regions.neutral?.indices.length === 2);
  check('skin tone lands in orange family',
    regions.orange?.indices.includes(7));

  check('red indices sorted dark→bright',
    regions.red.indices.join(',') === '2,3,4');

  check('byIndex covers every body index',
    [2, 3, 4, 5, 6, 7].every(i => byIndex.has(i)));
  check('byIndex skips transparent and outline',
    !byIndex.has(0) && !byIndex.has(1));

  // Circular mean: dark reds near 360° and brighter reds near 0-10° must
  // average near the wraparound point, not to the opposite side of the wheel
  const mh = regions.red.meanHue;
  check('red meanHue near wraparound (not cyan)', mh > 330 || mh < 30);
}

// ── recolorRegions ────────────────────────────────────────────────────────────

section('region_recolor — recolorRegions');

{
  const pal = syntheticPalette();
  const { palette: out } = recolorRegions(pal, { red: '#0000ff' });

  // Retargeted colors: hue becomes blue, each keeps its own luminance
  for (const idx of [2, 3, 4]) {
    const before = pal.colors.find(c => c.index === idx);
    const after  = out.colors.find(c => c.index === idx);
    const hb = rgbToHsl(before.r, before.g, before.b);
    const ha = rgbToHsl(after.r,  after.g,  after.b);
    check(`index ${idx}: hue moved to blue family`, ha.h > 200 && ha.h < 280);
    check(`index ${idx}: luminance preserved`, Math.abs(ha.l - hb.l) < 0.02);
  }

  // Untouched regions identical
  for (const idx of [5, 6, 7]) {
    const before = pal.colors.find(c => c.index === idx);
    const after  = out.colors.find(c => c.index === idx);
    check(`index ${idx}: untouched region identical`,
      before.r === after.r && before.g === after.g && before.b === after.b);
  }

  // Outline + transparent never change
  const o = out.colors.find(c => c.index === 1);
  check('outline unchanged', o.r === 12 && o.g === 4 && o.b === 8);
}

{
  // { hue, sat } object form
  const pal = syntheticPalette();
  const { palette: out } = recolorRegions(pal, { neutral: { hue: 120, sat: 0.6 } });
  const after = out.colors.find(c => c.index === 5);
  const ha = rgbToHsl(after.r, after.g, after.b);
  check('object form: neutral gains green hue', ha.h > 90 && ha.h < 150);
  check('object form: saturation applied', ha.s > 0.4);
}

{
  // Unknown region throws with available list
  const pal = syntheticPalette();
  let threw = false, msg = '';
  try { recolorRegions(pal, { teal: '#00ffff' }); }
  catch (e) { threw = true; msg = e.message; }
  check('unknown region throws', threw);
  check('error names available regions', msg.includes('red'));
}

// ── regionPixelCounts ─────────────────────────────────────────────────────────

section('region_recolor — regionPixelCounts');

{
  const pal = syntheticPalette();
  const cls = classifyRegions(pal);
  const grid = [
    [0, 1, 2, 2, 3],
    [0, 5, 6, 7, 4],
  ];
  const counts = regionPixelCounts(grid, cls);
  check('red count = 4 (indices 2,2,3,4)', counts.red === 4);
  check('neutral count = 2', counts.neutral === 2);
  check('orange count = 1', counts.orange === 1);
  check('outline counted separately', counts.outline === 1);
}

// ── Real frame round trip ─────────────────────────────────────────────────────

section('region_recolor — real frame');

{
  const BATCH = new URL('../../exports/batch', import.meta.url).pathname;
  const gPath = join(BATCH, 'frame_0004_grid.json');
  const pPath = join(BATCH, 'frame_0004_palette.json');

  if (!existsSync(gPath) || !existsSync(pPath)) {
    check('batch frame available for region tests', false);
  } else {
    const gd  = JSON.parse(readFileSync(gPath, 'utf8'));
    const pal = paletteFromRGB(JSON.parse(readFileSync(pPath, 'utf8')));
    const grid = gd.data.map(r => Array.isArray(r) ? r : Object.values(r).map(Number));

    const cls = classifyRegions(pal);
    check('real frame: red region exists (SSJ4 fur)',
      (cls.regions.red?.indices.length ?? 0) >= 5);

    const counts = regionPixelCounts(grid, cls);
    check('real frame: red is the dominant region',
      counts.red === Math.max(...Object.entries(counts)
        .filter(([k]) => k !== 'outline').map(([, v]) => v)));

    // Recolor leaves the grid alone by construction; verify palette size + indices stable
    const { palette: out } = recolorRegions(pal, { red: '#3060ff' });
    check('real frame: recolored palette keeps every index',
      pal.colors.every(c => out.colors.some(o => o.index === c.index)));
    check('real frame: recolored palette same size', out.colors.length === pal.colors.length);
  }
}
