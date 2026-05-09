/**
 * Tests for src/eval/diff.js
 *
 * Covers: rowToRegion, diffGrids, heatmapToAscii, diffSequence, changeMask.
 */

import { check, section } from '../helpers.js';
import { PALETTE }        from '../../src/core/palette.js';
import {
  rowToRegion,
  diffGrids,
  heatmapToAscii,
  diffSequence,
  changeMask,
} from '../../src/eval/diff.js';

// ── rowToRegion ───────────────────────────────────────────────────────────────

section('diff — rowToRegion');

{
  check('row 0 of 9 → top',    rowToRegion(0, 9) === 'top');
  check('row 2 of 9 → top',    rowToRegion(2, 9) === 'top');
  check('row 3 of 9 → mid',    rowToRegion(3, 9) === 'mid');
  check('row 5 of 9 → mid',    rowToRegion(5, 9) === 'mid');
  check('row 6 of 9 → bottom', rowToRegion(6, 9) === 'bottom');
  check('row 8 of 9 → bottom', rowToRegion(8, 9) === 'bottom');
  check('row 0 of 1 → top',    rowToRegion(0, 1) === 'top');
}

// ── diffGrids ─────────────────────────────────────────────────────────────────

section('diff — diffGrids (identical)');

{
  const grid = [[1,4,4,1],[1,3,2,1],[1,1,1,1]];
  const r = diffGrids(grid, PALETTE, grid, PALETTE);

  check('identical: changedPixels=0',   r.changedPixels === 0);
  check('identical: changeFraction=0',  r.changeFraction === 0);
  check('identical: direction=none',    r.direction === 'none');
  check('identical: overlapWidth=4',    r.overlapWidth === 4);
  check('identical: overlapHeight=3',   r.overlapHeight === 3);
  check('identical: totalPixels > 0',   r.totalPixels > 0);
  check('identical: brighterCount=0',   r.brighterCount === 0);
  check('identical: darkerCount=0',     r.darkerCount === 0);
}

section('diff — diffGrids (all changed)');

{
  // gridA: all shadow_deep (idx 2), gridB: all peak (idx 7) — every pixel brighter
  const gridA = [[2,2,2],[2,2,2],[2,2,2]];
  const gridB = [[7,7,7],[7,7,7],[7,7,7]];
  const r = diffGrids(gridA, PALETTE, gridB, PALETTE);

  check('all changed: changedPixels=9',     r.changedPixels === 9);
  check('all changed: changeFraction=1',    r.changeFraction === 1);
  check('all changed: direction=brighter',  r.direction === 'brighter');
  check('all changed: brighterCount=9',     r.brighterCount === 9);
  check('all changed: darkerCount=0',       r.darkerCount === 0);
}

{
  // gridA: all peak, gridB: all shadow — every pixel darker
  const gridA = [[7,7],[7,7]];
  const gridB = [[2,2],[2,2]];
  const r = diffGrids(gridA, PALETTE, gridB, PALETTE);

  check('darker: direction=darker',       r.direction === 'darker');
  check('darker: darkerCount=4',          r.darkerCount === 4);
  check('darker: brighterCount=0',        r.brighterCount === 0);
}

section('diff — diffGrids (transparent handling)');

{
  // Transparent-to-transparent → not counted
  const gridA = [[0,0],[0,0]];
  const gridB = [[0,0],[0,0]];
  const r = diffGrids(gridA, PALETTE, gridB, PALETTE);

  check('all transparent: totalPixels=0',  r.totalPixels === 0);
  check('all transparent: changedPixels=0',r.changedPixels === 0);
}

{
  // One transparent, one opaque → counted as change
  const gridA = [[0]];
  const gridB = [[4]];
  const r = diffGrids(gridA, PALETTE, gridB, PALETTE);

  check('trans→opaque: totalPixels=1',   r.totalPixels === 1);
  check('trans→opaque: changedPixels=1', r.changedPixels === 1);
}

{
  // Opaque→transparent also counted
  const gridA = [[4]];
  const gridB = [[0]];
  const r = diffGrids(gridA, PALETTE, gridB, PALETTE);

  check('opaque→trans: changedPixels=1', r.changedPixels === 1);
}

section('diff — diffGrids (overlap)');

