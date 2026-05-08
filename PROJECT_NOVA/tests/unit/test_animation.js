/**
 * Tests for the animation module:
 *   src/animation/keyframe.js
 *   src/animation/timing.js
 *   src/animation/spritesheet.js
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import { makeGrid, cloneGrid } from '../../src/core/grid.js';
import {
  makeKeyframe, totalDuration, assertUniformSize,
  sequenceToJSON, sequenceFromJSON,
} from '../../src/animation/keyframe.js';
import {
  ease, distributeDurations, idleTiming, walkTiming,
  fpsToMs, durationsToFps,
} from '../../src/animation/timing.js';
import {
  keyframesToPNG, buildSidecar, animationSummary,
} from '../../src/animation/spritesheet.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function solidGrid(w, h, val = 3) {
  return Array.from({ length: h }, () => Array(w).fill(val));
}

function twoFrameSeq() {
  const g1 = solidGrid(4, 4, 3);
  const g2 = solidGrid(4, 4, 4);
  return [makeKeyframe(g1, 100), makeKeyframe(g2, 200)];
}

section('animation — keyframe');
function test(name, fn) {
  try { fn(); check(name, true); }
  catch (e) { check(name, false, e.message); }
}

// ── makeKeyframe ──────────────────────────────────────────────────────────────

test('makeKeyframe stores grid, duration, dimensions', () => {
  const g = solidGrid(5, 6, 2);
  const kf = makeKeyframe(g, 150);
  assert.equal(kf.width, 5);
  assert.equal(kf.height, 6);
  assert.equal(kf.durationMs, 150);
});

test('makeKeyframe rounds fractional duration', () => {
  const kf = makeKeyframe(solidGrid(4, 4), 83.7);
  assert.equal(kf.durationMs, 84);
});

test('makeKeyframe defensive copy — mutation does not affect keyframe', () => {
  const g = solidGrid(4, 4, 2);
  const kf = makeKeyframe(g, 100);
  g[0][0] = 7;
  assert.equal(kf.grid[0][0], 2);
});

test('makeKeyframe stores label, tags, notes', () => {
  const kf = makeKeyframe(solidGrid(4, 4), 100, {
    label: 'inhale', tags: ['idle', 'warrior'], notes: 'test note',
  });
  assert.equal(kf.label, 'inhale');
  assert.deepEqual(kf.tags, ['idle', 'warrior']);
  assert.equal(kf.notes, 'test note');
});

test('makeKeyframe defaults label/tags/notes to empty', () => {
  const kf = makeKeyframe(solidGrid(4, 4), 100);
  assert.equal(kf.label, '');
  assert.deepEqual(kf.tags, []);
  assert.equal(kf.notes, '');
});

test('makeKeyframe throws on empty grid', () => {
  assert.throws(() => makeKeyframe([], 100), /non-empty/);
});

test('makeKeyframe throws on zero duration', () => {
  assert.throws(() => makeKeyframe(solidGrid(4, 4), 0), /> 0/);
});

test('makeKeyframe throws on negative duration', () => {
  assert.throws(() => makeKeyframe(solidGrid(4, 4), -10), /> 0/);
});

test('makeKeyframe throws on non-array grid', () => {
  assert.throws(() => makeKeyframe('not a grid', 100), /non-empty/);
});

// ── totalDuration ─────────────────────────────────────────────────────────────

test('totalDuration sums all keyframe durations', () => {
  const seq = twoFrameSeq();
  assert.equal(totalDuration(seq), 300);
});

test('totalDuration single frame', () => {
  const kf = makeKeyframe(solidGrid(4, 4), 250);
  assert.equal(totalDuration([kf]), 250);
});

test('totalDuration empty sequence returns 0', () => {
  assert.equal(totalDuration([]), 0);
});

// ── assertUniformSize ─────────────────────────────────────────────────────────

test('assertUniformSize returns width/height for uniform sequence', () => {
  const seq = twoFrameSeq();
  const { width, height } = assertUniformSize(seq);
  assert.equal(width, 4);
  assert.equal(height, 4);
});

test('assertUniformSize throws on mismatched frames', () => {
  const kf1 = makeKeyframe(solidGrid(4, 4), 100);
  const kf2 = makeKeyframe(solidGrid(5, 4), 100);
  assert.throws(() => assertUniformSize([kf1, kf2]), /expected 4×4/);
});

test('assertUniformSize throws on empty sequence', () => {
  assert.throws(() => assertUniformSize([]), /empty/);
});

// ── sequenceToJSON / sequenceFromJSON ─────────────────────────────────────────

test('sequenceToJSON produces correct shape', () => {
  const seq = twoFrameSeq();
  const json = sequenceToJSON(seq, { name: 'test_anim' });
  assert.equal(json.version, 1);
  assert.equal(json.width, 4);
  assert.equal(json.height, 4);
  assert.equal(json.frameCount, 2);
  assert.equal(json.totalMs, 300);
  assert.equal(json.frames.length, 2);
  assert.equal(json.meta.name, 'test_anim');
});

test('sequenceToJSON frames have index, durationMs, data', () => {
  const seq = twoFrameSeq();
  const json = sequenceToJSON(seq);
  assert.equal(json.frames[0].index, 0);
  assert.equal(json.frames[0].durationMs, 100);
  assert.equal(json.frames[1].index, 1);
  assert.equal(json.frames[1].durationMs, 200);
});

test('sequenceToJSON data rows are plain arrays (not Uint8Array)', () => {
  const seq = twoFrameSeq();
  const json = sequenceToJSON(seq);
  // Must be serialisable to JSON and back without the {0:v,...} issue
  const re = JSON.parse(JSON.stringify(json));
  assert.ok(Array.isArray(re.frames[0].data[0]));
});

test('sequenceFromJSON round-trips keyframes', () => {
  const seq = twoFrameSeq();
  const json = sequenceToJSON(seq);
  const restored = sequenceFromJSON(json);
  assert.equal(restored.length, 2);
  assert.equal(restored[0].durationMs, 100);
  assert.equal(restored[1].durationMs, 200);
  assert.deepEqual(restored[0].grid, seq[0].grid);
});

test('sequenceFromJSON preserves label and tags', () => {
  const kf = makeKeyframe(solidGrid(4, 4), 100, { label: 'test', tags: ['a', 'b'] });
  const json = sequenceToJSON([kf]);
  const [restored] = sequenceFromJSON(json);
  assert.equal(restored.label, 'test');
  assert.deepEqual(restored.tags, ['a', 'b']);
});

// ── ease functions ────────────────────────────────────────────────────────────

test('ease.linear always returns 1', () => {
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    assert.equal(ease.linear(t), 1);
  }
});

test('ease.easeIn increases with t', () => {
  assert.ok(ease.easeIn(0) < ease.easeIn(0.5));
  assert.ok(ease.easeIn(0.5) < ease.easeIn(1));
});

test('ease.easeOut decreases with t', () => {
  assert.ok(ease.easeOut(0) > ease.easeOut(0.5));
  assert.ok(ease.easeOut(0.5) > ease.easeOut(1));
});

test('ease.easeInOut is point-symmetric: f(t)+f(1-t)=2', () => {
  for (const t of [0.1, 0.2, 0.3, 0.4]) {
    const sum = ease.easeInOut(t) + ease.easeInOut(1 - t);
    assert.ok(Math.abs(sum - 2) < 1e-9, `sum at t=${t}: ${sum}`);
  }
});

test('ease.holdPop: first 80% returns 1.5, last 20% returns 0.3', () => {
  assert.equal(ease.holdPop(0), 1.5);
  assert.equal(ease.holdPop(0.79), 1.5);
  assert.equal(ease.holdPop(0.8), 0.3);
  assert.equal(ease.holdPop(1), 0.3);
});

test('ease.anticipation: first half short, second half long', () => {
  assert.equal(ease.anticipation(0), 0.5);
  assert.equal(ease.anticipation(0.49), 0.5);
  assert.equal(ease.anticipation(0.5), 2.0);
  assert.equal(ease.anticipation(1), 2.0);
});

// ── distributeDurations ───────────────────────────────────────────────────────

test('distributeDurations sum equals totalMs', () => {
  for (const [n, total] of [[4, 600], [3, 400], [7, 1000], [1, 250]]) {
    const d = distributeDurations(n, total);
    assert.equal(d.reduce((a, b) => a + b, 0), total, `n=${n} total=${total}`);
  }
});

test('distributeDurations returns integers', () => {
  const d = distributeDurations(4, 601);
  for (const v of d) assert.ok(Number.isInteger(v), `${v} is not integer`);
});

test('distributeDurations with linear: all frames equal (or ±1)', () => {
  const d = distributeDurations(4, 600, ease.linear);
  assert.equal(d.reduce((a, b) => a + b, 0), 600);
  // Linear with 4 frames → all 150
  for (const v of d) assert.ok(Math.abs(v - 150) <= 1);
});

test('distributeDurations throws on n=0', () => {
  assert.throws(() => distributeDurations(0, 600), /n must be > 0/);
});

test('distributeDurations single frame gets full duration', () => {
  const d = distributeDurations(1, 500);
  assert.deepEqual(d, [500]);
});

test('distributeDurations with easeIn: last frame longer than first', () => {
  const d = distributeDurations(4, 400, ease.easeIn);
  assert.ok(d[3] > d[0], `d[3]=${d[3]} should be > d[0]=${d[0]}`);
});

// ── idleTiming ────────────────────────────────────────────────────────────────

test('idleTiming returns 4 durations summing to totalMs', () => {
  const d = idleTiming(600);
  assert.equal(d.length, 4);
  assert.equal(d.reduce((a, b) => a + b, 0), 600);
});

test('idleTiming all durations are positive integers', () => {
  const d = idleTiming(600);
  for (const v of d) {
    assert.ok(v > 0, `duration ${v} not positive`);
    assert.ok(Number.isInteger(v), `${v} not integer`);
  }
});

test('idleTiming default 600ms', () => {
  const d = idleTiming();
  assert.equal(d.reduce((a, b) => a + b, 0), 600);
});

// ── walkTiming ────────────────────────────────────────────────────────────────

test('walkTiming returns 4 durations summing to totalMs', () => {
  const d = walkTiming(400);
  assert.equal(d.length, 4);
  assert.equal(d.reduce((a, b) => a + b, 0), 400);
});

// ── fpsToMs / durationsToFps ──────────────────────────────────────────────────

test('fpsToMs: 10fps = 100ms', () => {
  assert.equal(fpsToMs(10), 100);
});

test('fpsToMs: 24fps ≈ 42ms', () => {
  assert.equal(fpsToMs(24), 42);
});

test('durationsToFps: 100ms = 10fps', () => {
  assert.deepEqual(durationsToFps([100, 200]), [10, 5]);
});

test('durationsToFps: round-trips with fpsToMs', () => {
  const fps = 12;
  const [v] = durationsToFps([fpsToMs(fps)]);
  assert.equal(v, fps);
});

// ── animationSummary ──────────────────────────────────────────────────────────

test('animationSummary contains frame count, dimensions, total ms', () => {
  const seq = twoFrameSeq();
  const s = animationSummary(seq, 'my_anim');
  assert.ok(s.includes('my_anim'));
  assert.ok(s.includes('2 frames'));
  assert.ok(s.includes('4×4px'));
  assert.ok(s.includes('300ms'));
});

test('animationSummary includes per-frame durations and labels', () => {
  const kf1 = makeKeyframe(solidGrid(4, 4), 100, { label: 'idle' });
  const kf2 = makeKeyframe(solidGrid(4, 4), 200, { label: 'walk' });
  const s = animationSummary([kf1, kf2], 'test');
  assert.ok(s.includes('100ms'));
  assert.ok(s.includes('200ms'));
  assert.ok(s.includes('idle'));
  assert.ok(s.includes('walk'));
});

// ── buildSidecar ──────────────────────────────────────────────────────────────

test('buildSidecar returns valid JSON-safe object', () => {
  const seq = twoFrameSeq();
  const sidecar = buildSidecar(seq, { name: 'test' });
  const re = JSON.parse(JSON.stringify(sidecar));
  assert.equal(re.frameCount, 2);
  assert.equal(re.meta.name, 'test');
});

test('buildSidecar attaches ascii field to each frame', () => {
  const seq = twoFrameSeq();
  const sidecar = buildSidecar(seq);
  for (const f of sidecar.frames) {
    assert.ok(typeof f.ascii === 'string' || (Array.isArray(f.ascii) || typeof f.ascii !== 'undefined'),
      'ascii field missing');
  }
});

test('buildSidecar totalMs matches sum of frame durations', () => {
  const seq = twoFrameSeq();
  const sidecar = buildSidecar(seq, { totalMs: 300 });
  assert.equal(sidecar.totalMs, 300);
});

// ── keyframesToPNG ────────────────────────────────────────────────────────────

test('keyframesToPNG returns a Uint8Array (PNG bytes)', () => {
  const seq = twoFrameSeq();
  const bytes = keyframesToPNG(seq, 1);
  assert.ok(bytes instanceof Uint8Array, 'expected Uint8Array');
  assert.ok(bytes.length > 0);
});

test('keyframesToPNG PNG header magic bytes', () => {
  const seq = twoFrameSeq();
  const bytes = keyframesToPNG(seq, 1);
  // PNG magic: 89 50 4E 47 0D 0A 1A 0A
  assert.equal(bytes[0], 0x89);
  assert.equal(bytes[1], 0x50);
  assert.equal(bytes[2], 0x4e);
  assert.equal(bytes[3], 0x47);
});

test('keyframesToPNG larger scale produces larger output', () => {
  const seq = twoFrameSeq();
  const small = keyframesToPNG(seq, 1);
  const large = keyframesToPNG(seq, 4);
  assert.ok(large.length > small.length, 'scale=4 should be larger than scale=1');
});

// Results are tallied by run_all.js via helpers.js
