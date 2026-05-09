# PROJECT: NOVA

> Status: Active — Phase 19 complete
> Purpose: AI-native pixel art pipeline. Look at any sprite image → extract its structure as AI-readable data → reproduce it pixel-perfect → style-transfer to any palette → evaluate against reference → iterate.

---

## What is this project?

A six-stage pipeline:
1. **Authoring** — 3D model (procedural or loaded GLB/glTF)
2. **Rendering** — cel-shaded at native low resolution (no downsampling)
3. **Cleanup** — 9 deterministic passes on palette index grid
4. **Aesthetic Evaluation** — structural metrics + reference library comparison
5. **Animation** — keyframe sprite sheets with per-frame timing
6. **Export** — PNG sprite sheet + JSON metadata

**The core insight**: LLMs can't see pixels but CAN read data. Every stage emits text-readable structures (ASCII grids, palette index arrays, JSON metrics). This isn't a workaround — it's the correct architecture.

---

## Stack

- **Node.js** — core pipeline (palette, grid, cleanup passes, metrics, export)
- **Three.js** — 3D rendering + cel shaders (runs in browser via HTML harness)
- **Python (optional)** — FID computation, discriminator training (Phase 4+)
- No frameworks, no bundlers for Phase 1 — plain Node.js modules

---

## Commands

```bash
# Install dependencies
npm install

# Run all tests (1111 tests)
npm test

# ── Ingest ──────────────────────────────────────────────────────────────────
# Ingest a single sprite from the Goku sheet
python3 tools/ingest_sprite.py --frame 4

# Batch-ingest all Goku frames (builds exports/batch/ + reference.json)
python3 tools/batch_ingest.py
python3 tools/batch_ingest.py --clean   # delete stale files first

# ── Evaluate ────────────────────────────────────────────────────────────────
# Evaluate one frame against the Goku reference distribution
node tools/eval_goku.js frame_0004
node tools/eval_goku.js              # random frame
node tools/eval_goku.js --all        # all frames, summary
node tools/eval_goku.js --worst 10   # 10 worst-scoring

# Full pipeline health report
node tools/goku_report.js
node tools/goku_report.js --verbose  # per-frame rows

# ── Style transfer ──────────────────────────────────────────────────────────
# Remap a frame to any color palette
node tools/style_transfer.js frame_0004 cool
node tools/style_transfer.js frame_0004 warm
node tools/style_transfer.js frame_0004 crimson
# Palettes: crimson | cool | warm | forest | mono

# ── Animation ───────────────────────────────────────────────────────────────
# Assemble frames into spritesheet + JSON sidecar
node tools/animate_goku.js --range 0-7
node tools/animate_goku.js --range 0-7 --palette cool --fps 12
node tools/animate_goku.js --sequence walk  # named sequences: walk/idle/kick/run/punch

# ── Phase 8: Goku-calibrated generative authoring ───────────────────────────
# Generate a new sprite calibrated to the Goku reference distribution
node tools/goku_iterate.js                  # default params, target band rmsZ < 0.5
node tools/goku_iterate.js --bad            # start from imbalanced params (harder test)
node tools/goku_iterate.js --max=50         # larger iteration budget
node tools/goku_iterate.js --target=0.40   # tighter convergence
node tools/goku_iterate.js --scale=4,8,16  # export at multiple scales
# Output: exports/goku_warrior.png + exports/goku_warrior.json

# ── Phase 9: Multi-pose generation ──────────────────────────────────────────
# Generate all 5 poses (idle, guard, punch, kick, power_up) calibrated to Goku
node tools/generate_poses.js                         # all 5 poses, default settings
node tools/generate_poses.js --poses=idle,punch      # specific poses only
node tools/generate_poses.js --scale=4 --fps=12      # thumbnail size, 12fps timing
node tools/generate_poses.js --max=50                # more iterations per pose
# Output: exports/poses/<pose>.png + exports/poses/pose_sheet.png (1120×320px)

# ── Phase 12: Generated animation ───────────────────────────────────────────
# Generate animated sprite sheets from the generative pipeline
node tools/generate_animation.js                  # idle loop + pose sequence
node tools/generate_animation.js --anim=idle      # 4-frame breathing idle only
node tools/generate_animation.js --anim=poses     # 5-pose sequence only
node tools/generate_animation.js --palette=cool   # style-transfer output
node tools/generate_animation.js --scale=4        # output scale (default 6)
node tools/generate_animation.js --fps=12         # idle loop FPS (default 8)
# Output: exports/generated_animation/idle_loop.png + pose_sequence.png + .json sidecars

# ── Phase 15: Sprite variation engine ───────────────────────────────────────
# Generate all pose × palette combinations at once
node tools/generate_variants.js                          # all 5 poses × 5 palettes = 25 variants
node tools/generate_variants.js --poses=idle,punch       # subset of poses
node tools/generate_variants.js --palettes=crimson,cool  # subset of palettes
node tools/generate_variants.js --scale=4 --max=30       # scale + iteration budget
# Output: exports/variants/<pose>_<palette>.png + variants.json + summary.txt

# ── Phase 14: Palette designer ──────────────────────────────────────────────
# Create custom palettes from hex colors or anchor points
node tools/palette_designer.js --hex "#000,#1c0814,...,#ffe088"   # from hex list
node tools/palette_designer.js --anchors "#0d0020,#e8c8ff"        # dark→light interpolation
node tools/palette_designer.js --anchors "#0d0020,#e8c8ff" --n=6  # 6 colors
node tools/palette_designer.js --preset crimson                   # show built-in
node tools/palette_designer.js --hex "..." --ascii                # ASCII preview
node tools/palette_designer.js --hex "..." --png                  # PNG preview
# Output: exports/palettes/<name>.json

# ── Phase 13: Pipeline quality report ───────────────────────────────────────
# Compare generated sprites vs ingested Goku frames (grades S-D)
node tools/quality_report.js                  # all 5 poses, grade report
node tools/quality_report.js --verbose        # per-metric z-score table
node tools/quality_report.js --ascii          # ASCII side-by-side comparison
# Output: exports/quality_report.json

# ── Legacy ──────────────────────────────────────────────────────────────────
node tools/ascii_dump.js <grid.json>
node tools/reconstruct.js goku_frame
```