{
  // A is 4×4, B is 2×2 → overlap is 2×2
  const gridA = [[1,2,1,1],[1,3,2,1],[1,2,3,1],[1,1,1,1]];
  const gridB = [[1,4],[1,5]];
  const r = diffGrids(gridA, PALETTE, gridB, PALETTE);

  check('overlap width=2',  r.overlapWidth  === 2);
  check('overlap height=2', r.overlapHeight === 2);
}

section('diff — diffGrids (region density)');

{
  // 9-row grid: top=rows 0-2, mid=rows 3-5, bottom=rows 6-8
  // Only bottom row changed
  const base = [[2,2,2]];
  const gridA = Array.from({ length: 9 }, () => [2, 2, 2]);
  const gridB = gridA.map((row, i) => i >= 6 ? [7, 7, 7] : [...row]);

  const r = diffGrids(gridA, PALETTE, gridB, PALETTE);

  check('bottom region has changes',    r.regionChanged.bottom > 0);
  check('top region has no changes',    r.regionChanged.top === 0);
  check('mid region has no changes',    r.regionChanged.mid === 0);
  check('bottom density > 0',          r.regionDensity.bottom > 0);
  check('top density = 0',             r.regionDensity.top === 0);
}

section('diff — diffGrids (result shape)');

{
  const grid = [[1,2,1]];
  const r = diffGrids(grid, PALETTE, grid, PALETTE);

  check('has overlapWidth',    typeof r.overlapWidth   === 'number');
  check('has overlapHeight',   typeof r.overlapHeight  === 'number');
  check('has totalPixels',     typeof r.totalPixels    === 'number');
  check('has changedPixels',   typeof r.changedPixels  === 'number');
  check('has changeFraction',  typeof r.changeFraction === 'number');
  check('has brighterCount',   typeof r.brighterCount  === 'number');
  check('has darkerCount',     typeof r.darkerCount    === 'number');
  check('has direction',       typeof r.direction      === 'string');
  check('has regionCounts',    typeof r.regionCounts   === 'object');
  check('has regionChanged',   typeof r.regionChanged  === 'object');
  check('has regionDensity',   typeof r.regionDensity  === 'object');
  check('has heatmap',         Array.isArray(r.heatmap));
  check('heatmap rows = overlapHeight', r.heatmap.length === r.overlapHeight);
  check('heatmap cols = overlapWidth',  r.heatmap[0].length === r.overlapWidth);
}

{
  // changeFraction ∈ [0,1]
  const gridA = [[2,3,4],[5,6,7],[1,2,3]];
  const gridB = [[7,6,5],[4,3,2],[1,2,3]];
  const r = diffGrids(gridA, PALETTE, gridB, PALETTE);
  check('changeFraction ∈ [0,1]', r.changeFraction >= 0 && r.changeFraction <= 1);
}

{
  // regionDensity values ∈ [0,1]
  const gridA = [[2,3],[4,5],[6,7],[2,3],[4,5],[6,7]];
  const gridB = [[7,6],[5,4],[3,2],[7,6],[5,4],[3,2]];
  const r = diffGrids(gridA, PALETTE, gridB, PALETTE);
  const densities = Object.values(r.regionDensity);
  check('all regionDensity ∈ [0,1]', densities.every(d => d >= 0 && d <= 1));
}

// ── heatmapToAscii ────────────────────────────────────────────────────────────

section('diff — heatmapToAscii');

{
  const heatmap = [
    [0,  1, -1],
    [null, 0, 1],
  ];
  const ascii = heatmapToAscii(heatmap);
  check('returns string',          typeof ascii === 'string');
  check('correct rows',            ascii.split('\n').length === 2);
  check('row 0 length=3',          ascii.split('\n')[0].length === 3);
  check('0 → dot',                 ascii[0] === '.');
  check('1 → plus',                ascii[1] === '+');
  check('-1 → minus',              ascii[2] === '-');
  check('null → dot',              ascii.split('\n')[1][0] === '.');
}

{
  // All same → all dots
  const heatmap = [[0,0,0],[0,0,0]];
  const ascii = heatmapToAscii(heatmap);
  check('all same → all dots', ascii.replace(/\n/g,'').split('').every(c => c === '.'));
}

{
  // Roundtrip: diff identical grids → all dots
  const grid  = [[1,4,4,1],[1,3,2,1],[1,1,1,1]];
  const r     = diffGrids(grid, PALETTE, grid, PALETTE);
  const ascii = heatmapToAscii(r.heatmap);
  check('identical diff → ascii has no + or -',
    !ascii.includes('+') && !ascii.includes('-'));
}

