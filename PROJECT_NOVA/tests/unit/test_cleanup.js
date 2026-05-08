import { check, section } from '../helpers.js';
import { makeGrid, cloneGrid, setPixel } from '../../src/core/grid.js';
import { IDX } from '../../src/core/palette.js';
import { pass1Orphan }           from '../../src/cleanup/pass1_orphan.js';
import { pass2OutlineThin }      from '../../src/cleanup/pass2_outline_thin.js';
import { pass3OutlineRepair }    from '../../src/cleanup/pass3_outline_repair.js';
import { pass4HighlightCluster } from '../../src/cleanup/pass4_highlight_cluster.js';
import { pass5SinglePixel }      from '../../src/cleanup/pass5_single_pixel.js';
import { pass6BandSkip }         from '../../src/cleanup/pass6_band_skip.js';
import { pass7HighlightArea }    from '../../src/cleanup/pass7_highlight_area.js';
import { pass8MidDiagnostic }    from '../../src/cleanup/pass8_mid_diagnostic.js';
import { pass9ContactShadow }    from '../../src/cleanup/pass9_contact_shadow.js';
import { runCleanup }            from '../../src/cleanup/index.js';

const T = IDX.TRANSPARENT;
const O = IDX.OUTLINE;
const X = IDX.SHADOW_DEEP;
const x = IDX.SHADOW;
const o = IDX.MID;
const B = IDX.BRIGHT;
const H = IDX.HIGHLIGHT;
const P = IDX.PEAK;

// ── Pass 1: Orphan Removal ──────────────────────────────────────────────────
section('pass1 orphan removal');
{
  // Single stray pixel surrounded by different colors
  const g = makeGrid(5, 5, o);  // fill with mid
  g[2][2] = P;  // single peak pixel — all neighbors are mid
  const out = pass1Orphan(g);
  check('pass1 removes rare isolated pixel', out[2][2] === o);

  // Pixel with a same-color neighbor should NOT be removed
  const g2 = makeGrid(5, 5, o);
  g2[2][2] = P; g2[2][3] = P;  // two adjacent peaks — not isolated
  const out2 = pass1Orphan(g2);
  check('pass1 keeps pixel with same-color neighbor', out2[2][2] === P);

  // Common color should not be removed even if isolated
  const g3 = makeGrid(10, 10, P);  // fill with peak — 100 pixels
  g3[5][5] = o;  // single mid surrounded by peak — but mid is still "rare" here (1 pixel)
  const out3 = pass1Orphan(g3);
  check('pass1 removes rare isolated mid in peak field', out3[5][5] === P);

  // Immutability
  const g4 = makeGrid(5, 5, o);
  g4[2][2] = P;
  const out4 = pass1Orphan(g4);
  check('pass1 immutable', g4[2][2] === P);
}

// ── Pass 2: Outline Thinning ────────────────────────────────────────────────
section('pass2 outline thinning');
{
  // Outline pixel with 3 outline neighbors and 1 body neighbor → demote
  //  O O
  //  O O  <- bottom-right has 3 outline neighbors (top, left, top-left) + body below
  const g = makeGrid(4, 4, T);
  g[1][1] = O; g[1][2] = O;
  g[2][1] = O; g[2][2] = O;  // 2x2 outline block
  g[3][2] = o;               // body below
  const out = pass2OutlineThin(g);
  // Bottom-right of 2x2 block should be demoted
  check('pass2 demotes bottom-right of 2x2 block', out[2][2] === X);

  // Single outline pixel with body neighbors should not be demoted
  const g2 = makeGrid(5, 5, T);
  g2[2][2] = O;
  g2[1][2] = o; g2[3][2] = o; g2[2][1] = o; g2[2][3] = o; // all body, no outline neighbors
  const out2 = pass2OutlineThin(g2);
  check('pass2 keeps thin outline', out2[2][2] === O);

  // Immutability
  const g3 = makeGrid(4, 4, T);
  g3[1][1] = O; g3[1][2] = O; g3[2][1] = O; g3[2][2] = O;
  pass2OutlineThin(g3);
  check('pass2 immutable', g3[2][2] === O);
}

