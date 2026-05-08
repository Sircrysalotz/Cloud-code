/**
 * Tests for src/eval/compare.js — z-score comparison and adjustment hints.
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import { compareToReference, adjustmentHints } from '../../src/eval/compare.js';

// ── Test distribution ─────────────────────────────────────────────────────────

const DIST = {
  shadow_deep_ratio:  { mean: 0.38, stddev: 0.05, n: 165 },
  shadow_ratio:       { mean: 0.24, stddev: 0.07, n: 165 },
  mid_ratio:          { mean: 0.19, stddev: 0.06, n: 165 },
  bright_ratio:       { mean: 0.09, stddev: 0.06, n: 165 },
  highlight_ratio:    { mean: 0.07, stddev: 0.03, n: 165 },
  peak_ratio:         { mean: 0.05, stddev: 0.03, n: 165 },
  symmetry_score:     { mean: 0.10, stddev: 0.05, n: 165 },
  body_density:       { mean: 0.38, stddev: 0.08, n: 165 },
};

// ── compareToReference ────────────────────────────────────────────────────────

section('compare — compareToReference');

{
  // Metrics exactly at the distribution mean → z=0 everywhere
  const perfect = {
    shadow_deep_ratio: 0.38,
    shadow_ratio:      0.24,
    mid_ratio:         0.19,
    bright_ratio:      0.09,
    highlight_ratio:   0.07,
    peak_ratio:        0.05,
    symmetry_score:    0.10,
    body_density:      0.38,
  };
  const r = compareToReference(perfect, DIST);

  check('all z-scores near 0 for mean values',
    Object.values(r.results).every(v => Math.abs(v.z) < 0.01));

  check('rms_z near 0', r.rms_z < 0.05);
  check('pass = true', r.pass === true);
  check('no flags', r.flags.length === 0);
  check('summary contains PASS', r.summary.includes('PASS'));
}

{
  // Metrics 3σ above mean → should be flagged bad/critical
  const high = {
    shadow_deep_ratio: 0.38 + 3 * 0.05,  // +3σ
    mid_ratio:         0.19 + 3 * 0.06,  // +3σ
  };
  const r = compareToReference(high, DIST);

  check('z > 2.5 flagged as bad or critical',
    r.flags.some(f => f.key === 'shadow_deep_ratio' && (f.severity === 'bad' || f.severity === 'critical')));

  check('pass = false when critical flags present', r.pass === false);
}

{
  // Metrics 4σ above → critical
  const veryHigh = { mid_ratio: 0.19 + 4 * 0.06 };
  const r = compareToReference(veryHigh, DIST);
  check('z > 3.5 flagged critical',
    r.flags.some(f => f.key === 'mid_ratio' && f.severity === 'critical'));
}

{
  // Direction detection
  const low  = { shadow_deep_ratio: 0.38 - 3 * 0.05 };
  const high = { shadow_deep_ratio: 0.38 + 3 * 0.05 };
  const rLow  = compareToReference(low,  DIST);
  const rHigh = compareToReference(high, DIST);

  check('below mean → direction = low',
    rLow.flags.find(f => f.key === 'shadow_deep_ratio')?.direction === 'low');
  check('above mean → direction = high',
    rHigh.flags.find(f => f.key === 'shadow_deep_ratio')?.direction === 'high');
}

{
  // rmsZ scales with deviation
  const slight = { mid_ratio: 0.19 + 0.5 * 0.06 };  // 0.5σ
  const large  = { mid_ratio: 0.19 + 2.5 * 0.06 };  // 2.5σ
  const rS = compareToReference(slight, DIST);
  const rL = compareToReference(large,  DIST);
  check('larger deviation → higher rmsZ', rL.rms_z > rS.rms_z);
}

{
  // Empty metrics → empty results, rmsZ=0, pass=true
  const r = compareToReference({}, DIST);
  check('empty metrics → pass', r.pass === true);
  check('empty metrics → rmsZ = 0', r.rms_z === 0);
}

{
  // Unknown metric keys are ignored
  const r = compareToReference({ unknown_key: 999, shadow_deep_ratio: 0.38 }, DIST);
  check('unknown keys ignored', !r.results.unknown_key);
  check('known key still evaluated', !!r.results.shadow_deep_ratio);
}

{
  // Zero stddev → z = 0 (no division by zero)
  const zeroStdDist = { mid_ratio: { mean: 0.19, stddev: 0.0, n: 1 } };
  const r = compareToReference({ mid_ratio: 0.99 }, zeroStdDist);
  check('zero stddev → z = 0 (no NaN/Infinity)', r.results.mid_ratio.z === 0);
}

{
  // Flags are sorted: critical first, then bad, then warn
  const multiFlag = {
    shadow_deep_ratio: 0.38 + 4 * 0.05,  // critical
    mid_ratio:         0.19 + 3 * 0.06,  // bad
    bright_ratio:      0.09 + 1.6 * 0.06, // warn
  };
  const r = compareToReference(multiFlag, DIST);
  const severities = r.flags.map(f => f.severity);
  check('flags sorted critical first',
    severities[0] === 'critical' || (severities[0] === 'bad' && !severities.includes('critical')));
}

// ── adjustmentHints ───────────────────────────────────────────────────────────

section('compare — adjustmentHints');

const KEYS = ['shadow_deep_ratio','shadow_ratio','mid_ratio','bright_ratio','highlight_ratio','peak_ratio','symmetry_score','outline_thickness_variance','unique_body_colors','body_density'];

{
  // Every key with direction 'low' should produce a hint
  for (const key of KEYS) {
    const hints = adjustmentHints([{ key, direction: 'low', severity: 'bad' }]);
    check(`${key} low → produces hint`, hints.length > 0);
  }
}

{
  // Every key with direction 'high' should produce a hint (except unique_body_colors high)
  const keysWithHighHint = KEYS.filter(k => k !== 'unique_body_colors');
  for (const key of keysWithHighHint) {
    const hints = adjustmentHints([{ key, direction: 'high', severity: 'bad' }]);
    check(`${key} high → produces hint`, hints.length > 0);
  }
}

{
  // No hardcoded "index N" in any hint
  for (const key of KEYS) {
    for (const direction of ['low', 'high']) {
      const hints = adjustmentHints([{ key, direction, severity: 'bad' }]);
      const hasIndexRef = hints.some(h => /index \d/.test(h));
      check(`${key}/${direction}: no "index N" in hint`, !hasIndexRef);
    }
  }
}

{
  // Unknown key → empty hints (no crash)
  const hints = adjustmentHints([{ key: 'nonexistent_metric', direction: 'low', severity: 'bad' }]);
  check('unknown key → empty hints', hints.length === 0);
}

{
  // Empty flags → empty hints
  check('empty flags → empty array', adjustmentHints([]).length === 0);
}

{
  // Multiple flags → multiple hints
  const flags = [
    { key: 'shadow_deep_ratio', direction: 'high', severity: 'bad' },
    { key: 'peak_ratio',        direction: 'low',  severity: 'warn' },
  ];
  const hints = adjustmentHints(flags);
  check('two flags → two hints', hints.length === 2);
}
