"""Generate the small pixel-art UI textures used by the market board.

Original procedural textures (wood planks, dark stone, hanging vines) drawn
pixel by pixel with a fixed seed, so re-running produces identical files.
CSS scales them up with `image-rendering: pixelated`.

    python scripts/generate-ui-textures.py
"""

import random
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "public" / "art" / "ui"
OUT.mkdir(parents=True, exist_ok=True)


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def shade(c, d):
    return tuple(max(0, min(255, v + d)) for v in c)


def planks(name, base, seam, light, w=64, h=32, rows=4, seed=1):
    rnd = random.Random(seed)
    base, seam, light = hex_rgb(base), hex_rgb(seam), hex_rgb(light)
    im = Image.new("RGB", (w, h))
    px = im.load()
    ph = h // rows
    for r in range(rows):
        joint = rnd.randrange(8, w - 8)
        tone = rnd.randint(-8, 8)
        grain = [rnd.random() < 0.18 for _ in range(ph)]
        for y in range(ph):
            yy = r * ph + y
            for x in range(w):
                c = shade(base, tone + rnd.randint(-5, 5))
                if grain[y] and rnd.random() < 0.8:
                    c = shade(c, -10)
                if rnd.random() < 0.03:
                    c = shade(c, -16)
                if y == 0:
                    c = light
                if y == ph - 1:
                    c = seam
                if x == joint and 0 < y < ph - 1:
                    c = seam
                px[x, yy] = c
    im.save(OUT / f"{name}.png", optimize=True)


def stone(name="stone-dark", w=32, h=32, seed=7):
    rnd = random.Random(seed)
    mortar = hex_rgb("#15161d")
    im = Image.new("RGB", (w, h))
    px = im.load()
    bh, bw = 8, 16
    for y in range(h):
        row = y // bh
        off = (bw // 2) * (row % 2)
        for x in range(w):
            bx = (x + off) % bw
            by = y % bh
            brick_id = (row, (x + off) // bw)
            r2 = random.Random(hash(brick_id) + seed)
            tone = r2.randint(-7, 7)
            c = shade(hex_rgb("#2c2e3b"), tone + rnd.randint(-4, 4))
            if by == 0 or bx == 0:
                c = mortar
            elif by == 1 or bx == 1:
                c = shade(c, 9)
            elif by == bh - 1 or bx == bw - 1:
                c = shade(c, -9)
            if rnd.random() < 0.04:
                c = shade(c, -12)
            px[x, y] = c
    im.save(OUT / f"{name}.png", optimize=True)


LEAF = [hex_rgb(c) for c in ("#24561a", "#2f6d21", "#3d8a2a", "#52a638", "#74c24a")]


def leaf_cluster(px, cx, cy, size, rnd, w, h):
    for dy in range(-size, size + 1):
        for dx in range(-size, size + 1):
            if abs(dx) + abs(dy) > size + rnd.randint(-1, 0):
                continue
            x, y = cx + dx, cy + dy
            if 0 <= x < w and 0 <= y < h:
                light = (-dx - dy) / (2 * size + 1)
                i = max(0, min(4, int(2 + light * 3 + rnd.uniform(-0.8, 0.8))))
                px[x, y] = LEAF[i] + (255,)


def vine(name="vine", w=32, h=128, seed=3):
    rnd = random.Random(seed)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = im.load()
    x = w // 2
    stem = hex_rgb("#2a4a16") + (255,)
    for y in range(h):
        if y % 6 == 0:
            x = max(4, min(w - 5, x + rnd.choice((-1, 0, 1))))
        px[x, y] = stem
    y = 2
    while y < h - 2:
        side = rnd.choice((-1, 1))
        leaf_cluster(px, x + side * rnd.randint(2, 7), y, rnd.randint(3, 5), rnd, w, h)
        if rnd.random() < 0.6:
            leaf_cluster(px, x - side * rnd.randint(2, 5), y + 3, rnd.randint(2, 3), rnd, w, h)
        y += rnd.randint(5, 9)
    im.save(OUT / f"{name}.png", optimize=True)


planks("wood-dark", "#5d3b1f", "#2f1c0c", "#7a5130", seed=2)
planks("wood-mid", "#8a5a2e", "#4a2e15", "#a8743f", seed=5)
planks("wood-light", "#b07a41", "#6b4523", "#c99357", seed=9)
stone()
vine()
print("wrote", sorted(p.name for p in OUT.iterdir()))
