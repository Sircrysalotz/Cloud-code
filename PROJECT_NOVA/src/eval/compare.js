/**
 * Z-score comparison engine.
 *
 * Given a sprite's metrics and a reference distribution, compute z-scores
 * for each metric and identify which aspects deviate from the reference style.
 *
 * This replaces "does this look good" with a computable question:
 *   "Which metrics are more than N standard deviations from the reference mean?"
 *
 * The AI works with these numbers to decide what to adjust.
 */

import { computeMetrics } from './metrics.js';
import { buildReferenceProfile } from './reference_lib.js';

// ── Z-score thresholds ────────────────────────────────────────────────────────
const WARN_Z  = 1.5;  // |z| > 1.5 → flag as notable deviation
const BAD_Z   = 2.5;  // |z| > 2.5 → flag as significant deviation
const CRIT_Z  = 3.5;  // |z| > 3.5 → flag as critical (rare in good sprites)

// Metrics where higher is always better (no upper flag)
const HIGHER_IS_BETTER = new Set(['unique_body_colors']);

// Metrics where direction matters (flag separately for too-high/too-low)
const DIRECTION_MATTERS = new Set([
  'shadow_deep_ratio', 'shadow_ratio', 'mid_ratio',
  'bright_ratio', 'highlight_ratio', 'peak_ratio',
  'symmetry_score', 'body_density',
]);

// ── Compare ───────────────────────────────────────────────────────────────────

/**
 * Compare a sprite's metrics against a reference distribution.
 *
 * @param {object} spriteMetrics — from computeMetrics()
 * @param {object} distribution  — from computeDistribution()
 * @returns {CompareResult}
 */
