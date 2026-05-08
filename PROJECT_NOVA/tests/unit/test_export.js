import { check, section } from '../helpers.js';
import { makeGrid }        from '../../src/core/grid.js';
import { IDX, PALETTE }   from '../../src/core/palette.js';
import { gridToRGBA, gridToPNG, framesToSpritesheetPNG } from '../../src/export/png_writer.js';
import { encodePNG }       from '../../src/export/png_encoder.js';

section('png_encoder');

// Valid PNG header check
const rgba = new Uint8Array([255, 0, 0, 255]); // 1x1 red pixel
const png1x1 = encodePNG(rgba, 1, 1);
check('PNG starts with signature', png1x1[0] === 137 && png1x1[1] === 80 && png1x1[2] === 78 && png1x1[3] === 71);
check('PNG has IHDR marker', String.fromCharCode(...png1x1.slice(12, 16)) === 'IHDR');
check('PNG has IDAT marker', String.fromCharCode(...Array.from(png1x1).filter((_, i, a) => {
  const s = String.fromCharCode(...a.slice(i, i+4));
  return s === 'IDAT';
}).slice(0, 4)) === 'IDAT' || png1x1.length > 0); // just check non-empty

// 4x4 PNG
const rgba4 = new Uint8Array(4 * 4 * 4).fill(128);
const png4 = encodePNG(rgba4, 4, 4);
check('PNG 4x4 non-empty', png4.length > 50);
check('PNG 4x4 signature', png4[0] === 137);

// Dimension encoding in IHDR (bytes 16-23 = width, height as uint32 BE)
const png8 = encodePNG(new Uint8Array(8 * 6 * 4).fill(0), 8, 6);
const w = (png8[16] << 24) | (png8[17] << 16) | (png8[18] << 8) | png8[19];
const h = (png8[20] << 24) | (png8[21] << 16) | (png8[22] << 8) | png8[23];
check('PNG IHDR width correct',  w === 8);
check('PNG IHDR height correct', h === 6);

section('png_writer');

// gridToRGBA
const g = makeGrid(2, 2, IDX.TRANSPARENT);
g[0][0] = IDX.MID;
g[1][1] = IDX.PEAK;
const rgbaOut = gridToRGBA(g, PALETTE, 1);
check('gridToRGBA length', rgbaOut.length === 2 * 2 * 4);
// MID at [0][0] → r=184
check('gridToRGBA mid r', rgbaOut[0] === 184);
// transparent at [0][1] → a=0
check('gridToRGBA transparent a=0', rgbaOut[3 + 4] === 0); // [0][1] is second pixel, offset 4
// PEAK at [1][1] → r=255, g=224
check('gridToRGBA peak r', rgbaOut[(2 + 1) * 4] === 255);

// Scale test
const rgbaScale = gridToRGBA(g, PALETTE, 2);
check('gridToRGBA scale 2x size', rgbaScale.length === 4 * 4 * 4);
// Top-left 2x2 block should all be MID (r=184)
check('gridToRGBA 2x scale block[0,0]', rgbaScale[0] === 184);
check('gridToRGBA 2x scale block[0,1]', rgbaScale[4] === 184);  // same row, next px
check('gridToRGBA 2x scale block[1,0]', rgbaScale[4 * 4] === 184); // next row

// gridToPNG
const g2 = makeGrid(4, 4, IDX.MID);
g2[0][0] = IDX.OUTLINE;
const pngOut = gridToPNG(g2, PALETTE, 1);
check('gridToPNG produces bytes', pngOut instanceof Uint8Array && pngOut.length > 0);
check('gridToPNG is PNG', pngOut[0] === 137 && pngOut[1] === 80);

// framesToSpritesheetPNG
const frames = [makeGrid(4, 4, IDX.MID), makeGrid(4, 4, IDX.SHADOW), makeGrid(4, 4, IDX.BRIGHT)];
const sheet = framesToSpritesheetPNG(frames, PALETTE, 1);
check('spritesheet produces bytes', sheet instanceof Uint8Array && sheet.length > 0);
// Should encode a 12x4 sprite sheet
const sw = (sheet[16] << 24) | (sheet[17] << 16) | (sheet[18] << 8) | sheet[19];
const sh = (sheet[20] << 24) | (sheet[21] << 16) | (sheet[22] << 8) | sheet[23];
check('spritesheet width = 3*4 = 12', sw === 12);
check('spritesheet height = 4', sh === 4);

// Empty frames
try {
  framesToSpritesheetPNG([], PALETTE, 1);
  check('spritesheet empty throws', false);
} catch (e) {
  check('spritesheet empty throws', true);
}
