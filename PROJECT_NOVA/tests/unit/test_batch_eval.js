/**
 * Tests for src/eval/batch_eval.js
 *
 * Covers: batchEval, rankBatch, filterBatch, batchSummary, topN.
 */

import { check, section }       from '../helpers.js';
import { PALETTE }              from '../../src/core/palette.js';
import { loadBatchReference }   from '../../src/eval/reference_lib.js';
import { idleParams }           from '../../src/authoring/poses.js';
import { buildFromParams }      from '../../src/authoring/parametric.js';
import {
  batchEval,
  rankBatch,
  filterBatch,
  batchSummary,
  topN,
} from '../../src/eval/batch_eval.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Simple test grids — well-formed sprites
const shadowGrid = [
  [0,1,1,1,1,0],
  [1,2,3,2,3,1],
  [1,2,2,3,2,1],
  [1,3,2,2,3,1],
  [0,1,1,1,1,0],
];

const brightGrid = [
  [0,1,1,1,1,0],
  [1,5,6,5,6,1],
  [1,5,5,6,5,1],
  [1,6,5,5,6,1],
  [0,1,1,1,1,0],
];

const ref = loadBatchReference();
const dist = ref?.distribution ?? null;

// ── batchEval ─────────────────────────────────────────────────────────────────

section('batch_eval — batchEval (no distribution needed)');

