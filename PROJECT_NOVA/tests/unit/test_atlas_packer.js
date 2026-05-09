/**
 * Tests for src/export/atlas_packer.js
 *
 * Covers: packRects, buildUVMap, renderAtlasRGBA, buildAtlas,
 *         libraryCells, atlasInfo.
 */

import { check, section } from '../helpers.js';
import { PALETTE }        from '../../src/core/palette.js';
import {
  packRects,
  buildUVMap,
  renderAtlasRGBA,
  buildAtlas,
  libraryCells,
  atlasInfo,
} from '../../src/export/atlas_packer.js';

// ── packRects ─────────────────────────────────────────────────────────────────

section('atlas_packer — packRects');

{
  const { placements, atlasWidth, atlasHeight } = packRects([]);
  check('empty input → empty placements', placements.size === 0);
  check('empty input → atlasWidth=0',     atlasWidth  === 0);
  check('empty input → atlasHeight=0',    atlasHeight === 0);
}

{
  const items = [{ id: 'a', width: 8, height: 12 }];
  const { placements, atlasWidth, atlasHeight } = packRects(items);
  check('single item placed',        placements.has('a'));
  check('single item x=0',           placements.get('a').x === 0);
  check('single item y=0',           placements.get('a').y === 0);
  check('atlasWidth >= item width',  atlasWidth >= 8);
  check('atlasHeight = item height', atlasHeight === 12);
}

{
  // Two items side by side (both 4×4, auto width should fit them)
  const items = [
    { id: 'a', width: 4, height: 4 },
    { id: 'b', width: 4, height: 4 },
  ];
  const { placements, atlasWidth, atlasHeight } = packRects(items);
  check('both items placed', placements.has('a') && placements.has('b'));
  check('no overlap: x offsets differ or on different shelves', () => {
    const pa = placements.get('a');
    const pb = placements.get('b');
    const separated = (pa.x + 4 <= pb.x || pb.x + 4 <= pa.x) || (pa.y !== pb.y);
    return separated;
  });
  check('atlasHeight >= 4', atlasHeight >= 4);
  check('atlasWidth > 0',   atlasWidth > 0);
}

{
  // Forced new shelf when item exceeds maxWidth
  const items = [
    { id: 'a', width: 8, height: 4 },
    { id: 'b', width: 8, height: 4 },
  ];
  const { placements, atlasHeight } = packRects(items, 8);
  check('second item on new shelf', placements.get('b').y >= 4);
  check('total height = 2 shelves', atlasHeight === 8);
}

{
  // IDs are preserved exactly
  const items = [{ id: 'idle_crimson', width: 6, height: 10 }];
  const { placements } = packRects(items);
  check('id key preserved', placements.has('idle_crimson'));
}

{
  // All placements are non-negative
  const items = Array.from({ length: 5 }, (_, i) => ({
    id: `s${i}`, width: 4 + i, height: 6 + i,
  }));
  const { placements } = packRects(items);
  let allNonNeg = true;
  for (const [, pos] of placements) {
    if (pos.x < 0 || pos.y < 0) allNonNeg = false;
  }
  check('all placements non-negative', allNonNeg);
}

{
  // No two items overlap
  const items = Array.from({ length: 6 }, (_, i) => ({
    id: `r${i}`, width: 5, height: 5,
  }));
  const { placements } = packRects(items, 16);

  const rects = [...placements.entries()].map(([id, pos]) => {
    const item = items.find(it => it.id === id);
    return { x: pos.x, y: pos.y, w: item.width, h: item.height };
  });

  let noOverlap = true;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x &&
          a.y < b.y + b.h && a.y + a.h > b.y) {
        noOverlap = false;
      }
    }
  }
  check('no two rects overlap', noOverlap);
}

// ── buildUVMap ────────────────────────────────────────────────────────────────

section('atlas_packer — buildUVMap');

