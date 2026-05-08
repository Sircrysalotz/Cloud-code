/**
 * Pass 4 — Highlight Cluster Validation
 *
 * Flood-fill to find peak-color clusters. Keep the largest cluster only.
 * Demote all other peak pixels to highlight.
 */

import { cloneGrid, findClusters } from '../core/grid.js';
import { PALETTE } from '../core/palette.js';

export function pass4HighlightCluster(grid, palette = PALETTE) {
  const out = cloneGrid(grid);
  const PEAK      = palette.peakIndex;
  const HIGHLIGHT = palette.highlightIndex;

  const clusters = findClusters(grid, v => v === PEAK);
  if (clusters.length <= 1) return out;

  let largest = clusters[0];
  for (const c of clusters) {
    if (c.pixels.length > largest.pixels.length) largest = c;
  }

  for (const cluster of clusters) {
    if (cluster === largest) continue;
    for (const p of cluster.pixels) out[p.row][p.col] = HIGHLIGHT;
  }
  return out;
}
