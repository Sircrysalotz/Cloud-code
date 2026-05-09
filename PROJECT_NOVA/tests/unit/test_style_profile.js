import { check, section } from '../helpers.js';
import {
  buildStyleProfile, scaffoldFromProfile, scoreAgainstProfile,
  styleProfileToJSON, styleProfileFromJSON,
} from '../../src/eval/style_profile.js';
import { makeGrid, gridSize } from '../../src/core/grid.js';
import { PALETTE } from '../../src/core/palette.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTestGrid(w, h, fill = 4) {
  const g = makeGrid(w, h, 0);
  // outline border + body fill
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (r === 0 || r === h-1 || c === 0 || c === w-1) g[r][c] = 1;
      else g[r][c] = fill;
    }
  }
  return g;
}

// Build two different grids for testing
const g1 = makeTestGrid(10, 15, 4);  // mostly mid
const g2 = makeTestGrid(10, 15, 3);  // mostly shadow
const g3 = makeTestGrid(12, 15, 5);  // mostly bright
const testGrids = [g1, g2, g3];

// ── buildStyleProfile ─────────────────────────────────────────────────────────
section('style_profile / buildStyleProfile');

const profile = buildStyleProfile(testGrids, PALETTE, 'test');

check('profile source', profile.source === 'test');
check('profile frameCount', profile.frameCount === 3);
check('profile has dims', profile.dims !== undefined);
check('profile medianWidth', profile.dims.medianWidth === 10);
check('profile medianHeight', profile.dims.medianHeight === 15);
check('profile aspectRatio', Math.abs(profile.dims.aspectRatio - 10/15) < 0.01);

check('profile has bands', profile.bands !== undefined);
check('profile bands has shadow_deep', profile.bands.shadow_deep !== undefined);
check('profile bands has mid',         profile.bands.mid !== undefined);
check('profile bands has peak',        profile.bands.peak !== undefined);
check('profile band mean is number',   typeof profile.bands.mid.mean === 'number');
check('profile band sigma is number',  typeof profile.bands.mid.sigma === 'number');

check('profile has spatial', profile.spatial !== undefined);
check('profile spatial shadow_deep', profile.spatial.shadow_deep !== undefined);
check('profile spatial mid topBias',    typeof profile.spatial.mid.topBias === 'number');
check('profile spatial mid centerBias', typeof profile.spatial.mid.centerBias === 'number');
check('profile topBias in [0,1]', profile.spatial.mid.topBias >= 0 && profile.spatial.mid.topBias <= 1);

check('profile has highlight centroid', profile.highlight !== undefined);
check('profile highlight centroidRowNorm', typeof profile.highlight.centroidRowNorm === 'number');
check('profile highlight centroidColNorm', typeof profile.highlight.centroidColNorm === 'number');

check('profile has outline',  profile.outline !== undefined);
check('profile outline coverageRatio >= 0', profile.outline.coverageRatio >= 0);
check('profile outline coverageRatio <= 1', profile.outline.coverageRatio <= 1);

check('profile has symmetry', profile.symmetry !== undefined);
check('profile symmetry meanScore', typeof profile.symmetry.meanScore === 'number');

check('profile has templateFrame', Array.isArray(profile.templateFrame));
check('profile templateFrame rows', profile.templateFrame.length === 15);
check('profile templateFrame cols', profile.templateFrame[0].length === 10);

// ── buildStyleProfile edge cases ──────────────────────────────────────────────
section('style_profile / buildStyleProfile edge cases');

const singleFrame = buildStyleProfile([g1], PALETTE);
check('single frame profile', singleFrame.frameCount === 1);
check('single frame sigma = 0', singleFrame.bands.mid.sigma === 0);

let threw = false;
try { buildStyleProfile([], PALETTE); } catch { threw = true; }
check('empty grids throws', threw);

// Different-sized grids
const gSmall = makeTestGrid(8, 12, 4);
const gLarge = makeTestGrid(16, 24, 4);
const mixedProfile = buildStyleProfile([gSmall, gSmall, gLarge], PALETTE);
check('mixed sizes uses median', mixedProfile.dims.medianWidth === 8);

// ── scaffoldFromProfile ───────────────────────────────────────────────────────
section('style_profile / scaffoldFromProfile');

const scaffold = scaffoldFromProfile(profile, PALETTE);
check('scaffold is a grid', Array.isArray(scaffold));
check('scaffold has rows', scaffold.length === 15);
check('scaffold has cols', scaffold[0].length === 10);