---

## Architecture

```
PROJECT_NOVA/
├── src/
│   ├── core/
│   │   ├── palette.js          <- dynamic N-color palette, paletteFromRGB, band helpers
│   ├── palette_designer.js <- Phase 14: paletteFromHex, paletteFromAnchors, validatePalette, paletteInfo
│   └── authoring/
│       ├── variant_engine.js   <- Phase 15: buildVariantLibrary, generatePoseGrid, buildVariantCell
│       ├── character_spec.js   <- Phase 16: buildCharacter, validateCharacterSpec, resolvePaletteSpec
│       └── optimizer.js        <- Phase 18: Nelder-Mead threshold optimizer, projectThresholds
│   │   ├── grid.js             <- 2D grid (Uint8Array rows), cloneGrid, countPixels
│   │   └── ascii.js            <- gridToAscii, asciiToGrid, gridToJSON
│   ├── cleanup/                <- 9 deterministic passes (all palette-agnostic)
│   │   ├── pass1_orphan.js     <- remove isolated pixels
│   │   ├── pass2_outline_thin.js <- break 2×2 outline blocks
│   │   ├── pass3_outline_repair.js <- body pixels touching transparent → outline
│   │   ├── pass4_highlight_cluster.js <- shrink oversized peak clusters
│   │   ├── pass5_single_pixel.js <- remove disconnected single-pixel limbs
│   │   ├── pass6_band_skip.js  <- smooth luminance band jumps
│   │   ├── pass7_highlight_area.js <- cap peak area ratio
│   │   ├── pass8_mid_diagnostic.js <- flag mid-tone dominance (no mutation)
│   │   ├── pass9_contact_shadow.js <- darken bottom contact pixels
│   │   └── index.js            <- runCleanup(grid, palette) — all 9 in order
│   ├── eval/
│   │   ├── metrics.js          <- computeMetrics(grid, palette) — 6 band ratios + structural
│   │   ├── reference_lib.js    <- loadBatchReference(), buildReferenceProfile()
│   │   ├── compare.js          <- compareToReference(), adjustmentHints() (palette-agnostic)
│   │   └── similarity.js       <- Phase 17: compareGrids, findMostSimilar, computeMetricSimilarity
│   ├── animation/
│   │   ├── keyframe.js         <- makeKeyframe, totalDuration, sequenceToJSON
│   │   ├── timing.js           <- idleTiming, walkTiming, distributeDurations
│   │   └── spritesheet.js      <- keyframesToPNG, buildSidecar
│   ├── export/
│   │   └── scene_composer.js   <- Phase 19: createScene, addCharacter, addBattleLayout, renderScenePNG, sceneToJSON
│   └── authoring/
│       ├── parametric.js       <- buildFromParams, adjustParams, badStartParams (open part names)
│       ├── poses.js            <- 5 pose factories: idle/guard/punch/kick/power_up
│       └── goku_gen.js         <- generateGokuSprite(), evaluateAgainstGoku() (Phase 8 API)
├── tools/
│   ├── ingest_sprite.py        <- ingest single frame: K-means palette + grid (100% accuracy)
│   ├── batch_ingest.py         <- ingest all 165 Goku frames → exports/batch/ + reference.json
│   ├── eval_goku.js            <- evaluate any frame: ASCII + z-score table + hints
│   ├── goku_report.js          <- full pipeline health report (pass rate, per-metric breakdown)
│   ├── style_transfer.js       <- remap frame to any palette by luminance band rank
│   ├── animate_goku.js         <- assemble frames → spritesheet PNG + JSON sidecar
│   ├── goku_iterate.js         <- Phase 8: Goku-calibrated iteration loop, exports goku_warrior.png
│   ├── generate_poses.js       <- Phase 9: all 5 poses → Goku-calibrated → pose_sheet.png
│   ├── style_gallery.js        <- Phase 10: 5 palettes × 5 poses → 25-cell contact sheet
│   ├── generate_animation.js   <- Phase 12: idle breathing loop + pose sequence animation
│   ├── quality_report.js       <- Phase 13: generated vs ingested quality scoring + grading
│   ├── auto_iterate.js         <- parametric convergence loop (band-only, structural informational)
│   └── reconstruct.js          <- load grid+palette → render PNG (legacy)
├── tests/unit/                 <- 583 tests, all passing
├── exports/
│   ├── batch/                  <- 171 clean Goku frame grids/palettes + reference.json
│   ├── style_transfer/         <- style-transferred PNGs
│   └── animations/             <- spritesheet PNGs + JSON sidecars
└── references/grids/           <- legacy reference library (empty — use batch/ instead)
```

