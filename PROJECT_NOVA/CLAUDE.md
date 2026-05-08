# PROJECT: NOVA

> Status: Active — Phase 7 complete
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

# Run all tests (385 tests)
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
│   │   └── compare.js          <- compareToReference(), adjustmentHints() (palette-agnostic)
│   ├── animation/
│   │   ├── keyframe.js         <- makeKeyframe, totalDuration, sequenceToJSON
│   │   ├── timing.js           <- idleTiming, walkTiming, distributeDurations
│   │   └── spritesheet.js      <- keyframesToPNG, buildSidecar
│   └── authoring/
│       └── parametric.js       <- buildFromParams, adjustParams, badStartParams
├── tools/
│   ├── ingest_sprite.py        <- ingest single frame: K-means palette + grid (100% accuracy)
│   ├── batch_ingest.py         <- ingest all 165 Goku frames → exports/batch/ + reference.json
│   ├── eval_goku.js            <- evaluate any frame: ASCII + z-score table + hints
│   ├── goku_report.js          <- full pipeline health report (pass rate, per-metric breakdown)
│   ├── style_transfer.js       <- remap frame to any palette by luminance band rank
│   ├── animate_goku.js         <- assemble frames → spritesheet PNG + JSON sidecar
│   ├── reconstruct.js          <- load grid+palette → render PNG (legacy)
│   └── auto_iterate.js         <- parametric generation convergence loop
├── tests/unit/                 <- 385 tests, all passing
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
| 8 | Goku-calibrated generative authoring — next | 🔜 |
