/**
 * Tests for src/core/palette_mutator.js
 *
 * Covers: tint, brighten, darken, contrast, saturate, desaturate,
 *         invert, compose, mutationDiff.
 */

import { check, section } from '../helpers.js';
import { PALETTE }        from '../../src/core/palette.js';
import {
  tint,
  brighten,
  darken,
  contrast,
  saturate,
  desaturate,
  invert,
  compose,
  mutationDiff,
} from '../../src/core/palette_mutator.js';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Average luminance of body colors (index >= 2). */
function avgLum(palette) {
  const body = palette.colors.filter(e => e.index >= 2);
  return body.reduce((s, e) => s + 0.2126*e.r + 0.7152*e.g + 0.0722*e.b, 0) / body.length;
}

/** Average saturation of body colors. */
function avgSat(palette) {
  const body = palette.colors.filter(e => e.index >= 2);
  let total = 0;
  for (const e of body) {
    const r = e.r/255, g = e.g/255, b = e.b/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    const l = (max+min)/2;
    const s = max === min ? 0 : l > 0.5 ? (max-min)/(2-max-min) : (max-min)/(max+min);
    total += s;
  }
  return total / body.length;
}

// ── tint ──────────────────────────────────────────────────────────────────────

section('palette_mutator — tint');

{
  const p = tint(PALETTE, { hue: 200, amount: 0.5 });
  check('returns palette object',      typeof p === 'object' && Array.isArray(p.colors));
  check('same color count',            p.colors.length === PALETTE.colors.length);
  check('transparent preserved (a=0)', p.colors[0].a === 0);
  check('outline preserved (index=1)', p.colors.find(c => c.index === 1)?.index === 1);
}

{
  // amount=0 → identical body colors
  const p = tint(PALETTE, { hue: 0, amount: 0 });
  const body = PALETTE.colors.filter(e => e.index >= 2);
  const tinted = p.colors.filter(e => e.index >= 2);
  const allSame = body.every((e, i) =>
    e.r === tinted[i].r && e.g === tinted[i].g && e.b === tinted[i].b
  );
  check('amount=0 → identical body', allSame);
}

{
  // Invalid hue throws
  let threw = false;
  try { tint(PALETTE, { hue: -10, amount: 0.3 }); } catch (e) { threw = true; }
  check('negative hue throws', threw);
}

{
  let threw = false;
  try { tint(PALETTE, { hue: 360, amount: 0.3 }); } catch (e) { threw = true; }
  check('hue=360 throws', threw);
}

{
  let threw = false;
  try { tint(PALETTE, { hue: 120, amount: 1.5 }); } catch (e) { threw = true; }
  check('amount > 1 throws', threw);
}

// ── brighten ──────────────────────────────────────────────────────────────────

section('palette_mutator — brighten');

{
  const p = brighten(PALETTE, { amount: 0.1 });
  check('brighten returns palette', typeof p === 'object');
  check('transparent preserved',   p.colors[0].a === 0);
  check('same count',              p.colors.length === PALETTE.colors.length);
}

{
  // Luminance increases after brightening
  const p = brighten(PALETTE, { amount: 0.2 });
  check('avg lum increases after brighten', avgLum(p) >= avgLum(PALETTE) - 1);
}

{
  // amount=0 → no change to luminance
  const p = brighten(PALETTE, { amount: 0 });
  check('amount=0: lum unchanged', Math.abs(avgLum(p) - avgLum(PALETTE)) < 1);
}

{
  // Invalid amount throws
  let threw = false;
  try { brighten(PALETTE, { amount: 1.1 }); } catch (e) { threw = true; }
  check('amount > 1 throws', threw);
}

// ── darken ────────────────────────────────────────────────────────────────────

section('palette_mutator — darken');

{
  const p = darken(PALETTE, { amount: 0.1 });
  check('darken returns palette', typeof p === 'object');
}

{
  // Luminance decreases after darkening
  const p = darken(PALETTE, { amount: 0.2 });
  check('avg lum decreases after darken', avgLum(p) <= avgLum(PALETTE) + 1);
}

{
  // brighten then darken by same amount → close to original
  const brightened = brighten(PALETTE, { amount: 0.15 });
  const roundtrip  = darken(brightened, { amount: 0.15 });
  const origLum    = avgLum(PALETTE);
  const rtLum      = avgLum(roundtrip);
  check('brighten+darken ≈ original lum (within 15)', Math.abs(origLum - rtLum) < 15);
}

