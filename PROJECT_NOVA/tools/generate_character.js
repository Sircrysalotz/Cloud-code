#!/usr/bin/env node
/**
 * Procedural crimson warrior sprite generator.
 *
 * Constructs a standing humanoid via body-part rectangles + gradient shading,
 * then runs the cleanup pipeline, targeting reference metrics from the Goku
 * sprite sheet analysis:
 *   shadow_deep ≈ 0.30  shadow ≈ 0.18  mid ≈ 0.35
 *   bright ≈ 0.04       highlight ≈ 0.06  peak ≈ 0.07
 */

import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath }            from 'url';
import { dirname, join }            from 'path';
import { makeGrid, cloneGrid }      from '../src/core/grid.js';
import { IDX, PALETTE }             from '../src/core/palette.js';
import { asciiDump }                from '../src/core/ascii.js';
import { runCleanup }               from '../src/cleanup/index.js';
import { gridToPNG }                from '../src/export/png_writer.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT   = join(__dir, '..', 'exports');
mkdirSync(OUT, { recursive: true });

const W = 24;
const H = 40;
const T  = IDX.TRANSPARENT;
const OL = IDX.OUTLINE;
const SD = IDX.SHADOW_DEEP;
const SH = IDX.SHADOW;
const MI = IDX.MID;
const BR = IDX.BRIGHT;
const HI = IDX.HIGHLIGHT;
const PK = IDX.PEAK;

// ── Gradient shading ─────────────────────────────────────────────────────────
// t ∈ [0,1]: 0 = shadow side (left), 1 = lit side (right)
// Tuned to match reference: SD≈0.30 SH≈0.18 MI≈0.35 BR≈0.04 HI≈0.06 PK≈0.07
function warmGradient(t) {
  if (t < 0.28) return SD;
  if (t < 0.46) return SH;
  if (t < 0.82) return MI;
  if (t < 0.86) return BR;
  if (t < 0.93) return HI;
  return PK;
}

// ── Body-part fill ────────────────────────────────────────────────────────────
// Fill a rectangular region with the gradient shading function.
// colBias shifts the horizontal gradient (negative = more shadow, positive = more lit).
function fillRegion(grid, r0, r1, c0, c1, gradFn = warmGradient, colBias = 0) {
  const span = c1 - c0;
  if (span <= 0) return;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c < c1; c++) {
      const t = Math.max(0, Math.min(1, (c - c0) / span + colBias));
      grid[r][c] = gradFn(t);
    }
  }
}

// ── Outline pass ──────────────────────────────────────────────────────────────
// Wrap all non-transparent body pixels with outline (1px, 4-connected).
function addOutline(grid) {
  const g = cloneGrid(grid);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (grid[r][c] === T) {
        // If any 4-neighbor is non-transparent, place outline here
        const neighbors = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]];
        if (neighbors.some(([nr,nc]) =>
          nr >= 0 && nr < H && nc >= 0 && nc < W && grid[nr][nc] !== T
        )) {
          g[r][c] = OL;
        }
      }
    }
  }
  return g;
}

// ── Build character ───────────────────────────────────────────────────────────
function buildWarrior() {
  let g = makeGrid(W, H, T);

  // HEAD (rows 2–7, cols 9–14 interior = 6px wide)
  // Slightly darker on left (shadow_deep) → golden peak on right edge
  fillRegion(g, 2, 7, 9, 15, warmGradient);

  // NECK (rows 8–9, cols 10–13 interior = 4px wide)
  fillRegion(g, 8, 9, 10, 14, warmGradient, -0.05); // slightly darker

  // TORSO (rows 10–19, cols 7–16 = 10px wide)
  fillRegion(g, 10, 19, 7, 17, warmGradient);

  // LEFT ARM (rows 10–17, cols 4–7 = 4px wide, more shadowed)
  fillRegion(g, 10, 17, 4, 8, warmGradient, -0.15); // bias toward shadow

  // RIGHT ARM (rows 10–17, cols 17–20 = 4px wide, more lit)
  fillRegion(g, 10, 17, 17, 21, warmGradient, 0.15); // bias toward lit

  // HIPS (rows 20–21, cols 8–15 = 8px wide, slightly narrower than torso)
  fillRegion(g, 20, 21, 8, 16, warmGradient);

  // LEFT LEG (rows 22–37, cols 6–10 = 5px wide, shadowed side)
  fillRegion(g, 22, 37, 6, 11, warmGradient, -0.10);

  // RIGHT LEG (rows 22–37, cols 13–17 = 5px wide, lit side)
  fillRegion(g, 22, 37, 13, 18, warmGradient, 0.10);

  // FEET / BOOTS (rows 38–39, cols 5–11 and 12–18)
  fillRegion(g, 38, 39, 5, 11, (t) => t < 0.6 ? SD : SH); // dark boots
  fillRegion(g, 38, 39, 12, 18, (t) => t < 0.4 ? SH : MI);

  // Add hair detail on top of head (rows 0–1, cols 9–15)
  fillRegion(g, 0, 1, 9, 16, (t) => t < 0.3 ? SD : (t < 0.6 ? SH : MI));

  // Shoulder pads — bright highlight on shoulder joints
  for (const [r, c] of [[10,6],[10,7],[10,20],[10,21]]) {
    if (r < H && c < W) g[r][c] = HI;
  }
  // Knee highlights
  for (const [r, c] of [[30,8],[30,9],[30,13],[30,14]]) {
    if (r < H && c < W) g[r][c] = HI;
  }
  // Peak specular on chest center and top of head
  for (const [r, c] of [[3,14],[4,14],[11,16],[12,16]]) {
    if (r < H && c < W) g[r][c] = PK;
  }

  // Wrap with 1px outline
  g = addOutline(g);

  return g;
}

