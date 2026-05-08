import { check, section } from '../helpers.js';
import { makeGrid }        from '../../src/core/grid.js';
import { IDX }             from '../../src/core/palette.js';
import {
  computeMetrics,
  symmetryScore,
  outlineThicknessVariance,
  bodyCount,
  bandRatios,
  highlightCentroid,
} from '../../src/eval/metrics.js';
import {
  compareToReference,
  adjustmentHints,
} from '../../src/eval/compare.js';
import {
  computeDistribution,
  filterEntries,
} from '../../src/eval/reference_lib.js';

const T  = IDX.TRANSPARENT;
const OL = IDX.OUTLINE;
const SD = IDX.SHADOW_DEEP;
const SH = IDX.SHADOW;
const MI = IDX.MID;
const BR = IDX.BRIGHT;
const HI = IDX.HIGHLIGHT;
const PK = IDX.PEAK;

// ── helpers ───────────────────────────────────────────────────────────────────
section('eval/metrics — countByIndex + bandRatios');

// 4×4 grid: all mid
const gMid = makeGrid(4, 4, MI);
const mMid = computeMetrics(gMid);
check('all-mid body_count=16',      mMid.body_count === 16);
check('all-mid outline_count=0',    mMid.outline_count === 0);
check('all-mid mid_ratio≈1',        Math.abs(mMid.mid_ratio - 1) < 0.001);
check('all-mid shadow_deep_ratio=0',mMid.shadow_deep_ratio === 0);
check('all-mid peak_ratio=0',       mMid.peak_ratio === 0);

// Mixed grid: 2 pixels each SD, SH, MI, BR
const gMix = makeGrid(2, 4, T);
gMix[0][0] = SD; gMix[0][1] = SH;
gMix[1][0] = MI; gMix[1][1] = BR;
gMix[2][0] = HI; gMix[2][1] = PK;
gMix[3][0] = OL; gMix[3][1] = T;
const mMix = computeMetrics(gMix);
check('mix body_count=6',  mMix.body_count === 6);
check('mix outline_count=1', mMix.outline_count === 1);
check('mix SD ratio=1/6',  Math.abs(mMix.shadow_deep_ratio - 1/6) < 0.001);
check('mix MI ratio=1/6',  Math.abs(mMix.mid_ratio - 1/6) < 0.001);
check('mix PK ratio=1/6',  Math.abs(mMix.peak_ratio - 1/6) < 0.001);

// ── symmetry ──────────────────────────────────────────────────────────────────
section('eval/metrics — symmetryScore');

// Perfect mirror: 4×4 with SD left, MI right
const gSym = makeGrid(4, 4, T);
for (let r = 0; r < 4; r++) { gSym[r][0] = SD; gSym[r][3] = SD; }
check('symmetric grid score=1', Math.abs(symmetryScore(gSym) - 1) < 0.001);

// Asymmetric: SD on left, MI on right
const gAsym = makeGrid(4, 4, T);
for (let r = 0; r < 4; r++) { gAsym[r][0] = SD; gAsym[r][3] = MI; }
check('asymmetric grid score=0', symmetryScore(gAsym) < 0.1);

// All transparent → score = 1 (no comparisons → perfect by convention)
const gEmpty = makeGrid(4, 4, T);
check('all-transparent sym=1', symmetryScore(gEmpty) === 1);

// ── outline thickness variance ────────────────────────────────────────────────
section('eval/metrics — outlineThicknessVariance');

// 3×3 grid, all outline → each outline pixel has 2-3 outline neighbors
const gAll = makeGrid(3, 3, OL);
const otv = outlineThicknessVariance(gAll);
check('uniform outline: finite variance', isFinite(otv));
check('no outline → 0', outlineThicknessVariance(makeGrid(4, 4, T)) === 0);

// ── highlight centroid ────────────────────────────────────────────────────────
section('eval/metrics — highlightCentroid');

// Peak in top-left → centroid should have low x, low y
const gHL = makeGrid(10, 10, MI);
gHL[1][1] = PK; gHL[1][2] = HI; gHL[2][1] = HI;
const hc = highlightCentroid(gHL);
check('highlight centroid x < 0.5 (left)', hc.x < 0.5);
check('highlight centroid y < 0.5 (top)', hc.y < 0.5);

// ── computeMetrics completeness ────────────────────────────────────────────────
section('eval/metrics — computeMetrics completeness');

