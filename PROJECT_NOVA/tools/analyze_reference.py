#!/usr/bin/env python3
"""
Reference sprite sheet analyzer.

Given a sprite sheet PNG with a solid background (typically green chromakey):
1. Removes background via chroma key
2. Auto-detects sprite bounding rows/columns using blank-space scanning
3. Extracts individual sprite frames
4. Computes palette metrics for each
5. Saves extracted frames as PNGs + a reference manifest JSON

Usage:
  python3 tools/analyze_reference.py <spritesheet.png> [--bg-color R,G,B] [--out-dir DIR] [--max-sprites N]
"""

import sys
import json
import math
import argparse
from pathlib import Path
from PIL import Image
from collections import Counter

# ── Palette definition (must match src/core/palette.js) ────────────────────
PALETTE = [
    {'index': 0, 'name': 'transparent', 'r': 0,   'g': 0,   'b': 0,   'a': 0,   'ascii': '.'},
    {'index': 1, 'name': 'outline',     'r': 28,  'g': 8,   'b': 20,  'a': 255, 'ascii': '#'},
    {'index': 2, 'name': 'shadow_deep', 'r': 56,  'g': 12,  'b': 32,  'a': 255, 'ascii': 'X'},
    {'index': 3, 'name': 'shadow',      'r': 104, 'g': 20,  'b': 36,  'a': 255, 'ascii': 'x'},
    {'index': 4, 'name': 'mid',         'r': 184, 'g': 40,  'b': 28,  'a': 255, 'ascii': 'o'},
    {'index': 5, 'name': 'bright',      'r': 232, 'g': 96,  'b': 36,  'a': 255, 'ascii': 'O'},
    {'index': 6, 'name': 'highlight',   'r': 255, 'g': 168, 'b': 64,  'a': 255, 'ascii': '*'},
    {'index': 7, 'name': 'peak',        'r': 255, 'g': 224, 'b': 136, 'a': 255, 'ascii': '@'},
]
BODY_INDICES = [2, 3, 4, 5, 6, 7]
ASCII_CHARS  = [p['ascii'] for p in PALETTE]