export function compareToReference(spriteMetrics, distribution) {
  const results  = {};
  const flags    = [];
  let   totalZ2  = 0;
  let   zCount   = 0;

  for (const [key, dist] of Object.entries(distribution)) {
    const actual = spriteMetrics[key];
    if (typeof actual !== 'number') continue;

    const { mean, stddev } = dist;
    const z = stddev < 0.0001 ? 0 : (actual - mean) / stddev;
    const absZ = Math.abs(z);

    let severity = 'ok';
    let direction = z > 0 ? 'high' : 'low';

    if (absZ > CRIT_Z)       severity = 'critical';
    else if (absZ > BAD_Z)   severity = 'bad';
    else if (absZ > WARN_Z)  severity = 'warn';

    if (severity !== 'ok') {
      const msg = `${key}: ${round3(actual)} (ref ${round3(mean)}±${round3(stddev)}, z=${round2(z)})`;
      flags.push({ key, severity, direction, z: round2(z), msg });
    }

    results[key] = {
      actual:  round4(actual),
      mean:    round4(mean),
      stddev:  round4(stddev),
      z:       round2(z),
      severity,
    };

    totalZ2 += z * z;
    zCount++;
  }

  // RMS z-score across all metrics — overall stylistic distance from reference
  const rmsZ = zCount > 0 ? Math.sqrt(totalZ2 / zCount) : 0;

  // Sort flags: critical first, then by |z| descending
  flags.sort((a, b) => {
    const order = { critical: 0, bad: 1, warn: 2 };
    const od = (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
    return od !== 0 ? od : Math.abs(b.z) - Math.abs(a.z);
  });

  return {
    results,
    flags,
    rms_z:    round2(rmsZ),
    pass:     flags.filter(f => f.severity === 'bad' || f.severity === 'critical').length === 0,
    summary:  summaryText(rmsZ, flags),
  };
}

// ── Convenience: compare sprite grid directly ─────────────────────────────────

/**
 * One-shot: compute metrics from grid, load reference library, compare.
 *
 * @param {Grid} grid
 * @param {object} [filterOpts] — passed to buildReferenceProfile()
 * @returns {{ metrics, distribution, comparison }}
 */
export function evalGrid(grid, filterOpts = {}) {
  const metrics      = computeMetrics(grid);
  const { distribution, entries } = buildReferenceProfile(filterOpts);
  const comparison   = compareToReference(metrics, distribution);
  return { metrics, distribution, comparison, referenceCount: entries.length };
}

// ── Adjustment hints ──────────────────────────────────────────────────────────
// Translate z-score flags into plain-text adjustment directions.
// The AI reads these and applies corrective rules.

export function adjustmentHints(flags) {
  const hints = [];
  for (const f of flags) {
    const { key, direction } = f;
    switch (key) {
      case 'shadow_deep_ratio':
        hints.push(direction === 'low'
          ? 'Add more shadow_deep (index 2) — expand dark shadow side of body parts'
          : 'Reduce shadow_deep — convert some SD pixels to shadow or mid');
        break;
      case 'shadow_ratio':
        hints.push(direction === 'low'
          ? 'Add shadow (index 3) transition zone — widen the shadow-to-mid gradient'
          : 'Reduce shadow — tighten transition, shift some SH to mid');
        break;
      case 'mid_ratio':
        hints.push(direction === 'low'
          ? 'Mid-tone (index 4) is sparse — body fill is too dark or too bright. Expand mid zone'
          : 'Too much mid — consider darkening shadow zones or brightening highlight zones');
        break;
      case 'bright_ratio':
        hints.push(direction === 'low'
          ? 'Add bright (index 5) lit edge — 1-2px bright sliver on light-facing surfaces'
          : 'Reduce bright — trim the lit edge, shift to highlight');
        break;
      case 'highlight_ratio':
        hints.push(direction === 'low'
          ? 'Add highlight (index 6) — small cluster on upper-right of prominent surfaces'
          : 'Too much highlight — reduce highlight cluster, keep to specular spots only');
        break;
      case 'peak_ratio':
        hints.push(direction === 'low'
          ? 'Add peak (index 7) — 2-8 pixels max, specular center of highlight cluster'
          : 'Too much peak — demote outer peak ring to highlight');
        break;
      case 'symmetry_score':
        hints.push(direction === 'low'
          ? 'Sprite is asymmetric — check that left/right body halves use matching palette bands'
          : 'Sprite is too symmetric — add pose variation or shadow asymmetry');
        break;
      case 'outline_thickness_variance':
        hints.push(direction === 'high'
          ? 'Outline is uneven — check for 2×2 outline blocks (pass 2) or broken outline gaps (pass 3)'
          : 'Outline is too uniform — may lack interior detail lines');
        break;
      case 'unique_body_colors':
        hints.push(direction === 'low'
          ? `Only ${f.actual ?? '?'} body colors used — add more palette bands for richer shading`
          : '');
        break;
      case 'body_density':
        hints.push(direction === 'low'
          ? 'Sprite is very sparse — body fills little of the bounding box'
          : 'Sprite is very dense — consider adding more breathing room / transparency');
        break;
    }
  }
  return hints.filter(Boolean);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function summaryText(rmsZ, flags) {
  const criticals = flags.filter(f => f.severity === 'critical').length;
  const bads      = flags.filter(f => f.severity === 'bad').length;
  const warns     = flags.filter(f => f.severity === 'warn').length;
  if (criticals > 0) return `CRITICAL (${criticals} critical, rmsZ=${round2(rmsZ)})`;
  if (bads      > 0) return `NEEDS WORK (${bads} bad, ${warns} warns, rmsZ=${round2(rmsZ)})`;
  if (warns     > 0) return `ACCEPTABLE (${warns} warns, rmsZ=${round2(rmsZ)})`;
  return `PASS (rmsZ=${round2(rmsZ)})`;
}

function round2(x) { return Math.round(x * 100)  / 100; }
function round3(x) { return Math.round(x * 1000) / 1000; }
function round4(x) { return Math.round(x * 10000) / 10000; }
