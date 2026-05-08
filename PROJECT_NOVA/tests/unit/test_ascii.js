import { check, section } from '../helpers.js';
import { gridToAscii, asciiToGrid, asciiDump, asciiDiff, asciiAnnotate, gridToJSON, gridFromJSON } from '../../src/core/ascii.js';
import { makeGrid } from '../../src/core/grid.js';
import { IDX } from '../../src/core/palette.js';

section('ascii');

// Round-trip: grid → ASCII → grid
const g = makeGrid(4, 3, 0);
g[0][0] = IDX.OUTLINE;
g[1][2] = IDX.MID;
g[2][3] = IDX.PEAK;

const ascii = gridToAscii(g);
check('gridToAscii line count', ascii.split('\n').length === 3);
check('gridToAscii outline char', ascii[0] === '#');
check('gridToAscii transparent char', ascii[1] === '.');

const g2 = asciiToGrid(ascii);
check('asciiToGrid outline', g2[0][0] === IDX.OUTLINE);
check('asciiToGrid mid',     g2[1][2] === IDX.MID);
check('asciiToGrid peak',    g2[2][3] === IDX.PEAK);
check('asciiToGrid transparent', g2[0][1] === IDX.TRANSPARENT);

// asciiDump
const dump = asciiDump(g, 'test');
check('asciiDump has label', dump.includes('[test]'));
check('asciiDump has dimensions', dump.includes('4x3'));

// asciiDiff
const before = makeGrid(4, 3, 0);
const after  = makeGrid(4, 3, 0);
after[1][1] = IDX.MID;
after[2][2] = IDX.SHADOW;
const diff = asciiDiff(before, after);
const lines = diff.split('\n');
check('asciiDiff row 0 unchanged', lines[0] === '    ');
check('asciiDiff row 1 has change', lines[1][1] === '!');
check('asciiDiff row 2 has change', lines[2][2] === '!');
check('asciiDiff row 2 no other change', lines[2][0] === ' ');

// asciiAnnotate
const g3 = makeGrid(3, 3, IDX.MID);
const annotated = asciiAnnotate(g3, [{ row: 1, col: 1 }], '?');
const aLines = annotated.split('\n');
check('asciiAnnotate center marked', aLines[1][1] === '?');
check('asciiAnnotate others unchanged', aLines[0][0] === 'o');

// JSON round-trip
const json = gridToJSON(g, { label: 'test' });
const parsed = JSON.parse(json);
check('gridToJSON has width',  parsed.width === 4);
check('gridToJSON has height', parsed.height === 3);
check('gridToJSON has label',  parsed.label === 'test');

const g4 = gridFromJSON(json);
check('gridFromJSON rows', g4.length === 3);
check('gridFromJSON outline', g4[0][0] === IDX.OUTLINE);
check('gridFromJSON peak',    g4[2][3] === IDX.PEAK);