---

## Palette (default — crimson aesthetic)

| Index | Name         | Hex       | ASCII |
|-------|--------------|-----------|-------|
| 0     | transparent  | —         | `.`   |
| 1     | outline      | `#1c0814` | `#`   |
| 2     | shadow_deep  | `#380c20` | `X`   |
| 3     | shadow       | `#681424` | `x`   |
| 4     | mid          | `#b8281c` | `o`   |
| 5     | bright       | `#e86024` | `O`   |
| 6     | highlight    | `#ffa840` | `*`   |
| 7     | peak         | `#ffe088` | `@`   |

Hue-shifted: cool shadows (purple), warm highlights (orange-gold).

---

## Palette system

**Dynamic, N-color.** Not locked to any fixed palette. Every function accepts `palette` as a parameter.

```javascript
// Load any palette from Python ingest output
import { paletteFromRGB } from '../src/core/palette.js';
const palette = paletteFromRGB(paletteData);  // [{index, rgb:[r,g,b]}, ...]

// Index conventions (always):
// 0 = transparent
// 1 = outline (darkest, always black/near-black)
// 2..N-1 = body, sorted by luminance (dark → bright)

// Band helpers (palette-agnostic):
palette.bodyIndices      // [2, 3, ..., N-1]
palette.isBody(v)        // true for body pixels
palette.bandLevel(v)     // 0-based luminance rank
palette.darkenOne(v)     // one step darker
palette.brightenOne(v)   // one step brighter
palette.midIndex         // ~40th percentile body index
palette.peakIndex        // highest luminance body index
```

