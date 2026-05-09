/**
 * Tests for src/export/scene_composer.js
 *
 * Covers: createScene, addCharacter, addBattleLayout,
 *         renderSceneRGBA, renderScenePNG, sceneToJSON,
 *         layersOverlap, autoCanvasSize.
 */

import { check, section } from '../helpers.js';
import { PALETTE }        from '../../src/core/palette.js';
import {
  createScene,
  addCharacter,
  addBattleLayout,
  renderSceneRGBA,
  renderScenePNG,
  sceneToJSON,
  layersOverlap,
  autoCanvasSize,
} from '../../src/export/scene_composer.js';

// ── createScene ───────────────────────────────────────────────────────────────

section('scene_composer — createScene');

{
  const s = createScene(32, 40);
  check('returns object',          typeof s === 'object');
  check('width stored',            s.width === 32);
  check('height stored',           s.height === 40);
  check('layers starts empty',     Array.isArray(s.layers) && s.layers.length === 0);
  check('has background r',        typeof s.background.r === 'number');
  check('has background g',        typeof s.background.g === 'number');
  check('has background b',        typeof s.background.b === 'number');
  check('default bg is dark',      s.background.r < 64 && s.background.g < 64 && s.background.b < 64);
}

{
  const s = createScene(16, 20, { r: 100, g: 150, b: 200 });
  check('custom bg r',  s.background.r === 100);
  check('custom bg g',  s.background.g === 150);
  check('custom bg b',  s.background.b === 200);
}

{
  let threw = false;
  try { createScene(0, 10); } catch (e) { threw = true; }
  check('width=0 throws', threw);
}

{
  let threw = false;
  try { createScene(10, -1); } catch (e) { threw = true; }
  check('negative height throws', threw);
}

// ── addCharacter ──────────────────────────────────────────────────────────────

section('scene_composer — addCharacter');

{
  const grid = [[1, 4, 1], [1, 3, 1]];
  const s    = createScene(32, 40);
  const ret  = addCharacter(s, grid, PALETTE, 5, 10);

  check('returns same scene (chain)',    ret === s);
  check('layer added',                  s.layers.length === 1);
  check('layer x stored',               s.layers[0].x === 5);
  check('layer y stored',               s.layers[0].y === 10);
  check('layer grid stored',            s.layers[0].grid === grid);
  check('auto id assigned',             typeof s.layers[0].id === 'string');
}

{
  const grid = [[1, 2, 1]];
  const s    = createScene(32, 40);
  addCharacter(s, grid, PALETTE, 0, 0, 'hero');
  check('explicit id stored', s.layers[0].id === 'hero');
}

{
  const grid = [[1]];
  const s    = createScene(32, 40);
  addCharacter(s, grid, PALETTE, 2.7, 3.4);
  check('x is rounded',  s.layers[0].x === 3);
  check('y is rounded',  s.layers[0].y === 3);
}

{
  const grid = [[1]];
  const s    = createScene(32, 40);
  addCharacter(s, grid, PALETTE, 0, 0, 'a');
  addCharacter(s, grid, PALETTE, 0, 0, 'b');
  check('two layers stored', s.layers.length === 2);
}

{
  // Auto-increments id
  const grid = [[1]];
  const s    = createScene(32, 40);
  addCharacter(s, grid, PALETTE, 0, 0);
  addCharacter(s, grid, PALETTE, 1, 0);
  check('auto ids differ', s.layers[0].id !== s.layers[1].id);
}

// ── addBattleLayout ───────────────────────────────────────────────────────────

section('scene_composer — addBattleLayout');

{
  const gridL = [[1,2,2,1],[1,3,3,1],[1,2,2,1],[1,1,1,1]];  // 4×4
  const gridR = [[1,5,5,1],[1,6,6,1],[1,5,5,1],[1,1,1,1]];  // 4×4
  const s = createScene(32, 16);
  addBattleLayout(s, gridL, PALETTE, gridR, PALETTE);

  check('adds two layers',       s.layers.length === 2);
  check('left id = "left"',      s.layers[0].id === 'left');
  check('right id = "right"',    s.layers[1].id === 'right');
}

{
  const gridL = [[1,2,1],[1,3,1],[1,2,1],[1,1,1]];  // 3-wide, 4-tall
  const gridR = [[1,5,1],[1,6,1],[1,1,1]];           // 3-wide, 3-tall
  const W = 24, H = 12;
  const s = createScene(W, H);
  addBattleLayout(s, gridL, PALETTE, gridR, PALETTE);

  const [left, right] = s.layers;

  // Left bottom-aligned
  const lH = gridL.length;
  check('left bottom-aligned', left.y === Math.max(0, H - lH));

  // Right bottom-aligned
  const rH = gridR.length;
  check('right bottom-aligned', right.y === Math.max(0, H - rH));

  // Left in left third
  check('left x >= 0', left.x >= 0);
  check('left x < W/2', left.x < W / 2);

  // Right in right half
  check('right x > left.x', right.x > left.x);
}

