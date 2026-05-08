#!/usr/bin/env python3
"""
batch_ingest.py — Ingest all sprite frames from the reference sheet.

For each detected sprite:
  - Extract palette via k-means (using the sprite's own colors)
  - Build palette-index grid
  - Verify reconstruction accuracy
  - Save grid JSON + palette JSON

Also builds a reference distribution JSON from all ingested frames.

Usage:
  python3 tools/batch_ingest.py
  python3 tools/batch_ingest.py --min-body 100    # skip tiny sprites
  python3 tools/batch_ingest.py --max-frames 50   # cap for speed
  python3 tools/batch_ingest.py --colors 24       # palette size
"""

import argparse
import json
import os
import sys

# Reuse the ingest_sprite module
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest_sprite import (
    Image, find_sprites_in_sheet, build_grid_and_palette,
    compute_accuracy, ascii_dump, luminance, SOURCE_IMG, EXPORTS_DIR
)

BATCH_DIR = os.path.join(EXPORTS_DIR, 'batch')
os.makedirs(BATCH_DIR, exist_ok=True)

# ── Band ratios ────────────────────────────────────────────────────────────────

def compute_band_ratios(grid, palette, n_bands=6):
    """
    Divide palette slots 2..N-1 into n_bands equal luminance groups.
    Return ratio of body pixels in each band.
    """
    # Body slots sorted by index (= luminance order from ingest)
    body_slots = [i for i in range(2, len(palette))]
    if not body_slots:
        return {}

    # Assign each body slot to a band
    n = len(body_slots)
    slot_to_band = {}
    for i, slot in enumerate(body_slots):
        band = min(int(i / n * n_bands), n_bands - 1)
        slot_to_band[slot] = band

    # Count pixels per band
    band_counts = [0] * n_bands
    total_body = 0
    for row in grid:
        for v in row:
            if v >= 2:
                b = slot_to_band.get(v, -1)
                if b >= 0:
                    band_counts[b] += 1
                    total_body += 1

    names = ['shadow_deep', 'shadow', 'mid', 'bright', 'highlight', 'peak']
    ratios = {}
    for i in range(n_bands):
        key = names[i] if i < len(names) else f'band_{i}'
        ratios[f'{key}_ratio'] = round(band_counts[i] / max(total_body, 1), 4)

    return ratios, total_body

def compute_outline_ratio(grid, body_count):
    outline = sum(1 for row in grid for v in row if v == 1)
    return round(outline / max(body_count + outline, 1), 4)

def compute_body_density(grid):
    W = len(grid[0]) if grid else 0
    H = len(grid)
    non_transparent = sum(1 for row in grid for v in row if v != 0)
    return round(non_transparent / max(W * H, 1), 4)

