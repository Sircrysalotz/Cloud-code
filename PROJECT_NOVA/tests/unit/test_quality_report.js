/**
 * Tests for tools/quality_report.js
 *
 * Covers: evaluateGridAgainstRef, computeBandRmsZ,
 *         buildIngestedStats, computeGenerationQuality.
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import { PALETTE }        from '../../src/core/palette.js';
import { loadBatchReference } from '../../src/eval/reference_lib.js';
import {
  evaluateGridAgainstRef,
  computeBandRmsZ,
  buildIngestedStats,
  computeGenerationQuality,
} from '../../tools/quality_report.js';

// ── computeBandRmsZ ───────────────────────────────────────────────────────────

section('quality_report — computeBandRmsZ');

{
  // All zeros → rmsZ=0
  const results = {
    shadow_deep_ratio: { z: 0 },
    shadow_ratio:      { z: 0 },
    mid_ratio:         { z: 0 },
    bright_ratio:      { z: 0 },
    highlight_ratio:   { z: 0 },
    peak_ratio:        { z: 0 },
  };
  check('all-zero z-scores → band rmsZ=0', computeBandRmsZ(results) === 0);
}

{
  // All z=1 → rmsZ=1
  const results = Object.fromEntries(
    ['shadow_deep_ratio','shadow_ratio','mid_ratio','bright_ratio','highlight_ratio','peak_ratio']
      .map(k => [k, { z: 1 }])
  );
  check('all z=1 → band rmsZ=1', Math.abs(computeBandRmsZ(results) - 1) < 1e-9);
}

{
  // z=2 for one key, 0 for others → rmsZ = sqrt(4/6) ≈ 0.816
  const results = {
    shadow_deep_ratio: { z: 2 },
    shadow_ratio:      { z: 0 },
    mid_ratio:         { z: 0 },
    bright_ratio:      { z: 0 },
    highlight_ratio:   { z: 0 },
    peak_ratio:        { z: 0 },
  };
  const expected = Math.sqrt(4 / 6);
  check('one z=2 rest 0 → rmsZ=sqrt(4/6)',
    Math.abs(computeBandRmsZ(results) - expected) < 1e-9);
}

{
  // Missing band keys → those are skipped, not treated as 0
  const results = {
    shadow_deep_ratio: { z: 3 },  // only 1 of 6 present
    some_other_key:    { z: 99 }, // ignored (not a band key)
  };
  check('missing band keys skipped: rmsZ based on present only',
    Math.abs(computeBandRmsZ(results) - 3) < 1e-9);
}

{
  // Empty results → 0
  check('empty results → band rmsZ=0', computeBandRmsZ({}) === 0);
}

{
  // Structural keys are not included
  const results = {
    symmetry_score:    { z: 10 },  // structural — should NOT affect band rmsZ
    shadow_deep_ratio: { z: 0 },
    shadow_ratio:      { z: 0 },
    mid_ratio:         { z: 0 },
    bright_ratio:      { z: 0 },
    highlight_ratio:   { z: 0 },
    peak_ratio:        { z: 0 },
  };
  check('structural keys excluded from band rmsZ', computeBandRmsZ(results) === 0);
}

// ── computeGenerationQuality ──────────────────────────────────────────────────

section('quality_report — computeGenerationQuality');

{
  // Generated better than reference → grade S or A
  const q = computeGenerationQuality([0.3, 0.4, 0.5], { mean: 0.6, stddev: 0.1 });
  check('gen < ref → ratio < 1', q.ratio < 1);
  check('gen < ref → grade A or S', q.grade === 'S' || q.grade === 'A');
  check('genMean matches input', Math.abs(q.genMean - (0.3+0.4+0.5)/3) < 1e-9);
  check('refMean matches input', Math.abs(q.refMean - 0.6) < 1e-9);
}

{
  // Generated matches reference → grade A
  const q = computeGenerationQuality([0.6, 0.6, 0.6], { mean: 0.6, stddev: 0.1 });
  check('gen = ref → ratio ≈ 1', Math.abs(q.ratio - 1.0) < 1e-9);
  check('gen = ref → grade A', q.grade === 'A');
}

{
  // Generated 1.2× reference → grade B
  const q = computeGenerationQuality([0.72], { mean: 0.6, stddev: 0.1 });
  check('gen 1.2× ref → grade B', q.grade === 'B');
}

{
  // Generated 1.5× reference → grade C
  const q = computeGenerationQuality([0.9], { mean: 0.6, stddev: 0.1 });
  check('gen 1.5× ref → grade C', q.grade === 'C');
}

{
  // Generated 2× reference → grade D
  const q = computeGenerationQuality([1.2], { mean: 0.6, stddev: 0.1 });
  check('gen 2× ref → grade D', q.grade === 'D');
}

{
  // Empty generated → unknown
  const q = computeGenerationQuality([], { mean: 0.6, stddev: 0.1 });
  check('empty generated → unknown grade', q.grade === 'unknown');
}

{
  // quality object has all required fields
  const q = computeGenerationQuality([0.5], { mean: 0.6, stddev: 0.1 });
  check('quality has genMean', typeof q.genMean === 'number');
  check('quality has refMean', typeof q.refMean === 'number');
  check('quality has ratio',   typeof q.ratio === 'number');
  check('quality has grade',   typeof q.grade === 'string');
  check('quality has verdict', typeof q.verdict === 'string' && q.verdict.length > 0);
}

// ── evaluateGridAgainstRef ────────────────────────────────────────────────────

section('quality_report — evaluateGridAgainstRef');

const ref = loadBatchReference();
const dist = ref?.distribution ?? null;

if (!dist) {
  check('batch reference available for quality_report tests', false);
} else {
  {
    // Simple all-transparent grid → body_count=0, band ratios all 0
    const grid = [[0, 0], [0, 0]];
    const result = evaluateGridAgainstRef(grid, PALETTE, dist);

    check('result has metrics',    typeof result.metrics === 'object');
    check('result has bandRmsZ',   typeof result.bandRmsZ === 'number');
    check('result has fullRmsZ',   typeof result.fullRmsZ === 'number');
    check('result has comparison', typeof result.comparison === 'object');
    check('bandRmsZ is finite',    isFinite(result.bandRmsZ) && result.bandRmsZ >= 0);
    check('fullRmsZ is finite',    isFinite(result.fullRmsZ) && result.fullRmsZ >= 0);
    check('comparison has results', typeof result.comparison.results === 'object');
    check('comparison has flags',   Array.isArray(result.comparison.flags));
  }

  {
    // A grid with some body pixels should have non-zero bandRmsZ
    // Build a minimal 4×4 grid: outline border + body fill (indices 1-7)
    const g = [
      [1, 1, 1, 1],
      [1, 4, 4, 1],
      [1, 2, 3, 1],
      [1, 1, 1, 1],
    ];
    const result = evaluateGridAgainstRef(g, PALETTE, dist);
    check('grid with body pixels: metrics body_count > 0',
      result.metrics.body_count > 0);
    check('grid with body pixels: bandRmsZ is numeric', typeof result.bandRmsZ === 'number');
  }

  {
    // Goku-calibrated idle pose should score well (band rmsZ < 2.0)
    // Load directly from exports/poses/idle.json
    const { existsSync, readFileSync } = await import('fs');
    const { join }                     = await import('path');
    const { paletteFromRGB }           = await import('../../src/core/palette.js');
    const idlePath = new URL('../../exports/poses/idle.json', import.meta.url).pathname;
    if (existsSync(idlePath)) {
      const raw     = JSON.parse(readFileSync(idlePath, 'utf8'));
      const grid    = raw.data.map(row => new Uint8Array(row));
      // Use the palette embedded in the sidecar (original dynamic palette or style-transferred)
      const palette = raw.palette_colors ? paletteFromRGB(raw.palette_colors) : PALETTE;
      const result  = evaluateGridAgainstRef(grid, palette, dist);
      check('generated idle: bandRmsZ < 2.0', result.bandRmsZ < 2.0);
      check('generated idle: fullRmsZ is finite', isFinite(result.fullRmsZ));
    } else {
      check('generated idle pose exists (exports/poses/idle.json)', false);
    }
  }

// ── buildIngestedStats ────────────────────────────────────────────────────────

  section('quality_report — buildIngestedStats');

  {
    // Empty frame names → zero stats
    const stats = buildIngestedStats([], dist, 50);
    check('empty frames → mean=0', stats.mean === 0);
    check('empty frames → count=0', stats.count === 0);
    check('empty frames → values is empty array', Array.isArray(stats.values) && stats.values.length === 0);
  }

  {
    // With actual batch frames, stats should be reasonable
    const { readdirSync, readFileSync: rf, existsSync: es } = await import('fs');
    const { join: pj } = await import('path');
    const batchDir = new URL('../../exports/batch', import.meta.url).pathname;

    if (es(batchDir)) {
      const names = readdirSync(batchDir)
        .filter(f => f.endsWith('_palette.json'))
        .map(f => f.replace('_palette.json', ''))
        .slice(0, 10);  // just a few for speed

      if (names.length > 0) {
        const stats = buildIngestedStats(names, dist, 10);
        check('ingested stats: count > 0', stats.count > 0);
        check('ingested stats: mean is finite and > 0', isFinite(stats.mean) && stats.mean > 0);
        check('ingested stats: stddev >= 0', stats.stddev >= 0);
        check('ingested stats: min <= mean', stats.min <= stats.mean + 1e-9);
        check('ingested stats: max >= mean', stats.max >= stats.mean - 1e-9);
        check('ingested stats: values array matches count', stats.values.length === stats.count);
        check('ingested stats: all values are finite', stats.values.every(v => isFinite(v)));
      }
    }
  }

// ── Integration: full quality assessment ────────────────────────────────────

  section('quality_report — integration');

  {
    // Generate results for 2 poses and compute quality
    const { buildFromParams } = await import('../../src/authoring/parametric.js');
    const { idleParams }      = await import('../../src/authoring/poses.js');

    const p    = idleParams();
    const grid = buildFromParams(p);
    const r    = evaluateGridAgainstRef(grid, PALETTE, dist);

    check('integration: evaluateGridAgainstRef returns valid result',
      typeof r.bandRmsZ === 'number' && isFinite(r.bandRmsZ));

    const quality = computeGenerationQuality([r.bandRmsZ], { mean: 0.6, stddev: 0.2 });
    check('integration: computeGenerationQuality returns grade',
      ['S','A','B','C','D','unknown'].includes(quality.grade));
  }
}