{
  const grid = [[1,2,1],[1,3,1],[1,1,1]];  // 3×3
  const cells = [
    { id: 'idle_warm', pose: 'idle', paletteKey: 'warm', grid, palette: PALETTE },
  ];
  const placements = new Map([['idle_warm', { x: 5, y: 10 }]]);
  const uv = buildUVMap(cells, placements);

  check('returns array',       Array.isArray(uv));
  check('one entry',           uv.length === 1);
  check('id preserved',        uv[0].id === 'idle_warm');
  check('pose preserved',      uv[0].pose === 'idle');
  check('paletteKey preserved',uv[0].paletteKey === 'warm');
  check('x from placement',    uv[0].x === 5);
  check('y from placement',    uv[0].y === 10);
  check('width = grid cols',   uv[0].width === 3);
  check('height = grid rows',  uv[0].height === 3);
}

{
  // Missing placement → defaults to (0,0)
  const grid = [[1]];
  const cells = [{ id: 'x', pose: 'idle', paletteKey: 'cool', grid, palette: PALETTE }];
  const uv = buildUVMap(cells, new Map());
  check('missing placement → x=0', uv[0].x === 0);
  check('missing placement → y=0', uv[0].y === 0);
}

// ── renderAtlasRGBA ───────────────────────────────────────────────────────────

section('atlas_packer — renderAtlasRGBA');

{
  // Transparent grid → all alpha=0 (transparent atlas)
  const grid = [[0, 0], [0, 0]];
  const cells = [{ id: 'a', grid, palette: PALETTE }];
  const uvMap = [{ id: 'a', x: 0, y: 0, width: 2, height: 2 }];
  const rgba  = renderAtlasRGBA(cells, uvMap, 1, { atlasWidth: 4, atlasHeight: 4 });

  check('transparent sprite → alpha=0 at origin', rgba[3] === 0);
  check('output length correct', rgba.length === 4 * 4 * 4);
}

{
  // Opaque pixel is blitted correctly
  const grid = [[4]];  // index 4 = mid, opaque
  const cells = [{ id: 'b', grid, palette: PALETTE }];
  const uvMap = [{ id: 'b', x: 2, y: 1, width: 1, height: 1 }];
  const rgba  = renderAtlasRGBA(cells, uvMap, 1, { atlasWidth: 4, atlasHeight: 4 });

  // Pixel (2,1) = row 1, col 2 → offset = (1*4 + 2)*4 = 24
  check('opaque pixel alpha=255', rgba[24 + 3] === 255);
  // Position (0,0) should be transparent
  check('other position alpha=0', rgba[3] === 0);
}

{
  // scale=2: atlas dimensions double
  const grid = [[4, 4], [1, 1]];
  const cells = [{ id: 'c', grid, palette: PALETTE }];
  const uvMap = [{ id: 'c', x: 0, y: 0, width: 2, height: 2 }];
  const rgba  = renderAtlasRGBA(cells, uvMap, 2, { atlasWidth: 4, atlasHeight: 4 });

  check('scale=2 buffer size', rgba.length === (4*2) * (4*2) * 4);
}

{
  // Unknown id → no crash, returns output of correct size
  const cells = [];
  const uvMap = [{ id: 'ghost', x: 0, y: 0, width: 2, height: 2 }];
  let threw = false, rgba;
  try { rgba = renderAtlasRGBA(cells, uvMap, 1, { atlasWidth: 4, atlasHeight: 4 }); }
  catch (e) { threw = true; }
  check('unknown id → no throw',           !threw);
  check('unknown id → output still sized', rgba?.length === 4 * 4 * 4);
}

// ── buildAtlas ────────────────────────────────────────────────────────────────

section('atlas_packer — buildAtlas');

{
  const result = buildAtlas([]);
  check('empty cells → uvMap=[]',      result.uvMap.length === 0);
  check('empty cells → atlasWidth=0',  result.atlasWidth  === 0);
  check('empty cells → atlasHeight=0', result.atlasHeight === 0);
  check('empty cells → rgba empty',    result.rgba.length  === 0);
  check('empty cells → png is Uint8Array', result.png instanceof Uint8Array);
}

