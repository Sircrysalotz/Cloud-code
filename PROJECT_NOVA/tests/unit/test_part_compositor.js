/**
 * Tests for src/authoring/part_compositor.js — Phase 28.
 *
 * Covers: rowProfile, findSeams, splitParts, compositeParts, assembleCharacter.
 * Uses synthetic humanoid grids plus real batch frames when available.
 */

import { existsSync, readFileSync } from 'fs';
import { join }            from 'path';
import { check, section }  from '../helpers.js';
import { paletteFromRGB }  from '../../src/core/palette.js';
import {
  rowProfile,
  findSeams,
  splitParts,
  compositeParts,
  assembleCharacter,
} from '../../src/authoring/part_compositor.js';

// ── Synthetic humanoid: wide head, narrow neck, wide torso, waist, legs ───────
// 11 cols × 16 rows. 1=outline used as generic body value.
function syntheticHumanoid() {
  const rows = [
    '...111.....',  // 0  head top
    '..11111....',  // 1  head widest (5)
    '..11111....',  // 2
    '....1......',  // 3  neck (1) ← narrowest after head peak
    '..11111....',  // 4  shoulders
    '.1111111...',  // 5  torso widest (7)
    '.1111111...',  // 6
    '..11111....',  // 7
    '...111.....',  // 8  waist (3)  ← hip seam window
    '...111.....',  // 9
    '..11.11....',  // 10 legs split
    '..11.11....',  // 11
    '..11.11....',  // 12
    '..11.11....',  // 13
    '.111.111...',  // 14 feet
    '.111.111...',  // 15
  ];
  return rows.map(s => Uint8Array.from([...s].map(ch => ch === '1' ? 1 : 0)));
}

// ── rowProfile ────────────────────────────────────────────────────────────────

section('part_compositor — rowProfile');

{
  const g = syntheticHumanoid();
  const p = rowProfile(g);

  check('profile has one entry per row', p.length === g.length);
  check('row 0: count 3', p[0].count === 3);
  check('row 1: width 5 (head peak)', p[1].width === 5);
  check('row 3: width 1 (neck)', p[3].width === 1);
  check('row 5: width 7 (torso peak)', p[5].width === 7);
  check('row 10: count 4, width 5 (split legs span gap)',
    p[10].count === 4 && p[10].width === 5);
  check('left/right recorded', p[1].left === 2 && p[1].right === 6);
}

{
  // Empty grid rows
  const g = [new Uint8Array(5), new Uint8Array(5)];
  const p = rowProfile(g);
  check('empty rows: width 0', p.every(e => e.width === 0 && e.count === 0));
  check('empty rows: left/right -1', p[0].left === -1 && p[0].right === -1);
}

// ── findSeams ─────────────────────────────────────────────────────────────────

section('part_compositor — findSeams');

{
  const g = syntheticHumanoid();
  const { neckRow, hipRow, bounds } = findSeams(g);

  check('neck found at narrowest post-head row (3)', neckRow === 3);
  check('hip in waist window (rows 8-11)', hipRow >= 8 && hipRow <= 11);
  check('hip below neck', hipRow > neckRow);
  check('bounds match content', bounds.top === 0 && bounds.bottom === 15);
}

{
  // Fully transparent grid
  const g = [new Uint8Array(4), new Uint8Array(4)];
  const { neckRow, hipRow } = findSeams(g);
  check('transparent grid: neckRow -1', neckRow === -1);
  check('transparent grid: hipRow -1', hipRow === -1);
}

// ── splitParts ────────────────────────────────────────────────────────────────

section('part_compositor — splitParts');

{
  const g = syntheticHumanoid();
  const { head, torso, legs, seams } = splitParts(g);

  check('head grid non-empty', head.grid.length > 0 && head.grid[0].length > 0);
  check('torso grid non-empty', torso.grid.length > 0);
  check('legs grid non-empty', legs.grid.length > 0);

  // Head = rows 0..3 cropped → 4 rows tall
  check('head height matches rows to neck', head.grid.length === seams.neckRow - seams.bounds.top + 1);

  // Part heights cover the full content height
  const total = head.grid.length + torso.grid.length + legs.grid.length;
  check('part heights sum to content height',
    total === seams.bounds.height);

  // Pixel conservation: no pixels invented
  const count = grid => grid.reduce((s, row) => s + [...row].filter(v => v !== 0).length, 0);
  const orig  = count(g);
  check('no pixels invented or lost in split',
    count(head.grid) + count(torso.grid) + count(legs.grid) === orig);

  check('seamCenter is finite number for all parts',
    [head, torso, legs].every(p => Number.isFinite(p.seamCenter)));
}

{
  // Fully transparent grid throws
  let threw = false;
  try { splitParts([new Uint8Array(4), new Uint8Array(4)]); } catch { threw = true; }
  check('splitParts throws on transparent grid', threw);
}

// ── compositeParts ────────────────────────────────────────────────────────────

section('part_compositor — compositeParts');

{
  const g = syntheticHumanoid();
  const parts = splitParts(g);
  const out = compositeParts(parts);

  const count = grid => grid.reduce((s, row) => s + [...row].filter(v => v !== 0).length, 0);
  check('recomposed pixel count matches original', count(out) === count(g));
  check('recomposed height = sum of part heights',
    out.length === parts.head.grid.length + parts.torso.grid.length + parts.legs.grid.length);
  check('output rows are Uint8Array', out.every(r => r instanceof Uint8Array));
}

