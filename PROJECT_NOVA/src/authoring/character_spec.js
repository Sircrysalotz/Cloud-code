/**
 * character_spec.js — Phase 16: Character specification API.
 *
 * Define a character once in JSON, get a complete sprite set back.
 *
 * Character spec format:
 * {
 *   name:     string,                   — character identifier
 *   palette:  PaletteSpec,              — color scheme definition
 *   poses:    string[],                 — which poses to generate (default: all)
 *   animate:  string[],                 — which poses to make into animations
 *   calibrate: boolean,                 — Goku-calibrate generation (default: true)
 *   options:  { maxIter, targetRmsZ, scale, fps }
 * }
 *
 * PaletteSpec can be:
 *   { preset: 'crimson'|'cool'|'warm'|'forest'|'mono' }
 *   { hex: ['#000', '#111', ..., '#fff'] }
 *   { anchors: ['#dark', '#light'], n: 8 }
 *
 * Returns a CharacterResult:
 * {
 *   name, spec,
 *   palette,               — resolved Palette object
 *   variants,              — VariantLibrary (all poses × this palette)
 *   animations,            — { [poseName]: { grids, timings } }
 *   quality,               — { grade, verdict, genMean, refMean }
 *   report,                — plain-object AI-readable summary
 * }
 */

import { paletteFromHex, paletteFromAnchors, validatePalette, paletteInfo } from '../core/palette_designer.js';
import { POSE_NAMES }                  from './poses.js';
import { buildVariantLibrary }         from './variant_engine.js';
import { buildIdleAnimation, buildPoseAnimation, buildFrameVariants } from '../../tools/generate_animation.js';
import { computeGenerationQuality }    from '../../tools/quality_report.js';
import { runIteration }                from '../../tools/goku_iterate.js';
import { poseParams }                  from './poses.js';

// ── Built-in palette definitions ──────────────────────────────────────────────

const PRESET_PALETTES = {
  crimson: ['#000000','#1c0814','#380c20','#681424','#b8281c','#e86024','#ffa840','#ffe088'],
  cool:    ['#000000','#0a081e','#141450','#282878','#4650b4','#648cdc','#a0c8ff','#dcf0ff'],
  warm:    ['#000000','#1e0a00','#501900','#8c3205','#d26414','#f09628','#ffc850','#fff0a0'],
  forest:  ['#000000','#081408','#0f280f','#1e4619','#326e28','#509b3c','#8cc85a','#c8f096'],
  mono:    ['#000000','#141414','#2d2d2d','#505050','#787878','#a0a0a0','#c8c8c8','#f0f0f0'],
};

// ── Spec validation ───────────────────────────────────────────────────────────

const VALID_POSES    = new Set(POSE_NAMES);
const DEFAULT_OPTIONS = { maxIter: 25, targetRmsZ: 0.70, scale: 6, fps: 8 };

/**
 * Validate a character spec. Returns { valid, errors }.
 *
 * @param {object} spec
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCharacterSpec(spec) {
  const errors = [];

  if (!spec || typeof spec !== 'object') {
    return { valid: false, errors: ['spec must be an object'] };
  }

  // name
  if (!spec.name || typeof spec.name !== 'string') {
    errors.push('spec.name is required (string)');
  } else if (!/^[a-zA-Z0-9_-]+$/.test(spec.name)) {
    errors.push('spec.name must be alphanumeric with _ or - only');
  }

  // palette
  if (!spec.palette || typeof spec.palette !== 'object') {
    errors.push('spec.palette is required (object with preset|hex|anchors)');
  } else {
    const p = spec.palette;
    if (!p.preset && !p.hex && !p.anchors) {
      errors.push('spec.palette must have preset, hex, or anchors');
    }
    if (p.preset && !PRESET_PALETTES[p.preset]) {
      errors.push(`spec.palette.preset unknown: ${p.preset}. Options: ${Object.keys(PRESET_PALETTES).join(', ')}`);
    }
    if (p.hex && (!Array.isArray(p.hex) || p.hex.length < 2)) {
      errors.push('spec.palette.hex must be an array of ≥ 2 hex strings');
    }
    if (p.anchors && (!Array.isArray(p.anchors) || p.anchors.length !== 2)) {
      errors.push('spec.palette.anchors must be exactly [darkHex, lightHex]');
    }
  }

  // poses
  if (spec.poses !== undefined) {
    if (!Array.isArray(spec.poses)) {
      errors.push('spec.poses must be an array of pose names');
    } else {
      const invalid = spec.poses.filter(p => !VALID_POSES.has(p));
      if (invalid.length > 0) {
        errors.push(`spec.poses contains unknown poses: ${invalid.join(', ')}. Valid: ${POSE_NAMES.join(', ')}`);
      }
    }
  }

  // animate
  if (spec.animate !== undefined) {
    if (!Array.isArray(spec.animate)) {
      errors.push('spec.animate must be an array of pose names');
    } else {
      const poses  = spec.poses ?? POSE_NAMES;
      const invalid = spec.animate.filter(p => !VALID_POSES.has(p) || !poses.includes(p));
      if (invalid.length > 0) {
        errors.push(`spec.animate references poses not in spec.poses: ${invalid.join(', ')}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Palette resolver ──────────────────────────────────────────────────────────

/**
 * Resolve a PaletteSpec to a Palette object.
 */
