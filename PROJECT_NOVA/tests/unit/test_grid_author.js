import { check, section } from '../helpers.js';
import {
  canvas, fromASCII, paintCell, paintCells, paintFill, replaceIndex,
  linePixels, drawLine, drawRect, drawEllipse, ellipsePixels,
  stamp, eraseRect, mirrorLeftToRight, mirrorRightToLeft,
  outlineBody, extractOutline, extractSilhouette,
  fillRect, gradientFill, toASCII,
} from '../../src/core/grid_author.js';
import { gridSize, getPixel } from '../../src/core/grid.js';
import { PALETTE } from '../../src/core/palette.js';

// ── canvas ────────────────────────────────────────────────────────────────────
section('grid_author / canvas');

const c5x3 = canvas(5, 3);
check('canvas width',  gridSize(c5x3)[0] === 5);
check('canvas height', gridSize(c5x3)[1] === 3);
check('canvas transparent', c5x3[1][2] === 0);
check('canvas independent rows', c5x3[0] !== c5x3[1]);

// ── fromASCII ─────────────────────────────────────────────────────────────────
section('grid_author / fromASCII');

const ascii3 = '.#.\n#o#\n.#.';
const g3 = fromASCII(ascii3, PALETTE);
check('fromASCII height', gridSize(g3)[1] === 3);
check('fromASCII width',  gridSize(g3)[0] === 3);
check('fromASCII transparent', g3[0][0] === 0);
check('fromASCII outline',     g3[0][1] === 1);
check('fromASCII mid',         g3[1][1] === 4);

const asciiLeadingNL = '\n.#.\n#o#\n.#.\n';
const gLead = fromASCII(asciiLeadingNL, PALETTE);
check('fromASCII strips leading newlines', gridSize(gLead)[1] === 3);

// ── paintCell ─────────────────────────────────────────────────────────────────
section('grid_author / paintCell');

const base = canvas(5, 5);
const p1 = paintCell(base, 2, 3, 4);
check('paintCell sets pixel',      p1[2][3] === 4);
check('paintCell immutable',       base[2][3] === 0);
check('paintCell other unchanged', p1[2][4] === 0);
check('paintCell out of bounds',   (() => { paintCell(base, 10, 10, 4); return true; })());

// ── paintCells ────────────────────────────────────────────────────────────────
section('grid_author / paintCells');

const pc = paintCells(base, [{row:0,col:0},{row:1,col:1},{row:2,col:2}], 3);
check('paintCells 0,0', pc[0][0] === 3);
check('paintCells 1,1', pc[1][1] === 3);
check('paintCells 2,2', pc[2][2] === 3);
check('paintCells immutable', base[0][0] === 0);
check('paintCells empty list', paintCells(base, [], 5)[0][0] === 0);

// ── paintFill ─────────────────────────────────────────────────────────────────
section('grid_author / paintFill');

const fillBase = fromASCII('.....\\n.###.\\n.#o#.\\n.###.\\n.....', PALETTE);
// Simpler test: 5x5 transparent canvas, paint a filled rect then flood-fill
const fb = canvas(5, 5);
// Draw a 3x3 border of mid (4) leaving center transparent
const fb2 = drawRect(fb, 1, 1, 3, 3, 4, false);
const fb3 = paintFill(fb2, 2, 2, 5); // fill interior with bright
check('paintFill fills interior', fb3[2][2] === 5);
check('paintFill stops at border', fb3[1][1] === 4);

const pf2 = paintFill(canvas(3, 3), 1, 1, 7); // all transparent → fill with 7
check('paintFill all transparent', pf2[0][0] === 7 && pf2[2][2] === 7);

const pf3 = paintFill(canvas(3, 3), 1, 1, 0); // same color → no change
check('paintFill same color noop', pf3[1][1] === 0);

// ── replaceIndex ──────────────────────────────────────────────────────────────
section('grid_author / replaceIndex');

const ri = fromASCII('#o#\nooo\n#o#', PALETTE);
const ri2 = replaceIndex(ri, 4, 5); // mid→bright
check('replaceIndex center', ri2[1][1] === 5);
check('replaceIndex corner', ri2[0][1] === 5);
check('replaceIndex outline unchanged', ri2[0][0] === 1);
check('replaceIndex immutable', ri[1][1] === 4);
check('replaceIndex nothing to replace', replaceIndex(ri, 99, 5)[1][1] === 4);

// ── linePixels ────────────────────────────────────────────────────────────────
section('grid_author / linePixels');

const lpH = linePixels(0, 0, 0, 4);
check('linePixels horizontal count',  lpH.length === 5);
check('linePixels horizontal start',  lpH[0].row === 0 && lpH[0].col === 0);
check('linePixels horizontal end',    lpH[4].col === 4);

const lpV = linePixels(0, 0, 4, 0);
check('linePixels vertical count', lpV.length === 5);
check('linePixels vertical end',   lpV[4].row === 4);

