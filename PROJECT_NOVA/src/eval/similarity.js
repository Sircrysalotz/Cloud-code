/**
 * similarity.js — Phase 17: Sprite similarity engine.
 *
 * Computes structural similarity between two sprites in the pipeline's
 * feature space — not pixel-level SSIM (useless for LLMs) but the same
 * metrics the calibration loop uses: band ratios, symmetry, body density.
 *
 * Two sprites are "similar" if their metric vectors are close. This lets
 * the AI answer: "does this generated sprite match the reference style?"
 *
 * Similarity metrics:
 *   band_cosine  — cosine similarity of the 6-band ratio vectors (0–1)
 *   band_l2      — Euclidean distance of band ratio vectors (0 = identical)
 *   struct_delta — mean absolute difference of structural metrics
 *   composite    — weighted combination: 0 (identical) → 1 (maximally different)
 *   grade        — S/A/B/C/D letter grade
 */

import { computeMetrics } from './metrics.js';

// ── Constants ─────────────────────────────────────────────────────────────────

export const BAND_KEYS = [
  'shadow_deep_ratio', 'shadow_ratio', 'mid_ratio',
  'bright_ratio', 'highlight_ratio', 'peak_ratio',
];

export const STRUCT_KEYS = [
  'symmetry_score', 'body_density',
];

// Grade thresholds for composite score
export const GRADE_THRESHOLDS = {
  S: 0.10,  // composite < 0.10 → essentially identical
  A: 0.20,  // < 0.20 → very similar
  B: 0.35,  // < 0.35 → similar style
  C: 0.55,  // < 0.55 → somewhat similar
  D: Infinity,
};

// ── Math helpers ──────────────────────────────────────────────────────────────

function dot(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }
function mag(a)    { return Math.sqrt(a.reduce((s, v) => s + v * v, 0)); }

/**
 * Cosine similarity between two vectors.
 * Returns 1 for identical direction, 0 for orthogonal, -1 for opposite.
 */
export function cosineSim(a, b) {
  const ma = mag(a), mb = mag(b);
  if (ma < 1e-10 || mb < 1e-10) return 1;  // both zero = identical
  return Math.max(-1, Math.min(1, dot(a, b) / (ma * mb)));
}

/**
 * Euclidean distance between two vectors.
 */
export function euclideanDist(a, b) {
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
}

/**
 * Mean absolute difference between two arrays.
 */
export function meanAbsDiff(a, b) {
  if (a.length === 0) return 0;
  return a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
}

// ── Core similarity function ──────────────────────────────────────────────────

/**
 * Compute band-vector and structural metrics from pre-computed metrics object.
 */
export function metricsToVectors(metrics) {
  const band   = BAND_KEYS.map(k => metrics[k] ?? 0);
  const struct = STRUCT_KEYS.map(k => {
    const v = metrics[k] ?? 0;
    // Normalize: symmetry 0–1 (already), body_density 0–1 (already)
    return typeof v === 'number' ? v : 0;
  });
  return { band, struct };
}

/**
 * Compute all similarity scores between two pre-computed metric objects.
 *
 * @param {object} metricsA — from computeMetrics
 * @param {object} metricsB — from computeMetrics
 * @returns {SimilarityResult}
 */
export function computeMetricSimilarity(metricsA, metricsB) {
  const vecA = metricsToVectors(metricsA);
  const vecB = metricsToVectors(metricsB);

  const band_cosine  = cosineSim(vecA.band, vecB.band);
  const band_l2      = euclideanDist(vecA.band, vecB.band);
  const struct_delta = meanAbsDiff(vecA.struct, vecB.struct);

  // Composite: lower is more similar.
  // weight band similarity heavily (it's what calibration targets).
  // cosine_dissim ∈ [0,1]: 0 = identical direction
  const cosine_dissim  = (1 - band_cosine) / 2;  // map [-1,1]→[0,1]
  const composite      = 0.70 * cosine_dissim + 0.20 * Math.min(band_l2, 1) + 0.10 * Math.min(struct_delta, 1);

  let grade = 'D';
  for (const [g, thresh] of Object.entries(GRADE_THRESHOLDS)) {
    if (composite < thresh) { grade = g; break; }
  }

  return {
    band_cosine:    +band_cosine.toFixed(4),
    band_l2:        +band_l2.toFixed(4),
    struct_delta:   +struct_delta.toFixed(4),
    composite:      +composite.toFixed(4),
    grade,
    vectors:        { bandA: vecA.band, bandB: vecB.band, structA: vecA.struct, structB: vecB.struct },
    per_band:       Object.fromEntries(BAND_KEYS.map((k, i) => [k, {
      a: +vecA.band[i].toFixed(4),
      b: +vecB.band[i].toFixed(4),
      diff: +(vecA.band[i] - vecB.band[i]).toFixed(4),
    }])),
  };
}

/**
 * High-level: compare two grids directly.
 *
 * @param {Uint8Array[]} gridA
 * @param {object}       paletteA
 * @param {Uint8Array[]} gridB
 * @param {object}       paletteB
 * @returns {SimilarityResult}
 */
export function compareGrids(gridA, paletteA, gridB, paletteB) {
  const metricsA = computeMetrics(gridA, paletteA);
  const metricsB = computeMetrics(gridB, paletteB);
  const result   = computeMetricSimilarity(metricsA, metricsB);
  return { ...result, metricsA, metricsB };
}

/**
 * Compare a sprite against a batch of reference grids. Returns sorted results.
 *
 * @param {object}       queryMetrics    — from computeMetrics
 * @param {{ id, metrics }[]} references — each entry has id + pre-computed metrics
 * @returns {{ id, similarity }[]}       — sorted by composite (most similar first)
 */
export function findMostSimilar(queryMetrics, references) {
  return references
    .map(({ id, metrics }) => ({
      id,
      similarity: computeMetricSimilarity(queryMetrics, metrics),
    }))
    .sort((a, b) => a.similarity.composite - b.similarity.composite);
}

/**
 * Grade label with description.
 */
export function gradeLabel(grade) {
  return {
    S: 'IDENTICAL — same luminance distribution',
    A: 'VERY SIMILAR — same aesthetic style',
    B: 'SIMILAR — compatible style with minor variation',
    C: 'SOMEWHAT SIMILAR — same character type but different tone',
    D: 'DIFFERENT — distinct luminance profile',
  }[grade] ?? 'UNKNOWN';
}
