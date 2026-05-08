import { check, section } from '../helpers.js';
import { DEFAULT_PALETTE, PALETTE, IDX, makePalette, quantize, bandLevel, indexToRGBA } from '../../src/core/palette.js';

section('palette');

// Basic structure
check('palette has 8 colors', PALETTE.size === 8);
check('index 0 is transparent', PALETTE.get(0).name === 'transparent');
check('index 1 is outline',     PALETTE.get(1).name === 'outline');
check('index 7 is peak',        PALETTE.get(7).name === 'peak');

// Lookup
check('byName lookup mid',      PALETTE.getByName('mid').index === IDX.MID);
check('ascii for transparent',  PALETTE.ascii(0) === '.');
check('ascii for outline',      PALETTE.ascii(1) === '#');
check('ascii for peak',         PALETTE.ascii(7) === '@');
check('isTransparent(0)',       PALETTE.isTransparent(0));
check('isTransparent(4) false', !PALETTE.isTransparent(4));
check('isOutline(1)',           PALETTE.isOutline(1));
check('isBody(4)',              PALETTE.isBody(4));
check('isBody(0) false',        !PALETTE.isBody(0));
check('isBody(1) false',        !PALETTE.isBody(1));

// quantize
check('quantize transparent (a=0)', quantize(255, 0, 0, 0) === IDX.TRANSPARENT);
check('quantize transparent (a=50)', quantize(255, 0, 0, 50) === IDX.TRANSPARENT);
check('quantize exact mid color', quantize(184, 40, 28, 255) === IDX.MID);
check('quantize near peak',       quantize(255, 224, 136, 255) === IDX.PEAK);
check('quantize near outline',    quantize(28, 8, 20, 255) === IDX.OUTLINE);

// bandLevel
check('bandLevel shadow_deep = 0', bandLevel(IDX.SHADOW_DEEP) === 0);
check('bandLevel mid = 2',         bandLevel(IDX.MID) === 2);
check('bandLevel peak = 5',        bandLevel(IDX.PEAK) === 5);
check('bandLevel transparent = -1', bandLevel(IDX.TRANSPARENT) === -1);
check('bandLevel outline = -1',    bandLevel(IDX.OUTLINE) === -1);

// indexToRGBA
const rgba = indexToRGBA(IDX.MID);
check('indexToRGBA mid r', rgba[0] === 184);
check('indexToRGBA mid a', rgba[3] === 255);
check('indexToRGBA transparent a=0', indexToRGBA(0)[3] === 0);

// Custom palette
const custom = makePalette([
  { index: 0, name: 'transparent', hex: null, r: 0, g: 0, b: 0, a: 0, ascii: '.' },
  { index: 1, name: 'black',       hex: '#000', r: 0, g: 0, b: 0, a: 255, ascii: '#' },
]);
check('custom palette size 2', custom.size === 2);
check('custom palette getByName black', custom.getByName('black')?.index === 1);
