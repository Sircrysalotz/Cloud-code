/**
 * Tests for src/core/palette_designer.js
 *
 * Covers: parseHex, luminance, toHex, lerpRGB, interpolateColors,
 *         paletteFromHex, paletteFromAnchors, validatePalette, paletteInfo.
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import {
  parseHex,
  luminance,
  toHex,
  lerpRGB,
  interpolateColors,
  paletteFromHex,
  paletteFromAnchors,
  validatePalette,
  paletteInfo,
} from '../../src/core/palette_designer.js';

// ── parseHex ──────────────────────────────────────────────────────────────────

section('palette_designer — parseHex');

{
  const c = parseHex('#ff0000');
  check('red: r=255', c.r === 255);
  check('red: g=0',   c.g === 0);
  check('red: b=0',   c.b === 0);
}

{
  const c = parseHex('#ffe088');
  check('peak: r=255', c.r === 255);
  check('peak: g=224', c.g === 224);
  check('peak: b=136', c.b === 136);
}

{
  // 3-char shorthand
  const c = parseHex('#f00');
  check('shorthand #f00: r=255', c.r === 255);
  check('shorthand #f00: g=0',   c.g === 0);
  check('shorthand #f00: b=0',   c.b === 0);
}

{
  // Without leading #
  const c = parseHex('1c0814');
  check('no hash: r=28', c.r === 28);
  check('no hash: g=8',  c.g === 8);
  check('no hash: b=20', c.b === 20);
}

{
  // Invalid hex throws
  let threw = false;
  try { parseHex('#gggggg'); } catch { threw = true; }
  check('invalid hex throws', threw);
}

{
  // Too short throws
  let threw = false;
  try { parseHex('#12'); } catch { threw = true; }
  check('too-short hex throws', threw);
}

// ── luminance ─────────────────────────────────────────────────────────────────

section('palette_designer — luminance');

{
  check('black: lum=0', luminance(0, 0, 0) === 0);
  check('white: lum=255', Math.abs(luminance(255, 255, 255) - 255) < 0.01);
  check('red lighter than dark blue', luminance(100, 0, 0) > luminance(0, 0, 100));
  check('green dominates in luminance', luminance(0, 100, 0) > luminance(100, 0, 0));
  check('luminance is non-negative', luminance(255, 255, 255) >= 0);
}

// ── toHex ─────────────────────────────────────────────────────────────────────

section('palette_designer — toHex');

{
  check('black', toHex({ r: 0, g: 0, b: 0 }) === '#000000');
  check('white', toHex({ r: 255, g: 255, b: 255 }) === '#ffffff');
  check('red',   toHex({ r: 255, g: 0, b: 0 }) === '#ff0000');
  check('single digit pads', toHex({ r: 1, g: 2, b: 3 }) === '#010203');
}

// ── lerpRGB ───────────────────────────────────────────────────────────────────

section('palette_designer — lerpRGB');

{
  const a = { r: 0,   g: 0,   b: 0   };
  const b = { r: 255, g: 100, b: 200 };
  const mid = lerpRGB(a, b, 0.5);
  check('lerp t=0.5: r midpoint', mid.r === 128);
  check('lerp t=0.5: g midpoint', mid.g === 50);
  check('lerp t=0.5: b midpoint', mid.b === 100);
}

{
  const a = { r: 10, g: 20, b: 30 };
  const b = { r: 10, g: 20, b: 30 };
  const r = lerpRGB(a, b, 0.5);
  check('lerp of same colors is identity', r.r === 10 && r.g === 20 && r.b === 30);
}

{
  const a = { r: 0, g: 0, b: 0 };
  const b = { r: 200, g: 100, b: 50 };
  const at0 = lerpRGB(a, b, 0);
  const at1 = lerpRGB(a, b, 1);
  check('lerp t=0 returns a', at0.r === 0 && at0.g === 0 && at0.b === 0);
  check('lerp t=1 returns b', at1.r === 200 && at1.g === 100 && at1.b === 50);
}

// ── interpolateColors ────────────────────────────────────────────────────────

section('palette_designer — interpolateColors');

{
  const dark  = { r: 0, g: 0, b: 0 };
  const light = { r: 255, g: 255, b: 255 };
  const cs = interpolateColors(dark, light, 5);
  check('n=5: returns 5 colors', cs.length === 5);
  check('first is dark',  cs[0].r === 0   && cs[0].g === 0);
  check('last is light',  cs[4].r === 255 && cs[4].g === 255);
  check('middle is ~128', Math.abs(cs[2].r - 128) <= 1);
}

{
  // n=2: just endpoints
  const dark  = { r: 10, g: 10, b: 10 };
  const light = { r: 200, g: 100, b: 50 };
  const cs = interpolateColors(dark, light, 2);
  check('n=2: first is dark',  cs[0].r === 10);
  check('n=2: last is light',  cs[1].r === 200);
}

{
  // n=1 throws
  let threw = false;
  try { interpolateColors({ r:0,g:0,b:0 }, { r:255,g:255,b:255 }, 1); }
  catch { threw = true; }
  check('n=1 throws', threw);
}

// ── paletteFromHex ────────────────────────────────────────────────────────────

section('palette_designer — paletteFromHex');

{
  // 8-color crimson palette (same as PALETTE singleton but built via hex)
  const hexes = ['#000000','#1c0814','#380c20','#681424','#b8281c','#e86024','#ffa840','#ffe088'];
  const pal = paletteFromHex(hexes);

  check('8 hex colors → 9 total (includes transparent)', pal.colors.length === 9);
  check('has transparent at index 0', pal.colors.find(c => c.index === 0)?.a === 0);
  check('has outline at index 1', pal.colors.find(c => c.index === 1) !== undefined);
  check('bodyIndices has 7 entries', pal.bodyIndices.length === 7);
  check('has peakIndex', typeof pal.peakIndex === 'number');
}

{
  // Colors are sorted darkest→lightest regardless of input order
  const shuffled = ['#ffe088','#1c0814','#b8281c','#380c20','#000000','#681424','#e86024','#ffa840'];
  const pal = paletteFromHex(shuffled);
  const bodyColors = pal.bodyIndices.map(i => pal.colors.find(c => c.index === i));
  const lums = bodyColors.map(c => luminance(c.r, c.g, c.b));
  check('body sorted dark→light after shuffle',
    lums.every((l, i) => i === 0 || l >= lums[i - 1]));
}

{
  // 3-color minimal palette
  const pal = paletteFromHex(['#000000', '#808080', '#ffffff']);
  check('3-color: 4 total (with transparent)', pal.colors.length === 4);
  check('3-color: bodyIndices has 2', pal.bodyIndices.length === 2);
  check('3-color: darkest is outline', pal.outlineIndex === 1);
}

{
  // Empty input throws
  let threw = false;
  try { paletteFromHex([]); } catch { threw = true; }
  check('empty hex array throws', threw);
}

{
  // Palette works with transferStyle (band mapping)
  const pal = paletteFromHex(['#000000','#111111','#444444','#888888','#bbbbbb','#dddddd','#eeeeee','#ffffff']);
  check('paletteFromHex result has isBody method', typeof pal.isBody === 'function');
  check('paletteFromHex result has bandLevel method', typeof pal.bandLevel === 'function');
  check('bodyIndices are valid', pal.bodyIndices.every(i => pal.isBody(i)));
}

// ── paletteFromAnchors ────────────────────────────────────────────────────────

section('palette_designer — paletteFromAnchors');

{
  const pal = paletteFromAnchors('#000000', '#ffffff', 8);
  check('8 anchors → 9 total', pal.colors.length === 9);
  check('darkest body near black', luminance(
    pal.colors.find(c => c.index === pal.bodyIndices[0])?.r ?? 0,
    pal.colors.find(c => c.index === pal.bodyIndices[0])?.g ?? 0,
    pal.colors.find(c => c.index === pal.bodyIndices[0])?.b ?? 0
  ) < 60);  // 8-step gray: darkest body ≈ 36 lum
  check('peak body near white', luminance(
    pal.colors.find(c => c.index === pal.peakIndex)?.r ?? 0,
    pal.colors.find(c => c.index === pal.peakIndex)?.g ?? 0,
    pal.colors.find(c => c.index === pal.peakIndex)?.b ?? 0
  ) > 200);
}

{
  // n=6 produces 7 total
  const pal = paletteFromAnchors('#000000', '#ffffff', 6);
  check('n=6 → 7 total colors', pal.colors.length === 7);
  check('n=6 → 5 body indices', pal.bodyIndices.length === 5);
}

{
  // n=2 minimal
  const pal = paletteFromAnchors('#000000', '#ffffff', 2);
  check('n=2 → 3 total (outline + 1 body + transparent)', pal.colors.length === 3);
  check('n=2 → 1 body index', pal.bodyIndices.length === 1);
}

{
  // n=1 throws
  let threw = false;
  try { paletteFromAnchors('#000000', '#ffffff', 1); } catch { threw = true; }
  check('n=1 throws', threw);
}

{
  // Anchors with color (not just gray) produce a colored palette
  const purple = paletteFromAnchors('#0d0020', '#e8c8ff', 8);
  const body   = purple.bodyIndices.map(i => purple.colors.find(c => c.index === i));
  check('purple palette: body colors have non-zero blue',
    body.every(c => c.b > 0));
}

// ── validatePalette ───────────────────────────────────────────────────────────

section('palette_designer — validatePalette');

{
  // Valid 8-color palette
  const pal = paletteFromHex(['#000000','#1c0814','#380c20','#681424','#b8281c','#e86024','#ffa840','#ffe088']);
  const v = validatePalette(pal);
  check('crimson-like palette is valid', v.valid === true);
  check('valid palette has no errors', v.errors.length === 0);
  check('validation has warnings array', Array.isArray(v.warnings));
}

{
  // Too-bright outline → warning (all colors light, so darkest becomes outline but is still too bright)
  const brightOutline = paletteFromHex(['#aaaaaa', '#cccccc', '#dddddd', '#ffffff']);
  const v = validatePalette(brightOutline);
  check('bright outline produces a warning', v.warnings.some(w => w.includes('Outline')));
}

{
  // Narrow luminance spread → warning
  const narrow = paletteFromHex(['#303030','#323232','#343434','#363636']);
  const v = validatePalette(narrow);
  check('narrow spread produces warnings', v.warnings.length > 0);
}

{
  // Good palette: dark outline, bright peak, wide spread
  const good = paletteFromAnchors('#0a0010', '#f0e8ff', 8);
  const v = validatePalette(good);
  check('good wide-spread palette is valid', v.valid);
}

// ── paletteInfo ───────────────────────────────────────────────────────────────

section('palette_designer — paletteInfo');

{
  const pal = paletteFromHex(['#000000','#1c0814','#380c20','#681424','#b8281c','#e86024','#ffa840','#ffe088']);
  const info = paletteInfo(pal);

  check('info has total_colors', typeof info.total_colors === 'number' && info.total_colors > 0);
  check('info has body_count',   typeof info.body_count   === 'number' && info.body_count > 0);
  check('info has outline_hex',  typeof info.outline_hex  === 'string' && info.outline_hex.startsWith('#'));
  check('info has luminance_spread', typeof info.luminance_spread === 'number' && info.luminance_spread >= 0);
  check('info has body array',   Array.isArray(info.body));
  check('info has validation',   typeof info.validation === 'object');
  check('info body entries have hex', info.body.every(c => typeof c.hex === 'string'));
  check('info body entries have luminance', info.body.every(c => typeof c.luminance === 'number'));
  check('info body sorted dark→light', info.body.every((c, i) => i === 0 || c.luminance >= info.body[i-1].luminance));
}

{
  // Minimal 2-color palette
  const pal = paletteFromAnchors('#000000', '#ffffff', 2);
  const info = paletteInfo(pal);
  check('2-color info: body_count=1', info.body_count === 1);
  check('2-color info: has peak_luminance', typeof info.peak_luminance === 'number');
}
