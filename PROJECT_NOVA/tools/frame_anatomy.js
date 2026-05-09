#!/usr/bin/env node
/**
 * frame_anatomy.js — Extract pixel-level anatomy from ingested Goku frames.
 *
 * Analyzes the batch frames to build an AI-readable anatomy map: where each
 * body region lives in pixel coordinates, what colors dominate each region,
 * and how stable each region is across frames.
 *
 * This is the foundation for creating new characters — once you know WHERE
 * Goku's hair / torso / arms / legs are in pixel space, you can reposition
 * those regions to define a new character's anatomy.
 *
 * Usage:
 *   node tools/frame_anatomy.js                      # analyze all frames
 *   node tools/frame_anatomy.js --frame=4            # single frame detail
 *   node tools/frame_anatomy.js --ascii              # ASCII map of stable pixels
 *   node tools/frame_anatomy.js --stability          # stability map
 *
 * Output:
 *   exports/anatomy.json   — full anatomy data
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { paletteFromRGB } from '../src/core/palette.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const BATCH = join(__dir, '..', 'exports', 'batch');
const OUT   = join(__dir, '..', 'exports');

const args      = process.argv.slice(2);
const showAscii = args.includes('--ascii');
const showStab  = args.includes('--stability');
const singleArg = args.find(a => a.startsWith('--frame='))?.slice(8);

// ── Load all frames ───────────────────────────────────────────────────────────
const gridFiles = readdirSync(BATCH)
  .filter(f => f.match(/^frame_\d{4}_grid\.json$/))
  .sort();

const targets = singleArg
  ? [`frame_${String(singleArg).padStart(4,'0')}_grid.json`]
  : gridFiles;

console.log(`\nAnalyzing ${targets.length} frame(s)...\n`);

// Find max canvas size across all frames
let maxW = 0, maxH = 0;
const frames = [];

for (const gf of targets) {
  const fid      = gf.match(/frame_(\d{4})_grid/)[1];
  const palPath  = join(BATCH, `frame_${fid}_palette.json`);
  if (!existsSync(palPath)) continue;

  const gd  = JSON.parse(readFileSync(join(BATCH, gf), 'utf8'));
  const pd  = JSON.parse(readFileSync(palPath, 'utf8'));
  const pal = paletteFromRGB(pd);

  maxW = Math.max(maxW, gd.width);
  maxH = Math.max(maxH, gd.height);

  // Build normalized grid: row-by-row pixel values
  const data = gd.data.map(row => Array.isArray(row) ? [...row] : Object.values(row).map(Number));

  // Compute bounding box of non-transparent pixels
  let minR = gd.height, maxR = 0, minC = gd.width, maxC = 0;
  let bodyCount = 0;
  for (let r = 0; r < gd.height; r++) {
    for (let c = 0; c < gd.width; c++) {
      if (data[r][c] !== 0) {
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
        if (data[r][c] !== pal.outlineIndex) bodyCount++;
      }
    }
  }

  // Divide body into vertical zones (normalized 0-1 relative to bounding box)
  const bodyH = maxR - minR + 1;
  const bodyW = maxC - minC + 1;

  // Count pixels in each vertical zone (6 zones: hair, head, neck/shoulder, torso, hips/thigh, lower leg/foot)
  const ZONES = ['hair', 'head', 'shoulder', 'torso', 'hips', 'feet'];
  const zoneCounts = ZONES.map(() => ({ body: 0, outline: 0, darkest: 0, brightest: 0 }));
  const zoneN = ZONES.length;

  for (let r = minR; r <= maxR; r++) {
    const t   = (r - minR) / Math.max(bodyH - 1, 1);
    const zi  = Math.min(Math.floor(t * zoneN), zoneN - 1);
    for (let c = minC; c <= maxC; c++) {
      const v = data[r][c];
      if (v === 0) continue;
      if (v === pal.outlineIndex) { zoneCounts[zi].outline++; continue; }
      zoneCounts[zi].body++;
      const band = pal.bandLevel(v);
      const nb   = pal.bodyIndices.length;
      if (band < nb * 0.3) zoneCounts[zi].darkest++;
      if (band > nb * 0.7) zoneCounts[zi].brightest++;
    }
  }

  // Luminance centroid: row and column weighted by brightness
  let weightedRow = 0, weightedCol = 0, totalWeight = 0;
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const v = data[r][c];
      if (v === 0 || v === pal.outlineIndex) continue;
      const w = pal.bandLevel(v) + 1;
      weightedRow += r * w; weightedCol += c * w; totalWeight += w;
    }
  }
  const lumCentroid = totalWeight > 0
    ? { row: weightedRow / totalWeight, col: weightedCol / totalWeight }
    : null;

  frames.push({
    id: fid, width: gd.width, height: gd.height, data, palette: pal,
    bodyCount, bbox: { minR, maxR, minC, maxC, bodyH, bodyW },
    zones: ZONES.map((name, i) => ({ name, ...zoneCounts[i] })),
    lumCentroid,
    accuracy: gd.accuracy?.exact_pct ?? 100,
  });
}

// ── Stability map (pixels always present across all frames) ───────────────────
// Align all frames to a common top-left (0,0) and count presence at each cell

const presenceMap = [];  // presenceMap[r][c] = count of frames where this pixel is non-transparent
for (let r = 0; r < maxH; r++) {
  presenceMap.push(new Float32Array(maxW));
}

for (const f of frames) {
  const { minR, minC } = f.bbox;
  for (let r = 0; r < f.height; r++) {
    for (let c = 0; c < f.width; c++) {
      if (f.data[r][c] !== 0) {
        presenceMap[r][c]++;
      }
    }
  }
}

const n = frames.length;
// Normalize to 0-1
for (let r = 0; r < maxH; r++)
  for (let c = 0; c < maxW; c++)
    presenceMap[r][c] /= n;

// Find stable core (always present in >80% of frames)
const STABLE_THRESHOLD = 0.8;
let stablePixels = 0, totalCovered = 0;
for (let r = 0; r < maxH; r++)
  for (let c = 0; c < maxW; c++) {
    if (presenceMap[r][c] > 0) totalCovered++;
    if (presenceMap[r][c] >= STABLE_THRESHOLD) stablePixels++;
  }

// ── Per-frame detail (single frame mode) ─────────────────────────────────────
if (singleArg && frames.length === 1) {
  const f = frames[0];
  console.log(`Frame ${f.id}:  ${f.width}×${f.height}  body=${f.bodyCount}  acc=${f.accuracy}%`);
  console.log(`Bounding box: rows ${f.bbox.minR}-${f.bbox.maxR}  cols ${f.bbox.minC}-${f.bbox.maxC}`);
  console.log(`Body size: ${f.bbox.bodyW}×${f.bbox.bodyH}`);
  if (f.lumCentroid) {
    console.log(`Luminance centroid: row=${f.lumCentroid.row.toFixed(1)}  col=${f.lumCentroid.col.toFixed(1)}`);
  }
  console.log('\nVertical zones (body pixel counts):');
  for (const z of f.zones) {
    const total = z.body + z.outline;
    const darkPct  = total > 0 ? (z.darkest  / z.body * 100).toFixed(0) : 0;
    const brightPct = total > 0 ? (z.brightest / z.body * 100).toFixed(0) : 0;
    console.log(
      `  ${z.name.padEnd(10)}  body=${String(z.body).padStart(4)}  outline=${String(z.outline).padStart(4)}` +
      `  dark=${darkPct}%  bright=${brightPct}%`
    );
  }
}

// ── Summary across all frames ─────────────────────────────────────────────────
console.log(`\nCanvas bounds:  ${maxW}×${maxH}`);
console.log(`Stable pixels (≥80% presence): ${stablePixels} of ${totalCovered} covered cells (${(stablePixels/Math.max(totalCovered,1)*100).toFixed(1)}%)`);

if (frames.length > 1) {
  // Average zone distribution
  const zoneNames = frames[0].zones.map(z => z.name);
  const avgZones = zoneNames.map((name, i) => {
    const avg = v => frames.reduce((s, f) => s + (f.zones[i]?.[v] ?? 0), 0) / frames.length;
    return { name, body: avg('body'), outline: avg('outline'), darkest: avg('darkest'), brightest: avg('brightest') };
  });

  console.log('\nAverage pixel count per vertical zone across all frames:');
  for (const z of avgZones) {
    const total = z.body + z.outline;
    const darkPct   = z.body > 0 ? (z.darkest   / z.body * 100).toFixed(0) : 0;
    const brightPct = z.body > 0 ? (z.brightest / z.body * 100).toFixed(0) : 0;
    console.log(
      `  ${z.name.padEnd(10)}  body=${z.body.toFixed(0).padStart(4)}  outline=${z.outline.toFixed(0).padStart(4)}` +
      `  dark=${darkPct}%  bright=${brightPct}%`
    );
  }
}

// ── Stability ASCII map ───────────────────────────────────────────────────────
if (showStab || showAscii) {
  console.log('\nStability map (how often each cell is occupied):');
  console.log('  @ = always  * = often  o = sometimes  . = rarely/never\n');

  // Find active bounds
  let sMinR = maxH, sMaxR = 0, sMinC = maxW, sMaxC = 0;
  for (let r = 0; r < maxH; r++)
    for (let c = 0; c < maxW; c++)
      if (presenceMap[r][c] > 0.05) {
        sMinR = Math.min(sMinR, r); sMaxR = Math.max(sMaxR, r);
        sMinC = Math.min(sMinC, c); sMaxC = Math.max(sMaxC, c);
      }

  for (let r = sMinR; r <= sMaxR; r++) {
    let row = '  ';
    for (let c = sMinC; c <= sMaxC; c++) {
      const p = presenceMap[r][c];
      if (p >= 0.95) row += '@';
      else if (p >= 0.70) row += '*';
      else if (p >= 0.30) row += 'o';
      else if (p >= 0.05) row += '.';
      else row += ' ';
    }
    console.log(row);
  }
}

// ── Save anatomy JSON ─────────────────────────────────────────────────────────
const anatomy = {
  source:         'frame_anatomy',
  frames_analyzed: frames.length,
  canvas:         { maxW, maxH },
  stability: {
    threshold:    STABLE_THRESHOLD,
    stable_pixels: stablePixels,
    total_covered: totalCovered,
    ratio:        +(stablePixels / Math.max(totalCovered, 1)).toFixed(3),
  },
  // Compress stability map: only store non-zero cells
  presence_map: presenceMap.flatMap((row, r) =>
    Array.from(row).map((v, c) => v > 0 ? { r, c, p: +v.toFixed(3) } : null).filter(Boolean)
  ),
  per_frame: frames.map(f => ({
    id:    f.id,
    width: f.width, height: f.height,
    body_count: f.bodyCount,
    bbox:  f.bbox,
    zones: f.zones,
    lum_centroid: f.lumCentroid,
  })),
};

const outPath = join(OUT, 'anatomy.json');
writeFileSync(outPath, JSON.stringify(anatomy, null, 2));
console.log(`\nSaved: exports/anatomy.json\n`);