if (!dist) {
  check('batch reference available', false);
} else {

{
  const candidates = [
    { id: 'shadow', grid: shadowGrid, palette: PALETTE },
    { id: 'bright', grid: brightGrid, palette: PALETTE },
  ];
  const results = batchEval(candidates, dist);

  check('returns array of 2', results.length === 2);

  const r0 = results[0];
  check('result has id',        r0.id === 'shadow');
  check('result has metrics',   typeof r0.metrics === 'object');
  check('result has bandRmsZ',  typeof r0.bandRmsZ === 'number');
  check('result has grade',     typeof r0.grade === 'string');
  check('result has pass',      typeof r0.pass === 'boolean');
  check('result has zScores',   r0.zScores !== null);
  check('result has grid',      Array.isArray(r0.grid));
}

{
  // zScores=false → zScores is null
  const candidates = [{ id: 'a', grid: shadowGrid, palette: PALETTE }];
  const results    = batchEval(candidates, dist, { zScores: false });
  check('zScores=false → null', results[0].zScores === null);
}

{
  // Default palette used when not specified
  const candidates = [{ id: 'no-pal', grid: shadowGrid }];
  let threw = false;
  try { batchEval(candidates, dist); } catch (e) { threw = true; }
  check('missing palette → no throw', !threw);
}

{
  // Empty candidates → empty results
  const results = batchEval([], dist);
  check('empty candidates → []', results.length === 0);
}

{
  // bandRmsZ is a finite non-negative number
  const candidates = [{ id: 'x', grid: shadowGrid, palette: PALETTE }];
  const results    = batchEval(candidates, dist);
  check('bandRmsZ is finite',       isFinite(results[0].bandRmsZ));
  check('bandRmsZ is non-negative', results[0].bandRmsZ >= 0);
}

{
  // grade is S/A/B/C/D
  const candidates = [
    { id: 'a', grid: shadowGrid, palette: PALETTE },
    { id: 'b', grid: brightGrid, palette: PALETTE },
  ];
  const results = batchEval(candidates, dist);
  check('grades are S/A/B/C/D',
    results.every(r => ['S','A','B','C','D'].includes(r.grade)));
}

{
  // zScores object has expected keys
  const results = batchEval([{ id: 'x', grid: shadowGrid, palette: PALETTE }], dist);
  const z = results[0].zScores;
  check('zScores has shadow_deep_ratio', 'shadow_deep_ratio' in z);
  check('zScores has symmetry_score',    'symmetry_score'    in z);
  check('zScores has body_density',      'body_density'      in z);
}

{
  // runCleanup=false skips cleanup
  const candidates = [{ id: 'raw', grid: shadowGrid, palette: PALETTE }];
  let threw = false;
  try { batchEval(candidates, dist, { runCleanup: false }); } catch (e) { threw = true; }
  check('runCleanup=false: no throw', !threw);
}

{
  // Different grids produce different bandRmsZ
  const r = batchEval([
    { id: 's', grid: shadowGrid, palette: PALETTE },
    { id: 'b', grid: brightGrid, palette: PALETTE },
  ], dist);
  check('different grids → different rmsZ', r[0].bandRmsZ !== r[1].bandRmsZ);
}

// ── rankBatch ─────────────────────────────────────────────────────────────────

section('batch_eval — rankBatch');

{
  const results = batchEval([
    { id: 's', grid: shadowGrid, palette: PALETTE },
    { id: 'b', grid: brightGrid, palette: PALETTE },
  ], dist);

  const ranked = rankBatch(results);
  check('ranked length=2', ranked.length === 2);
  check('rank 1 ≤ rank 2 (bandRmsZ)', ranked[0].bandRmsZ <= ranked[1].bandRmsZ);
  check('ranks assigned', ranked[0].rank === 1 && ranked[1].rank === 2);
}

{
  // Descending
  const results = batchEval([
    { id: 's', grid: shadowGrid, palette: PALETTE },
    { id: 'b', grid: brightGrid, palette: PALETTE },
  ], dist);
  const ranked = rankBatch(results, 'bandRmsZ', true);
  check('descending: rank 1 ≥ rank 2', ranked[0].bandRmsZ >= ranked[1].bandRmsZ);
}

{
  // Original not mutated
  const results = batchEval([
    { id: 's', grid: shadowGrid, palette: PALETTE },
    { id: 'b', grid: brightGrid, palette: PALETTE },
  ], dist);
  const orig0 = results[0].id;
  rankBatch(results);
  check('rankBatch does not mutate original', results[0].id === orig0);
}

{
  // Empty → empty
  check('rankBatch([]) → []', rankBatch([]).length === 0);
}

// ── filterBatch ───────────────────────────────────────────────────────────────

section('batch_eval — filterBatch');

{
  const results = batchEval([
    { id: 's', grid: shadowGrid, palette: PALETTE },
    { id: 'b', grid: brightGrid, palette: PALETTE },
  ], dist);

  const passing = filterBatch(results, r => r.pass);
  check('filterBatch returns subset', passing.length <= 2);
  check('all filtered pass', passing.every(r => r.pass));
}

{
  // Filter by grade
  const results = batchEval([
    { id: 's', grid: shadowGrid, palette: PALETTE },
    { id: 'b', grid: brightGrid, palette: PALETTE },
  ], dist);
  const notD = filterBatch(results, r => r.grade !== 'D');
  check('all non-D after filter', notD.every(r => r.grade !== 'D'));
}

{
  // Filter all out → empty
  const results = batchEval([{ id: 'x', grid: shadowGrid, palette: PALETTE }], dist);
  const none    = filterBatch(results, () => false);
  check('filter-all → []', none.length === 0);
}

// ── batchSummary ──────────────────────────────────────────────────────────────

section('batch_eval — batchSummary');

{
  const results = batchEval([
    { id: 's', grid: shadowGrid, palette: PALETTE },
    { id: 'b', grid: brightGrid, palette: PALETTE },
  ], dist);
  const s = batchSummary(results);

  check('count=2',                   s.count === 2);
  check('passCount ∈ [0,2]',         s.passCount >= 0 && s.passCount <= 2);
  check('passRate ∈ [0,1]',          s.passRate >= 0 && s.passRate <= 1);
  check('meanBandRmsZ ≥ 0',          s.meanBandRmsZ >= 0);
  check('minBandRmsZ ≤ maxBandRmsZ', s.minBandRmsZ  <= s.maxBandRmsZ);
  check('gradeDistribution object',  typeof s.gradeDistribution === 'object');
  check('bestId is a string',        typeof s.bestId === 'string');
  check('worstId is a string',       typeof s.worstId === 'string');
  check('metricMeans object',        typeof s.metricMeans === 'object');
}

{
  // Empty → zero counts
  const s = batchSummary([]);
  check('empty: count=0',      s.count        === 0);
  check('empty: passRate=0',   s.passRate     === 0);
  check('empty: bestId=null',  s.bestId       === null);
  check('empty: worstId=null', s.worstId      === null);
}

{
  // minBandRmsZ = bestId's rmsZ
  const results = batchEval([
    { id: 's', grid: shadowGrid, palette: PALETTE },
    { id: 'b', grid: brightGrid, palette: PALETTE },
  ], dist);
  const s    = batchSummary(results);
  const best = results.find(r => r.id === s.bestId);
  check('minBandRmsZ = best rmsZ', Math.abs(s.minBandRmsZ - best.bandRmsZ) < 1e-6);
}

{
  // passRate = passCount / count
  const results = batchEval([
    { id: 's', grid: shadowGrid, palette: PALETTE },
    { id: 'b', grid: brightGrid, palette: PALETTE },
  ], dist);
  const s = batchSummary(results);
  check('passRate = passCount/count',
    Math.abs(s.passRate - s.passCount / s.count) < 1e-6);
}

// ── topN ─────────────────────────────────────────────────────────────────────

section('batch_eval — topN');

{
  const results = batchEval([
    { id: 's', grid: shadowGrid, palette: PALETTE },
    { id: 'b', grid: brightGrid, palette: PALETTE },
  ], dist);

  const top1 = topN(results, 1);
  check('topN(1) has 1 result', top1.length === 1);
  check('topN(1) is best',
    top1[0].bandRmsZ === Math.min(...results.map(r => r.bandRmsZ)));
}

{
  const results = batchEval([
    { id: 's', grid: shadowGrid, palette: PALETTE },
    { id: 'b', grid: brightGrid, palette: PALETTE },
  ], dist);
  const top5 = topN(results, 5);  // more than available
  check('topN(5) capped at 2', top5.length === 2);
}

{
  check('topN of empty → empty', topN([], 3).length === 0);
}

// ── Integration: batch eval of generated sprites ──────────────────────────────

section('batch_eval — integration (generated sprites)');

{
  // Generate 3 sprites from different pose params and batch-eval them
  const params = idleParams();
  const grids  = [
    buildFromParams(params),
    buildFromParams({ ...params, thresholds: params.thresholds.map(t => Math.min(0.95, t + 0.1)) }),
    buildFromParams({ ...params, thresholds: params.thresholds.map(t => Math.max(0.05, t - 0.1)) }),
  ];

  const candidates = grids.map((grid, i) => ({ id: `gen_${i}`, grid, palette: PALETTE }));
  const results    = batchEval(candidates, dist);
  const summary    = batchSummary(results);
  const ranked     = rankBatch(results);

  check('integration: 3 results',                  results.length === 3);
  check('integration: summary count=3',            summary.count  === 3);
  check('integration: ranked in order',
    ranked[0].bandRmsZ <= ranked[1].bandRmsZ && ranked[1].bandRmsZ <= ranked[2].bandRmsZ);
  check('integration: topN(2) has 2 results',      topN(results, 2).length === 2);
  check('integration: gradeDistribution non-empty',
    Object.keys(summary.gradeDistribution).length > 0);
  check('integration: all bandRmsZ finite',
    results.every(r => isFinite(r.bandRmsZ)));
}

} // end if (!dist)