{
  // Split-then-recompose of a symmetric sprite keeps parts horizontally aligned:
  // every part's seam center maps to the same output column
  const g = syntheticHumanoid();
  const parts = splitParts(g);
  const out = compositeParts(parts);
  const p = rowProfile(out);

  // Head peak center (row 1) and torso peak center should be within 1 col
  const center = e => (e.left + e.right) / 2;
  const headC  = center(p[1]);
  const torsoC = center(p[parts.head.grid.length + 1]);
  check('head and torso centers aligned within 1 column',
    Math.abs(headC - torsoC) <= 1);
}

{
  // Partial composition: torso only
  const parts = splitParts(syntheticHumanoid());
  const out = compositeParts({ torso: parts.torso });
  check('single-part composition works', out.length === parts.torso.grid.length);
}

{
  // No parts throws
  let threw = false;
  try { compositeParts({}); } catch { threw = true; }
  check('compositeParts throws with no parts', threw);
}

// ── assembleCharacter (synthetic frames) ──────────────────────────────────────

section('part_compositor — assembleCharacter (synthetic)');

{
  // Two synthetic "frames" sharing one palette shape (4 colors)
  const palette = paletteFromRGB([
    { index: 0, rgb: [0, 0, 0] },
    { index: 1, rgb: [10, 10, 10] },
    { index: 2, rgb: [100, 0, 0] },
    { index: 3, rgb: [200, 0, 0] },
  ]);
  const frameA = { grid: syntheticHumanoid().map(r => [...r]), palette };
  // Frame B: same shape but body uses index 2 instead of 1
  const frameB = {
    grid: syntheticHumanoid().map(r => [...r].map(v => v === 1 ? 2 : 0)),
    palette,
  };
  const loadFrame = idx => (idx === 0 ? frameA : idx === 1 ? frameB : null);

  const result = assembleCharacter(
    { head: { frame: 0 }, torso: { frame: 1 }, legs: { frame: 0 } },
    loadFrame
  );

  check('assembled grid non-empty', result.grid.length > 0);
  check('palette is target frame palette', result.palette === palette);
  check('parts metadata recorded',
    result.parts.head.frame === 0 && result.parts.torso.frame === 1);

  // Head pixels keep frame A's index; torso pixels come from frame B
  const valuesIn = rows => new Set(rows.flatMap(r => [...r].filter(v => v !== 0)));
  const headRows  = result.grid.slice(0, 4);
  const headVals  = valuesIn(headRows);
  check('head region uses donor A values', headVals.has(1));

  // Missing donor frame throws
  let threw = false;
  try {
    assembleCharacter({ head: { frame: 99 } }, loadFrame);
  } catch { threw = true; }
  check('missing donor frame throws', threw);

  // Empty spec throws
  threw = false;
  try { assembleCharacter({}, loadFrame); } catch { threw = true; }
  check('empty spec throws', threw);
}

// ── Real batch frames (skipped if batch not ingested) ─────────────────────────

section('part_compositor — real batch frames');

{
  const BATCH = new URL('../../exports/batch', import.meta.url).pathname;

  const loadFrame = (frameIdx) => {
    const id = String(frameIdx).padStart(4, '0');
    const gPath = join(BATCH, `frame_${id}_grid.json`);
    const pPath = join(BATCH, `frame_${id}_palette.json`);
    if (!existsSync(gPath) || !existsSync(pPath)) return null;
    const gd = JSON.parse(readFileSync(gPath, 'utf8'));
    const pd = JSON.parse(readFileSync(pPath, 'utf8'));
    return {
      grid:    gd.data.map(row => Array.isArray(row) ? [...row] : Object.values(row).map(Number)),
      palette: paletteFromRGB(pd),
    };
  };

  if (!loadFrame(4)) {
    check('batch frames available for part_compositor tests', false);
  } else {
    const frame = loadFrame(4);
    const { neckRow, hipRow, bounds } = findSeams(frame.grid);

    check('real frame: neck seam inside content',
      neckRow > bounds.top && neckRow < bounds.bottom);
    check('real frame: hip seam below neck', hipRow > neckRow);

    const { head, torso, legs } = splitParts(frame.grid);
    const count = grid => grid.reduce((s, row) => s + [...row].filter(v => v !== 0).length, 0);
    check('real frame: head has pixels', count(head.grid) > 50);
    check('real frame: torso has pixels', count(torso.grid) > 100);
    check('real frame: legs have pixels', count(legs.grid) > 100);
    check('real frame: split conserves all pixels',
      count(head.grid) + count(torso.grid) + count(legs.grid) === count(frame.grid));

    // Cross-frame assembly with palette unification
    const result = assembleCharacter(
      { head: { frame: 4 }, torso: { frame: 9 }, legs: { frame: 14 } },
      loadFrame
    );
    check('cross-frame character assembled', result.grid.length > 30);
    check('cross-frame: all indices valid in target palette',
      result.grid.every(row => [...row].every(v =>
        result.palette.colors.some(c => c.index === v))));
    check('cross-frame: has body pixels',
      count(result.grid) > 300);
  }
}