const lpD = linePixels(0, 0, 3, 3);
check('linePixels diagonal has 4 pixels', lpD.length === 4);
check('linePixels diagonal end', lpD[3].row === 3 && lpD[3].col === 3);

const lpSingle = linePixels(2, 2, 2, 2);
check('linePixels single point', lpSingle.length === 1);

// ── drawLine ──────────────────────────────────────────────────────────────────
section('grid_author / drawLine');

const dl = canvas(7, 7);
const dl2 = drawLine(dl, 0, 0, 6, 6, 1);
check('drawLine start pixel', dl2[0][0] === 1);
check('drawLine end pixel',   dl2[6][6] === 1);
check('drawLine immutable',   dl[0][0] === 0);

const dlH = drawLine(canvas(5, 3), 1, 0, 1, 4, 2);
check('drawLine horizontal row', dlH[1][0] === 2 && dlH[1][4] === 2);
check('drawLine horizontal non-row untouched', dlH[0][0] === 0);

// ── drawRect ──────────────────────────────────────────────────────────────────
section('grid_author / drawRect');

const dr = canvas(7, 7);
const dr2 = drawRect(dr, 1, 1, 5, 5, 1, false);
check('drawRect top edge',    dr2[1][1] === 1 && dr2[1][5] === 1);
check('drawRect bottom edge', dr2[5][1] === 1 && dr2[5][5] === 1);
check('drawRect left edge',   dr2[3][1] === 1);
check('drawRect right edge',  dr2[3][5] === 1);
check('drawRect interior empty', dr2[3][3] === 0);
check('drawRect immutable',   dr[1][1] === 0);

const drF = drawRect(dr, 1, 1, 3, 3, 4, true);
check('drawRect filled interior', drF[2][2] === 4);
check('drawRect filled border',   drF[1][1] === 4);
check('drawRect filled outside',  drF[4][4] === 0);

// ── ellipsePixels / drawEllipse ───────────────────────────────────────────────
section('grid_author / drawEllipse');

const ep = ellipsePixels(5, 5, 3, 4);
check('ellipsePixels returns pixels', ep.length > 0);
const epSet = new Set(ep.map(p => `${p.row},${p.col}`));
// Cardinal extremes: top/bottom at ±ra from center row, left/right at ±rb from center col
check('ellipsePixels top extreme',    epSet.has('2,5'));   // cr-ra = 5-3 = 2
check('ellipsePixels bottom extreme', epSet.has('8,5'));   // cr+ra = 5+3 = 8
check('ellipsePixels left extreme',   epSet.has('5,1'));   // cc-rb = 5-4 = 1
check('ellipsePixels right extreme',  epSet.has('5,9'));   // cc+rb = 5+4 = 9

const eg = canvas(12, 12);
const eg2 = drawEllipse(eg, 5, 5, 3, 4, 2);
check('drawEllipse top pixel',    eg2[2][5] === 2);
check('drawEllipse bottom pixel', eg2[8][5] === 2);
check('drawEllipse immutable',    eg[2][5]  === 0);

// ── stamp ─────────────────────────────────────────────────────────────────────
section('grid_author / stamp');

const dst = canvas(10, 10);
const src = fromASCII('#o#\no@o\n#o#', PALETTE);
// src layout: row0=[1,4,1] row1=[4,7,4] row2=[1,4,1]  (1=outline, 4=mid, 7=peak)
const stamped = stamp(dst, src, 2, 3);
check('stamp outline pixel',   stamped[2][3] === 1);  // src[0][0]=outline → dst[2][3]
check('stamp mid pixel',       stamped[2][4] === 4);  // src[0][1]=mid → dst[2][4]
check('stamp peak pixel',      stamped[3][4] === 7);  // src[1][1]=peak → dst[3][4]
check('stamp immutable dst',   dst[2][3]     === 0);
check('stamp out of bounds safe', (() => { stamp(dst, src, 9, 9); return true; })());

// Transparent pixels in src must not overwrite dst content
const dstFilled = paintCell(canvas(5, 5), 2, 0, 7);  // put 7 at col 0
const srcSmall  = fromASCII('.o.', PALETTE);          // [0,4,0]
const stamped2  = stamp(dstFilled, srcSmall, 2, 0);
check('stamp transparent skips dst content', stamped2[2][0] === 7); // col0=transparent in src → dst[2][0] stays 7
check('stamp non-transparent overwrites',    stamped2[2][1] === 4); // col1=mid in src → dst[2][1]=4

// ── eraseRect ─────────────────────────────────────────────────────────────────
section('grid_author / eraseRect');

const eraseBase = drawRect(canvas(7, 7), 0, 0, 6, 6, 4, true);
const erased    = eraseRect(eraseBase, 2, 2, 4, 4);
check('eraseRect center cleared', erased[3][3] === 0);
check('eraseRect corner cleared', erased[2][2] === 0);
check('eraseRect outside kept',   erased[1][1] === 4);
check('eraseRect immutable',      eraseBase[3][3] === 4);