// ── Pass 3: Outline Gap Repair ───────────────────────────────────────────────
section('pass3 outline repair');
{
  // Body pixel adjacent to transparent → becomes outline
  const g = makeGrid(5, 5, T);
  g[2][2] = o; g[2][3] = o; g[3][2] = o; g[3][3] = o; // 2x2 body block inside transparent field
  const out = pass3OutlineRepair(g);
  // All 4 body pixels touch transparent → all become outline
  check('pass3 converts body touching transparent', out[2][2] === O);
  check('pass3 all body→outline', out[2][3] === O && out[3][2] === O && out[3][3] === O);

  // Body pixel not touching transparent should not change
  const g2 = makeGrid(5, 5, o);  // solid body
  const out2 = pass3OutlineRepair(g2);
  check('pass3 interior body unchanged', out2[2][2] === o);

  // Outline pixel adjacent to transparent — should not double-convert
  const g3 = makeGrid(5, 5, T);
  g3[2][2] = O; // already outline
  const out3 = pass3OutlineRepair(g3);
  check('pass3 outline stays outline', out3[2][2] === O);
}

// ── Pass 4: Highlight Cluster Validation ────────────────────────────────────
section('pass4 highlight cluster');
{
  // Two separate peak clusters — smaller should be demoted
  const g = makeGrid(10, 10, o);
  g[1][1] = P; g[1][2] = P; g[1][3] = P; // cluster A: 3px
  g[8][8] = P; // cluster B: 1px
  const out = pass4HighlightCluster(g);
  check('pass4 keeps large cluster', out[1][1] === P && out[1][2] === P);
  check('pass4 demotes small cluster', out[8][8] === H);

  // Single cluster — nothing should change
  const g2 = makeGrid(5, 5, o);
  g2[2][2] = P; g2[2][3] = P;
  const out2 = pass4HighlightCluster(g2);
  check('pass4 single cluster unchanged', out2[2][2] === P && out2[2][3] === P);

  // No peak pixels — should not throw
  const g3 = makeGrid(5, 5, o);
  const out3 = pass4HighlightCluster(g3);
  check('pass4 no peak pixels OK', out3[2][2] === o);
}

// ── Pass 5: Single Pixel Limb Removal ────────────────────────────────────────
section('pass5 single pixel limb');
{
  // Body pixel with 3+ transparent neighbors → removed
  const g = makeGrid(5, 5, T);
  g[2][2] = o; // single isolated body pixel (4 transparent neighbors → removed)
  const out = pass5SinglePixel(g);
  check('pass5 removes isolated body pixel', out[2][2] === T);

  // Body pixel at corner: 2 out-of-bounds + 2 transparent = 4 → removed
  const g2 = makeGrid(5, 5, T);
  g2[0][0] = o;
  const out2 = pass5SinglePixel(g2);
  check('pass5 removes corner body pixel', out2[0][0] === T);

  // Body pixel connected to others should survive
  const g3 = makeGrid(5, 5, T);
  g3[2][2] = o; g3[2][3] = o; g3[3][2] = o; // cluster of 3
  const out3 = pass5SinglePixel(g3);
  check('pass5 keeps connected cluster', out3[2][2] === o);
}

// ── Pass 6: Band Skip Prevention ─────────────────────────────────────────────
section('pass6 band skip');
{
  // shadow_deep (level 0) adjacent to peak (level 5) → 5 apart → insert mid (level 1)
  const g = makeGrid(4, 3, T);
  g[1][1] = X; // shadow_deep, level 0
  g[1][2] = P; // peak, level 5 → diff = 5 >= 3 → insert intermediate
  const out = pass6BandSkip(g);
  // Lighter pixel (peak) should be replaced with level 1 (shadow)
  check('pass6 fixes large skip', out[1][2] !== P);
  check('pass6 intermediate level inserted', out[1][2] === IDX.SHADOW); // level 0+1 = shadow

  // Adjacent pixels 2 apart (e.g. shadow_deep → mid) → allowed, not changed
  const g2 = makeGrid(4, 3, T);
  g2[1][1] = X; // level 0
  g2[1][2] = o; // level 2 → diff = 2 → OK
  const out2 = pass6BandSkip(g2);
  check('pass6 allows 2-level difference', out2[1][1] === X && out2[1][2] === o);
}

