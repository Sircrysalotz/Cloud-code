/**
 * diff.js — Phase 21: Sprite diff engine.
 *
 * Computes structured, AI-readable diffs between two palette-index grids.
 * Outputs changed-pixel statistics, per-region change density, dominant
 * luminance direction, and an ASCII heatmap — all text-readable data
 * that closes the generate→evaluate→adjust feedback loop.
 *
 * Grids must use the same coordinate system but may differ in size;
 * comparison is bounded to the overlapping region.
 */

// ── Region helpers ────────────────────────────────────────────────────────────

const REGIONS = ['top', 'mid', 'bottom'];

/**
 * Assign a row index to a vertical region bucket.
 * @param {number} row
 * @param {number} totalRows
 * @returns {'top'|'mid'|'bottom'}
 */
export function rowToRegion(row, totalRows) {
  const frac = row / totalRows;
  if (frac < 1 / 3) return 'top';
  if (frac < 2 / 3) return 'mid';
  return 'bottom';
}

// ── Core diff ─────────────────────────────────────────────────────────────────

/**
 * Compute a structured diff between two palette-index grids.
 *
 * Only opaque pixels (index > 0 in either grid) in the overlapping region
 * are considered.  Transparent-to-transparent is not a change.
 *
 * @param {Uint8Array[]} gridA     — reference grid
 * @param {object}       paletteA
 * @param {Uint8Array[]} gridB     — candidate grid
 * @param {object}       paletteB
 * @returns {DiffResult}
 */
export function diffGrids(gridA, paletteA, gridB, paletteB) {
  const hA = gridA.length,  wA = gridA[0]?.length ?? 0;
  const hB = gridB.length,  wB = gridB[0]?.length ?? 0;
  const H  = Math.min(hA, hB);
  const W  = Math.min(wA, wB);

  let totalPixels   = 0;   // opaque in at least one grid (within overlap)
  let changedPixels = 0;
  let brighterCount = 0;   // B is brighter than A
  let darkerCount   = 0;   // B is darker than A

  const regionCounts   = { top: 0, mid: 0, bottom: 0 };
  const regionChanged  = { top: 0, mid: 0, bottom: 0 };

  // Heatmap: 0=same, 1=brighter, -1=darker, null=both transparent
  const heatmap = [];

  for (let r = 0; r < H; r++) {
    const region = rowToRegion(r, H);
    const hRow   = [];

    for (let c = 0; c < W; c++) {
      const va = gridA[r][c];
      const vb = gridB[r][c];

      // Both transparent → skip
      if (va === 0 && vb === 0) { hRow.push(null); continue; }

      totalPixels++;
      regionCounts[region]++;

      const la = va === 0 ? -1 : paletteA.bandLevel(va);
      const lb = vb === 0 ? -1 : paletteB.bandLevel(vb);

      if (va === vb) {
        hRow.push(0);
      } else {
        changedPixels++;
        regionChanged[region]++;

        if (lb > la)       { brighterCount++; hRow.push(1);  }
        else if (lb < la)  { darkerCount++;   hRow.push(-1); }
        else               { hRow.push(0); }   // different index, same band
      }
    }

    heatmap.push(hRow);
  }

  const changeFraction = totalPixels > 0 ? changedPixels / totalPixels : 0;

  // Per-region density
  const regionDensity = {};
  for (const reg of REGIONS) {
    regionDensity[reg] = regionCounts[reg] > 0
      ? regionChanged[reg] / regionCounts[reg]
      : 0;
  }

  // Dominant direction
  let direction = 'none';
  if (brighterCount > darkerCount * 1.5)      direction = 'brighter';
  else if (darkerCount > brighterCount * 1.5)  direction = 'darker';
  else if (brighterCount + darkerCount > 0)    direction = 'mixed';

  return {
    overlapWidth:   W,
    overlapHeight:  H,
    totalPixels,
    changedPixels,
    changeFraction: +changeFraction.toFixed(4),
    brighterCount,
    darkerCount,
    direction,
    regionCounts,
    regionChanged,
    regionDensity: Object.fromEntries(
      REGIONS.map(k => [k, +regionDensity[k].toFixed(4)])
    ),
    heatmap,
  };
}

// ── ASCII heatmap ─────────────────────────────────────────────────────────────

/**
 * Render a diff heatmap as an ASCII string.
 *
 * Key: `.` same/transparent  `+` brighter  `-` darker
 *
 * @param {(0|1|-1|null)[][]} heatmap
 * @returns {string}
 */
export function heatmapToAscii(heatmap) {
  return heatmap.map(row =>
    row.map(v => v === null ? '.' : v === 0 ? '.' : v > 0 ? '+' : '-').join('')
  ).join('\n');
}

// ── Multi-frame diff ──────────────────────────────────────────────────────────

/**
 * Diff a sequence of frames against a reference, returning one DiffResult
 * per frame plus an aggregate summary.
 *
 * @param {Uint8Array[]}  refGrid      — reference grid
 * @param {object}        refPalette
 * @param {{ grid, palette }[]} frames — frames to compare
 * @returns {{ diffs: DiffResult[], summary }}
 */
export function diffSequence(refGrid, refPalette, frames) {
  const diffs = frames.map(({ grid, palette }) =>
    diffGrids(refGrid, refPalette, grid, palette)
  );

  const n = diffs.length;
  if (n === 0) {
    return { diffs: [], summary: { count: 0, meanChangeFraction: 0, maxChangeFraction: 0 } };
  }

  const mean = diffs.reduce((s, d) => s + d.changeFraction, 0) / n;
  const max  = Math.max(...diffs.map(d => d.changeFraction));

  return {
    diffs,
    summary: {
      count:               n,
      meanChangeFraction:  +mean.toFixed(4),
      maxChangeFraction:   +max.toFixed(4),
    },
  };
}

// ── Change mask ───────────────────────────────────────────────────────────────

/**
 * Build a binary change mask (1=changed, 0=same/transparent) from a heatmap.
 * Useful for targeted cleanup passes that focus on changed regions.
 *
 * @param {(0|1|-1|null)[][]} heatmap
 * @returns {Uint8Array[]}
 */
export function changeMask(heatmap) {
  return heatmap.map(row =>
    new Uint8Array(row.map(v => (v !== null && v !== 0) ? 1 : 0))
  );
}