// ── mirrorLeftToRight ─────────────────────────────────────────────────────────
section('grid_author / mirrorLeftToRight');

const mBase = canvas(6, 4);
const mPainted = paintCells(mBase, [{row:1,col:0},{row:1,col:1},{row:1,col:2}], 4);
const mirrored = mirrorLeftToRight(mPainted);
check('mirrorL2R left pixel stays',  mirrored[1][0] === 4);
check('mirrorL2R right mirrored',    mirrored[1][5] === 4);
check('mirrorL2R col1 → col4',       mirrored[1][4] === 4);
check('mirrorL2R immutable',         mPainted[1][5] === 0);

const mOdd = canvas(5, 3);
const mOddP = paintCell(mOdd, 1, 0, 3);
const mOddM = mirrorLeftToRight(mOddP);
check('mirrorL2R odd width',         mOddM[1][4] === 3);
check('mirrorL2R odd center unchanged', mOddM[1][2] === 0);

// ── mirrorRightToLeft ─────────────────────────────────────────────────────────
section('grid_author / mirrorRightToLeft');

const mrBase  = paintCells(canvas(6, 4), [{row:1,col:3},{row:1,col:4},{row:1,col:5}], 5);
const mrRight = mirrorRightToLeft(mrBase);
check('mirrorR2L right pixel stays', mrRight[1][5] === 5);
check('mirrorR2L left mirrored',     mrRight[1][0] === 5);
check('mirrorR2L immutable',         mrBase[1][0]  === 0);

// ── outlineBody ───────────────────────────────────────────────────────────────
section('grid_author / outlineBody');

// Grid: transparent border, mid fill
const obBase = drawRect(canvas(5, 5), 1, 1, 3, 3, 4, true);
const outlined = outlineBody(obBase);
check('outlineBody edge pixel → outline', outlined[1][1] === 1);
check('outlineBody center stays body',    outlined[2][2] === 4);
check('outlineBody transparent stays',    outlined[0][0] === 0);
check('outlineBody immutable',            obBase[1][1]   === 4);

// Already-outlined pixel should not be re-outlined
const withOutline = paintCell(obBase, 1, 1, 1);
const outlined2 = outlineBody(withOutline);
check('outlineBody outline pixel untouched', outlined2[1][1] === 1);

// ── extractOutline ────────────────────────────────────────────────────────────
section('grid_author / extractOutline');

const eoGrid = fromASCII('#o#\nooo\n#o#', PALETTE);
const eoOut  = extractOutline(eoGrid);
check('extractOutline outline pixel kept',   eoOut[0][0] === 1);
check('extractOutline body pixel removed',   eoOut[0][1] === 0);
check('extractOutline center removed',       eoOut[1][1] === 0);

// ── extractSilhouette ─────────────────────────────────────────────────────────
section('grid_author / extractSilhouette');

const esGrid = fromASCII('.#.\n#o#\n.#.', PALETTE);
const esSil  = extractSilhouette(esGrid, 3);
check('extractSilhouette non-transparent → fillIdx', esSil[0][1] === 3);
check('extractSilhouette center → fillIdx',          esSil[1][1] === 3);
check('extractSilhouette transparent → 0',           esSil[0][0] === 0);

// ── fillRect ──────────────────────────────────────────────────────────────────
section('grid_author / fillRect');

const frBase = canvas(6, 6);
const frFill = fillRect(frBase, 1, 1, 4, 4, 5);
check('fillRect interior filled',  frFill[2][2] === 5);
check('fillRect border filled',    frFill[1][1] === 5);
check('fillRect outside untouched', frFill[0][0] === 0);
check('fillRect immutable',        frBase[2][2] === 0);

// ── gradientFill ──────────────────────────────────────────────────────────────
section('grid_author / gradientFill');

const gfBase = fillRect(canvas(5, 6), 0, 0, 5, 4, 4); // all mid
const gfFill = gradientFill(gfBase, 2, 5, 4); // dark=2 bottom, bright=5 top
check('gradientFill top is bright',  gfFill[0][2] === 5);
check('gradientFill bottom is dark', gfFill[5][2] === 2);
check('gradientFill leaves non-target', (() => {
  const g = paintCell(gfBase, 1, 1, 1);
  const r = gradientFill(g, 2, 5, 4);
  return r[1][1] === 1; // outline untouched
})());

const gfEmpty = gradientFill(canvas(3, 3), 2, 5, 4);
check('gradientFill no target pixels → noop', gfEmpty[1][1] === 0);

// ── toASCII ───────────────────────────────────────────────────────────────────
section('grid_author / toASCII');

const roundtrip = fromASCII('.#.\n#o#\n.#.', PALETTE);
const ta = toASCII(roundtrip, PALETTE);
check('toASCII roundtrip line 1', ta.split('\n')[0] === '.#.');
check('toASCII roundtrip line 2', ta.split('\n')[1] === '#o#');
check('toASCII roundtrip line 3', ta.split('\n')[2] === '.#.');
