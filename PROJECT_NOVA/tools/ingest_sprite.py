#!/usr/bin/env python3
"""
ingest_sprite.py — Extract a single sprite frame from the Goku sheet and
represent it as a palette-index grid using the sprite's OWN quantised palette.

Pipeline:
  1. Load source PNG
  2. Locate sprite frame (by bounding box or auto-detect)
  3. Chroma-key background → transparent (index 0)
  4. K-means quantise non-BG pixels into N-1 color clusters
  5. Order clusters by luminance (darkest = low index)
  6. Map every pixel → palette index
  7. Save grid.json + palette.json + preview PNG (palette applied at 1x)
  8. Report pixel-level reconstruction accuracy

Usage:
  python3 tools/ingest_sprite.py --frame 4     # auto-detect, sprite index 4
  python3 tools/ingest_sprite.py --box 166 3 211 71  # explicit bounding box (x0 y0 x1 y1)
  python3 tools/ingest_sprite.py --colors 8    # number of palette slots (default 8)
"""

import argparse
import json
import math
import os
import random
import sys
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.join(SCRIPT_DIR, '..')
EXPORTS_DIR = os.path.join(PROJECT_DIR, 'exports')
SOURCE_IMG  = os.path.join(PROJECT_DIR, '..', 'Grok Image 2026-05-08 at 2.41.06 PM.png')

BG_COLOR = (38, 127, 0)
BG_TOLERANCE = 30   # pixels within this L2 distance of BG are treated as transparent

os.makedirs(EXPORTS_DIR, exist_ok=True)

# ── Color utilities ───────────────────────────────────────────────────────────

def color_dist(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))

def is_bg(px):
    return color_dist(px[:3], BG_COLOR) < BG_TOLERANCE

def luminance(rgb):
    r, g, b = [x / 255.0 for x in rgb[:3]]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

# ── K-means clustering ────────────────────────────────────────────────────────

def kmeans(pixels, k, max_iter=50, seed=42):
    """K-means on a list of (r,g,b) tuples. Returns k center colors."""
    random.seed(seed)
    # K-means++ initialisation
    centers = [random.choice(pixels)]
    for _ in range(k - 1):
        dists = [min(color_dist(p, c) ** 2 for c in centers) for p in pixels]
        total = sum(dists)
        r = random.uniform(0, total)
        cumulative = 0.0
        for p, d in zip(pixels, dists):
            cumulative += d
            if cumulative >= r:
                centers.append(p)
                break
        else:
            centers.append(random.choice(pixels))

    for _ in range(max_iter):
        # Assign
        clusters = [[] for _ in range(k)]
        for p in pixels:
            idx = min(range(k), key=lambda i: color_dist(p, centers[i]))
            clusters[idx].append(p)
        # Update
        new_centers = []
        for i, cluster in enumerate(clusters):
            if not cluster:
                new_centers.append(centers[i])
            else:
                mean = tuple(int(sum(c[j] for c in cluster) / len(cluster)) for j in range(3))
                new_centers.append(mean)
        if new_centers == centers:
            break
        centers = new_centers

    return centers

# ── Sprite detection ──────────────────────────────────────────────────────────

def find_sprites_in_sheet(img):
    """Return list of (x0, y0, x1, y1) bounding boxes for each sprite."""
    W, H = img.size
    pixels = img.load()

    # Find column groups
    col_has = [any(not is_bg(pixels[x, y]) for y in range(H)) for x in range(W)]
    col_groups = []
    in_g = False
    for x, has in enumerate(col_has):
        if has and not in_g:
            g_start = x; in_g = True
        elif not has and in_g:
            col_groups.append((g_start, x - 1))
            in_g = False
    if in_g:
        col_groups.append((g_start, W - 1))

    # For the largest column groups, find row groups
    sprites = []
    for c0, c1 in col_groups:
        if c1 - c0 < 10:   # skip narrow artefacts
            continue
        row_has = [any(not is_bg(pixels[x, y]) for x in range(c0, c1 + 1)) for y in range(H)]
        in_g = False
        for y, has in enumerate(row_has):
            if has and not in_g:
                r_start = y; in_g = True
            elif not has and in_g:
                # Found a row-group — split into individual sprites by column within this row band
                subs = find_col_groups_in_row(pixels, W, c0, c1, r_start, y - 1)
                for sc0, sc1 in subs:
                    sprites.append((sc0, r_start, sc1, y - 1))
                in_g = False
        if in_g:
            subs = find_col_groups_in_row(pixels, W, c0, c1, r_start, H - 1)
            for sc0, sc1 in subs:
                sprites.append((sc0, r_start, sc1, H - 1))
    return sprites

