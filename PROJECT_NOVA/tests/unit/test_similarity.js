/**
 * Tests for src/eval/similarity.js
 *
 * Covers: cosineSim, euclideanDist, meanAbsDiff, metricsToVectors,
 *         computeMetricSimilarity, compareGrids, findMostSimilar.
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import { PALETTE }        from '../../src/core/palette.js';
import { computeMetrics } from '../../src/eval/metrics.js';
import { loadBatchReference } from '../../src/eval/reference_lib.js';
import {
  BAND_KEYS, STRUCT_KEYS, GRADE_THRESHOLDS,
  cosineSim, euclideanDist, meanAbsDiff,
  metricsToVectors, computeMetricSimilarity,
  compareGrids, findMostSimilar, gradeLabel,
} from '../../src/eval/similarity.js';

// ── Math helpers ──────────────────────────────────────────────────────────────

section('similarity — cosineSim');

{
  check('identical vectors → 1', Math.abs(cosineSim([1,2,3], [1,2,3]) - 1) < 1e-9);
  check('orthogonal → 0', Math.abs(cosineSim([1,0,0], [0,1,0])) < 1e-9);
  check('opposite → -1', Math.abs(cosineSim([1,0,0], [-1,0,0]) + 1) < 1e-9);
  check('zero vectors → 1 (by convention)', cosineSim([0,0,0], [0,0,0]) === 1);
  check('one zero, one non-zero → 1', cosineSim([0,0,0], [1,2,3]) === 1);
  check('result in [-1, 1]', cosineSim([3,1,4], [1,5,9]) >= -1 && cosineSim([3,1,4],[1,5,9]) <= 1);
}

section('similarity — euclideanDist');

{
  check('identical → 0', euclideanDist([1,2,3], [1,2,3]) === 0);
  check('unit diff → 1', Math.abs(euclideanDist([0,0], [1,0]) - 1) < 1e-9);
  check('3-4-5 triangle → 5', Math.abs(euclideanDist([0,0], [3,4]) - 5) < 1e-9);
  check('always non-negative', euclideanDist([5,3], [1,9]) >= 0);
}

section('similarity — meanAbsDiff');

{
  check('identical → 0', meanAbsDiff([1,2,3], [1,2,3]) === 0);
  check('constant diff → that value', Math.abs(meanAbsDiff([0,0,0], [2,2,2]) - 2) < 1e-9);
  check('empty arrays → 0', meanAbsDiff([], []) === 0);
  check('mixed signs', Math.abs(meanAbsDiff([1], [3]) - 2) < 1e-9);
}

// ── metricsToVectors ──────────────────────────────────────────────────────────

section('similarity — metricsToVectors');

{
  const m = {
    shadow_deep_ratio: 0.38, shadow_ratio: 0.24, mid_ratio: 0.19,
    bright_ratio: 0.09, highlight_ratio: 0.07, peak_ratio: 0.03,
    symmetry_score: 0.50, body_density: 0.75,
  };
  const { band, struct } = metricsToVectors(m);

  check('band has 6 entries', band.length === 6);
  check('struct has 2 entries', struct.length === 2);
  check('band[0] = shadow_deep_ratio', band[0] === 0.38);
  check('band[5] = peak_ratio', band[5] === 0.03);
  check('struct[0] = symmetry_score', struct[0] === 0.50);
  check('struct[1] = body_density', struct[1] === 0.75);
}

{
  // Missing keys default to 0
  const { band, struct } = metricsToVectors({});
  check('missing band keys → 0', band.every(v => v === 0));
  check('missing struct keys → 0', struct.every(v => v === 0));
}

// ── computeMetricSimilarity ───────────────────────────────────────────────────

section('similarity — computeMetricSimilarity');

const gokuLike = {
  shadow_deep_ratio: 0.379, shadow_ratio: 0.235, mid_ratio: 0.188,
  bright_ratio: 0.086, highlight_ratio: 0.066, peak_ratio: 0.045,
  symmetry_score: 0.10, body_density: 0.55,
};

{
  // Identical metrics → grade S
  const r = computeMetricSimilarity(gokuLike, gokuLike);
  check('identical → grade S', r.grade === 'S');
  check('identical → band_cosine = 1', r.band_cosine === 1);
  check('identical → band_l2 = 0', r.band_l2 === 0);
  check('identical → composite near 0', r.composite < GRADE_THRESHOLDS.S);
}

{
  // Result shape
  const r = computeMetricSimilarity(gokuLike, gokuLike);
  check('result has band_cosine',  typeof r.band_cosine  === 'number');
  check('result has band_l2',      typeof r.band_l2      === 'number');
  check('result has struct_delta', typeof r.struct_delta === 'number');
  check('result has composite',    typeof r.composite    === 'number');
  check('result has grade',        typeof r.grade        === 'string');
  check('result has vectors',      typeof r.vectors      === 'object');
  check('result has per_band',     typeof r.per_band     === 'object');
  check('per_band has 6 keys',     Object.keys(r.per_band).length === 6);
}

{
  // All-different metrics → grade D
  const opposite = {
    shadow_deep_ratio: 0.01, shadow_ratio: 0.01, mid_ratio: 0.01,
    bright_ratio: 0.32, highlight_ratio: 0.32, peak_ratio: 0.32,
    symmetry_score: 0.90, body_density: 0.10,
  };
  const r = computeMetricSimilarity(gokuLike, opposite);
  check('very different → grade C or D', ['C','D'].includes(r.grade));
  check('very different → composite > grade A threshold', r.composite > GRADE_THRESHOLDS.A);
}

{
  // Symmetry: A vs B should equal B vs A
  const a = { shadow_deep_ratio: 0.3, shadow_ratio: 0.2, mid_ratio: 0.2,
              bright_ratio: 0.1, highlight_ratio: 0.1, peak_ratio: 0.1,
              symmetry_score: 0.4, body_density: 0.6 };
  const b = { shadow_deep_ratio: 0.4, shadow_ratio: 0.25, mid_ratio: 0.15,
              bright_ratio: 0.08, highlight_ratio: 0.07, peak_ratio: 0.05,
              symmetry_score: 0.2, body_density: 0.7 };
  const ab = computeMetricSimilarity(a, b);
  const ba = computeMetricSimilarity(b, a);
  check('similarity is symmetric (composite)', ab.composite === ba.composite);
  check('similarity is symmetric (grade)',     ab.grade === ba.grade);
}

{
  // Per-band diffs sum check
  const a = { shadow_deep_ratio: 0.40, shadow_ratio: 0.20, mid_ratio: 0.15,
              bright_ratio: 0.10, highlight_ratio: 0.10, peak_ratio: 0.05 };
  const b = { shadow_deep_ratio: 0.35, shadow_ratio: 0.25, mid_ratio: 0.20,
              bright_ratio: 0.08, highlight_ratio: 0.08, peak_ratio: 0.04 };
  const r = computeMetricSimilarity(a, b);
  check('per_band diffs are computed', Object.values(r.per_band).every(v => typeof v.diff === 'number'));
  check('per_band diff sign is correct (a - b)',
    Math.abs(r.per_band.shadow_deep_ratio.diff - (0.40 - 0.35)) < 1e-9);
}

// ── compareGrids ──────────────────────────────────────────────────────────────

section('similarity — compareGrids');

{
  // Simple grids
  const g = [[1, 4, 4, 1], [1, 2, 3, 1], [1, 4, 4, 1]];
  const r = compareGrids(g, PALETTE, g, PALETTE);

  check('same grid same palette → grade S', r.grade === 'S');
  check('result has metricsA', typeof r.metricsA === 'object');
  check('result has metricsB', typeof r.metricsB === 'object');
  check('metricsA.body_count > 0', r.metricsA.body_count > 0);
}

{
  // Different grids: shadow-heavy vs bright-heavy
  const dark  = [[1, 2, 2, 2, 2, 1], [1, 2, 3, 2, 2, 1], [1, 2, 2, 2, 2, 1]];
  const light = [[1, 6, 6, 6, 6, 1], [1, 7, 7, 7, 6, 1], [1, 6, 6, 6, 6, 1]];
  const r = compareGrids(dark, PALETTE, light, PALETTE);

  check('dark vs light → not S grade', r.grade !== 'S');
  check('dark vs light → composite > 0', r.composite > 0);
}

// ── findMostSimilar ───────────────────────────────────────────────────────────

section('similarity — findMostSimilar');

{
  const query = {
    shadow_deep_ratio: 0.38, shadow_ratio: 0.24, mid_ratio: 0.19,
    bright_ratio: 0.09, highlight_ratio: 0.07, peak_ratio: 0.03,
    symmetry_score: 0.10, body_density: 0.55,
  };
  const refs = [
    { id: 'frame_0001', metrics: { shadow_deep_ratio: 0.40, shadow_ratio: 0.22, mid_ratio: 0.18, bright_ratio: 0.08, highlight_ratio: 0.08, peak_ratio: 0.04, symmetry_score: 0.12, body_density: 0.54 } },
    { id: 'frame_0050', metrics: { shadow_deep_ratio: 0.10, shadow_ratio: 0.10, mid_ratio: 0.20, bright_ratio: 0.25, highlight_ratio: 0.25, peak_ratio: 0.10, symmetry_score: 0.80, body_density: 0.30 } },
    { id: 'frame_0100', metrics: { shadow_deep_ratio: 0.38, shadow_ratio: 0.24, mid_ratio: 0.19, bright_ratio: 0.09, highlight_ratio: 0.07, peak_ratio: 0.03, symmetry_score: 0.10, body_density: 0.55 } },
  ];

  const results = findMostSimilar(query, refs);

  check('returns 3 results', results.length === 3);
  check('results sorted by composite (ascending)',
    results.every((r, i) => i === 0 || r.similarity.composite >= results[i-1].similarity.composite));
  check('most similar is frame_0100 (identical)', results[0].id === 'frame_0100');
  check('all results have id and similarity', results.every(r => r.id && r.similarity));
}

{
  // Empty references → empty result
  const q = { shadow_deep_ratio: 0.38 };
  check('empty refs → empty result', findMostSimilar(q, []).length === 0);
}

// ── gradeLabel ────────────────────────────────────────────────────────────────

section('similarity — gradeLabel');

{
  check('S label is string', typeof gradeLabel('S') === 'string' && gradeLabel('S').length > 0);
  check('A label is string', typeof gradeLabel('A') === 'string');
  check('D label is string', typeof gradeLabel('D') === 'string');
  check('unknown grade → string', typeof gradeLabel('Z') === 'string');
  check('S label mentions IDENTICAL', gradeLabel('S').includes('IDENTICAL'));
}

// ── Integration with real batch frames ────────────────────────────────────────

section('similarity — integration');

const ref = loadBatchReference();
if (!ref) {
  check('batch reference available for similarity integration', false);
} else {
  {
    // Same Goku frame vs itself → grade S
    const entry = ref.entries?.[0];
    if (entry?.metrics) {
      const r = computeMetricSimilarity(entry.metrics, entry.metrics);
      check('Goku frame vs itself → grade S', r.grade === 'S');
    }
  }

  {
    // Two Goku frames should have grade A or B (same style)
    const [e1, e2] = ref.entries ?? [];
    if (e1?.metrics && e2?.metrics) {
      const r = computeMetricSimilarity(e1.metrics, e2.metrics);
      check('two Goku frames → grade A or B (similar style)',
        ['S','A','B'].includes(r.grade));
    }
  }

  {
    // findMostSimilar on a sample
    const sample = (ref.entries ?? []).slice(0, 10).filter(e => e.metrics);
    if (sample.length >= 2) {
      const query = sample[0].metrics;
      const refs  = sample.slice(1).map(e => ({ id: e.id ?? e.name, metrics: e.metrics }));
      const results = findMostSimilar(query, refs);
      check('findMostSimilar returns sorted results', results.length === refs.length);
      check('top result composite ≤ bottom result composite',
        results[0].similarity.composite <= results[results.length - 1].similarity.composite);
    }
  }
}
