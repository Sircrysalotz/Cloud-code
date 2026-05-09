/**
 * Tests for src/authoring/character_spec.js
 *
 * Covers: validateCharacterSpec, resolvePaletteSpec, buildCharacter.
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import { PALETTE }        from '../../src/core/palette.js';
import { loadBatchReference } from '../../src/eval/reference_lib.js';
import {
  validateCharacterSpec,
  resolvePaletteSpec,
  buildCharacter,
} from '../../src/authoring/character_spec.js';

// ── validateCharacterSpec ─────────────────────────────────────────────────────

section('character_spec — validateCharacterSpec');

{
  // Minimal valid spec
  const v = validateCharacterSpec({ name: 'warrior', palette: { preset: 'crimson' } });
  check('minimal spec is valid', v.valid === true);
  check('no errors', v.errors.length === 0);
}

{
  // Full valid spec
  const v = validateCharacterSpec({
    name:      'my_hero',
    palette:   { anchors: ['#000000', '#ffffff'], n: 8 },
    poses:     ['idle', 'punch'],
    animate:   ['idle'],
    calibrate: true,
    options:   { maxIter: 20, targetRmsZ: 0.70, scale: 4, fps: 8 },
  });
  check('full spec is valid', v.valid === true);
  check('full spec no errors', v.errors.length === 0);
}

{
  // Missing name
  const v = validateCharacterSpec({ palette: { preset: 'cool' } });
  check('missing name → invalid', !v.valid);
  check('missing name → error about name', v.errors.some(e => e.includes('name')));
}

{
  // Invalid name (spaces)
  const v = validateCharacterSpec({ name: 'my hero', palette: { preset: 'cool' } });
  check('name with space → invalid', !v.valid);
}

{
  // Missing palette
  const v = validateCharacterSpec({ name: 'hero' });
  check('missing palette → invalid', !v.valid);
  check('missing palette → error about palette', v.errors.some(e => e.includes('palette')));
}

{
  // Palette with none of preset/hex/anchors
  const v = validateCharacterSpec({ name: 'hero', palette: {} });
  check('empty palette → invalid', !v.valid);
}

{
  // Unknown preset
  const v = validateCharacterSpec({ name: 'hero', palette: { preset: 'unknown_palette' } });
  check('unknown preset → invalid', !v.valid);
  check('unknown preset → mentions preset', v.errors.some(e => e.includes('preset')));
}

{
  // Unknown pose in poses
  const v = validateCharacterSpec({ name: 'hero', palette: { preset: 'cool' }, poses: ['idle', 'fly'] });
  check('unknown pose → invalid', !v.valid);
  check('unknown pose → mentions poses', v.errors.some(e => e.includes('poses')));
}

{
  // animate references pose not in poses
  const v = validateCharacterSpec({
    name: 'hero', palette: { preset: 'cool' },
    poses: ['idle'], animate: ['punch'],  // punch not in poses
  });
  check('animate with missing pose → invalid', !v.valid);
  check('animate error mentions animate', v.errors.some(e => e.includes('animate')));
}

{
  // hex palette too short
  const v = validateCharacterSpec({ name: 'x', palette: { hex: ['#000000'] } });
  check('hex with 1 color → invalid', !v.valid);
}

{
  // anchors with wrong count
  const v = validateCharacterSpec({ name: 'x', palette: { anchors: ['#000000'] } });
  check('anchors with 1 color → invalid', !v.valid);
}

{
  // null spec
  const v = validateCharacterSpec(null);
  check('null spec → invalid', !v.valid);
}

// ── resolvePaletteSpec ────────────────────────────────────────────────────────

section('character_spec — resolvePaletteSpec');

{
  // Preset
  const pal = resolvePaletteSpec({ preset: 'crimson' });
  check('crimson preset: 9 colors', pal.colors.length === 9);
  check('crimson preset: has bodyIndices', pal.bodyIndices.length > 0);
}

{
  // Hex array
  const pal = resolvePaletteSpec({
    hex: ['#000000','#1c0814','#380c20','#681424','#b8281c','#e86024','#ffa840','#ffe088'],
  });
  check('hex spec: 9 colors', pal.colors.length === 9);
}

{
  // Anchors
  const pal = resolvePaletteSpec({ anchors: ['#000000', '#ffffff'], n: 6 });
  check('anchors n=6: 7 colors', pal.colors.length === 7);
  check('anchors n=6: 5 body', pal.bodyIndices.length === 5);
}

{
  // Anchors default n=8
  const pal = resolvePaletteSpec({ anchors: ['#000000', '#ffffff'] });
  check('anchors default n=8: 9 colors', pal.colors.length === 9);
}

{
  // Unknown preset throws
  let threw = false;
  try { resolvePaletteSpec({ preset: 'neon_purple' }); } catch { threw = true; }
  check('unknown preset throws', threw);
}

{
  // Missing spec type throws
  let threw = false;
  try { resolvePaletteSpec({}); } catch { threw = true; }
  check('empty palette spec throws', threw);
}

// ── buildCharacter ────────────────────────────────────────────────────────────

section('character_spec — buildCharacter');

const ref  = loadBatchReference();
const dist = ref?.distribution ?? null;

if (!dist) {
  check('batch reference available for character_spec tests', false);
} else {

  {
    // Minimal build: 1 pose, 1 palette, no animation
    const result = buildCharacter({
      name:    'test_char',
      palette: { preset: 'cool' },
      poses:   ['idle'],
      animate: [],
      options: { maxIter: 8, targetRmsZ: 1.5 },
    }, dist);

    check('result has name',      result.name === 'test_char');
    check('result has palette',   typeof result.palette === 'object');
    check('result has palInfo',   typeof result.palInfo === 'object');
    check('result has library',   typeof result.library === 'object');
    check('result has animations', typeof result.animations === 'object');
    check('result has quality',   typeof result.quality === 'object');
    check('result has report',    typeof result.report === 'object');
    check('library has 1 cell (1 pose × 1 palette)', result.library.cells.length === 1);
    check('animations is empty (no animate)', Object.keys(result.animations).length === 0);
  }

  {
    // With animation
    const result = buildCharacter({
      name:    'animated_char',
      palette: { preset: 'mono' },
      poses:   ['idle'],
      animate: ['idle'],
      options: { maxIter: 8, targetRmsZ: 1.5, fps: 8 },
    }, dist);

    check('idle animation generated', 'idle' in result.animations);
    check('idle animation has 4 frames', result.animations.idle.grids.length === 4);
    check('idle animation has 4 timings', result.animations.idle.timings.length === 4);
    check('report has animation info', 'idle' in result.report.animations);
    check('report animation has frame_count', result.report.animations.idle.frame_count === 4);
  }

  {
    // Quality grade in valid range
    const result = buildCharacter({
      name:    'grade_test',
      palette: { preset: 'warm' },
      poses:   ['idle'],
      options: { maxIter: 8, targetRmsZ: 1.5 },
    }, dist);

    check('quality grade is a letter', ['S','A','B','C','D','unknown'].includes(result.quality.grade));
    check('quality has verdict string', typeof result.quality.verdict === 'string');
    check('quality has ratio', typeof result.quality.ratio === 'number');
  }

  {
    // Invalid spec throws
    let threw = false;
    try {
      buildCharacter({ name: 'bad char!', palette: { preset: 'cool' } }, dist);
    } catch { threw = true; }
    check('invalid spec throws', threw);
  }

  {
    // Report is fully AI-readable (no undefined/null values in key fields)
    const result = buildCharacter({
      name:    'ai_readable',
      palette: { anchors: ['#0a0020', '#e0c8ff'] },
      poses:   ['idle'],
      options: { maxIter: 5, targetRmsZ: 2.0 },
    }, dist);

    const { report } = result;
    check('report.name is string',       typeof report.name === 'string');
    check('report.poses is array',       Array.isArray(report.poses));
    check('report.palette_info is obj',  typeof report.palette_info === 'object');
    check('report.generation is obj',    typeof report.generation === 'object');
    check('report.quality.grade exists', typeof report.quality.grade === 'string');
    check('report.generation.total_variants > 0', report.generation.total_variants > 0);
    check('report.generation.mean_band_rmsZ finite',
      isFinite(report.generation.mean_band_rmsZ));
  }

  {
    // Progress callback is called
    const logs = [];
    buildCharacter({
      name:    'progress_test',
      palette: { preset: 'forest' },
      poses:   ['idle'],
      options: { maxIter: 5, targetRmsZ: 2.0 },
    }, dist, msg => logs.push(msg));

    check('progress callback was called', logs.length > 0);
    check('progress messages are strings', logs.every(m => typeof m === 'string'));
  }
}
