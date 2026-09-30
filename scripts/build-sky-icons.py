"""Build web-sized copies of the Sky Island Market icon pack.

The pack in public/assets/sky-island-v1 ships 1100-1400 px PNGs (about
11 MB in total). The app only shows them at 16-260 px, so this writes
smaller copies next to them in public/assets/sky-island-v1/web/:

    ui-*.png   -> <name>-64.png, <name>-128.png
    item-*.png -> <name>-256.png, <name>-512.png

Each copy keeps the original canvas, transparent padding and aspect ratio
(the longest side is scaled to the target size). Resizing happens on
premultiplied alpha so edges do not pick up dark fringes. The originals are
never modified. Re-run after replacing any pack image:

    python scripts/build-sky-icons.py
"""

from pathlib import Path

from PIL import Image

PACK = Path(__file__).resolve().parent.parent / "public" / "assets" / "sky-island-v1"
OUT = PACK / "web"
SIZES = {"ui-": (64, 128), "item-": (256, 512)}


def build():
    OUT.mkdir(exist_ok=True)
    written = []
    for src in sorted(PACK.glob("*.png")):
        sizes = next((s for prefix, s in SIZES.items() if src.name.startswith(prefix)), None)
        if not sizes:
            continue
        image = Image.open(src).convert("RGBA")
        w, h = image.size
        for target in sizes:
            scale = target / max(w, h)
            size = (max(1, round(w * scale)), max(1, round(h * scale)))
            small = image.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")
            dest = OUT / f"{src.stem}-{target}.png"
            small.save(dest, optimize=True)
            written.append((dest.name, size, dest.stat().st_size))
    for name, size, nbytes in written:
        print(f"{name:34} {size[0]:>4}x{size[1]:<4} {nbytes / 1024:6.1f} KB")
    print(f"{len(written)} files, {sum(n for *_, n in written) / 1024:.0f} KB total")


if __name__ == "__main__":
    build()
