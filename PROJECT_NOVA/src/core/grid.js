/**
 * 2D grid data structure for palette-index pixel grids.
 *
 * A Grid is an immutable-by-convention array of Uint8Arrays.
 * grid[row][col] = palette index (0-255)
 * Row 0 = top of image.
 */

/**
 * Create a new Grid filled with a given index.
 * @param {number} width
 * @param {number} height
 * @param {number} fill  palette index to fill with (default 0 = transparent)
 * @returns {Uint8Array[]}
 */
export function makeGrid(width, height, fill = 0) {
  return Array.from({ length: height }, () => new Uint8Array(width).fill(fill));
}

/**
 * Clone a grid (deep copy). Cleanup passes must return a new grid, never mutate.
 * @param {Uint8Array[]} grid
 * @returns {Uint8Array[]}
 */
export function cloneGrid(grid) {
  return grid.map(row => new Uint8Array(row));
}

/**
 * Get pixel at (row, col). Returns -1 for out-of-bounds.
 * @param {Uint8Array[]} grid
 * @param {number} row
 * @param {number} col
 * @returns {number}
 */
export function getPixel(grid, row, col) {
  if (row < 0 || row >= grid.length) return -1;
  if (col < 0 || col >= grid[0].length) return -1;
  return grid[row][col];
}

/**
 * Set pixel in a cloned grid (non-mutating).
 * Returns the same grid reference with pixel modified — caller is responsible for cloning first.
 * @param {Uint8Array[]} grid
 * @param {number} row
 * @param {number} col
 * @param {number} value
 */
export function setPixel(grid, row, col, value) {
  if (row < 0 || row >= grid.length) return;
  if (col < 0 || col >= grid[0].length) return;
  grid[row][col] = value;
}

/**
 * Return [width, height] of a grid.
 */
export function gridSize(grid) {
  return [grid[0]?.length ?? 0, grid.length];
}

/**
 * 4-neighbors of (row, col) that are within bounds.
 * Returns array of {row, col, value} objects.
 */
export function neighbors4(grid, row, col) {
  const result = [];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nr = row + dr;
    const nc = col + dc;
    const v = getPixel(grid, nr, nc);
    if (v !== -1) result.push({ row: nr, col: nc, value: v });
  }
  return result;
}

/**
 * 8-neighbors of (row, col) that are within bounds.
 */
export function neighbors8(grid, row, col) {
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      const v = getPixel(grid, nr, nc);
      if (v !== -1) result.push({ row: nr, col: nc, value: v });
    }
  }
  return result;
}

/**
 * Count pixels matching a predicate.
 * @param {Uint8Array[]} grid
 * @param {function(number): boolean} pred  receives palette index
 * @returns {number}
 */
export function countPixels(grid, pred) {
  let count = 0;
  const [w, h] = gridSize(grid);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (pred(grid[r][c])) count++;
    }
  }
  return count;
}

/**
 * Most common value among a list of palette indices.
 * @param {number[]} indices
 * @returns {number}
 */
export function mostCommon(indices) {
  const counts = new Map();
  for (const v of indices) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = indices[0], bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) { best = v; bestCount = c; }
  return best;
}

/**
 * Flood fill starting at (row, col), matching the value at that pixel.
 * Returns array of {row, col} for all connected pixels with same value.
 * Uses 4-connectivity.
 * @param {Uint8Array[]} grid
 * @param {number} startRow
 * @param {number} startCol
 * @param {function(number): boolean} [matchFn]  if provided, fill cells where matchFn(value) is true
 * @returns {{row: number, col: number}[]}
 */
export function floodFill(grid, startRow, startCol, matchFn) {
  const target = grid[startRow]?.[startCol];
  if (target === undefined) return [];
  const predicate = matchFn ?? ((v) => v === target);
  if (!predicate(target)) return [];

  const [w, h] = gridSize(grid);
  const visited = new Uint8Array(w * h);
  const queue = [[startRow, startCol]];
  const result = [];
  visited[startRow * w + startCol] = 1;

  while (queue.length > 0) {
    const [r, c] = queue.pop();
    result.push({ row: r, col: c });
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= h || nc < 0 || nc >= w) continue;
      if (visited[nr * w + nc]) continue;
      if (!predicate(grid[nr][nc])) continue;
      visited[nr * w + nc] = 1;
      queue.push([nr, nc]);
    }
  }
  return result;
}

/**
 * Find all connected clusters of pixels matching a predicate.
 * Returns array of clusters, each cluster is {pixels: [{row,col}], value: number}.
 */
export function findClusters(grid, pred) {
  const [w, h] = gridSize(grid);
  const visited = new Uint8Array(w * h);
  const clusters = [];

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (visited[r * w + c]) continue;
      const v = grid[r][c];
      if (!pred(v)) continue;
      const pixels = floodFill(grid, r, c, pred);
      for (const p of pixels) visited[p.row * w + p.col] = 1;
      clusters.push({ pixels, value: v });
    }
  }
  return clusters;
}

/**
 * Build a palette-index frequency map for the grid.
 * @param {Uint8Array[]} grid
 * @returns {Map<number, number>} index -> count
 */
export function frequencyMap(grid) {
  const freq = new Map();
  const [w, h] = gridSize(grid);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const v = grid[r][c];
      freq.set(v, (freq.get(v) ?? 0) + 1);
    }
  }
  return freq;
}

/**
 * Create a grid from a flat array of palette indices (row-major).
 */
export function gridFromFlat(flat, width) {
  const height = Math.floor(flat.length / width);
  const grid = makeGrid(width, height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      grid[r][c] = flat[r * width + c];
    }
  }
  return grid;
}

/**
 * Flatten a grid to a plain array (row-major).
 */
export function flattenGrid(grid) {
  return grid.flatMap(row => Array.from(row));
}