// ── Metrics ──────────────────────────────────────────────────────────────────
function computeMetrics(g) {
  const counts = new Array(8).fill(0);
  for (const row of g) for (const v of row) counts[v]++;
  const body = counts.slice(2).reduce((a, b) => a + b, 0);
  const outline = counts[1];
  const names = ['transparent','outline','shadow_deep','shadow','mid','bright','highlight','peak'];
  const ratios = {};
  for (let i = 2; i <= 7; i++) ratios[names[i]] = (counts[i] / Math.max(body, 1)).toFixed(3);
  return { body, outline, counts, ratios };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const gridPre = buildWarrior();

console.log('\n=== PRE-CLEANUP ===');
console.log(asciiDump(gridPre, 'warrior_pre'));
const mPre = computeMetrics(gridPre);
console.log('Body:', mPre.body, '| Outline:', mPre.outline);
console.log('Ratios:', mPre.ratios);

const { grid: gridPost, flags } = runCleanup(gridPre);

console.log('\n=== POST-CLEANUP ===');
console.log(asciiDump(gridPost, 'warrior_post'));
const mPost = computeMetrics(gridPost);
console.log('Body:', mPost.body, '| Outline:', mPost.outline);
console.log('Ratios:', mPost.ratios);
if (flags.length) console.log('Cleanup flags:', flags);

// ── Reference comparison ──────────────────────────────────────────────────────
const TARGETS = {
  shadow_deep: 0.30, shadow: 0.18, mid: 0.35,
  bright: 0.04, highlight: 0.06, peak: 0.07,
};
console.log('\n=== Reference comparison (post-cleanup, tolerance ±0.10) ===');
for (const [k, target] of Object.entries(TARGETS)) {
  const actual = parseFloat(mPost.ratios[k] || 0);
  const delta  = (actual - target).toFixed(3);
  const ok     = Math.abs(actual - target) < 0.10 ? '✓' : '✗';
  console.log(`  ${ok} ${k.padEnd(12)} actual=${actual.toFixed(3)} target=${target.toFixed(3)} Δ=${delta}`);
}

// ── Export ────────────────────────────────────────────────────────────────────
const SCALE = 8;
writeFileSync(join(OUT, 'warrior_pre.png'),  gridToPNG(gridPre,  PALETTE, SCALE));
writeFileSync(join(OUT, 'warrior_post.png'), gridToPNG(gridPost, PALETTE, SCALE));

function toJSON(g, id, isPost) {
  const m = computeMetrics(g);
  return JSON.stringify({
    id, source: 'procedural', quality: 'reference_matched',
    tags: ['warrior', 'humanoid', 'standing', 'crimson'],
    width: W, height: H, data: g,
    metrics: {
      width: W, height: H, total_pixels: W * H,
      body_count: m.body, outline_count: m.outline,
      ...Object.fromEntries(
        Object.entries(m.ratios).map(([k, v]) => [`${k}_ratio`, parseFloat(v)])
      ),
      post_cleanup: isPost,
    },
  }, null, 2);
}
writeFileSync(join(OUT, 'warrior_pre.json'),  toJSON(gridPre,  'warrior_pre',  false));
writeFileSync(join(OUT, 'warrior_post.json'), toJSON(gridPost, 'warrior_post', true));

console.log(`\nSaved (${W * SCALE}×${H * SCALE}px):`);
console.log('  exports/warrior_pre.png  exports/warrior_post.png');
console.log('  exports/warrior_pre.json  exports/warrior_post.json');
