/**
 * variant_engine.js — Phase 15: Sprite variation engine.
 *
 * Given a character definition (poses + palettes), generates every combination
 * and assembles a complete variant library. Each variant is fully AI-readable
 * (metrics, z-scores, ASCII previews) and export-ready (PNG + JSON).
 *
 * The "ship it" API: define once, get everything.
 *
 *   const variants = await buildVariantLibrary({
 *     poses:    ['idle', 'punch'],
 *     palettes: [myPalette, coolPalette],
 *     distribution,
 *   });
 *   // → { cells: [{pose, palette, grid, metrics, bandRmsZ, ...}], summary }
 */

import { computeMetrics }              from '../eval/metrics.js';
import { compareToReference }          from '../eval/compare.js';
import { runIteration }                from '../../tools/goku_iterate.js';
import { transferStyle }               from '../../tools/style_transfer.js';
import { PALETTE }                     from '../core/palette.js';
import { POSE_NAMES, poseParams }      from './poses.js';

// ── Types / shapes ────────────────────────────────────────────────────────────
//
// VariantCell = {
//   pose:       string,         — pose name
//   paletteKey: string,         — palette identifier
//   grid:       Uint8Array[],   — style-transferred grid
//   palette:    Palette,        — target palette
//   metrics:    object,         — from computeMetrics
//   bandRmsZ:   number,         — calibration quality
//   fullRmsZ:   number,
//   flags:      object[],       — z-score flags
// }
//
// VariantLibrary = {
//   poses:    string[],
//   palettes: { key, palette }[],
//   cells:    VariantCell[],
//   summary:  { totalCells, meanBandRmsZ, bestCell, worstCell }
// }

// ── Core ──────────────────────────────────────────────────────────────────────

/**
 * Generate a single pose grid (Goku-calibrated).
 *
 * @param {string} poseName
 * @param {object} distribution
 * @param {object} [opts]
 * @returns {Uint8Array[]}
 */
export function generatePoseGrid(poseName, distribution, opts = {}) {
  const { maxIter = 25, targetRmsZ = 0.70 } = opts;
  const { bestGrid } = runIteration(poseParams(poseName), distribution, { maxIter, targetRmsZ });
  return bestGrid;
}

/**
 * Build a variant cell: one pose in one palette, with full evaluation data.
 *
 * @param {string}      poseName
 * @param {Uint8Array[]} srcGrid       — base grid in PALETTE (crimson) space
 * @param {string}      paletteKey    — identifier for this palette
 * @param {object}      tgtPalette    — target Palette object
 * @param {object}      distribution
 * @returns {VariantCell}
 */
export function buildVariantCell(poseName, srcGrid, paletteKey, tgtPalette, distribution) {
  const grid       = transferStyle(srcGrid, PALETTE, tgtPalette);
  const metrics    = computeMetrics(grid, tgtPalette);
  const comparison = compareToReference(metrics, distribution);
  const bandRmsZ   = computeCellBandRmsZ(comparison.results);

  return {
    pose:       poseName,
    paletteKey,
    grid,
    palette:    tgtPalette,
    metrics,
    bandRmsZ,
    fullRmsZ:  comparison.rms_z,
    flags:     comparison.flags,
    pass:      comparison.pass,
  };
}

/**
 * Band-only rmsZ for a cell (excludes structural metrics).
 */
export function computeCellBandRmsZ(results) {
  const BAND_KEYS = [
    'shadow_deep_ratio','shadow_ratio','mid_ratio',
    'bright_ratio','highlight_ratio','peak_ratio',
  ];
  let sum = 0, n = 0;
  for (const k of BAND_KEYS) {
    const r = results[k];
    if (r && typeof r.z === 'number') { sum += r.z * r.z; n++; }
  }
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

/**
 * Build a complete variant library: all poses × all palettes.
 *
 * @param {object} config
 * @param {string[]}          config.poses       — subset of POSE_NAMES (default: all)
 * @param {{ key, palette }[]} config.palettes   — palette definitions
 * @param {object}            config.distribution — Goku reference distribution
 * @param {object}            [config.opts]       — { maxIter, targetRmsZ, onProgress }
 * @returns {VariantLibrary}
 */
export function buildVariantLibrary(config) {
  const {
    poses        = POSE_NAMES,
    palettes,
    distribution,
    opts         = {},
  } = config;

  if (!palettes || palettes.length === 0) throw new Error('buildVariantLibrary: palettes is required');
  if (!distribution)                       throw new Error('buildVariantLibrary: distribution is required');

  const { maxIter = 25, targetRmsZ = 0.70, onProgress = null } = opts;
  const totalTasks = poses.length * (1 + palettes.length); // 1 generate + N transfers per pose
  let   done = 0;

  function tick(msg) {
    done++;
    if (onProgress) onProgress({ done, total: totalTasks, msg });
  }

  // Step 1: generate a base grid (crimson palette) for each pose
  const baseGrids = {};
  for (const poseName of poses) {
    baseGrids[poseName] = generatePoseGrid(poseName, distribution, { maxIter, targetRmsZ });
    tick(`generated ${poseName}`);
  }

  // Step 2: build cells for every pose × palette combination
  const cells = [];
  for (const poseName of poses) {
    for (const { key: paletteKey, palette: tgtPalette } of palettes) {
      const cell = buildVariantCell(poseName, baseGrids[poseName], paletteKey, tgtPalette, distribution);
      cells.push(cell);
      tick(`${poseName} × ${paletteKey}`);
    }
  }

  // Summary
  const bandRmsZs  = cells.map(c => c.bandRmsZ);
  const meanRmsZ   = bandRmsZs.reduce((s, v) => s + v, 0) / Math.max(bandRmsZs.length, 1);
  const bestCell   = cells.reduce((a, b) => a.bandRmsZ < b.bandRmsZ ? a : b, cells[0]);
  const worstCell  = cells.reduce((a, b) => a.bandRmsZ > b.bandRmsZ ? a : b, cells[0]);
  const passCount  = cells.filter(c => c.pass).length;

  return {
    poses,
    palettes,
    baseGrids,
    cells,
    summary: {
      totalCells:  cells.length,
      meanBandRmsZ: +meanRmsZ.toFixed(4),
      passRate:    +(passCount / cells.length).toFixed(4),
      passCount,
      bestCell:  { pose: bestCell?.pose,  paletteKey: bestCell?.paletteKey,  bandRmsZ: bestCell?.bandRmsZ  },
      worstCell: { pose: worstCell?.pose, paletteKey: worstCell?.paletteKey, bandRmsZ: worstCell?.bandRmsZ },
    },
  };
}
