/**
 * Tests for src/eval/reference_lib.js
 */

import assert from 'assert/strict';
import { check, section } from '../helpers.js';
import {
  loadBatchReference,
  computeDistribution,
  filterEntries,
  buildReferenceProfile,
} from '../../src/eval/reference_lib.js';

// ── loadBatchReference ────────────────────────────────────────────────────────

section('reference_lib — loadBatchReference');

{
  const ref = loadBatchReference();

  check('loadBatchReference returns non-null (batch reference exists)',
    ref !== null);

  if (ref) {
    check('has entries array', Array.isArray(ref.entries));
    check('has at least 100 Goku frames', ref.entries.length >= 100);

    check('has distribution object', typeof ref.distribution === 'object' && ref.distribution !== null);

    const BAND_KEYS = ['shadow_deep_ratio','shadow_ratio','mid_ratio','bright_ratio','highlight_ratio','peak_ratio'];
    check('distribution has all 6 band ratio keys',
      BAND_KEYS.every(k => k in ref.distribution));

    check('distribution entries have mean, stddev, n',
      Object.values(ref.distribution).every(d =>
        typeof d.mean === 'number' &&
        typeof d.stddev === 'number' &&
        typeof d.n === 'number'));

    check('all distribution means are between 0 and 1',
      Object.values(ref.distribution)
        .filter(d => d.mean <= 1)
        .length === Object.values(ref.distribution).length);

    check('band ratio means are positive',
      BAND_KEYS.every(k => ref.distribution[k]?.mean > 0));

    check('entries have id, tags, quality, metrics fields',
      ref.entries.every(e =>
        typeof e.id === 'string' &&
        Array.isArray(e.tags) &&
        typeof e.quality === 'string' &&
        typeof e.metrics === 'object'));

    check('entries tagged as goku',
      ref.entries.every(e => e.tags.includes('goku')));

    check('entries tagged as excellent quality',
      ref.entries.every(e => e.quality === 'excellent'));

    // Goku distribution sanity: shadow_deep should be largest band ~38%
    const sd = ref.distribution['shadow_deep_ratio'];
    check('shadow_deep_ratio mean near 0.38 (±0.05)',
      sd && Math.abs(sd.mean - 0.379) < 0.05);

    check('shadow_deep_ratio stddev reasonable (< 0.1)',
      sd && sd.stddev < 0.1);
  }
}

// ── computeDistribution ───────────────────────────────────────────────────────

section('reference_lib — computeDistribution');

const MOCK_ENTRIES = [
  { id: 'a', tags: [], quality: 'good',
    metrics: { shadow_deep_ratio: 0.40, shadow_ratio: 0.20, mid_ratio: 0.15,
               bright_ratio: 0.10, highlight_ratio: 0.08, peak_ratio: 0.07,
               body_count: 200 } },
  { id: 'b', tags: [], quality: 'good',
    metrics: { shadow_deep_ratio: 0.36, shadow_ratio: 0.28, mid_ratio: 0.21,
               bright_ratio: 0.06, highlight_ratio: 0.05, peak_ratio: 0.04,
               body_count: 180 } },
  { id: 'c', tags: [], quality: 'good',
    metrics: { shadow_deep_ratio: 0.38, shadow_ratio: 0.24, mid_ratio: 0.18,
               bright_ratio: 0.09, highlight_ratio: 0.07, peak_ratio: 0.04,
               body_count: 220 } },
];

{
  const dist = computeDistribution(MOCK_ENTRIES);

  check('returns object with metric keys', typeof dist === 'object');
  check('shadow_deep_ratio present', 'shadow_deep_ratio' in dist);
  check('n = 3 for all keys',
    Object.values(dist).every(d => d.n === 3));

  // shadow_deep_ratio mean = (0.40 + 0.36 + 0.38) / 3 = 0.38
  const sd = dist['shadow_deep_ratio'];
  check('mean computed correctly',
    Math.abs(sd.mean - 0.38) < 0.0001);

  check('stddev is non-negative', sd.stddev >= 0);
  check('min <= mean <= max',
    sd.min <= sd.mean && sd.mean <= sd.max);

  check('min = 0.36', Math.abs(sd.min - 0.36) < 0.0001);
  check('max = 0.40', Math.abs(sd.max - 0.40) < 0.0001);
}