def find_col_groups_in_row(pixels, W, x0, x1, y0, y1):
    col_has = [any(not is_bg(pixels[x, y]) for y in range(y0, y1 + 1)) for x in range(x0, x1 + 1)]
    groups = []
    in_g = False
    for i, has in enumerate(col_has):
        x = x0 + i
        if has and not in_g:
            g_start = x; in_g = True
        elif not has and in_g:
            groups.append((g_start, x - 1))
            in_g = False
    if in_g:
        groups.append((g_start, x1))
    return groups

# ── Grid + palette ────────────────────────────────────────────────────────────

def build_grid_and_palette(img, x0, y0, x1, y1, n_colors):
    """
    Extract sprite at (x0,y0)-(x1,y1), quantise to n_colors, return:
      grid       — 2D list of palette indices
      palette    — list of (r,g,b) colors, index 0 = transparent
    """
    W, H = x1 - x0 + 1, y1 - y0 + 1
    pixels = img.load()

    # Collect all non-BG pixels for clustering
    body_pixels = []
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px = pixels[x, y]
            if not is_bg(px):
                body_pixels.append(px[:3])

    if not body_pixels:
        raise ValueError('No body pixels found in specified region')

    print(f'Sprite size: {W}×{H}  body pixels: {len(body_pixels)}  unique: {len(set(body_pixels))}')

    # K-means with n_colors-1 clusters (slot 0 is transparent)
    k = min(n_colors - 1, len(set(body_pixels)))
    print(f'K-means: k={k}  iterations=50')
    centers = kmeans(body_pixels, k)

    # Sort centers by luminance (darkest first = lowest index)
    centers.sort(key=luminance)

    # Palette: index 0 = transparent (no color), indices 1..k = body colors
    palette = [(0, 0, 0)] + centers  # slot 0 color is irrelevant (transparent)

    # Map each pixel to nearest palette index
    grid = []
    for y in range(y0, y1 + 1):
        row = []
        for x in range(x0, x1 + 1):
            px = pixels[x, y]
            if is_bg(px):
                row.append(0)
            else:
                nearest = min(range(1, len(palette)), key=lambda i: color_dist(px[:3], palette[i]))
                row.append(nearest)
        grid.append(row)

    return grid, palette

# ── Reconstruction accuracy ───────────────────────────────────────────────────

def compute_accuracy(img, x0, y0, x1, y1, grid, palette):
    """Pixel-level accuracy: what fraction of non-BG pixels are reconstructed exactly."""
    pixels = img.load()
    total_body = 0
    exact_match = 0
    total_error = 0.0

    for gy, y in enumerate(range(y0, y1 + 1)):
        for gx, x in enumerate(range(x0, x1 + 1)):
            px = pixels[x, y][:3]
            idx = grid[gy][gx]
            if idx == 0:
                continue   # transparent
            total_body += 1
            recon = palette[idx]
            err = color_dist(px, recon)
            total_error += err
            if err < 0.5:
                exact_match += 1

    mean_err = total_error / max(total_body, 1)
    return {
        'body_pixels': total_body,
        'exact_matches': exact_match,
        'exact_pct': round(exact_match / max(total_body, 1) * 100, 2),
        'mean_color_error': round(mean_err, 2),
    }

# ── Render to PNG ─────────────────────────────────────────────────────────────

def render_to_png(grid, palette, scale=1):
    H = len(grid)
    W = len(grid[0]) if H else 0
    out = Image.new('RGBA', (W * scale, H * scale), (0, 0, 0, 0))
    pix = out.load()
    for y, row in enumerate(grid):
        for x, idx in enumerate(row):
            if idx == 0:
                color = (0, 0, 0, 0)  # transparent
            else:
                r, g, b = palette[idx]
                color = (r, g, b, 255)
            for sy in range(scale):
                for sx in range(scale):
                    pix[x * scale + sx, y * scale + sy] = color
    return out

# ── ASCII dump ────────────────────────────────────────────────────────────────

ASCII_CHARS = '.#XxoO*@abcdefghijklmnopqrstuvwxyz'

