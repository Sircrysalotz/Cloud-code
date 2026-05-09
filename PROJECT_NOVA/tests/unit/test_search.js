/**
 * Tests for src/authoring/search.js
 *
 * Covers: randomRestart, hillClimb, beamSearch, multiStart.
 * Uses loose budgets to keep tests fast.
 */

import { check, section }    from '../helpers.js';
import { loadBatchReference } from '../../src/eval/reference_lib.js';
import { idleParams }         from '../../src/authoring/poses.js';
import {
  randomRestart,
  hillClimb,
  beamSearch,
  multiStart,
} from '../../src/authoring/search.js';

const ref  = loadBatchReference();
const dist = ref?.distribution ?? null;

if (!dist) {
  import('../helpers.js').then(h => {
    h.check('batch reference available for search tests', false);
  });
} else {

const base = idleParams();

// ── randomRestart ─────────────────────────────────────────────────────────────

section('search — randomRestart');

{
  const r = randomRestart(base, dist, { trials: 5, target: 5.0 });

  check('result has bestParams',   typeof r.bestParams === 'object');
  check('result has bestRmsZ',     typeof r.bestRmsZ   === 'number');
  check('result has trials',       typeof r.trials     === 'number');
  check('result has converged',    typeof r.converged  === 'boolean');
  check('result has log',          Array.isArray(r.log));
  check('bestRmsZ is finite',      isFinite(r.bestRmsZ));
  check('bestRmsZ ≥ 0',            r.bestRmsZ >= 0);
  check('log has ≥ 1 entry',       r.log.length >= 1);
  check('log trial field exists',  typeof r.log[0].trial === 'number');
  check('log rmsZ field exists',   typeof r.log[0].rmsZ  === 'number');
  check('log has thresholds',      Array.isArray(r.log[0].thresholds));
}

{
  // trials=3 → log has 4 entries (base + 3 trials)
  const r = randomRestart(base, dist, { trials: 3, target: 10.0 });
  check('trials=3: log has ≤ 4 entries', r.log.length <= 4);
  check('trials=3: reported trials ≤ 3', r.trials <= 3);
}

{
  // bestRmsZ ≤ any log rmsZ (it's the minimum)
  const r = randomRestart(base, dist, { trials: 8, target: 10.0 });
  const minLog = Math.min(...r.log.map(e => e.rmsZ));
  check('bestRmsZ ≤ min log rmsZ', r.bestRmsZ <= minLog + 1e-4);
}

{
  // bestParams has thresholds
  const r = randomRestart(base, dist, { trials: 3 });
  check('bestParams has thresholds', Array.isArray(r.bestParams.thresholds));
  check('thresholds length=5', r.bestParams.thresholds.length === 5);
  check('thresholds strictly increasing',
    r.bestParams.thresholds.every((v, i) => i === 0 || v > r.bestParams.thresholds[i-1]));
}

{
  // Early stop via target
  const r = randomRestart(base, dist, { trials: 100, target: 100.0 });
  check('target=100 always converged', r.converged);
}

// ── hillClimb ─────────────────────────────────────────────────────────────────

section('search — hillClimb');

{
  const r = hillClimb(base, dist, { maxSteps: 10, patience: 5, target: 5.0 });

  check('result has bestParams',   typeof r.bestParams === 'object');
  check('result has bestRmsZ',     typeof r.bestRmsZ   === 'number');
  check('result has steps',        typeof r.steps      === 'number');
  check('result has converged',    typeof r.converged  === 'boolean');
  check('result has log',          Array.isArray(r.log));
  check('bestRmsZ ≥ 0',            r.bestRmsZ >= 0);
  check('log has ≥ 1 entry',       r.log.length >= 1);
}

{
  // Log entries have step, rmsZ, improved
  const r = hillClimb(base, dist, { maxSteps: 5, target: 5.0 });
  check('log[0].step = 0',           r.log[0].step === 0);
  check('log entries have step',     r.log.every(e => typeof e.step    === 'number'));
  check('log entries have rmsZ',     r.log.every(e => typeof e.rmsZ    === 'number'));
  check('log entries have improved', r.log.every(e => typeof e.improved === 'boolean'));
}

{
  // Steps stops at maxSteps or patience
  const r = hillClimb(base, dist, { maxSteps: 20, patience: 3, target: 5.0 });
  check('steps ≤ maxSteps', r.steps <= 20);
}

{
  // Hill climb should not make things worse on average
  const initial = hillClimb(base, dist, { maxSteps: 0, patience: 1, target: 100.0 });
  const climbed = hillClimb(base, dist, { maxSteps: 15, patience: 5, target: 100.0 });
  check('hillClimb does not dramatically worsen result', climbed.bestRmsZ <= initial.bestRmsZ * 2.0);
}

{
  // bestParams thresholds are valid
  const r = hillClimb(base, dist, { maxSteps: 8 });
  check('thresholds ≥ 0.05', r.bestParams.thresholds.every(t => t >= 0.05));
  check('thresholds ≤ 0.95', r.bestParams.thresholds.every(t => t <= 0.95));
}

// ── beamSearch ────────────────────────────────────────────────────────────────

section('search — beamSearch');

{
  const r = beamSearch(base, dist, { beamWidth: 2, expand: 2, maxIter: 3, target: 5.0 });

  check('result has bestParams',   typeof r.bestParams === 'object');
  check('result has bestRmsZ',     typeof r.bestRmsZ   === 'number');
  check('result has iter',         typeof r.iter       === 'number');
  check('result has converged',    typeof r.converged  === 'boolean');
  check('result has beam',         Array.isArray(r.beam));
  check('result has log',          Array.isArray(r.log));
  check('bestRmsZ ≥ 0',            r.bestRmsZ >= 0);
}

{
  // Beam has beamWidth entries
  const r = beamSearch(base, dist, { beamWidth: 3, expand: 2, maxIter: 2, target: 5.0 });
  check('beam length = beamWidth', r.beam.length === 3);
}

{
  // Log entries have iter and beamRmsZs
  const r = beamSearch(base, dist, { beamWidth: 2, expand: 2, maxIter: 3, target: 5.0 });
  check('log[0].iter = 0',         r.log[0].iter === 0);
  check('log has beamRmsZs',       Array.isArray(r.log[0].beamRmsZs));
}

{
  // Beam members are in ascending order
  const r = beamSearch(base, dist, { beamWidth: 3, expand: 3, maxIter: 3, target: 5.0 });
  check('beam sorted ascending',
    r.beam.every((b, i) => i === 0 || b.rmsZ >= r.beam[i-1].rmsZ));
}

{
  // bestRmsZ = beam[0].rmsZ
  const r = beamSearch(base, dist, { beamWidth: 2, expand: 2, maxIter: 2, target: 5.0 });
  check('bestRmsZ = beam[0].rmsZ', Math.abs(r.bestRmsZ - r.beam[0].rmsZ) < 1e-4);
}

{
  // iter ≤ maxIter
  const r = beamSearch(base, dist, { beamWidth: 2, expand: 2, maxIter: 5, target: 5.0 });
  check('iter ≤ maxIter', r.iter <= 5);
}

// ── multiStart ────────────────────────────────────────────────────────────────

section('search — multiStart');

{
  const r = multiStart(base, dist, { maxSteps: 5, patience: 3, target: 5.0 });

  check('result has bestParams',   typeof r.bestParams === 'object');
  check('result has bestRmsZ',     typeof r.bestRmsZ   === 'number');
  check('result has seedResults',  Array.isArray(r.seedResults));
  check('result has log',          Array.isArray(r.log));
  check('5 seed results',          r.seedResults.length === 5);
  check('5 log entries',           r.log.length === 5);
  check('bestRmsZ ≥ 0',            r.bestRmsZ >= 0);
}

{
  // bestRmsZ ≤ all seed bestRmsZs
  const r = multiStart(base, dist, { maxSteps: 5, patience: 3, target: 100.0 });
  check('bestRmsZ ≤ all seeds',
    r.seedResults.every(s => r.bestRmsZ <= s.bestRmsZ + 1e-4));
}

{
  // Each seedResult has seedIndex, bestRmsZ, steps
  const r = multiStart(base, dist, { maxSteps: 3, patience: 2, target: 5.0 });
  check('seedResult has seedIndex', r.seedResults.every(s => typeof s.seedIndex === 'number'));
  check('seedResult has bestRmsZ',  r.seedResults.every(s => typeof s.bestRmsZ  === 'number'));
  check('seedResult has steps',     r.seedResults.every(s => typeof s.steps     === 'number'));
}

{
  // Log entries have seedIndex, finalRmsZ, steps
  const r = multiStart(base, dist, { maxSteps: 3, patience: 2, target: 5.0 });
  check('log has seedIndex', r.log.every(e => typeof e.seedIndex  === 'number'));
  check('log has finalRmsZ', r.log.every(e => typeof e.finalRmsZ  === 'number'));
  check('log has steps',     r.log.every(e => typeof e.steps      === 'number'));
}

{
  // Seed indices are 0-4
  const r = multiStart(base, dist, { maxSteps: 3, patience: 2, target: 5.0 });
  check('seed indices 0-4',
    r.seedResults.map(s => s.seedIndex).sort((a,b)=>a-b).every((v,i) => v === i));
}

// ── Cross-strategy comparison ─────────────────────────────────────────────────

section('search — strategy comparison');

{
  // All strategies produce a result with bestRmsZ (sanity integration test)
  const rr = randomRestart(base, dist, { trials: 3, target: 5.0 });
  const hc = hillClimb(base, dist, { maxSteps: 5, patience: 3, target: 5.0 });
  const bs = beamSearch(base, dist, { beamWidth: 2, expand: 2, maxIter: 2, target: 5.0 });
  const ms = multiStart(base, dist, { maxSteps: 3, patience: 2, target: 5.0 });

  check('randomRestart: isFinite(bestRmsZ)', isFinite(rr.bestRmsZ));
  check('hillClimb: isFinite(bestRmsZ)',     isFinite(hc.bestRmsZ));
  check('beamSearch: isFinite(bestRmsZ)',    isFinite(bs.bestRmsZ));
  check('multiStart: isFinite(bestRmsZ)',    isFinite(ms.bestRmsZ));

  // All produce valid thresholds
  for (const [name, r] of [['rr', rr], ['hc', hc], ['bs', bs], ['ms', ms]]) {
    check(`${name}: thresholds valid`,
      r.bestParams.thresholds.length === 5 &&
      r.bestParams.thresholds.every(t => t >= 0.05 && t <= 0.95));
  }
}

} // end if (!dist)