// ── diffSequence ──────────────────────────────────────────────────────────────

section('diff — diffSequence');

{
  const ref    = [[2,3,4],[5,6,7],[2,3,4]];
  const frames = [
    { grid: [[2,3,4],[5,6,7],[2,3,4]], palette: PALETTE },  // identical
    { grid: [[7,7,7],[7,7,7],[7,7,7]], palette: PALETTE },  // all changed
  ];
  const { diffs, summary } = diffSequence(ref, PALETTE, frames);

  check('returns 2 diffs',            diffs.length === 2);
  check('summary has count',          summary.count === 2);
  check('summary has meanChangeFraction', typeof summary.meanChangeFraction === 'number');
  check('summary has maxChangeFraction',  typeof summary.maxChangeFraction  === 'number');
  check('first diff: changeFraction=0',   diffs[0].changeFraction === 0);
  check('second diff: changeFraction>0',  diffs[1].changeFraction > 0);
  check('maxChangeFraction >= meanChangeFraction',
    summary.maxChangeFraction >= summary.meanChangeFraction);
}

{
  // Empty frames
  const { diffs, summary } = diffSequence([[1]], PALETTE, []);
  check('empty: diffs=[]',                diffs.length === 0);
  check('empty: count=0',                 summary.count === 0);
  check('empty: meanChangeFraction=0',    summary.meanChangeFraction === 0);
  check('empty: maxChangeFraction=0',     summary.maxChangeFraction  === 0);
}

{
  // All identical frames → mean=0, max=0
  const ref  = [[2,3],[4,5]];
  const f    = { grid: [[2,3],[4,5]], palette: PALETTE };
  const { summary } = diffSequence(ref, PALETTE, [f, f, f]);
  check('all identical: mean=0', summary.meanChangeFraction === 0);
  check('all identical: max=0',  summary.maxChangeFraction  === 0);
}

// ── changeMask ────────────────────────────────────────────────────────────────

section('diff — changeMask');

{
  const heatmap = [
    [0,  1, -1],
    [null, 0,  1],
  ];
  const mask = changeMask(heatmap);

  check('returns array of Uint8Array rows', mask.every(r => r instanceof Uint8Array));
  check('correct row count', mask.length === 2);
  check('correct col count', mask[0].length === 3);
  check('0 → 0',    mask[0][0] === 0);
  check('1 → 1',    mask[0][1] === 1);
  check('-1 → 1',   mask[0][2] === 1);
  check('null → 0', mask[1][0] === 0);
}

{
  // Identical grid → all zeros
  const grid = [[1,4,4],[1,3,2],[1,1,1]];
  const r    = diffGrids(grid, PALETTE, grid, PALETTE);
  const mask = changeMask(r.heatmap);
  const allZero = mask.every(row => [...row].every(v => v === 0));
  check('identical diff → mask all zeros', allZero);
}

{
  // All changed → mask all ones
  const gridA = [[2,2],[2,2]];
  const gridB = [[7,7],[7,7]];
  const r     = diffGrids(gridA, PALETTE, gridB, PALETTE);
  const mask  = changeMask(r.heatmap);
  const allOne = mask.every(row => [...row].every(v => v === 1));
  check('all changed → mask all ones', allOne);
}

// ── Integration ───────────────────────────────────────────────────────────────

section('diff — integration');

{
  // Build a realistic diff: shadow-heavy vs bright-heavy sprite
  const shadow = [
    [0,1,1,1,1,0],
    [1,2,3,3,2,1],
    [1,2,2,3,2,1],
    [1,3,2,2,3,1],
    [0,1,1,1,1,0],
  ];
  const bright = [
    [0,1,1,1,1,0],
    [1,5,6,6,5,1],
    [1,5,5,6,5,1],
    [1,6,5,5,6,1],
    [0,1,1,1,1,0],
  ];

  const r     = diffGrids(shadow, PALETTE, bright, PALETTE);
  const ascii = heatmapToAscii(r.heatmap);

  check('shadow→bright: direction=brighter',   r.direction === 'brighter');
  check('shadow→bright: changeFraction>0.3',   r.changeFraction > 0.3);
  check('shadow→bright: ascii has + chars',    ascii.includes('+'));
  check('shadow→bright: ascii no - chars',     !ascii.includes('-'));

  const mask = changeMask(r.heatmap);
  check('mask rows = grid height', mask.length === shadow.length);
  check('mask cols = grid width',  mask[0].length === shadow[0].length);
}
