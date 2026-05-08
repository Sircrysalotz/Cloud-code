#!/usr/bin/env node
/**
 * Generate golden ASCII test fixtures.
 * Creates a realistic test sprite grid, runs the full cleanup pipeline,
 * saves ASCII output at each pass stage to tests/golden/.
 *
 * Run: node tools/generate_golden.js
 */

import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { makeGrid } from '../src/core/grid.js';
import { IDX } from '../src/core/palette.js';
import { gridToAscii, asciiDump, gridToJSON, asciiDiff } from '../src/core/ascii.js';
import { runCleanup } from '../src/cleanup/index.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(__dir, '../tests/golden');
const exportsDir = join(__dir, '../exports');
mkdirSync(goldenDir, { recursive: true });
mkdirSync(exportsDir, { recursive: true });

const T = IDX.TRANSPARENT;
const O = IDX.OUTLINE;
const X = IDX.SHADOW_DEEP;
const x = IDX.SHADOW;
const o = IDX.MID;
const B = IDX.BRIGHT;
const H = IDX.HIGHLIGHT;
const P = IDX.PEAK;

// Build a 24x24 test sprite: roughly circular blob with shading
function makeTestSprite() {
  const W = 24, H_GRID = 24;
  const g = makeGrid(W, H_GRID, T);
  const cx = 12, cy = 11, r = 9;

  for (let row = 0; row < H_GRID; row++) {
    for (let col = 0; col < W; col++) {
      const dx = col - cx, dy = row - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > r) continue;

      const norm = dist / r; // 0 = center, 1 = edge
      // Shading: center is bright/highlight, edges are dark
      // Light source: upper-left
      const lx = (col - cx) / r, ly = (row - cy) / r;
      const lightDot = -lx * 0.5 - ly * 0.7; // upper-left light
      const shade = (lightDot + 1) / 2; // 0-1

      if (norm > 0.85) {
        g[row][col] = O; // outline ring
      } else if (shade > 0.80) {
        g[row][col] = P;  // peak highlight
      } else if (shade > 0.68) {
        g[row][col] = H;  // highlight
      } else if (shade > 0.52) {
        g[row][col] = B;  // bright
      } else if (shade > 0.38) {
        g[row][col] = o;  // mid
      } else if (shade > 0.22) {
        g[row][col] = x;  // shadow
      } else {
        g[row][col] = X;  // shadow_deep
      }
    }
  }

  // Add a few intentional artifacts for cleanup passes to fix:
  // Orphan stray pixel
  g[2][18] = P;
  // Isolated single-pixel protrusion
  g[11][22] = o;
  // Second disconnected peak cluster
  g[19][4] = P; g[19][5] = P;

  return g;
}

const sprite = makeTestSprite();

// Save pre-cleanup golden
const preAscii = asciiDump(sprite, 'pre-cleanup 24x24');
writeFileSync(join(goldenDir, 'pre_cleanup.txt'), preAscii);
writeFileSync(join(exportsDir, 'test_sprite_pre.json'), gridToJSON(sprite, { label: 'test_sprite_pre', width: 24, height: 24 }));
console.log('Saved: tests/golden/pre_cleanup.txt');
console.log(preAscii);

// Run cleanup
const { grid: cleaned, flags, passResults } = runCleanup(sprite);

// Save post-cleanup golden
const postAscii = asciiDump(cleaned, 'post-cleanup 24x24');
writeFileSync(join(goldenDir, 'post_cleanup.txt'), postAscii);
writeFileSync(join(exportsDir, 'test_sprite_post.json'), gridToJSON(cleaned, { label: 'test_sprite_post', width: 24, height: 24 }));
console.log('\nSaved: tests/golden/post_cleanup.txt');
console.log(postAscii);

// Save diff
const diff = asciiDiff(sprite, cleaned);
writeFileSync(join(goldenDir, 'cleanup_diff.txt'), diff);
console.log('\nDiff (! = changed by cleanup):');
console.log(diff);

// Report diagnostic flags
if (flags.length > 0) {
  console.log('\nDiagnostic flags:');
  for (const f of flags) console.log(' ', f);
}

// Per-pass golden files
for (const p of passResults) {
  const fname = `pass_${p.pass}.txt`;
  writeFileSync(join(goldenDir, fname), asciiDump(p.grid, p.pass));
}
console.log(`\nSaved ${passResults.length} per-pass golden files.`);
console.log('\nAll golden files written. Commit exports/ and tests/golden/ to make results visible from GitHub.');