// All pixels should be valid palette indices
const [sw, sh] = gridSize(scaffold);
let allValid = true;
for (let r = 0; r < sh; r++) {
  for (let c = 0; c < sw; c++) {
    if (scaffold[r][c] > 7) { allValid = false; break; }
  }
}
check('scaffold all valid indices', allValid);

// Border pixels should remain outline (1)
check('scaffold border outline top-left',     scaffold[0][0] === 1);
check('scaffold border outline bottom-right', scaffold[14][9] === 1);

// Interior should be non-zero
check('scaffold interior non-transparent', scaffold[7][5] > 0);

// ── scoreAgainstProfile ───────────────────────────────────────────────────────
section('style_profile / scoreAgainstProfile');

// Score g1 against profile built from g1 alone — should be nearly perfect
const selfProfile = buildStyleProfile([g1], PALETTE, 'self');
const selfScore   = scoreAgainstProfile(g1, selfProfile, PALETTE);
check('self-score rmsZ = 0',  selfScore.rmsZ === 0);
check('self-score score = 1', selfScore.score === 1);
check('self-score has deviations', Array.isArray(selfScore.deviations));
check('self-score deviations count', selfScore.deviations.length === 6);

// Score g2 against profile built from g1 — should have some deviation
const crossScore = scoreAgainstProfile(g2, selfProfile, PALETTE);
check('cross-score has rmsZ',    crossScore.rmsZ >= 0);
check('cross-score score 0-1',   crossScore.score >= 0 && crossScore.score <= 1);
check('cross-score deviations',  crossScore.deviations.length === 6);

// Deviation objects structure
const dev = selfScore.deviations[0];
check('deviation has band',  typeof dev.band  === 'string');
check('deviation has value', typeof dev.value === 'number');
check('deviation has mean',  typeof dev.mean  === 'number');
check('deviation has sigma', typeof dev.sigma === 'number');
check('deviation has z',     typeof dev.z     === 'number');
check('self-score all z=0',  selfScore.deviations.every(d => d.z === 0));

// ── styleProfileToJSON / styleProfileFromJSON ─────────────────────────────────
section('style_profile / serialization');

const jsonStr = styleProfileToJSON(profile);
check('toJSON returns string', typeof jsonStr === 'string');
check('toJSON contains source', jsonStr.includes('"source"'));
check('toJSON contains bands',  jsonStr.includes('"bands"'));

const parsed = styleProfileFromJSON(jsonStr);
check('fromJSON source',     parsed.source === profile.source);
check('fromJSON frameCount', parsed.frameCount === profile.frameCount);
check('fromJSON bands mid mean', Math.abs(parsed.bands.mid.mean - profile.bands.mid.mean) < 0.0001);
check('fromJSON templateFrame rows', parsed.templateFrame.length === profile.templateFrame.length);

// fromJSON also accepts objects
const parsed2 = styleProfileFromJSON(profile);
check('fromJSON accepts object', parsed2.source === profile.source);

// Roundtrip scaffold from parsed profile
const scaffold2 = scaffoldFromProfile(parsed, PALETTE);
check('scaffold from parsed profile works', scaffold2.length === 15);

// ── Dynamic palette support ───────────────────────────────────────────────────
section('style_profile / dynamic palette');

// Build a minimal 4-color palette (transparent, outline, body1, body2)
import { makePalette } from '../../src/core/palette.js';
const dynPalette = makePalette([
  { index:0, name:'transparent', hex:null,      r:0,  g:0,  b:0,  a:0,   ascii:'.' },
  { index:1, name:'outline',     hex:'#000000', r:0,  g:0,  b:0,  a:255, ascii:'#' },
  { index:2, name:'shadow_deep', hex:'#111111', r:17, g:17, b:17, a:255, ascii:'X' },
  { index:3, name:'peak',        hex:'#ffffff', r:255,g:255,b:255,a:255, ascii:'@' },
]);

const dynGrid = makeGrid(8, 8, 0);
for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
  if (r===0||r===7||c===0||c===7) dynGrid[r][c] = 1;
  else dynGrid[r][c] = r < 4 ? 3 : 2;
}

const dynProfile = buildStyleProfile([dynGrid, dynGrid], dynPalette, 'dynamic');
check('dynamic palette profile',          dynProfile.source === 'dynamic');
check('dynamic profile band mean >= 0',   dynProfile.bands.shadow_deep.mean >= 0);
check('dynamic scaffold valid', (() => {
  const sc = scaffoldFromProfile(dynProfile, dynPalette);
  return sc.length === 8 && sc[0].length === 8;
})());