def color_dist(r1, g1, b1, r2, g2, b2):
    return (r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2


def quantize_pixel(r, g, b, a):
    if a < 128:
        return 0
    best_idx, best_d = 0, float('inf')
    for p in PALETTE:
        if p['a'] == 0:
            continue
        d = color_dist(r, g, b, p['r'], p['g'], p['b'])
        if d < best_d:
            best_d = d
            best_idx = p['index']
    return best_idx


def is_background(r, g, b, bg_r, bg_g, bg_b, tol=40):
    return color_dist(r, g, b, bg_r, bg_g, bg_b) < tol * tol


def chroma_key(img, bg_color, tol=40):
    """Remove background color → RGBA with transparent background."""
    img = img.convert('RGBA')
    w, h = img.size
    pixels = list(img.getdata())
    bg_r, bg_g, bg_b = bg_color
    out = []
    for r, g, b, a in pixels:
        if is_background(r, g, b, bg_r, bg_g, bg_b, tol):
            out.append((0, 0, 0, 0))
        else:
            out.append((r, g, b, a))
    img.putdata(out)
    return img


def find_row_bands(img, min_blank_rows=2):
    """Find non-blank horizontal row bands (sprite rows) by scanning empty rows."""
    w, h = img.size
    pixels = img.load()
    bands = []
    in_band = False
    start = 0
    blank_run = 0

    for y in range(h):
        row_has_content = any(pixels[x, y][3] > 10 for x in range(w))
        if row_has_content:
            if not in_band:
                in_band = True
                start = y
            blank_run = 0
        else:
            if in_band:
                blank_run += 1
                if blank_run >= min_blank_rows:
                    bands.append((start, y - blank_run + 1))
                    in_band = False
    if in_band:
        bands.append((start, h))
    return bands


def extract_sprites_from_row(img, row_top, row_bot, min_blank_cols=2, min_w=8, min_h=8):
    """Extract individual sprites from a horizontal row band."""
    crop = img.crop((0, row_top, img.width, row_bot))
    w, h = crop.size
    pixels = crop.load()
    sprites = []
    in_sprite = False
    start = 0
    blank_run = 0

    for x in range(w):
        col_has_content = any(pixels[x, y][3] > 10 for y in range(h))
        if col_has_content:
            if not in_sprite:
                in_sprite = True
                start = x
            blank_run = 0
        else:
            if in_sprite:
                blank_run += 1
                if blank_run >= min_blank_cols:
                    s_img = crop.crop((start, 0, x - blank_run + 1, h))
                    # Trim vertical whitespace
                    s_img = trim_sprite(s_img)
                    if s_img.width >= min_w and s_img.height >= min_h:
                        sprites.append(s_img)
                    in_sprite = False

    if in_sprite:
        s_img = crop.crop((start, 0, w, h))
        s_img = trim_sprite(s_img)
        if s_img.width >= min_w and s_img.height >= min_h:
            sprites.append(s_img)

    return sprites


def trim_sprite(img):
    """Trim transparent rows/cols from sprite edges."""
    w, h = img.size
    pixels = img.load()
    top = 0
    while top < h and not any(pixels[x, top][3] > 10 for x in range(w)):
        top += 1
    bot = h
    while bot > top and not any(pixels[x, bot-1][3] > 10 for x in range(w)):
        bot -= 1
    left = 0
    while left < w and not any(pixels[left, y][3] > 10 for y in range(h)):
        left += 1
    right = w
    while right > left and not any(pixels[right-1, y][3] > 10 for y in range(h)):
        right -= 1
    if left >= right or top >= bot:
        return img
    return img.crop((left, top, right, bot))


def sprite_to_grid(img):
    """Convert RGBA PIL image to palette-index grid (list of lists)."""
    w, h = img.size
    pixels = img.load()
    return [[quantize_pixel(*pixels[c, r]) for c in range(w)] for r in range(h)]


def grid_to_ascii(grid):
    return '\n'.join(''.join(ASCII_CHARS[v] for v in row) for row in grid)


def compute_metrics(grid):
    """Compute structural metrics for a palette-index grid."""
    w = len(grid[0]) if grid else 0
    h = len(grid)
    total = w * h
    counts = Counter()
    for row in grid:
        for v in row:
            counts[v] += 1

    body_count = sum(counts[i] for i in BODY_INDICES)
    outline_count = counts.get(1, 0)
    transp_count = counts.get(0, 0)

    def ratio(idx):
        return counts.get(idx, 0) / max(body_count, 1)

    # Symmetry: compare left/right halves (body pixels only)
    mid = w // 2
    matches = 0
    comparisons = 0
    for r in range(h):
        for c in range(mid):
            lv = grid[r][c]
            rv = grid[r][w - 1 - c]
            if lv in BODY_INDICES or rv in BODY_INDICES:
                comparisons += 1
                if lv == rv:
                    matches += 1
    symmetry = matches / max(comparisons, 1)

    # Outline thickness variance (check each outline pixel's outline neighbor count)
    outline_thicknesses = []
    for r in range(h):
        for c in range(w):
            if grid[r][c] == 1:  # outline
                n_count = 0
                for dr, dc in [(-1,0),(1,0),(0,-1),(0,1)]:
                    nr, nc = r+dr, c+dc
                    if 0 <= nr < h and 0 <= nc < w and grid[nr][nc] == 1:
                        n_count += 1
                outline_thicknesses.append(n_count)

    thickness_var = 0.0
    if outline_thicknesses:
        mean = sum(outline_thicknesses) / len(outline_thicknesses)
        thickness_var = math.sqrt(sum((t - mean)**2 for t in outline_thicknesses) / len(outline_thicknesses))

    return {
        'width': w,
        'height': h,
        'total_pixels': total,
        'body_count': body_count,
        'outline_count': outline_count,
        'transparent_count': transp_count,
        'shadow_deep_ratio': ratio(2),
        'shadow_ratio': ratio(3),
        'mid_ratio': ratio(4),
        'bright_ratio': ratio(5),
        'highlight_ratio': ratio(6),
        'peak_ratio': ratio(7),
        'symmetry_score': round(symmetry, 3),
        'outline_thickness_variance': round(thickness_var, 3),
        'unique_body_colors': len([i for i in BODY_INDICES if counts.get(i, 0) > 0]),
        'palette_indices_used': sorted(set(v for row in grid for v in row)),
    }


def detect_bg_color(img, sample_size=100):
    """Detect background color by sampling corners."""
    w, h = img.size
    pixels = img.convert('RGB').load()
    samples = [
        pixels[0, 0], pixels[w-1, 0], pixels[0, h-1], pixels[w-1, h-1],
        pixels[w//2, 0], pixels[0, h//2],
    ]
    r = sum(s[0] for s in samples) // len(samples)
    g = sum(s[1] for s in samples) // len(samples)
    b = sum(s[2] for s in samples) // len(samples)
    print(f"  Auto-detected background color: rgb({r}, {g}, {b})")
    return (r, g, b)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('input', help='Sprite sheet PNG')
    parser.add_argument('--bg-color', help='Background color R,G,B (default: auto-detect)')
    parser.add_argument('--tol', type=int, default=60, help='Chroma key tolerance (default 60)')
    parser.add_argument('--out-dir', default=None, help='Output directory (default: references/)')
    parser.add_argument('--max-sprites', type=int, default=50, help='Max sprites to extract')
    parser.add_argument('--scale', type=int, default=4, help='PNG export scale factor')
    parser.add_argument('--no-ascii', action='store_true', help='Skip ASCII dump output')
    args = parser.parse_args()

    inpath = Path(args.input)
    script_dir = Path(__file__).parent
    out_dir = Path(args.out_dir) if args.out_dir else script_dir.parent / 'references'
    img_dir = out_dir / 'images'
    grid_dir = out_dir / 'grids'
    img_dir.mkdir(parents=True, exist_ok=True)
    grid_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading: {inpath}")
    img = Image.open(inpath).convert('RGBA')
    print(f"  Sheet size: {img.width}x{img.height}")

    # Detect or parse background color
    if args.bg_color:
        bg = tuple(int(x) for x in args.bg_color.split(','))
    else:
        bg = detect_bg_color(img)

    print(f"  Removing background (tol={args.tol})...")
    img_keyed = chroma_key(img, bg, tol=args.tol)

    print("  Finding row bands...")
    bands = find_row_bands(img_keyed)
    print(f"  Found {len(bands)} row band(s)")

    sprites = []
    for band_i, (top, bot) in enumerate(bands):
        row_sprites = extract_sprites_from_row(img_keyed, top, bot)
        print(f"  Row {band_i}: y={top}-{bot} → {len(row_sprites)} sprite(s)")
        sprites.extend(row_sprites)
        if len(sprites) >= args.max_sprites:
            sprites = sprites[:args.max_sprites]
            break

    print(f"\nExtracted {len(sprites)} sprites total")

    manifest = {'source': str(inpath.name), 'sprites': []}

    for i, sprite in enumerate(sprites):
        sid = f"ref_{i:03d}"
        grid = sprite_to_grid(sprite)
        metrics = compute_metrics(grid)
        ascii_art = grid_to_ascii(grid)

        # Save PNG
        out_img = sprite.resize(
            (sprite.width * args.scale, sprite.height * args.scale),
            Image.NEAREST
        )
        out_img.save(img_dir / f"{sid}.png")

        # Save grid JSON
        grid_data = {
            'id': sid,
            'source': inpath.name,
            'quality': 'excellent',
            'tags': ['reference', 'pixel_art'],
            'width': metrics['width'],
            'height': metrics['height'],
            'data': grid,
            'metrics': metrics,
        }
        (grid_dir / f"{sid}.json").write_text(json.dumps(grid_data, indent=2))

        if not args.no_ascii and i < 10:
            print(f"\n  [{sid}] {metrics['width']}x{metrics['height']}")
            print(ascii_art)
            print(f"  Metrics: mid={metrics['mid_ratio']:.2f} shadow={metrics['shadow_ratio']:.2f} "
                  f"peak={metrics['peak_ratio']:.2f} sym={metrics['symmetry_score']:.2f}")

        manifest['sprites'].append({'id': sid, 'metrics': metrics})

    # Save manifest
    manifest_path = out_dir / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"\nManifest saved: {manifest_path}")
    print(f"PNG sprites saved: {img_dir}/")
    print(f"Grid JSONs saved: {grid_dir}/")
    print(f"\nTotal: {len(sprites)} reference sprites ingested.")


if __name__ == '__main__':
    main()