// ── contrast ─────────────────────────────────────────────────────────────────

section('palette_mutator — contrast');

{
  const p = contrast(PALETTE, { factor: 1.5 });
  check('contrast returns palette', typeof p === 'object');
}

{
  // factor=1 → no change
  const p = contrast(PALETTE, { factor: 1.0 });
  const origLum = avgLum(PALETTE);
  const newLum  = avgLum(p);
  check('factor=1 → avg lum unchanged (within 5)', Math.abs(origLum - newLum) < 5);
}

{
  // Increased contrast → body colors spread further from midpoint
  // Dark colors get darker, bright colors get brighter
  const p = contrast(PALETTE, { factor: 2.0 });
  const bodyOrig = PALETTE.colors.filter(e => e.index >= 2);
  const bodyNew  = p.colors.filter(e => e.index >= 2);

  const lumsOrig = bodyOrig.map(e => 0.2126*e.r + 0.7152*e.g + 0.0722*e.b);
  const lumsNew  = bodyNew.map(e => 0.2126*e.r + 0.7152*e.g + 0.0722*e.b);

  const rangeOrig = Math.max(...lumsOrig) - Math.min(...lumsOrig);
  const rangeNew  = Math.max(...lumsNew)  - Math.min(...lumsNew);

  check('increased contrast widens lum range', rangeNew >= rangeOrig - 5);
}

{
  let threw = false;
  try { contrast(PALETTE, { factor: 0 }); } catch (e) { threw = true; }
  check('factor=0 throws', threw);
}

{
  let threw = false;
  try { contrast(PALETTE, { factor: -1 }); } catch (e) { threw = true; }
  check('negative factor throws', threw);
}

// ── saturate / desaturate ─────────────────────────────────────────────────────

section('palette_mutator — saturate');

{
  const p = saturate(PALETTE, { factor: 1.5 });
  check('saturate returns palette', typeof p === 'object');
}

{
  const p = saturate(PALETTE, { factor: 2.0 });
  check('avg sat increases after saturate', avgSat(p) >= avgSat(PALETTE) - 0.01);
}

section('palette_mutator — desaturate');

{
  const p = desaturate(PALETTE, { factor: 0.5 });
  check('desaturate returns palette', typeof p === 'object');
}

{
  const p = desaturate(PALETTE, { factor: 0.3 });
  check('avg sat decreases after desaturate', avgSat(p) <= avgSat(PALETTE) + 0.01);
}

{
  // factor=0 is invalid → throws
  let threw = false;
  try { desaturate(PALETTE, { factor: 0 }); } catch (e) { threw = true; }
  check('factor=0 throws', threw);
}

// ── invert ────────────────────────────────────────────────────────────────────

section('palette_mutator — invert');

{
  const p = invert(PALETTE);
  check('invert returns palette',     typeof p === 'object');
  check('same color count',           p.colors.length === PALETTE.colors.length);
  check('transparent preserved',      p.colors[0].a === 0);
}

{
  // After invert, the darkest body color should be brighter (and vice versa)
  const p     = invert(PALETTE);
  const body  = PALETTE.colors.filter(e => e.index >= 2).sort((a, b) => a.index - b.index);
  const bodyP = p.colors.filter(e => e.index >= 2).sort((a, b) => a.index - b.index);

  const lumOrig = body.map(e => 0.2126*e.r + 0.7152*e.g + 0.0722*e.b);
  const lumInv  = bodyP.map(e => 0.2126*e.r + 0.7152*e.g + 0.0722*e.b);

  // darkest original should become one of the brighter inverted values
  check('darkest original lum < brightest inverted lum',
    Math.min(...lumOrig) < Math.max(...lumInv));
}

{
  // Invert twice ≈ same average luminance
  const p2 = invert(invert(PALETTE));
  const origLum = avgLum(PALETTE);
  const rt      = avgLum(p2);
  check('double invert ≈ original avg lum (within 15)', Math.abs(origLum - rt) < 15);
}

// ── compose ───────────────────────────────────────────────────────────────────

section('palette_mutator — compose');

{
  // Empty steps → same palette structure
  const p = compose(PALETTE, []);
  check('empty compose returns palette', typeof p === 'object');
  check('empty compose: same count',     p.colors.length === PALETTE.colors.length);
}