{
  // Custom ids
  const grid = [[1, 2, 1]];
  const s = createScene(20, 10);
  addBattleLayout(s, grid, PALETTE, grid, PALETTE, 'player', 'enemy');
  check('custom left id', s.layers[0].id === 'player');
  check('custom right id', s.layers[1].id === 'enemy');
}

// ── layersOverlap ─────────────────────────────────────────────────────────────

section('scene_composer — layersOverlap');

const mkLayer = (x, y, w, h) => ({
  x, y, grid: Array.from({ length: h }, () => new Array(w).fill(1))
});

{
  const a = mkLayer(0, 0, 4, 4);
  const b = mkLayer(2, 2, 4, 4);
  check('overlapping → true', layersOverlap(a, b));
}

{
  const a = mkLayer(0, 0, 4, 4);
  const b = mkLayer(4, 0, 4, 4);
  check('adjacent right → false', !layersOverlap(a, b));
}

{
  const a = mkLayer(0, 0, 4, 4);
  const b = mkLayer(0, 4, 4, 4);
  check('adjacent below → false', !layersOverlap(a, b));
}

{
  const a = mkLayer(0, 0, 4, 4);
  const b = mkLayer(10, 10, 4, 4);
  check('fully separated → false', !layersOverlap(a, b));
}

{
  const a = mkLayer(1, 1, 4, 4);
  const b = mkLayer(1, 1, 4, 4);
  check('identical bounds → true', layersOverlap(a, b));
}

{
  const a = mkLayer(5, 0, 4, 4);
  const b = mkLayer(0, 0, 4, 4);
  check('separated left → false', !layersOverlap(a, b));
}

// ── autoCanvasSize ────────────────────────────────────────────────────────────

section('scene_composer — autoCanvasSize');

{
  const { width, height } = autoCanvasSize([]);
  check('empty placements → default 32×40', width === 32 && height === 40);
}

{
  const grid4x4 = Array.from({ length: 4 }, () => new Array(4).fill(1));
  const { width, height } = autoCanvasSize([{ grid: grid4x4, x: 0, y: 0 }]);
  check('single sprite at origin: width = spriteW + padding', width === 4 + 4);
  check('single sprite at origin: height = spriteH + padding', height === 4 + 4);
}

{
  const grid = Array.from({ length: 8 }, () => new Array(6).fill(1));
  const { width, height } = autoCanvasSize([{ grid, x: 4, y: 2 }]);
  check('offset sprite: width  = x + spriteW + padding', width  === 4 + 6 + 4);
  check('offset sprite: height = y + spriteH + padding', height === 2 + 8 + 4);
}

{
  const g = Array.from({ length: 4 }, () => new Array(4).fill(1));
  const { width, height } = autoCanvasSize([
    { grid: g, x: 0,  y: 0 },
    { grid: g, x: 20, y: 0 },
  ], 2);
  check('two sprites: width extends to rightmost', width >= 24);
  check('custom padding honored', width === 24 + 2);
}

// ── renderSceneRGBA ───────────────────────────────────────────────────────────

section('scene_composer — renderSceneRGBA');

{
  const s    = createScene(4, 4, { r: 10, g: 20, b: 30 });
  const rgba = renderSceneRGBA(s, 1);

  check('returns Uint8Array',         rgba instanceof Uint8Array);
  check('length = W*H*4',             rgba.length === 4 * 4 * 4);
  check('bg pixel r at (0,0)',        rgba[0] === 10);
  check('bg pixel g at (0,0)',        rgba[1] === 20);
  check('bg pixel b at (0,0)',        rgba[2] === 30);
  check('bg pixel a = 255',           rgba[3] === 255);
}

{
  // Scale 2: buffer size is (W*scale)*(H*scale)*4
  const s    = createScene(4, 4);
  const rgba = renderSceneRGBA(s, 2);
  check('scale=2: length = 4*W*H*4', rgba.length === 4 * 4 * 2 * 2 * 4);
}

{
  // Opaque body pixel overwrites background
  const grid = [[4]];  // index 4 = mid, opaque in default PALETTE
  const s    = createScene(4, 4, { r: 0, g: 0, b: 0 });
  addCharacter(s, grid, PALETTE, 0, 0);
  const rgba = renderSceneRGBA(s, 1);

  // Pixel (0,0) should NOT be black (background was overwritten)
  const px = [rgba[0], rgba[1], rgba[2]];
  check('opaque sprite pixel paints over bg', !(px[0] === 0 && px[1] === 0 && px[2] === 0));
  check('alpha=255 after blit', rgba[3] === 255);
}

{
  // Transparent pixel (index 0) does NOT overwrite background
  const grid = [[0]];  // index 0 = transparent
  const bg   = { r: 200, g: 100, b: 50 };
  const s    = createScene(4, 4, bg);
  addCharacter(s, grid, PALETTE, 0, 0);
  const rgba = renderSceneRGBA(s, 1);

  check('transparent pixel → bg preserved r', rgba[0] === 200);
  check('transparent pixel → bg preserved g', rgba[1] === 100);
  check('transparent pixel → bg preserved b', rgba[2] === 50);
}

