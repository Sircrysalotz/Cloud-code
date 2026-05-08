/**
 * Tests for src/authoring/parametric.js
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import { IDX } from '../../src/core/palette.js';
import {
  defaultParams, badStartParams, gradientIndex,
  buildFromParams, adjustParams,
} from '../../src/authoring/parametric.js';
import { runCleanup } from '../../src/cleanup/index.js';
import { evalGrid }   from '../../src/eval/compare.js';

const SD = IDX.SHADOW_DEEP;
const SH = IDX.SHADOW;
const MI = IDX.MID;
const BR = IDX.BRIGHT;
const HI = IDX.HIGHLIGHT;
const PK = IDX.PEAK;
const T  = IDX.TRANSPARENT;
const OL = IDX.OUTLINE;

section('parametric generator');
function test(name, fn) {
  try { fn(); check(name, true); }
  catch (e) { check(name, false, e.message); }
}

// ── defaultParams / badStartParams ────────────────────────────────────────────

test('defaultParams returns 5 thresholds', () => {
  assert.equal(defaultParams().thresholds.length, 5);
});

test('defaultParams thresholds are strictly ascending', () => {
  const th = defaultParams().thresholds;
  for (let i = 1; i < th.length; i++) assert.ok(th[i] > th[i-1]);
});

test('badStartParams returns 5 thresholds', () => {
  assert.equal(badStartParams().thresholds.length, 5);
});

test('badStartParams thresholds differ from defaultParams', () => {
  const d = defaultParams().thresholds;
  const b = badStartParams().thresholds;
  assert.notDeepEqual(d, b);
});

test('defaultParams and badStartParams produce independent objects', () => {
  const p1 = defaultParams();
  const p2 = defaultParams();
  p1.thresholds[0] = 0.99;
  assert.notEqual(p2.thresholds[0], 0.99);
});

test('defaultParams has expected canvas size', () => {
  const p = defaultParams();
  assert.equal(p.W, 24);
  assert.equal(p.H, 40);
});

test('defaultParams has all required body parts', () => {
  const p = defaultParams();
  for (const k of ['head', 'neck', 'torso', 'arm_left', 'arm_right', 'hips',
                   'leg_left', 'leg_right', 'boot_left', 'boot_right']) {
    assert.ok(k in p.parts, `missing part: ${k}`);
  }
});

// ── gradientIndex ─────────────────────────────────────────────────────────────

test('gradientIndex t=0 → SD', () => {
  assert.equal(gradientIndex(0, defaultParams()), SD);
});

test('gradientIndex t=1 → PK', () => {
  assert.equal(gradientIndex(1, defaultParams()), PK);
});

test('gradientIndex bands increase monotonically', () => {
  const p = defaultParams();
  const samples = [0, 0.1, 0.3, 0.5, 0.7, 0.85, 0.9, 0.95, 1.0];
  const indices = samples.map(t => gradientIndex(t, p));
  // Each index should be >= previous (monotone non-decreasing)
  for (let i = 1; i < indices.length; i++) {
    assert.ok(indices[i] >= indices[i-1],
      `gradientIndex not monotone at t=${samples[i]}: ${indices[i-1]} -> ${indices[i]}`);
  }
});

test('gradientIndex bad params: t=0.3 → SD (below first threshold 0.55)', () => {
  const p = badStartParams();
  assert.equal(gradientIndex(0.3, p), SD);
});

test('gradientIndex default params: t=0.3 → SH (above first threshold 0.28)', () => {
  const p = defaultParams();
  assert.equal(gradientIndex(0.3, p), SH);
});

// ── buildFromParams ───────────────────────────────────────────────────────────

test('buildFromParams returns 40-row grid', () => {
  const g = buildFromParams(defaultParams());
  assert.equal(g.length, 40);
});

test('buildFromParams returns 24-col grid', () => {
  const g = buildFromParams(defaultParams());
  assert.equal(g[0].length, 24);
});

test('buildFromParams has some body pixels', () => {
  const g = buildFromParams(defaultParams());
  let body = 0;
  for (const row of g) for (const v of row) if (v >= 2) body++;
  assert.ok(body > 50, `only ${body} body pixels`);
});

test('buildFromParams has outline pixels', () => {
  const g = buildFromParams(defaultParams());
  let outline = 0;
  for (const row of g) for (const v of row) if (v === OL) outline++;
  assert.ok(outline > 10, `only ${outline} outline pixels`);
});

test('buildFromParams bad start: more SD than default', () => {
  const gDefault = buildFromParams(defaultParams());
  const gBad     = buildFromParams(badStartParams());
  let sdDefault = 0, sdBad = 0;
  for (const row of gDefault) for (const v of row) if (v === SD) sdDefault++;
  for (const row of gBad)     for (const v of row) if (v === SD) sdBad++;
  assert.ok(sdBad > sdDefault,
    `bad params should have more SD: bad=${sdBad} default=${sdDefault}`);
});

test('buildFromParams bad start: less MI than default', () => {
  const gDefault = buildFromParams(defaultParams());
  const gBad     = buildFromParams(badStartParams());
  let miDefault = 0, miBad = 0;
  for (const row of gDefault) for (const v of row) if (v === MI) miDefault++;
  for (const row of gBad)     for (const v of row) if (v === MI) miBad++;
  assert.ok(miBad < miDefault,
    `bad params should have less MI: bad=${miBad} default=${miDefault}`);
});

test('buildFromParams is deterministic — same params, same grid', () => {
  const p = defaultParams();
  const g1 = buildFromParams(p);
  const g2 = buildFromParams(p);
  assert.deepEqual(g1, g2);
});

test('buildFromParams does not mutate params', () => {
  const p = defaultParams();
  const thCopy = [...p.thresholds];
  buildFromParams(p);
  assert.deepEqual(p.thresholds, thCopy);
});

// ── adjustParams ──────────────────────────────────────────────────────────────

function makeFlag(key, direction, severity = 'warn') {
  return { key, direction, severity };
}

test('adjustParams does not mutate input params', () => {
  const p = defaultParams();
  const thCopy = [...p.thresholds];
  adjustParams(p, [makeFlag('shadow_deep_ratio', 'high')]);
  assert.deepEqual(p.thresholds, thCopy);
});

test('adjustParams shadow_deep high → lowers th[0]', () => {
  const p = defaultParams();
  const th0 = p.thresholds[0];
  const p2  = adjustParams(p, [makeFlag('shadow_deep_ratio', 'high')]);
  assert.ok(p2.thresholds[0] < th0,
    `th[0] should decrease: ${th0} → ${p2.thresholds[0]}`);
});

test('adjustParams shadow_deep low → raises th[0]', () => {
  const p = defaultParams();
  const th0 = p.thresholds[0];
  const p2  = adjustParams(p, [makeFlag('shadow_deep_ratio', 'low')]);
  assert.ok(p2.thresholds[0] > th0,
    `th[0] should increase: ${th0} → ${p2.thresholds[0]}`);
});

test('adjustParams mid low → widens mid zone (th[1] down, th[2] up)', () => {
  const p = defaultParams();
  const [th1, th2] = [p.thresholds[1], p.thresholds[2]];
  const p2 = adjustParams(p, [makeFlag('mid_ratio', 'low')]);
  assert.ok(p2.thresholds[1] < th1, `th[1] should decrease`);
  assert.ok(p2.thresholds[2] > th2, `th[2] should increase`);
});

test('adjustParams peak low → lowers th[4] (more PK)', () => {
  const p = defaultParams();
  const th4 = p.thresholds[4];
  const p2  = adjustParams(p, [makeFlag('peak_ratio', 'low')]);
  assert.ok(p2.thresholds[4] < th4,
    `th[4] should decrease: ${th4} → ${p2.thresholds[4]}`);
});

test('adjustParams preserves threshold ordering', () => {
  const flags = [
    makeFlag('shadow_deep_ratio', 'high', 'bad'),
    makeFlag('mid_ratio', 'low', 'warn'),
    makeFlag('peak_ratio', 'low', 'warn'),
  ];
  const p2 = adjustParams(defaultParams(), flags);
  const th = p2.thresholds;
  for (let i = 1; i < th.length; i++) {
    assert.ok(th[i] > th[i-1],
      `thresholds out of order at ${i}: ${th[i-1]} >= ${th[i]}`);
  }
});

test('adjustParams critical severity moves by larger step than warn', () => {
  const p = defaultParams();
  const warnResult = adjustParams(p, [makeFlag('shadow_deep_ratio', 'high', 'warn')]);
  const critResult = adjustParams(p, [makeFlag('shadow_deep_ratio', 'high', 'critical')]);
  const warnDelta = p.thresholds[0] - warnResult.thresholds[0];
  const critDelta = p.thresholds[0] - critResult.thresholds[0];
  assert.ok(critDelta > warnDelta,
    `critical step ${critDelta} should be > warn step ${warnDelta}`);
});

test('adjustParams unknown flag key is ignored gracefully', () => {
  const p = defaultParams();
  const p2 = adjustParams(p, [{ key: 'nonexistent_metric', direction: 'high', severity: 'bad' }]);
  assert.deepEqual(p.thresholds, p2.thresholds);
});

// ── Integration: iterate to convergence ──────────────────────────────────────

test('integration: bad start converges within 20 iterations', async () => {
  let params = badStartParams();
  let converged = false;
  for (let i = 0; i < 20; i++) {
    const raw = buildFromParams(params);
    const { grid } = runCleanup(raw);
    const { comparison } = evalGrid(grid);
    if (comparison.pass && comparison.flags.length === 0) { converged = true; break; }
    if (comparison.flags.length === 0) { converged = true; break; }
    params = adjustParams(params, comparison.flags);
  }
  assert.ok(converged, 'did not converge in 20 iterations');
});

test('integration: default start passes eval immediately', () => {
  const raw = buildFromParams(defaultParams());
  const { grid } = runCleanup(raw);
  const { comparison } = evalGrid(grid);
  assert.ok(comparison.pass, `default params should pass: ${comparison.summary}`);
});

// Results are tallied by run_all.js via helpers.js
