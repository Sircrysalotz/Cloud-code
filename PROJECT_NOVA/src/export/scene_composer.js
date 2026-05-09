/**
 * scene_composer.js — Phase 19: Multi-character scene composition.
 *
 * Composes multiple character sprites onto a shared canvas with background.
 * The first step toward game-ready scene content.
 *
 * Scene format:
 * {
 *   width, height,            — canvas dimensions (in grid cells)
 *   background: { r,g,b },   — flat background color
 *   layers: [                 — ordered back-to-front
 *     { grid, palette, x, y, id }
 *   ]
 * }
 *
 * All coordinates are in grid-cell space (not pixels).
 * Scale is applied at export time.
 */

import { gridToRGBA }   from './png_writer.js';
import { encodePNG }    from './png_encoder.js';

// ── Scene builder ─────────────────────────────────────────────────────────────

/**
 * Create a new scene definition.
 *
 * @param {number} width    — canvas width in grid cells
 * @param {number} height   — canvas height in grid cells
 * @param {object} [bg]     — background color {r,g,b} (default: dark gray)
 * @returns {Scene}
 */
export function createScene(width, height, bg = { r: 20, g: 16, b: 28 }) {
  if (width <= 0 || height <= 0) throw new Error('Scene dimensions must be > 0');
  return {
    width,
    height,
    background: { r: bg.r ?? 20, g: bg.g ?? 16, b: bg.b ?? 28 },
    layers: [],
  };
}

/**
 * Add a character sprite to the scene.
 *
 * @param {Scene}       scene
 * @param {Uint8Array[]} grid    — character grid
 * @param {object}      palette — character palette
 * @param {number}      x       — left edge in grid cells
 * @param {number}      y       — top edge in grid cells (0 = top of canvas)
 * @param {string}      [id]    — identifier for this layer
 * @returns {Scene}             — returns same scene for chaining
 */
export function addCharacter(scene, grid, palette, x, y, id = `char_${scene.layers.length}`) {
  scene.layers.push({ grid, palette, x: Math.round(x), y: Math.round(y), id });
  return scene;
}

/**
 * Place two characters facing each other for a battle/interaction scene.
 * Left character is placed at the left third, right character at the right third.
 * Both are bottom-aligned.
 *
 * @param {Scene}        scene
 * @param {Uint8Array[]} gridL    — left character grid
 * @param {object}       palL
 * @param {Uint8Array[]} gridR    — right character grid
 * @param {object}       palR
 * @param {string}       [idL]
 * @param {string}       [idR]
 * @returns {Scene}
 */
export function addBattleLayout(scene, gridL, palL, gridR, palR, idL = 'left', idR = 'right') {
  const W = scene.width, H = scene.height;
  const lW = gridL[0]?.length ?? 0, lH = gridL.length;
  const rW = gridR[0]?.length ?? 0, rH = gridR.length;

  // Bottom-align: y = H - spriteHeight
  const yL = Math.max(0, H - lH);
  const yR = Math.max(0, H - rH);

  // Horizontal: left char at W/6, right char at W - rW - W/6 (mirror)
  const xL = Math.round(W / 6);
  const xR = Math.round(W - rW - W / 6);

  addCharacter(scene, gridL, palL, xL, yL, idL);
  addCharacter(scene, gridR, palR, xR, yR, idR);
  return scene;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/**
 * Render a scene to a flat RGBA Uint8Array.
 *
 * @param {Scene}  scene
 * @param {number} scale   — pixel scale factor
 * @returns {Uint8Array}   — RGBA bytes (width*scale × height*scale × 4)
 */
export function renderSceneRGBA(scene, scale = 1) {
  const W = scene.width  * scale;
  const H = scene.height * scale;
  const rgba = new Uint8Array(W * H * 4);

  // Fill background
  const { r: br, g: bg, b: bb } = scene.background;
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4]     = br;
    rgba[i * 4 + 1] = bg;
    rgba[i * 4 + 2] = bb;
    rgba[i * 4 + 3] = 255;
  }

  // Blit each layer
  for (const layer of scene.layers) {
    const { grid, palette, x: lx, y: ly } = layer;
    const lW = (grid[0]?.length ?? 0) * scale;
    const lH = grid.length * scale;
    const cellRGBA = gridToRGBA(grid, palette, scale);

    for (let py = 0; py < lH; py++) {
      for (let px = 0; px < lW; px++) {
        const si = (py * lW + px) * 4;
        // Skip transparent pixels (a=0)
        if (cellRGBA[si + 3] === 0) continue;

        const dx = lx * scale + px;
        const dy = ly * scale + py;
        if (dx < 0 || dx >= W || dy < 0 || dy >= H) continue;

        const di = (dy * W + dx) * 4;
        rgba[di]     = cellRGBA[si];
        rgba[di + 1] = cellRGBA[si + 1];
        rgba[di + 2] = cellRGBA[si + 2];
        rgba[di + 3] = 255;
      }
    }
  }

  return rgba;
}

/**
 * Render a scene to a PNG Uint8Array.
 *
 * @param {Scene}  scene
 * @param {number} [scale]
 * @returns {Uint8Array} — PNG bytes
 */
export function renderScenePNG(scene, scale = 4) {
  const W     = scene.width  * scale;
  const H     = scene.height * scale;
  const rgba  = renderSceneRGBA(scene, scale);
  return encodePNG(rgba, W, H);
}

/**
 * Build an AI-readable JSON description of the scene layout.
 *
 * @param {Scene}  scene
 * @returns {object}
 */
export function sceneToJSON(scene) {
  return {
    width:      scene.width,
    height:     scene.height,
    background: scene.background,
    layer_count: scene.layers.length,
    layers: scene.layers.map(l => ({
      id:      l.id,
      x:       l.x,
      y:       l.y,
      width:   l.grid[0]?.length ?? 0,
      height:  l.grid.length,
      bounds:  {
        left:   l.x,
        right:  l.x + (l.grid[0]?.length ?? 0),
        top:    l.y,
        bottom: l.y + l.grid.length,
      },
    })),
  };
}

/**
 * Check whether two layers overlap (bounding-box test).
 *
 * @param {Layer} a
 * @param {Layer} b
 * @returns {boolean}
 */
export function layersOverlap(a, b) {
  const aR = a.x + (a.grid[0]?.length ?? 0);
  const aB = a.y + a.grid.length;
  const bR = b.x + (b.grid[0]?.length ?? 0);
  const bB = b.y + b.grid.length;
  return a.x < bR && aR > b.x && a.y < bB && aB > b.y;
}

/**
 * Automatically compute a canvas size that fits all given sprite layouts.
 * Adds padding around all sprites.
 *
 * @param {{ grid, x, y }[]} placements
 * @param {number}           [padding]    — cells of padding on each side (default 4)
 * @returns {{ width, height }}
 */
export function autoCanvasSize(placements, padding = 4) {
  if (placements.length === 0) return { width: 32, height: 40 };
  let maxR = 0, maxB = 0;
  for (const { grid, x, y } of placements) {
    maxR = Math.max(maxR, x + (grid[0]?.length ?? 0));
    maxB = Math.max(maxB, y + grid.length);
  }
  return {
    width:  maxR + padding,
    height: maxB + padding,
  };
}