// ── Pass 7: Highlight Area Enforcement ───────────────────────────────────────
section('pass7 highlight area');
{
  // Create a grid where peak is >10% of body
  // 100 body pixels, 20 peak → 20% → too many
  const g = makeGrid(10, 10, o); // 100 mid pixels
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) g[r][c] = P; // 20 peak
  const out = pass7HighlightArea(g);
  const bodyCount = 100;
  let peakCount = 0;
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) if (out[r][c] === P) peakCount++;
  check('pass7 reduces peak ratio below 10%', peakCount / bodyCount <= 0.10);

  // Peak already within limit — should not change
  const g2 = makeGrid(20, 20, o); // 400 mid
  g2[0][0] = P; g2[0][1] = P;    // 2 peak = 0.5% → fine
  const out2 = pass7HighlightArea(g2);
  check('pass7 keeps low-ratio peak unchanged', out2[0][0] === P);
}

// ── Pass 8: Mid Diagnostic ────────────────────────────────────────────────────
section('pass8 mid diagnostic');
{
  // Balanced sprite — no flags
  const g = makeGrid(10, 10, o); // all mid → 100% mid
  // 100% is > 70%, should flag
  const { flags } = pass8MidDiagnostic(g);
  check('pass8 flags high mid', flags.some(f => f.includes('HIGH_MID')));

  // Low mid case
  const g2 = makeGrid(10, 10, P); // all peak
  const { flags: f2 } = pass8MidDiagnostic(g2);
  check('pass8 flags low mid', f2.some(f => f.includes('LOW_MID')));

  // Empty grid
  const g3 = makeGrid(5, 5, T);
  const { flags: f3 } = pass8MidDiagnostic(g3);
  check('pass8 flags empty', f3.some(f => f.includes('EMPTY')));

  // Grid does not get modified
  const g4 = makeGrid(5, 5, o);
  const { grid: outGrid } = pass8MidDiagnostic(g4);
  check('pass8 immutable grid', outGrid[2][2] === o);
}

// ── Pass 9: Contact Shadow ────────────────────────────────────────────────────
section('pass9 contact shadow');
{
  // Bottom body pixel should be darkened
  const g = makeGrid(5, 6, T);
  // Column 2: body pixels at rows 2, 3, 4 (lowest = row 4)
  g[2][2] = B; g[3][2] = o; g[4][2] = o; // bright → mid → mid
  const out = pass9ContactShadow(g);
  // Row 4, col 2 should be darkened (mid → shadow)
  check('pass9 darkens bottom pixel', out[4][2] < o);
  // Row 3, col 2 should also be darkened (mid level 2 → shadow level 1)
  check('pass9 darkens second-bottom pixel', out[3][2] <= o);
  // Row 2 (bright) should be higher up — may or may not change depending on level
  check('pass9 top of column unchanged or brightened', out[2][2] === B);

  // Empty column — should not crash
  const g2 = makeGrid(5, 5, T);
  const out2 = pass9ContactShadow(g2);
  check('pass9 empty column safe', out2[0][0] === T);

  // Immutability
  const g3 = makeGrid(5, 5, T);
  g3[4][2] = o;
  pass9ContactShadow(g3);
  check('pass9 immutable', g3[4][2] === o);
}

// ── Full pipeline ─────────────────────────────────────────────────────────────
section('runCleanup full pipeline');
{
  // Create a reasonably realistic grid and verify pipeline doesn't crash
  const g = makeGrid(16, 16, T);
  // Center blob of body
  for (let r = 4; r < 12; r++) for (let c = 4; c < 12; c++) g[r][c] = o;
  // Add some highlights
  g[6][6] = P; g[6][7] = P; g[7][6] = P; // peak cluster
  g[9][9] = P; // isolated peak
  // Stray pixel
  g[2][2] = P; // orphan peak
  // Vertical body at edge (potential single-pixel limb)
  g[8][3] = o; // protrusion with 3 transparent neighbors (left, top-left, bottom-left)

  const { grid, flags, passResults } = runCleanup(g);
  check('pipeline returns grid', Array.isArray(grid) && grid.length === 16);
  check('pipeline returns flags array', Array.isArray(flags));
  check('pipeline runs all 9 passes', passResults.length === 9);
  check('pipeline grid is valid', grid[4][4] !== undefined);
}