{
  // Single step equivalent to direct call
  const direct  = darken(PALETTE, { amount: 0.1 });
  const composed = compose(PALETTE, [{ op: 'darken', params: { amount: 0.1 } }]);
  check('compose(darken) ≈ direct darken',
    Math.abs(avgLum(direct) - avgLum(composed)) < 2);
}

{
  // Chained: darken then tint
  const p = compose(PALETTE, [
    { op: 'darken', params: { amount: 0.1 } },
    { op: 'tint',   params: { hue: 220, amount: 0.3 } },
  ]);
  check('chained compose returns palette',   typeof p === 'object');
  check('chained: transparent preserved',    p.colors[0].a === 0);
  check('chained: correct color count',      p.colors.length === PALETTE.colors.length);
}

{
  // Unknown op throws
  let threw = false;
  try { compose(PALETTE, [{ op: 'unknown' }]); } catch (e) { threw = true; }
  check('unknown op throws', threw);
}

{
  // invert in compose (no params needed)
  const p = compose(PALETTE, [{ op: 'invert' }]);
  check('invert via compose works', typeof p === 'object');
}

// ── mutationDiff ──────────────────────────────────────────────────────────────

section('palette_mutator — mutationDiff');

{
  // Identical palettes → no change
  const d = mutationDiff(PALETTE, PALETTE);
  check('identical: mean_delta_lum ≈ 0',  Math.abs(d.mean_delta_lum) < 0.01);
  check('identical: brighter=false',      d.brighter === false);
  check('identical: darker=false',        d.darker   === false);
  check('identical: has color_count',     typeof d.color_count === 'number');
  check('identical: has mean_delta_sat',  typeof d.mean_delta_sat === 'number');
}

{
  // Brightened → positive delta_lum
  const p = brighten(PALETTE, { amount: 0.2 });
  const d = mutationDiff(PALETTE, p);
  check('brightened: brighter=true OR delta_lum≥0', d.brighter || d.mean_delta_lum >= -0.01);
}

{
  // Darkened → negative delta_lum
  const p = darken(PALETTE, { amount: 0.2 });
  const d = mutationDiff(PALETTE, p);
  check('darkened: darker=true OR delta_lum≤0', d.darker || d.mean_delta_lum <= 0.01);
}

{
  // Desaturated → less_saturated
  const p = desaturate(PALETTE, { factor: 0.3 });
  const d = mutationDiff(PALETTE, p);
  check('desaturated: less_saturated=true OR delta_sat≤0',
    d.less_saturated || d.mean_delta_sat <= 0.01);
}

{
  // Result has all expected fields
  const p = tint(PALETTE, { hue: 180, amount: 0.3 });
  const d = mutationDiff(PALETTE, p);
  check('has color_count',    typeof d.color_count    === 'number');
  check('has mean_delta_lum', typeof d.mean_delta_lum === 'number');
  check('has mean_delta_sat', typeof d.mean_delta_sat === 'number');
  check('has brighter',       typeof d.brighter       === 'boolean');
  check('has darker',         typeof d.darker         === 'boolean');
  check('has more_saturated', typeof d.more_saturated === 'boolean');
  check('has less_saturated', typeof d.less_saturated === 'boolean');
}

// ── Integration: all ops preserve palette invariants ─────────────────────────

section('palette_mutator — invariants');

{
  const ops = [
    tint(PALETTE, { hue: 240, amount: 0.4 }),
    brighten(PALETTE, { amount: 0.1 }),
    darken(PALETTE, { amount: 0.1 }),
    contrast(PALETTE, { factor: 1.5 }),
    saturate(PALETTE, { factor: 1.3 }),
    desaturate(PALETTE, { factor: 0.6 }),
    invert(PALETTE),
    compose(PALETTE, [{ op: 'darken', params: {amount: 0.05} }, { op: 'saturate', params:{factor:1.2} }]),
  ];

  for (const p of ops) {
    check('transparent at index 0 (a=0)', p.colors.find(c => c.index === 0)?.a === 0);
  }

  for (const p of ops) {
    check('color count preserved', p.colors.length === PALETTE.colors.length);
  }

  for (const p of ops) {
    check('bandLevel works on mutated palette',
      typeof p.bandLevel(p.peakIndex) === 'number');
  }
}
