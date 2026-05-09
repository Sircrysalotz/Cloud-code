/**
 * Tests for src/core/grid_ops.js
 *
 * Covers: contentBounds, cropToContent, padGrid, padToSize,
 *         flipH, flipV, rotateGrid, scaleGrid, centerIn, normalizeSize.
 */

import { check, section } from '../helpers.js';
import {
  contentBounds,
  cropToContent,
  padGrid,
  padToSize,
  flipH,
  flipV,
  rotateGrid,
  scaleGrid,
  centerIn,
  normalizeSize,
} from '../../src/core/grid_ops.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function g(rows) {
  return rows.map(r => new Uint8Array(r));
}

function gridEq(a, b) {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

// ── contentBounds ─────────────────────────────────────────────────────────────

section('grid_ops — contentBounds');

{
  const grid = g([
    [0,0,0,0],
    [0,1,1,0],
    [0,1,0,0],
    [0,0,0,0],
  ]);
  const b = contentBounds(grid);
  check('top=1',    b.top    === 1);
  check('left=1',   b.left   === 1);
  check('bottom=2', b.bottom === 2);
  check('right=2',  b.right  === 2);
  check('width=2',  b.width  === 2);
  check('height=2', b.height === 2);
}

{
  // All transparent
  const grid = g([[0,0],[0,0]]);
  const b    = contentBounds(grid);
  check('all transparent: width=0',  b.width  === 0);
  check('all transparent: height=0', b.height === 0);
}

{
  // Single non-transparent pixel at (0,0)
  const grid = g([[3,0],[0,0]]);
  const b    = contentBounds(grid);
  check('single px: top=0',   b.top    === 0);
  check('single px: left=0',  b.left   === 0);
  check('single px: w=1',     b.width  === 1);
  check('single px: h=1',     b.height === 1);
}

{
  // Full grid opaque
  const grid = g([[1,2],[3,4]]);
  const b    = contentBounds(grid);
  check('full: top=0',    b.top    === 0);
  check('full: left=0',   b.left   === 0);
  check('full: bottom=1', b.bottom === 1);
  check('full: right=1',  b.right  === 1);
}

// ── cropToContent ─────────────────────────────────────────────────────────────

section('grid_ops — cropToContent');

{
  const grid = g([
    [0,0,0,0],
    [0,2,3,0],
    [0,4,5,0],
    [0,0,0,0],
  ]);
  const c = cropToContent(grid);
  check('crop height=2',  c.length     === 2);
  check('crop width=2',   c[0].length  === 2);
  check('crop [0][0]=2',  c[0][0]      === 2);
  check('crop [1][1]=5',  c[1][1]      === 5);
}

{
  // All transparent → 1×1 empty
  const c = cropToContent(g([[0,0],[0,0]]));
  check('all transparent → 1×1', c.length === 1 && c[0].length === 1);
  check('all transparent → value 0', c[0][0] === 0);
}

{
  // No padding to remove
  const grid = g([[1,2],[3,4]]);
  const c    = cropToContent(grid);
  check('no border: same dimensions', c.length === 2 && c[0].length === 2);
  check('no border: values preserved', gridEq(c, grid));
}

{
  // Returns new grid (not same reference)
  const grid = g([[1,2],[3,4]]);
  const c    = cropToContent(grid);
  check('returns new grid', c !== grid);
}

// ── padGrid ───────────────────────────────────────────────────────────────────

section('grid_ops — padGrid');

{
  const grid = g([[1,2],[3,4]]);
  const p    = padGrid(grid, { top: 1, bottom: 1, left: 1, right: 1 });

  check('padded height = H+2',     p.length    === 4);
  check('padded width = W+2',      p[0].length === 4);
  check('top row zeros',           p[0].every(v => v === 0));
  check('bottom row zeros',        p[3].every(v => v === 0));
  check('left col zeros',          p.every(r => r[0] === 0));
  check('right col zeros',         p.every(r => r[3] === 0));
  check('content at [1][1]',       p[1][1] === 1);
  check('content at [2][2]',       p[2][2] === 4);
}

{
  // No padding → same dimensions, same values
  const grid = g([[1,2],[3,4]]);
  const p    = padGrid(grid);
  check('no pad: same dimensions', p.length === 2 && p[0].length === 2);
  check('no pad: values unchanged', gridEq(p, grid));
}

{
  // Asymmetric padding
  const grid = g([[5]]);
  const p    = padGrid(grid, { top: 2, bottom: 0, left: 3, right: 1 });
  check('asymmetric: height=3', p.length    === 3);
  check('asymmetric: width=5',  p[0].length === 5);
  check('value at [2][3]',      p[2][3] === 5);
}

// ── padToSize ─────────────────────────────────────────────────────────────────

section('grid_ops — padToSize');

{
  const grid = g([[1,2],[3,4]]);
  const p    = padToSize(grid, 6, 6);

  check('padded to target width',  p[0].length === 6);
  check('padded to target height', p.length    === 6);

  // Content should be centered — check it's not all zero
  let nonZero = false;
  for (const row of p) for (const v of row) if (v !== 0) { nonZero = true; break; }
  check('content preserved', nonZero);
}

{
  // Already larger → returns padded-to-exactly or same
  const grid = g([[1,2,3],[4,5,6],[7,8,9]]);
  const p    = padToSize(grid, 2, 2);
  check('larger grid → same or bigger dims',
    p.length >= 3 && p[0].length >= 3);
  check('values preserved', gridEq(p, grid));
}

{
  // Same size → no change
  const grid = g([[1,2],[3,4]]);
  const p    = padToSize(grid, 2, 2);
  check('exact size: no change', gridEq(p, grid));
}

// ── flipH ─────────────────────────────────────────────────────────────────────

section('grid_ops — flipH');

{
  const grid = g([[1,2,3],[4,5,6]]);
  const f    = flipH(grid);

  check('flipH: same dims',      f.length === 2 && f[0].length === 3);
  check('flipH: row 0 reversed', f[0][0] === 3 && f[0][2] === 1);
  check('flipH: row 1 reversed', f[1][0] === 6 && f[1][2] === 4);
  check('flipH: center unchanged', f[0][1] === 2);
}

{
  // Symmetric grid: flipH of itself
  const grid  = g([[1,2,1],[3,4,3]]);
  const flipped = flipH(grid);
  check('symmetric row unchanged', gridEq(grid, flipped));
}

{
  // Returns new grid
  const grid = g([[1,2],[3,4]]);
  check('flipH returns new grid', flipH(grid) !== grid);
}

// ── flipV ─────────────────────────────────────────────────────────────────────

section('grid_ops — flipV');

{
  const grid = g([[1,2],[3,4],[5,6]]);
  const f    = flipV(grid);

  check('flipV: same dims',      f.length === 3 && f[0].length === 2);
  check('flipV: row order reversed', f[0][0] === 5 && f[2][0] === 1);
  check('flipV: values preserved', f[1][0] === 3 && f[1][1] === 4);
}

{
  // Double flip → original
  const grid = g([[1,2,3],[4,5,6]]);
  check('flipV twice = original', gridEq(flipV(flipV(grid)), grid));
}

// ── rotateGrid ────────────────────────────────────────────────────────────────

section('grid_ops — rotateGrid');

{
  // 90° CW: rows become cols
  const grid = g([[1,2,3],[4,5,6]]);  // 2 rows × 3 cols
  const r90  = rotateGrid(grid, 90);
  check('rotate90: new height=3', r90.length    === 3);
  check('rotate90: new width=2',  r90[0].length === 2);
  // top-left of rotated = bottom-left of original
  check('rotate90: [0][0] = grid[1][0]', r90[0][0] === 4);
}

{
  // 180°: same dims, fully inverted
  const grid = g([[1,2],[3,4]]);
  const r180 = rotateGrid(grid, 180);
  check('rotate180: same dims', r180.length === 2 && r180[0].length === 2);
  check('rotate180: [0][0] = grid[1][1]', r180[0][0] === 4);
  check('rotate180: [1][1] = grid[0][0]', r180[1][1] === 1);
}

{
  // 270°: inverse of 90°
  const grid = g([[1,2,3],[4,5,6]]);
  const r270 = rotateGrid(grid, 270);
  check('rotate270: new height=3', r270.length    === 3);
  check('rotate270: new width=2',  r270[0].length === 2);
}

{
  // 90° + 270° = identity
  const grid = g([[1,2,3],[4,5,6],[7,8,9]]);
  const rt   = rotateGrid(rotateGrid(grid, 90), 270);
  check('rotate90+270 = identity', gridEq(rt, grid));
}

{
  // 180° + 180° = identity
  const grid = g([[1,2],[3,4]]);
  check('rotate180+180 = identity', gridEq(rotateGrid(rotateGrid(grid, 180), 180), grid));
}

{
  // Invalid degrees throws
  let threw = false;
  try { rotateGrid(g([[1]]), 45); } catch (e) { threw = true; }
  check('invalid degrees throws', threw);
}

// ── scaleGrid ─────────────────────────────────────────────────────────────────

section('grid_ops — scaleGrid');

{
  const grid = g([[1,2],[3,4]]);
  const s    = scaleGrid(grid, 2);

  check('scale×2: height=4', s.length    === 4);
  check('scale×2: width=4',  s[0].length === 4);
  check('[0][0]=[0][1]=1',   s[0][0] === 1 && s[0][1] === 1);
  check('[1][0]=[1][1]=1',   s[1][0] === 1 && s[1][1] === 1);
  check('[0][2]=[0][3]=2',   s[0][2] === 2 && s[0][3] === 2);
  check('[2][0]=[3][1]=3',   s[2][0] === 3 && s[3][1] === 3);
}

{
  // factor=1 → clone
  const grid = g([[1,2],[3,4]]);
  const s    = scaleGrid(grid, 1);
  check('scale×1: same dims',    s.length === 2 && s[0].length === 2);
  check('scale×1: same values',  gridEq(s, grid));
  check('scale×1: new reference', s !== grid);
}

{
  // Non-integer factor throws
  let threw = false;
  try { scaleGrid(g([[1]]), 1.5); } catch (e) { threw = true; }
  check('non-integer factor throws', threw);
}

{
  // factor=0 throws
  let threw = false;
  try { scaleGrid(g([[1]]), 0); } catch (e) { threw = true; }
  check('factor=0 throws', threw);
}

{
  // scale×3: each cell becomes 3×3 block
  const grid = g([[7]]);
  const s    = scaleGrid(grid, 3);
  check('scale×3 of 1×1 → 3×3', s.length === 3 && s[0].length === 3);
  check('all cells = 7', s.every(r => [...r].every(v => v === 7)));
}

// ── centerIn ─────────────────────────────────────────────────────────────────

section('grid_ops — centerIn');

{
  const grid = g([[5]]);  // 1×1
  const c    = centerIn(grid, 5, 5);

  check('centerIn: output 5×5', c.length === 5 && c[0].length === 5);
  // pixel should be at (2,2)
  check('centered at (2,2)', c[2][2] === 5);
  // corners transparent
  check('corners transparent', c[0][0] === 0 && c[4][4] === 0);
}

{
  // Already same size → identical
  const grid = g([[1,2],[3,4]]);
  const c    = centerIn(grid, 2, 2);
  check('same size: identical', gridEq(c, grid));
}

{
  // Larger canvas → content is somewhere in the middle
  const grid = g([[1,2],[3,4]]);
  const c    = centerIn(grid, 6, 6);
  check('larger canvas height', c.length    === 6);
  check('larger canvas width',  c[0].length === 6);
  let nonZero = 0;
  for (const row of c) for (const v of row) if (v !== 0) nonZero++;
  check('4 non-zero pixels', nonZero === 4);
}

{
  // Sprite larger than canvas → clipped, no crash
  const grid = g([[1,2,3,4],[5,6,7,8],[9,1,2,3]]);
  let threw = false, c;
  try { c = centerIn(grid, 2, 2); } catch (e) { threw = true; }
  check('larger sprite: no throw',       !threw);
  check('larger sprite: output 2×2',     c?.length === 2 && c?.[0].length === 2);
}

// ── normalizeSize ─────────────────────────────────────────────────────────────

section('grid_ops — normalizeSize');

{
  const grid = g([
    [0,0,0,0],
    [0,1,2,0],
    [0,3,4,0],
    [0,0,0,0],
  ]);
  const n = normalizeSize(grid, 4, 4);

  check('normalize: exact output 4×4', n.length === 4 && n[0].length === 4);
  // Content (2×2 sprite) centered in 4×4 canvas → at (1,1)
  let nonZeroN = 0;
  for (const row of n) for (const v of row) if (v !== 0) nonZeroN++;
  check('content preserved (4 pixels)', nonZeroN === 4);
}

{
  // Already correct size
  const grid = g([[1,2],[3,4]]);
  const n    = normalizeSize(grid, 2, 2);
  check('correct size: no change needed', n.length === 2 && n[0].length === 2);
}

{
  // Output is always exactly target size
  for (const [w, h] of [[4,4],[8,6],[3,3]]) {
    const grid = g([[0,0,0],[0,2,0],[0,0,0]]);
    const n    = normalizeSize(grid, w, h);
    check(`normalizeSize: output always ${w}×${h}`,
      n.length === h && n[0].length === w);
  }
}

{
  // All transparent → still produces correct size
  const grid = g([[0,0],[0,0]]);
  const n    = normalizeSize(grid, 4, 4);
  check('all-transparent: output 4×4', n.length === 4 && n[0].length === 4);
}