def ascii_dump(grid, label=''):
    H = len(grid)
    W = len(grid[0]) if H else 0
    lines = [f'[{label}] {W}×{H}'] if label else [f'{W}×{H}']
    for row in grid:
        lines.append(''.join(ASCII_CHARS[min(v, len(ASCII_CHARS)-1)] for v in row))
    return '\n'.join(lines)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frame',  type=int, default=4,  help='Auto-detected sprite index (0-based)')
    ap.add_argument('--box',    type=int, nargs=4,    help='Explicit bounding box: x0 y0 x1 y1')
    ap.add_argument('--colors', type=int, default=8,  help='Palette size including transparent (default 8)')
    ap.add_argument('--scale',  type=int, default=8,  help='PNG export scale factor (default 8)')
    ap.add_argument('--out',    type=str, default='goku_frame', help='Output basename')
    args = ap.parse_args()

    img = Image.open(SOURCE_IMG)
    print(f'Source: {SOURCE_IMG}  ({img.size[0]}×{img.size[1]})')

    if args.box:
        x0, y0, x1, y1 = args.box
        print(f'Using explicit box: ({x0},{y0})–({x1},{y1})')
    else:
        print('Auto-detecting sprites...')
        sprites = find_sprites_in_sheet(img)
        print(f'Found {len(sprites)} sprites')
        for i, (sx0, sy0, sx1, sy1) in enumerate(sprites[:20]):
            print(f'  {i:2d}: ({sx0},{sy0})–({sx1},{sy1})  {sx1-sx0+1}×{sy1-sy0+1}')
        if args.frame >= len(sprites):
            print(f'Frame {args.frame} out of range, using 0')
            args.frame = 0
        x0, y0, x1, y1 = sprites[args.frame]
        print(f'\nSelected frame {args.frame}: ({x0},{y0})–({x1},{y1})  {x1-x0+1}×{y1-y0+1}')

    # Build grid + palette
    grid, palette = build_grid_and_palette(img, x0, y0, x1, y1, args.colors)

    # ASCII dump
    print('\n' + ascii_dump(grid, args.out))

    # Accuracy
    acc = compute_accuracy(img, x0, y0, x1, y1, grid, palette)
    print(f'\nAccuracy:')
    print(f'  body pixels:   {acc["body_pixels"]}')
    print(f'  exact matches: {acc["exact_matches"]}  ({acc["exact_pct"]}%)')
    print(f'  mean color Δ:  {acc["mean_color_error"]} (RGB distance, 0=perfect)')

    # Palette printout
    print(f'\nExtracted palette ({len(palette)} slots):')
    for i, (r, g, b) in enumerate(palette):
        lum = luminance((r, g, b))
        label = 'transparent' if i == 0 else f'lum={lum:.3f}'
        print(f'  [{i}] rgb({r:3d},{g:3d},{b:3d})  {label}')

    # Exports
    grid_path    = os.path.join(EXPORTS_DIR, f'{args.out}_grid.json')
    palette_path = os.path.join(EXPORTS_DIR, f'{args.out}_palette.json')
    recon_path   = os.path.join(EXPORTS_DIR, f'{args.out}_recon.png')
    orig_path    = os.path.join(EXPORTS_DIR, f'{args.out}_orig.png')

    # Save grid + palette
    with open(grid_path, 'w') as f:
        json.dump({
            'source_box': [x0, y0, x1, y1],
            'width': x1 - x0 + 1,
            'height': y1 - y0 + 1,
            'n_colors': args.colors,
            'accuracy': acc,
            'data': grid,
        }, f, indent=2)
    print(f'\nGrid:    {grid_path}')

    with open(palette_path, 'w') as f:
        json.dump([{'index': i, 'rgb': list(c)} for i, c in enumerate(palette)], f, indent=2)
    print(f'Palette: {palette_path}')

    # Reconstructed PNG
    recon_img = render_to_png(grid, palette, scale=args.scale)
    recon_img.save(recon_path)
    print(f'Recon:   {recon_path}  ({(x1-x0+1)*args.scale}×{(y1-y0+1)*args.scale}px, {args.scale}x scale)')

    # Original sprite crop (same scale)
    orig_crop = img.crop((x0, y0, x1 + 1, y1 + 1))
    ow, oh = orig_crop.size
    orig_scaled = orig_crop.resize((ow * args.scale, oh * args.scale), Image.NEAREST)
    orig_scaled.save(orig_path)
    print(f'Orig:    {orig_path}  ({ow*args.scale}×{oh*args.scale}px)')

    print(f'\nDone. Compare {args.out}_recon.png vs {args.out}_orig.png')

if __name__ == '__main__':
    main()