{
  const grid = [[1,4,1],[1,3,1],[1,1,1]];
  const cells = [
    { id: 'idle_warm',   pose: 'idle',  paletteKey: 'warm',   grid, palette: PALETTE },
    { id: 'guard_cool',  pose: 'guard', paletteKey: 'cool',   grid, palette: PALETTE },
    { id: 'punch_mono',  pose: 'punch', paletteKey: 'mono',   grid, palette: PALETTE },
  ];

  const result = buildAtlas(cells, { scale: 2 });

  check('uvMap has 3 entries',    result.uvMap.length === 3);
  check('atlasWidth > 0',         result.atlasWidth  > 0);
  check('atlasHeight > 0',        result.atlasHeight > 0);
  check('rgba is Uint8Array',     result.rgba instanceof Uint8Array);
  check('rgba non-empty',         result.rgba.length  > 0);
  check('png starts with header', result.png[0] === 0x89 && result.png[1] === 0x50);
}

{
  // uvMap entries have all required fields
  const grid = [[1,2,1]];
  const cells = [{ id: 'a_b', pose: 'idle', paletteKey: 'warm', grid, palette: PALETTE }];
  const { uvMap } = buildAtlas(cells, { scale: 1 });
  const e = uvMap[0];

  check('entry has id',         typeof e.id         === 'string');
  check('entry has pose',       typeof e.pose        === 'string');
  check('entry has paletteKey', typeof e.paletteKey  === 'string');
  check('entry has x',          typeof e.x           === 'number');
  check('entry has y',          typeof e.y           === 'number');
  check('entry has width',      typeof e.width       === 'number');
  check('entry has height',     typeof e.height      === 'number');
}

{
  // rgba size = atlasWidth*scale × atlasHeight*scale × 4
  const grid = [[1,4,1],[1,3,1]];
  const cells = [{ id: 'sp', pose: 'idle', paletteKey: 'warm', grid, palette: PALETTE }];
  const scale = 3;
  const { atlasWidth, atlasHeight, rgba } = buildAtlas(cells, { scale });
  check('rgba size matches atlas dims', rgba.length === atlasWidth * scale * atlasHeight * scale * 4);
}

{
  // No two UV entries overlap
  const grid4 = [[1,4,4,1],[1,3,3,1],[1,2,2,1],[1,1,1,1]];  // 4×4
  const cells = Array.from({ length: 6 }, (_, i) => ({
    id: `c${i}`, pose: 'idle', paletteKey: 'warm', grid: grid4, palette: PALETTE,
  }));
  const { uvMap } = buildAtlas(cells, { scale: 1 });

  let noOverlap = true;
  for (let i = 0; i < uvMap.length; i++) {
    for (let j = i + 1; j < uvMap.length; j++) {
      const a = uvMap[i], b = uvMap[j];
      if (a.x < b.x + b.width  && a.x + a.width  > b.x &&
          a.y < b.y + b.height && a.y + a.height > b.y) {
        noOverlap = false;
      }
    }
  }
  check('no UV entries overlap', noOverlap);
}

{
  // maxWidth option is respected: all entries fit within maxWidth
  const grid = [[1,2,3,4,5,1]];  // 6-wide
  const cells = Array.from({ length: 4 }, (_, i) => ({
    id: `w${i}`, pose: 'idle', paletteKey: 'warm', grid, palette: PALETTE,
  }));
  const mw = 12;
  const { uvMap, atlasWidth } = buildAtlas(cells, { scale: 1, maxWidth: mw });
  check('atlasWidth respects maxWidth', atlasWidth <= mw);
  check('all entries within maxWidth', uvMap.every(e => e.x + e.width <= mw));
}

// ── libraryCells ──────────────────────────────────────────────────────────────

section('atlas_packer — libraryCells');

{
  const fakeLib = {
    cells: [
      { id: 'idle_warm',  pose: 'idle',  paletteKey: 'warm',  grid: [[1]], palette: PALETTE },
      { id: 'guard_cool', pose: 'guard', paletteKey: 'cool',  grid: [[1]], palette: PALETTE },
    ],
  };
  const cells = libraryCells(fakeLib);

  check('returns array',          Array.isArray(cells));
  check('correct length',         cells.length === 2);
  check('id propagated',          cells[0].id === 'idle_warm');
  check('pose propagated',        cells[0].pose === 'idle');
  check('paletteKey propagated',  cells[0].paletteKey === 'warm');
  check('grid propagated',        cells[0].grid === fakeLib.cells[0].grid);
  check('palette propagated',     cells[0].palette === PALETTE);
}