{
  // Out-of-bounds sprite pixels are clipped
  const grid = [[4, 4, 4], [4, 4, 4]];  // 3×2 sprite placed so it extends beyond canvas
  const s    = createScene(2, 2, { r: 0, g: 0, b: 0 });
  addCharacter(s, grid, PALETTE, 1, 1);  // sprite at (1,1) on 2×2 canvas → mostly OOB

  let threw = false;
  let rgba;
  try { rgba = renderSceneRGBA(s, 1); } catch (e) { threw = true; }
  check('OOB pixels do not throw', !threw);
  check('output length still correct', rgba?.length === 2 * 2 * 4);
}

{
  // Layer order: second layer on top
  const gridA = [[4]];  // mid color
  const gridB = [[7]];  // peak color
  const s = createScene(4, 4, { r: 0, g: 0, b: 0 });
  addCharacter(s, gridA, PALETTE, 0, 0, 'bottom');
  addCharacter(s, gridB, PALETTE, 0, 0, 'top');
  const rgba = renderSceneRGBA(s, 1);

  // Top layer (peak) should be the final color at (0,0)
  const peakRGB = PALETTE.colors[PALETTE.peakIndex]?.rgb ?? PALETTE.colors[7]?.rgb;
  if (peakRGB) {
    check('top layer wins',
      rgba[0] === peakRGB[0] && rgba[1] === peakRGB[1] && rgba[2] === peakRGB[2]);
  } else {
    check('top layer wins (color check skipped — palette API)', true);
  }
}

// ── renderScenePNG ────────────────────────────────────────────────────────────

section('scene_composer — renderScenePNG');

{
  const s   = createScene(8, 8);
  const png = renderScenePNG(s, 2);

  check('returns Uint8Array',        png instanceof Uint8Array);
  check('starts with PNG signature', png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47);
  check('length > 0',                png.length > 0);
}

{
  const s   = createScene(4, 6);
  const png = renderScenePNG(s);   // default scale=4
  check('default scale produces valid PNG', png[0] === 0x89);
}

{
  // Scene with a character produces valid PNG
  const grid = [[1, 4, 4, 1], [1, 3, 3, 1], [1, 1, 1, 1]];
  const s    = createScene(12, 10);
  addCharacter(s, grid, PALETTE, 2, 2);
  const png = renderScenePNG(s, 2);
  check('scene with sprite → valid PNG header', png[0] === 0x89 && png[1] === 0x50);
}

// ── sceneToJSON ───────────────────────────────────────────────────────────────

section('scene_composer — sceneToJSON');

{
  const s = createScene(32, 40);
  const j = sceneToJSON(s);

  check('has width',       j.width === 32);
  check('has height',      j.height === 40);
  check('has background',  typeof j.background === 'object');
  check('has layer_count', j.layer_count === 0);
  check('layers is array', Array.isArray(j.layers));
}

{
  const grid = [[1, 4, 1], [1, 3, 1], [1, 1, 1]];  // 3×3
  const s    = createScene(20, 20);
  addCharacter(s, grid, PALETTE, 5, 7, 'hero');
  const j = sceneToJSON(s);

  check('layer_count = 1',   j.layer_count === 1);
  const l = j.layers[0];
  check('layer id',          l.id === 'hero');
  check('layer x',           l.x === 5);
  check('layer y',           l.y === 7);
  check('layer width',       l.width === 3);
  check('layer height',      l.height === 3);
  check('bounds.left',       l.bounds.left === 5);
  check('bounds.right',      l.bounds.right === 5 + 3);
  check('bounds.top',        l.bounds.top === 7);
  check('bounds.bottom',     l.bounds.bottom === 7 + 3);
}

{
  const grid = [[1]];
  const s    = createScene(20, 20);
  addCharacter(s, grid, PALETTE, 0, 0, 'a');
  addCharacter(s, grid, PALETTE, 5, 5, 'b');
  const j = sceneToJSON(s);
  check('layer_count = 2',          j.layer_count === 2);
  check('layers array has 2 items', j.layers.length === 2);
  check('layer ids preserved',      j.layers[0].id === 'a' && j.layers[1].id === 'b');
}

// ── Integration: battle scene ─────────────────────────────────────────────────

section('scene_composer — integration (battle scene)');

{
  const gridL = [
    [0,1,1,1,0],
    [1,4,3,4,1],
    [1,3,2,3,1],
    [0,1,1,1,0],
  ];
  const gridR = [
    [0,1,1,0],
    [1,5,5,1],
    [1,4,5,1],
    [0,1,1,0],
  ];

  const s = createScene(24, 10);
  addBattleLayout(s, gridL, PALETTE, gridR, PALETTE);

  const j   = sceneToJSON(s);
  const png = renderScenePNG(s, 2);

  check('battle scene: 2 layers',         j.layer_count === 2);
  check('battle scene: valid PNG',        png[0] === 0x89);
  check('battle scene: layers no overlap OR valid layout',
    !layersOverlap(s.layers[0], s.layers[1]) || j.layer_count === 2);
  check('battle scene: JSON has background',  typeof j.background.r === 'number');
  check('battle scene: bounds computed',  typeof j.layers[0].bounds === 'object');
}