def compute_symmetry(grid):
    W = len(grid[0]) if grid else 0
    H = len(grid)
    matches = total = 0
    for row in grid:
        for c in range(W // 2):
            l, r = row[c], row[W - 1 - c]
            if l == 0 and r == 0:
                continue
            total += 1
            if l == r:
                matches += 1
    return round(matches / max(total, 1), 4)

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--min-body',   type=int, default=100, help='Skip sprites with fewer body pixels')
    ap.add_argument('--max-frames', type=int, default=200, help='Max sprites to process')
    ap.add_argument('--colors',     type=int, default=0,   help='Palette size (0=auto: sprite unique+1)')
    ap.add_argument('--max-unique', type=int, default=40,  help='Skip sprites with more unique colors (not clean frames)')
    ap.add_argument('--max-height', type=int, default=150, help='Skip sprites taller than this (composite regions)')
    ap.add_argument('--verbose',    action='store_true')
    args = ap.parse_args()

    img = Image.open(SOURCE_IMG)
    W, H = img.size
    print(f'Source: {W}×{H}  detecting sprites...')

    sprites = find_sprites_in_sheet(img)
    print(f'Found {len(sprites)} sprites  (processing up to {args.max_frames})')

    manifest = []
    skipped = 0
    processed = 0
    total_acc = 0.0

    for i, (x0, y0, x1, y1) in enumerate(sprites):
        if processed >= args.max_frames:
            break

        w, h = x1 - x0 + 1, y1 - y0 + 1
        n_colors = args.colors if args.colors > 0 else None  # auto

        try:
            # First pass: count unique colors
            pixels = img.load()
            unique = set()
            body = 0
            for y in range(y0, y1+1):
                for x in range(x0, x1+1):
                    from ingest_sprite import is_bg
                    px = pixels[x, y]
                    if not is_bg(px):
                        unique.add(px[:3])
                        body += 1

            if body < args.min_body:
                skipped += 1
                continue

            if h > args.max_height:
                skipped += 1
                continue

            if len(unique) > args.max_unique:
                skipped += 1
                continue

            if n_colors is None:
                n_colors = len(unique) + 1  # +1 for transparent slot

            grid, palette = build_grid_and_palette(img, x0, y0, x1, y1, n_colors)
            acc = compute_accuracy(img, x0, y0, x1, y1, grid, palette)

            # Structural metrics
            band_result = compute_band_ratios(grid, palette)
            if isinstance(band_result, tuple):
                band_ratios, body_count = band_result
            else:
                band_ratios, body_count = {}, 0

            outline_ratio = compute_outline_ratio(grid, body_count)
            body_density  = compute_body_density(grid)
            symmetry      = compute_symmetry(grid)

            entry = {
                'id':          f'frame_{i:04d}',
                'source_box':  [x0, y0, x1, y1],
                'width':       w,
                'height':      h,
                'n_colors':    n_colors,
                'accuracy':    acc,
                'metrics': {
                    'width':         w,
                    'height':        h,
                    'body_count':    body_count,
                    'outline_ratio': outline_ratio,
                    'body_density':  body_density,
                    'symmetry_score': symmetry,
                    **band_ratios,
                },
            }

            # Save grid + palette
            grid_path    = os.path.join(BATCH_DIR, f'frame_{i:04d}_grid.json')
            palette_path = os.path.join(BATCH_DIR, f'frame_{i:04d}_palette.json')

            with open(grid_path, 'w') as f:
                json.dump({'source_box': [x0,y0,x1,y1], 'width': w, 'height': h,
                           'n_colors': n_colors, 'accuracy': acc, 'data': grid}, f)

            with open(palette_path, 'w') as f:
                json.dump([{'index': j, 'rgb': list(c)} for j, c in enumerate(palette)], f)

            manifest.append(entry)
            total_acc += acc['exact_pct']
            processed += 1

            if args.verbose or processed % 20 == 0:
                print(f'  [{processed:3d}] frame_{i:04d}: {w}×{h}  '
                      f'acc={acc["exact_pct"]}%  '
                      f'body={body_count}  '
                      f'mid={band_ratios.get("mid_ratio","?"):.3f}')

        except Exception as e:
            if args.verbose:
                print(f'  SKIP frame {i}: {e}')
            skipped += 1

    mean_acc = total_acc / max(processed, 1)
    print(f'\nProcessed: {processed}  skipped: {skipped}  mean accuracy: {mean_acc:.1f}%')

    # ── Reference distribution ─────────────────────────────────────────────────

    # Compute mean + stddev for each numeric metric across all frames
    all_metrics = [e['metrics'] for e in manifest]
    keys = set(k for m in all_metrics for k in m if isinstance(m[k], (int, float)))
    dist = {}
    for k in sorted(keys):
        vals = [m[k] for m in all_metrics if k in m and isinstance(m[k], (int,float))]
        if not vals:
            continue
        mean   = sum(vals) / len(vals)
        var    = sum((v - mean) ** 2 for v in vals) / max(len(vals) - 1, 1)
        stddev = var ** 0.5
        dist[k] = {
            'mean':   round(mean, 4),
            'stddev': round(stddev, 4),
            'n':      len(vals),
            'min':    round(min(vals), 4),
            'max':    round(max(vals), 4),
        }

    ref = {
        'source':        SOURCE_IMG,
        'frame_count':   processed,
        'mean_accuracy': round(mean_acc, 2),
        'distribution':  dist,
        'frames':        manifest,
    }

    ref_path = os.path.join(BATCH_DIR, 'reference.json')
    with open(ref_path, 'w') as f:
        json.dump(ref, f, indent=2)
    print(f'Reference: {ref_path}')

    # Print distribution summary
    print('\nReference distribution:')
    band_keys = ['shadow_deep_ratio','shadow_ratio','mid_ratio','bright_ratio','highlight_ratio','peak_ratio']
    for k in band_keys:
        if k in dist:
            d = dist[k]
            print(f'  {k:<22} mean={d["mean"]:.3f}  σ={d["stddev"]:.3f}  n={d["n"]}')

if __name__ == '__main__':
    main()
