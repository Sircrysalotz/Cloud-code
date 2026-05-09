/**
 * Tests for src/authoring/variant_engine.js
 *
 * Covers: generatePoseGrid, buildVariantCell, computeCellBandRmsZ,
 *         buildVariantLibrary — cells, summary, progress callbacks.
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import { PALETTE }        from '../../src/core/palette.js';
import { paletteFromHex } from '../../src/core/palette_designer.js';
import { loadBatchReference } from '../../src/eval/reference_lib.js';
import {
  generatePoseGrid,
  buildVariantCell,
  computeCellBandRmsZ,
  buildVariantLibrary,
} from '../../src/authoring/variant_engine.js';

// ── computeCellBandRmsZ ───────────────────────────────────────────────────────

section('variant_engine — computeCellBandRmsZ');

{
  // All-zero z-scores → 0
  const results = Object.fromEntries(
    ['shadow_deep_ratio','shadow_ratio','mid_ratio','bright_ratio','highlight_ratio','peak_ratio']
      .map(k => [k, { z: 0 }])
  );
  check('all zero → 0', computeCellBandRmsZ(results) === 0);
}

{
  // All z=2 → rmsZ=2
  const results = Object.fromEntries(
    ['shadow_deep_ratio','shadow_ratio','mid_ratio','bright_ratio','highlight_ratio','peak_ratio']
      .map(k => [k, { z: 2 }])
  );
  check('all z=2 → rmsZ=2', Math.abs(computeCellBandRmsZ(results) - 2) < 1e-9);
}

{
  // Structural key ignored
  const results = {
    shadow_deep_ratio: { z: 0 }, shadow_ratio: { z: 0 }, mid_ratio: { z: 0 },
    bright_ratio: { z: 0 }, highlight_ratio: { z: 0 }, peak_ratio: { z: 0 },
    symmetry_score: { z: 100 },  // ignored
  };
  check('structural key ignored', computeCellBandRmsZ(results) === 0);
}

{
  // Empty → 0
  check('empty results → 0', computeCellBandRmsZ({}) === 0);
}

// ── Integration tests (need batch reference) ──────────────────────────────────

const ref = loadBatchReference();
const dist = ref?.distribution ?? null;

if (!dist) {
  check('batch reference available for variant_engine tests', false);
} else {

// ── generatePoseGrid ──────────────────────────────────────────────────────────

  section('variant_engine — generatePoseGrid');

  {
    const grid = generatePoseGrid('idle', dist, { maxIter: 10, targetRmsZ: 1.0 });
    check('generatePoseGrid returns non-null', grid !== null);
    check('generatePoseGrid grid has correct height', grid.length === 40);
    check('generatePoseGrid grid has correct width', grid[0].length === 24);
    check('generatePoseGrid grid is Uint8Array rows', grid.every(r => r instanceof Uint8Array));
  }

  {
    // Different poses produce differently-sized grids
    const idle  = generatePoseGrid('idle',  dist, { maxIter: 5, targetRmsZ: 2.0 });
    const punch = generatePoseGrid('punch', dist, { maxIter: 5, targetRmsZ: 2.0 });
    check('idle width 24', idle[0].length === 24);
    check('punch width 30', punch[0].length === 30);
  }

// ── buildVariantCell ──────────────────────────────────────────────────────────

  section('variant_engine — buildVariantCell');

  {
    const grid    = generatePoseGrid('idle', dist, { maxIter: 10, targetRmsZ: 1.0 });
    const coolPal = paletteFromHex(['#000000','#0a081e','#141450','#282878','#4650b4','#648cdc','#a0c8ff','#dcf0ff']);
    const cell    = buildVariantCell('idle', grid, 'cool', coolPal, dist);

    check('cell has pose',       cell.pose === 'idle');
    check('cell has paletteKey', cell.paletteKey === 'cool');
    check('cell has grid',       Array.isArray(cell.grid) && cell.grid.length > 0);
    check('cell has metrics',    typeof cell.metrics === 'object');
    check('cell has bandRmsZ',   typeof cell.bandRmsZ === 'number' && isFinite(cell.bandRmsZ));
    check('cell has fullRmsZ',   typeof cell.fullRmsZ === 'number' && isFinite(cell.fullRmsZ));
    check('cell has flags',      Array.isArray(cell.flags));
    check('cell has pass',       typeof cell.pass === 'boolean');
  }

  {
    // Style transfer: grid uses target palette indices
    const grid    = generatePoseGrid('idle', dist, { maxIter: 5, targetRmsZ: 2.0 });
    const monoPal = paletteFromHex(['#000000','#141414','#2d2d2d','#505050','#787878','#a0a0a0','#c8c8c8','#f0f0f0']);
    const cell    = buildVariantCell('idle', grid, 'mono', monoPal, dist);

    // All non-transparent pixels should be valid mono palette indices
    check('cell grid uses target palette indices',
      cell.grid.every(row => row.every(v =>
        v === 0 || monoPal.isBody(v) || monoPal.isOutline(v)
      )));
  }

  {
    // Crimson transfer is valid (source = target)
    const grid   = generatePoseGrid('idle', dist, { maxIter: 5, targetRmsZ: 2.0 });
    const cell   = buildVariantCell('idle', grid, 'crimson', PALETTE, dist);
    check('crimson cell bandRmsZ finite', isFinite(cell.bandRmsZ));
  }

// ── buildVariantLibrary ───────────────────────────────────────────────────────

  section('variant_engine — buildVariantLibrary');

  {
    // 2 poses × 2 palettes = 4 cells
    const cool   = paletteFromHex(['#000000','#0a081e','#141450','#282878','#4650b4','#648cdc','#a0c8ff','#dcf0ff']);
    const warm   = paletteFromHex(['#000000','#1e0a00','#501900','#8c3205','#d26414','#f09628','#ffc850','#fff0a0']);
    const library = buildVariantLibrary({
      poses:        ['idle', 'punch'],
      palettes:     [{ key: 'cool', palette: cool }, { key: 'warm', palette: warm }],
      distribution: dist,
      opts:         { maxIter: 8, targetRmsZ: 1.5 },
    });

    check('library has 4 cells',  library.cells.length === 4);
    check('library has poses',    library.poses.length === 2);
    check('library has palettes', library.palettes.length === 2);
    check('library has baseGrids', typeof library.baseGrids === 'object');
    check('library has summary',  typeof library.summary === 'object');
  }

  {
    // Summary fields
    const cool = paletteFromHex(['#000000','#0a081e','#141450','#282878','#4650b4','#648cdc','#a0c8ff','#dcf0ff']);
    const { summary } = buildVariantLibrary({
      poses:        ['idle'],
      palettes:     [{ key: 'cool', palette: cool }],
      distribution: dist,
      opts:         { maxIter: 5, targetRmsZ: 2.0 },
    });

    check('summary has totalCells',   summary.totalCells === 1);
    check('summary has meanBandRmsZ', typeof summary.meanBandRmsZ === 'number');
    check('summary has passRate',     typeof summary.passRate === 'number');
    check('summary has passCount',    typeof summary.passCount === 'number');
    check('summary has bestCell',     typeof summary.bestCell === 'object');
    check('summary has worstCell',    typeof summary.worstCell === 'object');
    check('summary passRate between 0 and 1',
      summary.passRate >= 0 && summary.passRate <= 1);
  }

  {
    // Progress callback is called for each step
    const cool   = paletteFromHex(['#000000','#0a081e','#141450','#282878','#4650b4','#648cdc','#a0c8ff','#dcf0ff']);
    const events = [];
    buildVariantLibrary({
      poses:        ['idle'],
      palettes:     [{ key: 'cool', palette: cool }],
      distribution: dist,
      opts: {
        maxIter: 5, targetRmsZ: 2.0,
        onProgress: e => events.push(e),
      },
    });
    check('progress events fired',     events.length > 0);
    check('progress events have done', events.every(e => typeof e.done === 'number'));
    check('progress events have total',events.every(e => typeof e.total === 'number'));
    check('progress done increases',
      events.every((e, i) => i === 0 || e.done >= events[i-1].done));
    check('progress last done equals total',
      events[events.length - 1]?.done === events[events.length - 1]?.total);
  }

  {
    // Error cases
    let threw = false;
    try { buildVariantLibrary({ poses: ['idle'], palettes: [], distribution: dist }); }
    catch { threw = true; }
    check('empty palettes throws', threw);
  }

  {
    let threw = false;
    try { buildVariantLibrary({ poses: ['idle'], palettes: [{ key: 'x', palette: PALETTE }], distribution: null }); }
    catch { threw = true; }
    check('null distribution throws', threw);
  }

  {
    // All cells have correct pose × palette combinations
    const cool = paletteFromHex(['#000000','#0a081e','#141450','#282878','#4650b4','#648cdc','#a0c8ff','#dcf0ff']);
    const warm = paletteFromHex(['#000000','#1e0a00','#501900','#8c3205','#d26414','#f09628','#ffc850','#fff0a0']);
    const lib  = buildVariantLibrary({
      poses:        ['idle', 'guard'],
      palettes:     [{ key: 'cool', palette: cool }, { key: 'warm', palette: warm }],
      distribution: dist,
      opts:         { maxIter: 5, targetRmsZ: 2.0 },
    });

    const poseKeys    = lib.cells.map(c => c.pose);
    const paletteKeys = lib.cells.map(c => c.paletteKey);
    check('all poses represented in cells',
      ['idle', 'guard'].every(p => poseKeys.includes(p)));
    check('all palettes represented in cells',
      ['cool', 'warm'].every(p => paletteKeys.includes(p)));
    check('idle×cool exists', lib.cells.some(c => c.pose === 'idle'  && c.paletteKey === 'cool'));
    check('idle×warm exists', lib.cells.some(c => c.pose === 'idle'  && c.paletteKey === 'warm'));
    check('guard×cool exists',lib.cells.some(c => c.pose === 'guard' && c.paletteKey === 'cool'));
    check('guard×warm exists', lib.cells.some(c => c.pose === 'guard' && c.paletteKey === 'warm'));
  }

  {
    // baseGrids are in source (PALETTE) space — all indices valid for PALETTE
    const cool = paletteFromHex(['#000000','#0a081e','#141450','#282878','#4650b4','#648cdc','#a0c8ff','#dcf0ff']);
    const lib  = buildVariantLibrary({
      poses:    ['idle'],
      palettes: [{ key: 'cool', palette: cool }],
      distribution: dist,
      opts: { maxIter: 5, targetRmsZ: 2.0 },
    });
    const baseGrid = lib.baseGrids['idle'];
    check('baseGrid for idle exists', Array.isArray(baseGrid) && baseGrid.length > 0);
    check('baseGrid uses PALETTE indices (all ≤ 7)',
      baseGrid.every(row => row.every(v => v >= 0 && v <= 7)));
  }
}
