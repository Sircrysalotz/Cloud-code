/**
 * Pass 4 — Highlight Cluster Validation
 *
 * Flood-fill to find peak-color clusters. Keep the largest cluster only.
 * Demote all other peak pixels to highlight.
 *
 * WHY: Shader noise can scatter peak highlight into multiple specks across
 * the sprite. Real pixel art has a single coherent peak highlight cluster.
 */

import { cloneGrid, findClusters, gridSize } from '../core/grid.js';
import { IDX } from '../core/palette.js';

const PEAK      = IDX.PEAK;
const HIGHLIGHT = IDX.HIGHLIGHT;

/**
 * @param {Uint8Array[]} grid
 * @returns {Uint8Array[]}
 */
export function pass4HighlightCluster(grid) {
  const out = cloneGrid(grid);

  const clusters = findClusters(grid, v => v === PEAK);
  if (clusters.length <= 1) return out; // 0 or 1 cluster → nothing to do

  // Find largest cluster
  let largest = clusters[0];
  for (const c of clusters) {
    if (c.pixels.length > largest.pixels.length) largest = c;
  }

  // Demote all other clusters
  const keepSet = new Set(largest.pixels.map(p => `${p.row},${p.col}`));
  for (const cluster of clusters) {
    if (cluster === largest) continue;
    for (const p of cluster.pixels) {
      out[p.row][p.col] = HIGHLIGHT;
    }
  }
  return out;
}
