import { check, section } from '../helpers.js';
import {
  makeGrid, cloneGrid, getPixel, setPixel, gridSize,
  neighbors4, neighbors8, countPixels, mostCommon,
  floodFill, findClusters, frequencyMap, gridFromFlat, flattenGrid
} from '../../src/core/grid.js';

section('grid');

// makeGrid
const g = makeGrid(4, 3, 0);
check('makeGrid height', g.length === 3);
check('makeGrid width',  g[0].length === 4);
check('makeGrid fill 0', g[1][2] === 0);

const gFill = makeGrid(2, 2, 5);
check('makeGrid fill 5', gFill[0][0] === 5 && gFill[1][1] === 5);

// cloneGrid
const orig = makeGrid(3, 3, 2);
const copy = cloneGrid(orig);
copy[0][0] = 99;
check('cloneGrid independent', orig[0][0] === 2);
check('cloneGrid values copied', copy[1][1] === 2);

// getPixel / setPixel
const g2 = makeGrid(4, 4, 0);
setPixel(g2, 1, 2, 7);
check('setPixel', g2[1][2] === 7);
check('getPixel in bounds',  getPixel(g2, 1, 2) === 7);
check('getPixel out of bounds row', getPixel(g2, -1, 0) === -1);
check('getPixel out of bounds col', getPixel(g2, 0, 10) === -1);

// gridSize
check('gridSize 4x4', JSON.stringify(gridSize(g2)) === '[4,4]');
check('gridSize 3x2', JSON.stringify(gridSize(makeGrid(3, 2))) === '[3,2]');

// neighbors4
const g3 = makeGrid(5, 5, 0);
const nbrs = neighbors4(g3, 2, 2);
check('neighbors4 count center', nbrs.length === 4);
const cornNbrs = neighbors4(g3, 0, 0);
check('neighbors4 count corner', cornNbrs.length === 2);
const edgeNbrs = neighbors4(g3, 0, 2);
check('neighbors4 count edge', edgeNbrs.length === 3);

// neighbors8
const nbrs8 = neighbors8(g3, 2, 2);
check('neighbors8 count center', nbrs8.length === 8);
const cornNbrs8 = neighbors8(g3, 0, 0);
check('neighbors8 count corner', cornNbrs8.length === 3);

// countPixels
const g4 = makeGrid(3, 3, 4);
g4[0][0] = 7; g4[2][2] = 7;
check('countPixels equals 7', countPixels(g4, v => v === 7) === 2);
check('countPixels equals 4', countPixels(g4, v => v === 4) === 7);

// mostCommon
check('mostCommon basic', mostCommon([1, 2, 2, 3, 2]) === 2);
check('mostCommon single', mostCommon([5]) === 5);

// floodFill
const g5 = makeGrid(5, 5, 0);
g5[2][2] = 4; g5[2][3] = 4; g5[3][2] = 4; g5[1][2] = 4;
const filled = floodFill(g5, 2, 2);
check('floodFill count', filled.length === 4);
const filled0 = floodFill(g5, 0, 0);
check('floodFill all zeros', filled0.length > 10); // most of 5x5 is 0

// findClusters
const g6 = makeGrid(6, 4, 0);
g6[0][0] = 4; g6[0][1] = 4; // cluster A (2px)
g6[3][4] = 4; g6[3][5] = 4; g6[2][5] = 4; // cluster B (3px)
const clusters = findClusters(g6, v => v === 4);
check('findClusters count 2', clusters.length === 2);
check('findClusters sizes', clusters.map(c => c.pixels.length).sort((a,b)=>a-b).join(',') === '2,3');

// frequencyMap
const g7 = makeGrid(3, 2, 1);
g7[0][0] = 4; g7[1][2] = 7;
const freq = frequencyMap(g7);
check('frequencyMap count 1', freq.get(1) === 4);
check('frequencyMap count 4', freq.get(4) === 1);
check('frequencyMap count 7', freq.get(7) === 1);

// gridFromFlat / flattenGrid
const flat = [0,1,2,3,4,5];
const gFlat = gridFromFlat(flat, 3);
check('gridFromFlat rows', gFlat.length === 2);
check('gridFromFlat values', gFlat[1][2] === 5);
const reFlat = flattenGrid(gFlat);
check('flattenGrid round-trip', reFlat.join(',') === flat.join(','));
