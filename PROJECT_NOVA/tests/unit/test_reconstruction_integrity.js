/**
 * Reconstruction integrity tests — enforce the 100% accuracy floor in CI.
 *
 * 1. Golden render: re-render goku_frame from its grid+palette and
 *    byte-compare against the committed PNG (catches any render-path drift).
 * 2. Batch integrity: sampled frames report 100% ingest accuracy and every
 *    pixel index exists in the frame's own palette.
 * 3. Pose fidelity: each exported pose's grid is pixel-identical to its
 *    source batch frame (no cleanup, no transforms, nothing touched).
 */

import { existsSync, readFileSync } from 'fs';
import { join }            from 'path';
import { check, section }  from '../helpers.js';
import { paletteFromRGB }  from '../../src/core/palette.js';
import { gridToPNG }       from '../../src/export/png_writer.js';
import { POSE_NAMES, POSE_FRAME } from '../../src/authoring/poses.js';

const EXPORTS = new URL('../../exports', import.meta.url).pathname;
const BATCH   = join(EXPORTS, 'batch');

const loadJSON = p => JSON.parse(readFileSync(p, 'utf8'));
const rows = gd => gd.data.map(r => Array.isArray(r) ? r : Object.values(r).map(Number));

// ── 1. Golden render ──────────────────────────────────────────────────────────

section('reconstruction integrity — golden render');

{
  const gridPath = join(EXPORTS, 'goku_frame_grid.json');
  const palPath  = join(EXPORTS, 'goku_frame_palette.json');
  const pngPath  = join(EXPORTS, 'goku_frame_recon.png');

  if (!existsSync(gridPath) || !existsSync(palPath) || !existsSync(pngPath)) {
    check('golden render inputs exist', false);
  } else {
    const gd      = loadJSON(gridPath);
    const palette = paletteFromRGB(loadJSON(palPath));
    const fresh   = gridToPNG(rows(gd), palette, 8);
    const golden  = readFileSync(pngPath);

    check('golden render: byte count matches committed PNG', fresh.length === golden.length);
    check('golden render: bytes identical to committed PNG',
      fresh.length === golden.length && fresh.every((b, i) => b === golden[i]));
    check('golden render: source reports 100% ingest accuracy',
      gd.accuracy?.exact_pct === 100.0);
  }
}

// ── 2. Batch integrity (sampled) ──────────────────────────────────────────────

section('reconstruction integrity — batch sample');

{
  // Sample: the 5 pose donor frames + a spread of others
  const sample = [...new Set([...Object.values(POSE_FRAME), 1, 7, 20, 40])].sort((a, b) => a - b);
  let checkedAny = false;

  for (const idx of sample) {
    const id = String(idx).padStart(4, '0');
    const gPath = join(BATCH, `frame_${id}_grid.json`);
    const pPath = join(BATCH, `frame_${id}_palette.json`);
    if (!existsSync(gPath) || !existsSync(pPath)) continue;
    checkedAny = true;

    const gd       = loadJSON(gPath);
    const palette  = paletteFromRGB(loadJSON(pPath));
    const validIdx = new Set(palette.colors.map(c => c.index));
    const data     = rows(gd);

    check(`frame_${id}: ingest accuracy is 100%`, gd.accuracy?.exact_pct === 100.0);
    check(`frame_${id}: dimensions match data`,
      data.length === gd.height && data.every(r => r.length === gd.width));
    check(`frame_${id}: every pixel index exists in its palette`,
      data.every(r => r.every(v => validIdx.has(v))));
  }

  check('batch sample frames were available to check', checkedAny);
}

// ── 3. Pose fidelity ──────────────────────────────────────────────────────────

section('reconstruction integrity — pose fidelity');

for (const pose of POSE_NAMES) {
  const posePath = join(EXPORTS, 'poses', `${pose}.json`);
  if (!existsSync(posePath)) {
    check(`${pose}: exported pose JSON exists`, false);
    continue;
  }

  const poseData = loadJSON(posePath);
  const frameIdx = poseData.frame_idx ?? POSE_FRAME[pose];
  const id       = String(frameIdx).padStart(4, '0');
  const gPath    = join(BATCH, `frame_${id}_grid.json`);
  if (!existsSync(gPath)) {
    check(`${pose}: source batch frame exists`, false);
    continue;
  }

  const src = rows(loadJSON(gPath));
  const out = poseData.data;

  let diffs = -1;
  if (src.length === out.length && src[0].length === out[0].length) {
    diffs = 0;
    for (let r = 0; r < src.length; r++)
      for (let c = 0; c < src[0].length; c++)
        if (src[r][c] !== out[r][c]) diffs++;
  }

  check(`${pose}: dimensions match source frame_${id}`, diffs >= 0);
  check(`${pose}: pixel-identical to source frame_${id}`, diffs === 0,
    diffs > 0 ? `${diffs} pixels differ` : '');
}
