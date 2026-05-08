# PROJECT: NOVA

> Status: Active
> Purpose: AI-assisted pipeline that produces high-quality pixel art sprites from 3D models, with data-driven aesthetic evaluation and per-pixel editing.

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

# Run all tests
npm test

# ASCII dump a grid file
node tools/ascii_dump.js <grid.json>

# Run cleanup pipeline on a grid
node tools/cleanup_run.js <grid.json>

# Ingest a reference PNG
node tools/reference_ingest.js <image.png> --quality excellent --tags slime,creature

# Open live renderer in browser
open src/rendering/preview.html
```

---

## Architecture

```
PROJECT_NOVA/
├── src/
│   ├── core/
│   │   ├── palette.js        <- palette definitions, quantization
│   │   ├── grid.js           <- 2D grid data structure + ops
│   │   └── ascii.js          <- ASCII rendering (the perception loop)
│   ├── cleanup/
│   │   ├── pass1_orphan.js
│   │   ├── pass2_outline_thin.js
│   │   ├── pass3_outline_repair.js
│   │   ├── pass4_highlight_cluster.js
│   │   ├── pass5_single_pixel.js
│   │   ├── pass6_band_skip.js
│   │   ├── pass7_highlight_area.js
│   │   ├── pass8_mid_diagnostic.js
│   │   ├── pass9_contact_shadow.js
│   │   └── index.js          <- runs all passes in order
│   ├── rendering/
│   │   ├── shaders/          <- GLSL (toon, depth, outline)
│   │   ├── camera.js         <- texel-matching orthographic
│   │   ├── lighting.js       <- 5-component lighting
│   │   └── preview.html      <- browser harness (Three.js)
│   ├── eval/
│   │   ├── metrics.js        <- structural measurements
│   │   ├── reference_lib.js  <- load + query reference set
│   │   └── compare.js        <- z-score comparison
│   ├── animation/
│   │   ├── keyframe.js       <- keyframe data structure
│   │   ├── timing.js         <- per-frame duration logic
│   │   └── spritesheet.js    <- export PNG + JSON sidecar
│   └── authoring/
│       └── procedural/
│           └── slime.js      <- procedural slime (amorphous, works well)
├── tests/
│   ├── unit/                 <- per-function tests
│   └── golden/               <- ASCII golden outputs to diff against
├── tools/
│   ├── ascii_dump.js
│   ├── cleanup_run.js
│   └── reference_ingest.js
├── references/
│   ├── images/               <- raw reference PNGs
│   ├── grids/                <- processed grid JSONs
│   └── manifest.json         <- quality labels, tags
└── exports/                  <- output PNG sprite sheets (committed)
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

## Conventions

- Grid coords: `grid[row][col]`, row 0 = top
- Palette indices are integers 0-7 (8-color default palette)
- Transparency = index 0, outline = index 1, body = indices 2-7
- All cleanup passes take `Grid` -> return new `Grid` (immutable, no in-place mutation)
- Golden tests: save ASCII output as `.txt` in `tests/golden/`, diff on test run
- Exports committed to `exports/` so results are viewable from GitHub

---

## Rules

- **Never downsample from high resolution** — render at native sprite resolution only
- **Never anti-alias** — no MSAA, FXAA, TAA, or any smoothing
- **Every stage emits data** — always have an ASCII dump or JSON metric for any output
- **Cleanup passes are immutable** — each pass returns a new grid, original unchanged
- **Mechanical vs aesthetic** — cleanup passes fix deterministic errors; reference comparison handles aesthetics
- **Procedural for amorphous** — slimes, blobs, wisps work; humanoids fail
- **Per-frame timing always** — never uniform sampling; always explicit per-keyframe duration

---

## Phase Plan

| Phase | What |
|-------|------|
| 1 | Core data structures + ASCII perception loop + cleanup passes + tests |
| 2 | Three.js cel shader + depth pass + Roberts Cross outline |
| 3 | Animation keyframes + sprite sheet export + PNG commits |
| 4 | Reference library ingestion + structural metrics + comparison |
| 5 | FID + discriminator (optional) + evaluation CLI |
| 6 | Auto-iteration loop + live editor |

**Start with Phase 1** — pure data, no rendering runtime, fully testable.