**Band ratios** (6 named buckets from any palette size):
`shadow_deep | shadow | mid | bright | highlight | peak`

---

## Goku reference distribution (165 frames, 100% reconstruction accuracy)

| Band | Mean | σ |
|------|------|---|
| shadow_deep | 37.9% | 5.0% |
| shadow | 23.5% | 7.0% |
| mid | 18.8% | 5.6% |
| bright | 8.6% | 6.4% |
| highlight | 6.6% | 3.1% |
| peak | 4.5% | 2.6% |

Pipeline pass rate: 77.2% (132/171 frames). Structural metrics (symmetry, outline variance, unique colors) have 0 failures.

---

## Conventions

- Grid coords: `grid[row][col]`, row 0 = top
- Palette indices are integers, always N-color dynamic (not fixed at 8)
- Transparency = index 0, outline = index 1, body = indices 2..N-1
- All cleanup passes take `(grid, palette)` → return new `Grid` (immutable)
- Exports committed to `exports/` so results are viewable from GitHub
- `exports/batch/` is the canonical data source for eval — 171 clean Goku frames

---

## Rules

- **Never downsample from high resolution** — render at native sprite resolution only
- **Never anti-alias** — no MSAA, FXAA, TAA, or any smoothing
- **Every stage emits data** — always have an ASCII dump or JSON metric for any output
- **Cleanup passes are immutable** — each pass returns a new grid, original unchanged
- **Palette is always dynamic** — never hardcode color indices; use palette band helpers
- **Per-frame timing always** — never uniform sampling; always explicit per-keyframe duration
- **100% reconstruction is the floor** — ingest with N = unique_colors+1 → zero error

---

## Phase progress

| Phase | What | Status |
|-------|------|--------|
| 1 | Core data structures + ASCII perception loop + 9 cleanup passes + tests | ✅ Done |
| 2 | Three.js cel shader + depth pass + Roberts Cross outline | Scaffold only |
| 3 | Animation keyframes + sprite sheet export + PNG commits | ✅ Done |
| 4 | Reference library + structural metrics + z-score comparison | ✅ Done |
| 5 | Batch ingest + Goku reference distribution + 385 tests | ✅ Done |
| 6 | Palette-agnostic pipeline + style transfer + eval CLI | ✅ Done |
| 7 | Animation assembly + goku_report + full pipeline health | ✅ Done |
| 8 | Goku-calibrated generative authoring — goku_iterate + goku_gen + 443 tests | ✅ Done |
| 9 | Multi-pose generation — 5 poses + pose_sheet + flexible buildFromParams + 517 tests | ✅ Done |
| 10 | Style gallery — 5 palettes × 5 poses → 25-cell contact sheet + 583 tests | ✅ Done |
| 11 | End-to-end pipeline test: all 7 stages verified — ingest → eval → iterate → export + 636 tests | ✅ Done |
| 12 | Generated animation: 4-frame breathing idle loop + 5-pose sequence + 699 tests | ✅ Done |
| 13 | Pipeline quality report: generated vs ingested z-score comparison + grading + 744 tests | ✅ Done |
| 14 | Palette designer: paletteFromHex, paletteFromAnchors, validatePalette + 819 tests | ✅ Done |
| 15 | Sprite variation engine: all poses × all palettes — complete variant library + 866 tests | ✅ Done |
| 16 | Character specification API: JSON spec → complete sprite set (variants + animations + quality) + 920 tests | ✅ Done |
| 17 | Sprite similarity engine: metric-space comparison (band cosine + L2 + composite grade S-D) + 980 tests | ✅ Done |
| 18 | Adaptive threshold optimizer: Nelder-Mead simplex on 5D threshold space + 1021 tests | ✅ Done |
| 19 | Multi-character scene composition: battle layout, RGBA blit, PNG export, AI-readable JSON + 1111 tests | ✅ Done |