{
  // Cells without id get auto id = pose_paletteKey
  const fakeLib = {
    cells: [
      { pose: 'kick', paletteKey: 'mono', grid: [[1]], palette: PALETTE },
    ],
  };
  const cells = libraryCells(fakeLib);
  check('auto id = pose_paletteKey', cells[0].id === 'kick_mono');
}

{
  // Empty library
  const cells = libraryCells({ cells: [] });
  check('empty library → empty cells', cells.length === 0);
}

{
  // No cells property
  const cells = libraryCells({});
  check('missing cells → empty array', cells.length === 0);
}

// ── atlasInfo ─────────────────────────────────────────────────────────────────

section('atlas_packer — atlasInfo');

{
  const uvMap = [
    { id: 'idle_warm',  pose: 'idle',  paletteKey: 'warm',  x:0, y:0, width:4, height:4 },
    { id: 'idle_cool',  pose: 'idle',  paletteKey: 'cool',  x:4, y:0, width:4, height:4 },
    { id: 'guard_warm', pose: 'guard', paletteKey: 'warm',  x:0, y:4, width:4, height:4 },
  ];
  const info = atlasInfo({ uvMap, atlasWidth: 8, atlasHeight: 8 });

  check('sprite_count = 3',        info.sprite_count === 3);
  check('atlasWidth',              info.atlas_width  === 8);
  check('atlasHeight',             info.atlas_height === 8);
  check('poses deduplicated',      info.poses.length === 2);
  check('poses has idle',          info.poses.includes('idle'));
  check('poses has guard',         info.poses.includes('guard'));
  check('palettes deduplicated',   info.palettes.length === 2);
  check('palettes has warm',       info.palettes.includes('warm'));
  check('palettes has cool',       info.palettes.includes('cool'));
  check('entries array present',   Array.isArray(info.entries));
  check('entries length = 3',      info.entries.length === 3);
}

{
  // Empty atlas
  const info = atlasInfo({ uvMap: [], atlasWidth: 0, atlasHeight: 0 });
  check('empty atlas → sprite_count=0', info.sprite_count === 0);
  check('empty atlas → poses=[]',       info.poses.length === 0);
  check('empty atlas → palettes=[]',    info.palettes.length === 0);
}

{
  // Entries without pose/paletteKey are filtered from deduplication lists
  const uvMap = [
    { id: 'x', pose: '', paletteKey: '', x:0, y:0, width:1, height:1 },
  ];
  const info = atlasInfo({ uvMap, atlasWidth: 1, atlasHeight: 1 });
  check('empty pose strings filtered from poses list', info.poses.length === 0);
}

// ── Integration: build atlas from a mini variant set ─────────────────────────

section('atlas_packer — integration');

{
  // Simulate a small 2-pose × 2-palette variant set
  const makeGrid = (bodyIdx) => [
    [0, 1, 1, 0],
    [1, bodyIdx, bodyIdx, 1],
    [1, bodyIdx, bodyIdx, 1],
    [0, 1, 1, 0],
  ];

  const cells = [
    { id: 'idle_warm',  pose: 'idle',  paletteKey: 'warm',  grid: makeGrid(4), palette: PALETTE },
    { id: 'idle_cool',  pose: 'idle',  paletteKey: 'cool',  grid: makeGrid(5), palette: PALETTE },
    { id: 'guard_warm', pose: 'guard', paletteKey: 'warm',  grid: makeGrid(3), palette: PALETTE },
    { id: 'guard_cool', pose: 'guard', paletteKey: 'cool',  grid: makeGrid(6), palette: PALETTE },
  ];

  const result = buildAtlas(cells, { scale: 2 });
  const info   = atlasInfo(result);

  check('4-cell atlas: sprite_count=4',    info.sprite_count === 4);
  check('4-cell atlas: valid PNG',         result.png[0] === 0x89 && result.png[1] === 0x50);
  check('4-cell atlas: all ids in uvMap',  cells.every(c => result.uvMap.some(e => e.id === c.id)));
  check('4-cell atlas: all widths=4',      result.uvMap.every(e => e.width === 4));
  check('4-cell atlas: all heights=4',     result.uvMap.every(e => e.height === 4));
  check('4-cell atlas: rgba size matches', result.rgba.length === result.atlasWidth * 2 * result.atlasHeight * 2 * 4);
}
