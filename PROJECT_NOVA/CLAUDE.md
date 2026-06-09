# PROJECT: NOVA

> Status: Active — Phase 27 in progress
> Purpose: AI-native pixel art pipeline. Ingest any sprite → extract every pixel as readable data → reconstruct pixel-perfect → style-transfer, compose, and generate new characters from that data foundation.

---

## What is this project?

An AI-native pipeline where **every pixel is data**. Because LLMs can read structured data (grid arrays, palette indices, JSON metrics), they can understand, reconstruct, and generate pixel art with full accuracy — not as images, but as data structures.

The correct pipeline, in order:
1. **Ingest** — real sprite image → palette-indexed grid (100% accuracy, zero approximation)
2. **Reconstruct** — grid + palette → pixel-perfect PNG (no cleanup on ingested frames)
3. **Verify** — pixel-by-pixel confirmation that output matches source
4. **Style Transfer** — remap pixel luminance bands to any target palette (structure preserved)
5. **Compose** — combine/transform frames using grid operations (scale, flip, crop, recolor)
6. **Export** — PNG + JSON sidecar with full metadata

**The core insight**: Every pixel is stored as a palette index. Every palette index has a known luminance rank. An LLM can read these arrays, understand where hair is, where the torso is, what color each region is — and from that data, construct new content accurately.

**What does NOT work (and must never be used):**
- Parametric rectangle fills with gradient shading → produces blobs, not characters
- Running cleanup passes on ingested frames → corrupts 20% of real pixel data
- Embedding palette in JSON when batch already has it → duplicates data needlessly

---

## Stack

- **Node.js** — core pipeline (palette, grid, cleanup passes, metrics, export)
- **Python** — sprite ingest (K-means palette extraction, 100% reconstruction)
- No frameworks, no bundlers — plain Node.js modules

---

## Commands