export function resolvePaletteSpec(paletteSpec) {
  if (paletteSpec.preset) {
    const hexes = PRESET_PALETTES[paletteSpec.preset];
    if (!hexes) throw new Error(`Unknown palette preset: ${paletteSpec.preset}`);
    return paletteFromHex(hexes);
  }
  if (paletteSpec.hex) {
    return paletteFromHex(paletteSpec.hex);
  }
  if (paletteSpec.anchors) {
    const [dark, light] = paletteSpec.anchors;
    const n = paletteSpec.n ?? 8;
    return paletteFromAnchors(dark, light, n);
  }
  throw new Error('PaletteSpec must have preset, hex, or anchors');
}

// ── Main API ──────────────────────────────────────────────────────────────────

/**
 * Build a complete character sprite set from a spec.
 *
 * @param {object} spec         — character specification
 * @param {object} distribution — Goku reference distribution
 * @param {object} [progressFn] — optional progress callback(msg)
 * @returns {CharacterResult}
 */
export function buildCharacter(spec, distribution, progressFn = null) {
  const { valid, errors } = validateCharacterSpec(spec);
  if (!valid) throw new Error(`Invalid character spec:\n  ${errors.join('\n  ')}`);

  const log = msg => { if (progressFn) progressFn(msg); };

  const opts = { ...DEFAULT_OPTIONS, ...(spec.options ?? {}) };
  const poses    = spec.poses   ?? POSE_NAMES;
  const animate  = spec.animate ?? [];
  const calibrate = spec.calibrate !== false;

  // ── Resolve palette ────────────────────────────────────────────────────

  log('Resolving palette...');
  const palette  = resolvePaletteSpec(spec.palette);
  const palInfo  = paletteInfo(palette);
  const palValid = validatePalette(palette);

  // ── Generate variants ──────────────────────────────────────────────────

  log(`Generating variants: ${poses.length} poses...`);
  const library = buildVariantLibrary({
    poses,
    palettes: [{ key: spec.name, palette }],
    distribution,
    opts: {
      maxIter:     opts.maxIter,
      targetRmsZ:  opts.targetRmsZ,
      onProgress:  e => log(`  ${e.msg} (${e.done}/${e.total})`),
    },
  });

  // ── Build animations ───────────────────────────────────────────────────

  const animations = {};
  for (const poseName of animate) {
    log(`Animating ${poseName}...`);
    if (poseName === 'idle') {
      // 4-frame breathing cycle from calibrated base
      animations[poseName] = buildIdleAnimation(distribution, {
        fps: opts.fps, maxIter: opts.maxIter, targetRmsZ: opts.targetRmsZ,
      });
    } else {
      // Single-frame hold for other poses (future: multi-frame)
      const { bestParams } = runIteration(poseParams(poseName), distribution, {
        maxIter: opts.maxIter, targetRmsZ: opts.targetRmsZ,
      });
      const grids   = buildFrameVariants(bestParams, 1);
      const timings = [Math.round(1000 / opts.fps)];
      animations[poseName] = { grids, timings };
    }
  }

  // ── Quality assessment ─────────────────────────────────────────────────

  const genRmsZs  = library.cells.map(c => c.bandRmsZ);
  const quality   = computeGenerationQuality(genRmsZs, { mean: 0.61, stddev: 0.28 });

  // ── Build report ───────────────────────────────────────────────────────

  const report = {
    name:         spec.name,
    poses,
    palette_info: {
      type:        spec.palette.preset ?? (spec.palette.anchors ? 'anchors' : 'hex'),
      valid:       palValid.valid,
      warnings:    palValid.warnings,
      body_count:  palInfo.body_count,
      lum_spread:  palInfo.luminance_spread,
    },
    generation: {
      total_variants: library.summary.totalCells,
      mean_band_rmsZ: library.summary.meanBandRmsZ,
      pass_rate:      library.summary.passRate,
    },
    quality: {
      grade:   quality.grade,
      verdict: quality.verdict,
      ratio:   quality.ratio,
    },
    animations: Object.fromEntries(
      Object.entries(animations).map(([name, { grids, timings }]) => [
        name,
        { frame_count: grids.length, total_ms: timings.reduce((s, t) => s + t, 0) },
      ])
    ),
  };

  return {
    name: spec.name,
    spec,
    palette,
    palInfo,
    library,
    animations,
    quality,
    report,
  };
}