{
  // Empty entries → empty distribution
  const dist = computeDistribution([]);
  check('empty entries → empty distribution', Object.keys(dist).length === 0);
}

{
  // Single entry → stddev = 0
  const dist = computeDistribution([MOCK_ENTRIES[0]]);
  check('single entry: stddev = 0', dist['shadow_deep_ratio']?.stddev === 0);
  check('single entry: mean = value', Math.abs(dist['shadow_deep_ratio']?.mean - 0.40) < 0.0001);
}

{
  // Non-numeric values ignored
  const entries = [
    { id: 'x', tags: [], quality: 'good',
      metrics: { shadow_deep_ratio: 'bad', shadow_ratio: 0.25 } },
    { id: 'y', tags: [], quality: 'good',
      metrics: { shadow_deep_ratio: 0.30, shadow_ratio: null } },
  ];
  const dist = computeDistribution(entries);
  check('non-numeric shadow_deep_ratio: only 1 valid value → n=1',
    dist['shadow_deep_ratio']?.n === 1);
}

// ── filterEntries ─────────────────────────────────────────────────────────────

section('reference_lib — filterEntries');

const TAGGED_ENTRIES = [
  { id: 'a', tags: ['goku', 'walk'], quality: 'excellent', metrics: { body_count: 300 } },
  { id: 'b', tags: ['goku', 'idle'], quality: 'good',      metrics: { body_count: 200 } },
  { id: 'c', tags: ['warrior'],      quality: 'excellent', metrics: { body_count: 400 } },
  { id: 'd', tags: ['goku'],         quality: 'excellent', metrics: { body_count: 50  } },
];

{
  const all = filterEntries(TAGGED_ENTRIES);
  check('no filter: returns all (body_count ≥ 20)',
    all.length === 4);
}

{
  const high = filterEntries(TAGGED_ENTRIES, { minBodyCount: 250 });
  check('minBodyCount=250: 2 entries with body_count >= 250',
    high.length === 2);
}

{
  const goku = filterEntries(TAGGED_ENTRIES, { tags: ['goku'] });
  check('tag filter: only goku entries',
    goku.length === 3 && goku.every(e => e.tags.includes('goku')));
}

{
  const walk = filterEntries(TAGGED_ENTRIES, { tags: ['goku', 'walk'] });
  check('multi-tag filter: only goku+walk', walk.length === 1);
}

{
  const exc = filterEntries(TAGGED_ENTRIES, { quality: 'excellent' });
  check('quality filter: only excellent',
    exc.length === 3 && exc.every(e => e.quality === 'excellent'));
}

{
  const combined = filterEntries(TAGGED_ENTRIES, { tags: ['goku'], quality: 'excellent' });
  check('combined filter: goku + excellent', combined.length === 2);
}

{
  const empty = filterEntries([], { tags: ['goku'] });
  check('empty entries filtered → empty', empty.length === 0);
}

// ── buildReferenceProfile ─────────────────────────────────────────────────────

section('reference_lib — buildReferenceProfile');

{
  // Default (no opts) → returns Goku batch reference
  const prof = buildReferenceProfile();
  check('buildReferenceProfile returns object', typeof prof === 'object');
  check('has entries and distribution', 'entries' in prof && 'distribution' in prof);
  check('entries non-empty', prof.entries.length > 0);
  check('distribution has band keys',
    ['shadow_deep_ratio','shadow_ratio','mid_ratio'].every(k => k in prof.distribution));
}

{
  // source:'grids' falls back to empty grids/ dir → empty or legacy entries
  const prof = buildReferenceProfile({ source: 'grids' });
  check('source:grids returns valid profile', 'distribution' in prof);
  // distribution may be empty if grids/ dir is empty — that's fine
  check('distribution is an object', typeof prof.distribution === 'object');
}