```bash
# Install dependencies
npm install

# Run all tests
npm test

# ── Ingest ──────────────────────────────────────────────────────────────────
# Ingest a single sprite frame → exports/batch/frame_XXXX_grid.json + palette
python3 tools/ingest_sprite.py --frame 4

# Batch-ingest all Goku frames → exports/batch/ + reference.json
python3 tools/batch_ingest.py
python3 tools/batch_ingest.py --clean   # delete stale files first

# ── Reconstruct & Verify ────────────────────────────────────────────────────
# Reconstruct any ingested frame to PNG (no modifications)
node tools/reconstruct.js goku_frame            # exports/goku_frame_recon.png
node tools/reconstruct.js goku_frame --scale 4  # smaller scale

# Verify ALL batch frames reconstruct at 100% accuracy
node tools/verify_reconstruction.js              # all frames
node tools/verify_reconstruction.js --frame=4   # single frame
node tools/verify_reconstruction.js --verbose   # per-frame detail

# ── Poses (5 real Goku frames, pixel-perfect) ───────────────────────────────
# Reconstruct 5 key animation frames as named poses
node tools/generate_poses.js                          # all 5 poses, original palette
node tools/generate_poses.js --palette=crimson        # style-transfer to crimson
node tools/generate_poses.js --poses=idle,punch       # specific poses
node tools/generate_poses.js --no-sheet               # skip spritesheet
# Output: exports/poses/<pose>.png + exports/poses/pose_sheet.png

# ── Compose (Phase 28: new characters from real frame parts) ────────────────
# Transform a single frame (float scale, flip, zone crop, palette)
node tools/compose_character.js --frame=4 --flipH --palette=cool
node tools/compose_character.js --frame=5 --scale=1.5 --zone=head

# Inspect data-driven seam detection (neck/hip) for any frame
node tools/build_character.js --frame=4 --show-seams

# Fuse head/torso/legs from DIFFERENT real frames into a new character
node tools/build_character.js --head=4 --torso=9 --legs=14 --name=fusion_a
node tools/build_character.js --head=18 --torso=5 --legs=0 --target=5
# Output: exports/composed/<name>.png + .json (every pixel from real frames)

# Animate a fused character: body walks through real frames, pinned parts stay
node tools/animate_character.js --range=0-7 --head=4 --name=fused_walk
node tools/animate_character.js --range=0-7 --fps=12   # pure reassembly
# Output: exports/composed/<name>_sheet.png + .json (bottom-aligned strip)

# Region-aware recoloring: new character variants, grid never modified
node tools/recolor_character.js --frame=4 --list              # show hue regions
node tools/recolor_character.js --frame=4 --map="red:#3060ff" --name=blue_fur
node tools/recolor_character.js --frame=4 --map="red:#208040,orange:#c08850"
# Regions on frame 4: red=fur(543px) neutral=hair orange=skin purple/magenta=shading

# ── Evaluate ────────────────────────────────────────────────────────────────
# Evaluate any frame against the Goku reference distribution
node tools/eval_goku.js frame_0004
node tools/eval_goku.js --all        # all frames
node tools/eval_goku.js --worst 10   # worst-scoring frames

# Full pipeline health report
node tools/goku_report.js
node tools/goku_report.js --verbose  # per-frame rows

# ── Style transfer ──────────────────────────────────────────────────────────
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
│   ├── palette_designer.js  <- Phase 14: paletteFromHex, paletteFromAnchors, validatePalette, paletteInfo
│   │   └── palette_mutator.js <- Phase 22: tint, brighten, darken, contrast, saturate, desaturate, invert, compose
│   └── authoring/
│       ├── variant_engine.js   <- Phase 15: buildVariantLibrary, generatePoseGrid, buildVariantCell
│       ├── character_spec.js   <- Phase 16: buildCharacter, validateCharacterSpec, resolvePaletteSpec
│       ├── optimizer.js        <- Phase 18: Nelder-Mead threshold optimizer, projectThresholds
│       └── search.js           <- Phase 25: randomRestart, hillClimb, beamSearch, multiStart
│   │   ├── grid.js             <- 2D grid (Uint8Array rows), cloneGrid, countPixels
│   │   └── grid_ops.js         <- Phase 23: contentBounds, cropToContent, padGrid, flipH/V, rotateGrid, scaleGrid
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
│   │   ├── similarity.js       <- Phase 17: compareGrids, findMostSimilar, computeMetricSimilarity
│   │   ├── diff.js             <- Phase 21: diffGrids, heatmapToAscii, diffSequence, changeMask
│   │   ├── batch_eval.js       <- Phase 24: batchEval, rankBatch, filterBatch, batchSummary, topN
│   │   └── counterfactual.js   <- Phase 26: computeSensitivity, prescribe, rmsZGradient, gradientStep
│   ├── animation/
│   │   ├── keyframe.js         <- makeKeyframe, totalDuration, sequenceToJSON
│   │   ├── timing.js           <- idleTiming, walkTiming, distributeDurations
│   │   └── spritesheet.js      <- keyframesToPNG, buildSidecar
│   ├── export/
│   │   ├── scene_composer.js   <- Phase 19: createScene, addCharacter, addBattleLayout, renderScenePNG, sceneToJSON
│   │   └── atlas_packer.js     <- Phase 20: packRects, buildAtlas, buildUVMap, libraryCells, atlasInfo
│   └── authoring/
│       ├── parametric.js       <- buildFromParams, adjustParams, badStartParams (open part names)
│       ├── poses.js            <- 5 pose factories + POSE_FRAME real-frame mapping
│       ├── goku_gen.js         <- generateGokuSprite(), evaluateAgainstGoku() (Phase 8 API)
│       └── part_compositor.js  <- Phase 28: rowProfile, findSeams, splitParts, compositeParts, assembleCharacter
├── tools/
│   ├── ingest_sprite.py        <- ingest single frame: K-means palette + grid (100% accuracy)
│   ├── batch_ingest.py         <- ingest all Goku frames → exports/batch/ + reference.json
│   ├── eval_goku.js            <- evaluate any frame: ASCII + z-score table + hints
│   ├── goku_report.js          <- full pipeline health report (pass rate, per-metric breakdown)
│   ├── style_transfer.js       <- remap frame to any palette by luminance band rank [exports transferStyle, BUILTIN_PALETTES]
│   ├── animate_goku.js         <- assemble frames → spritesheet PNG + JSON sidecar
│   ├── generate_poses.js       <- Phase 9: 5 real frames → pixel-perfect pose PNGs + sheet
│   ├── generate_animation.js   <- Phase 12: idle breathing loop + pose sequence animation
│   ├── quality_report.js       <- Phase 13: generated vs ingested quality scoring + grading
│   ├── verify_reconstruction.js <- Phase 27: 100% accuracy verification across all batch frames
│   ├── frame_anatomy.js        <- Phase 27: pixel anatomy map — zone distribution + stability
│   ├── compose_character.js    <- Phase 28: single-frame transforms (scale/flip/zone/palette)
│   ├── build_character.js      <- Phase 28: fuse head/torso/legs from different real frames
│   └── reconstruct.js          <- load grid+palette → render PNG
├── tests/unit/                 <- 1693 tests, all passing
├── exports/
│   ├── batch/                  <- 183 Goku frame grids/palettes (100% accuracy) + reference.json
│   ├── poses/                  <- 5 pixel-perfect pose PNGs + pose_sheet.png
│   ├── composed/               <- Phase 28: fused characters + transformed frames
│   ├── style_transfer/         <- real frames style-transferred to 5 palettes
│   ├── animations/             <- spritesheet PNGs from real batch frames
│   ├── anatomy.json            <- pixel anatomy map (zone distributions + stability)
│   ├── goku_frame_grid.json    <- single frame grid (frame 4)
│   ├── goku_frame_palette.json <- single frame palette
│   ├── goku_frame_orig.png     <- original ingested image
│   └── goku_frame_recon.png    <- 100% accurate reconstruction of frame 4
└── references/grids/           <- legacy (empty — use batch/ instead)
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
- `exports/batch/` is the canonical data source — 183 Goku frames at 100% accuracy

---

## Rules

- **Never use gradients for pixel art** — gradient shading produces blobs, not characters. All shading must come from real pixel data
- **Never run cleanup on ingested frames** — cleanup is for generated sprites only. On real frames it corrupts ~20% of pixels. Use `--cleanup` as opt-in only
- **Never embed palette in JSON when batch has it** — always reference `frame_idx`, load palette from `exports/batch/frame_XXXX_palette.json` at runtime
- **100% reconstruction is non-negotiable** — verify with `node tools/verify_reconstruction.js` after any pipeline change
- **Every pixel is data** — `data[row][col]` = palette index, palette[index] = RGB. An LLM can read this and understand the character structure
- **Never downsample** — render at native sprite resolution only
- **Never anti-alias** — no smoothing of any kind
- **Every stage emits data** — always have an ASCII dump or JSON metric for any output
- **Palette is always dynamic** — never hardcode color indices; use palette band helpers
- **Per-frame timing always** — never uniform sampling; always explicit per-keyframe duration

---

## Phase progress

| Phase | What | Status |
|-------|------|--------|
| 1 | Core data structures + ASCII perception loop + 9 cleanup passes + tests | ✅ Done |
| 2 | Three.js cel shader + depth pass + Roberts Cross outline | Scaffold only (deprioritized) |
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
| 20 | Sprite atlas packer: shelf-first bin-pack, UV map, renderAtlasRGBA, libraryCells bridge + 1199 tests | ✅ Done |
| 21 | Sprite diff engine: pixel-level diff, region density, ASCII heatmap, changeMask, diffSequence + 1287 tests | ✅ Done |
| 22 | Palette mutation engine: tint, brighten, darken, contrast, saturate, desaturate, invert, compose + 1366 tests | ✅ Done |
| 23 | Grid surgery: contentBounds, cropToContent, padGrid, padToSize, flipH/V, rotateGrid, scaleGrid, normalizeSize + 1460 tests | ✅ Done |
| 24 | Batch evaluation engine: batchEval, rankBatch, filterBatch, batchSummary, topN + 1514 tests | ✅ Done |
| 25 | Search strategy engine: randomRestart, hillClimb, beamSearch, multiStart + 1583 tests | ✅ Done |
| 26 | Counterfactual analysis: Jacobian sensitivity, rmsZ gradient, prescribe, gradientStep + 1635 tests | ✅ Done |
| 27 | Pipeline accuracy overhaul: delete gradient-based outputs, verify 183 frames at 100%, fix generate_poses to use real pixel data with no cleanup corruption, build verify_reconstruction + frame_anatomy tools + 1649 tests | ✅ Done |
| 28 | Part compositor: data-driven seam detection (neck/hip from row-width profile), splitParts/compositeParts/assembleCharacter — fuse head/torso/legs from different real frames with band-rank palette unification + 1693 tests | ✅ Done |
| 29 | Composed-character animation (animate_character.js: pin parts, animate body over real frame ranges, bottom-aligned sheets) + reconstruction integrity tests in CI (golden render byte-compare, batch sample integrity, pose pixel-fidelity) + 1732 tests | ✅ Done |
| 30 | Region-aware recoloring: classifyRegions (hue-family clustering, circular mean), recolorRegions (retarget fur/skin/hair independently, luminance preserved, GRID UNTOUCHED), regionPixelCounts + recolor_character.js CLI + 1776 tests | ✅ Done |
| 31 | Character pipeline composition: chain fuse + recolor + animate in one spec — a full new-character definition from real data | 🔄 Next |
