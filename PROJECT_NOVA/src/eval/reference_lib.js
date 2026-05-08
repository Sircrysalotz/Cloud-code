/**
 * Reference library — loads the reference grid JSONs and computes
 * per-metric distributions (mean, stddev) for use in z-score comparison.
 *
 * The library is a static snapshot: load once, query many times.
 * No vision, no rendering — pure metric arithmetic.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { computeMetrics } from './metrics.js';

const SCALAR_METRICS = [
  'shadow_deep_ratio',
  'shadow_ratio',
  'mid_ratio',
  'bright_ratio',
  'highlight_ratio',
  'peak_ratio',
  'symmetry_score',
  'outline_thickness_variance',
  'unique_body_colors',
  'body_density',
];

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Load all reference grid JSONs from a directory.
 * Each JSON must have: {id, data, metrics?, tags?, quality?}
 * If the JSON has a pre-computed `metrics` field it is used as-is;
 * otherwise metrics are computed from `data`.
 *
 * @param {string} [gridsDir] — path to grids/ folder (defaults to references/grids/ relative to project root)
 * @returns {ReferenceEntry[]}
 */
export function loadReferenceLibrary(gridsDir) {
  if (!gridsDir) {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'references', 'grids');
    gridsDir = root;
  }

  let files;
  try {
    files = readdirSync(gridsDir).filter(f => f.endsWith('.json'));
  } catch {
    return []; // directory doesn't exist yet
  }

  const entries = [];
  for (const fname of files) {
    try {
      const raw = JSON.parse(readFileSync(join(gridsDir, fname), 'utf8'));
      const metrics = raw.metrics ?? computeMetrics(raw.data);
      entries.push({
        id:      raw.id ?? fname.replace('.json', ''),
        tags:    raw.tags ?? [],
        quality: raw.quality ?? 'unknown',
        metrics,
      });
    } catch {
      // skip malformed entries
    }
  }
  return entries;
}

// ── Filter ────────────────────────────────────────────────────────────────────

/**
 * Filter entries by tags (all specified tags must be present) and/or quality.
 * Pass empty arrays / null to skip filtering.
 */
export function filterEntries(entries, { tags = [], quality = null, minBodyCount = 20 } = {}) {
  return entries.filter(e => {
    if (minBodyCount > 0 && (e.metrics.body_count ?? 0) < minBodyCount) return false;
    if (quality && e.quality !== quality) return false;
    if (tags.length > 0 && !tags.every(t => e.tags.includes(t))) return false;
    return true;
  });
}

// ── Distribution ──────────────────────────────────────────────────────────────

/**
 * Compute mean and standard deviation for each scalar metric across entries.
 *
 * @param {ReferenceEntry[]} entries
 * @returns {MetricDistribution} — {metricName: {mean, stddev, n, min, max}}
 */
export function computeDistribution(entries) {
  if (entries.length === 0) return {};

  const dist = {};
  for (const key of SCALAR_METRICS) {
    const vals = entries
      .map(e => e.metrics[key])
      .filter(v => typeof v === 'number' && isFinite(v));

    if (vals.length === 0) continue;

    const n    = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);

    dist[key] = {
      mean:   round4(mean),
      stddev: round4(stddev),
      n,
      min:    round4(Math.min(...vals)),
      max:    round4(Math.max(...vals)),
    };
  }
  return dist;
}

// ── Convenience: load + filter + distribute in one call ───────────────────────

/**
 * Build a reference distribution from the default library.
 * This is the main entry point for compare.js.
 *
 * @param {object} [opts] — passed to filterEntries
 * @returns {{ entries, distribution }}
 */
export function buildReferenceProfile(opts = {}) {
  const all     = loadReferenceLibrary();
  const entries = filterEntries(all, opts);
  const distribution = computeDistribution(entries);
  return { entries, distribution };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round4(x) { return Math.round(x * 10000) / 10000; }