const g8 = makeGrid(8, 8, MI);
g8[0][0] = OL; g8[7][7] = PK; g8[3][3] = SH;
const m8 = computeMetrics(g8);
check('metrics has width',              typeof m8.width === 'number');
check('metrics has height',             typeof m8.height === 'number');
check('metrics has body_count',         typeof m8.body_count === 'number');
check('metrics has mid_ratio',          typeof m8.mid_ratio === 'number');
check('metrics has symmetry_score',     typeof m8.symmetry_score === 'number');
check('metrics has outline_tv',         typeof m8.outline_thickness_variance === 'number');
check('metrics has unique_body_colors', typeof m8.unique_body_colors === 'number');
check('metrics has body_density',       typeof m8.body_density === 'number');
check('metrics has highlight_centroid', typeof m8.highlight_centroid === 'object');

// ── compareToReference ────────────────────────────────────────────────────────
section('eval/compare — compareToReference');

const dist = {
  mid_ratio:  { mean: 0.35, stddev: 0.05, n: 10, min: 0.25, max: 0.45 },
  peak_ratio: { mean: 0.07, stddev: 0.02, n: 10, min: 0.03, max: 0.11 },
};

// On-target sprite
const result1 = compareToReference({ mid_ratio: 0.35, peak_ratio: 0.07 }, dist);
check('on-target pass=true',      result1.pass === true);
check('on-target no flags',       result1.flags.length === 0);
check('on-target rms_z≈0',        result1.rms_z < 0.1);

// Off-target sprite (mid way too low)
const result2 = compareToReference({ mid_ratio: 0.10, peak_ratio: 0.07 }, dist);
check('off-target pass=false',    result2.pass === false);
check('off-target has flags',     result2.flags.length > 0);
check('off-target flag is mid',   result2.flags[0].key === 'mid_ratio');
check('off-target flag low',      result2.flags[0].direction === 'low');

// Very high peak (3σ above mean) — should be flagged
const result3 = compareToReference({ mid_ratio: 0.35, peak_ratio: 0.13 }, dist);
check('high-peak has flag',       result3.flags.some(f => f.key === 'peak_ratio'));

// ── adjustmentHints ───────────────────────────────────────────────────────────
section('eval/compare — adjustmentHints');

const lowMidFlag  = [{ key: 'mid_ratio',  severity: 'bad', direction: 'low',  z: -2.1 }];
const highPeakFlag = [{ key: 'peak_ratio', severity: 'warn', direction: 'high', z: 1.9 }];
const hints1 = adjustmentHints(lowMidFlag);
check('low-mid hint is non-empty', hints1.length > 0);
check('low-mid hint mentions mid', hints1[0].toLowerCase().includes('mid'));

const hints2 = adjustmentHints(highPeakFlag);
check('high-peak hint non-empty', hints2.length > 0);
check('high-peak hint mentions demot', hints2[0].toLowerCase().includes('peak'));

// ── reference_lib — computeDistribution ──────────────────────────────────────
section('eval/reference_lib — computeDistribution');

const fakeEntries = [
  { id: 'a', tags: ['test'], quality: 'excellent', metrics: { mid_ratio: 0.30, shadow_deep_ratio: 0.28, body_count: 150 } },
  { id: 'b', tags: ['test'], quality: 'excellent', metrics: { mid_ratio: 0.40, shadow_deep_ratio: 0.32, body_count: 160 } },
  { id: 'c', tags: ['test'], quality: 'good',      metrics: { mid_ratio: 0.35, shadow_deep_ratio: 0.30, body_count: 140 } },
];

const fDist = computeDistribution(fakeEntries);
check('dist has mid_ratio',       typeof fDist.mid_ratio === 'object');
check('dist mid mean ≈ 0.35',     Math.abs(fDist.mid_ratio.mean - 0.35) < 0.001);
check('dist mid n = 3',           fDist.mid_ratio.n === 3);
check('dist stddev > 0',          fDist.mid_ratio.stddev > 0);

const filtered = filterEntries(fakeEntries, { quality: 'excellent' });
check('filter quality=excellent → 2', filtered.length === 2);

const filteredTag = filterEntries(fakeEntries, { tags: ['test'] });
check('filter tag=test → 3', filteredTag.length === 3);

const filteredBody = filterEntries(fakeEntries, { minBodyCount: 200 });
check('filter minBodyCount=200 → 0', filteredBody.length === 0);
