"""Losslessly encode the existing artwork. Requires Pillow with WebP support.

Original PNGs in assets/artwork/night-market stay intact. Exact RGBA equality is checked after decoding each
export; dimensions, crop, transparency, and the approved artwork do not change.
"""
import json
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parents[1]
art = root / "public/assets/night-market"
sources = root / "assets/artwork/night-market"
art.mkdir(parents=True, exist_ok=True)
measurements = []
for name in ("scene-only", "reference", "workspace-courtyard"):
    source = sources / f"{name}.png"
    output = art / f"{name}.webp"
    with Image.open(source) as original:
        rgba = original.convert("RGBA")
        rgba.save(output, "WEBP", lossless=True, quality=100, method=6, exact=True)
        with Image.open(output) as exported:
            assert exported.size == rgba.size, f"Dimensions changed: {name}"
            assert exported.convert("RGBA").tobytes() == rgba.tobytes(), f"Pixels changed: {name}"
        assert output.stat().st_size < source.stat().st_size, f"No byte savings: {name}"
        measurements.append({
            "source": source.relative_to(root).as_posix(),
            "export": output.relative_to(root).as_posix(),
            "dimensions": list(rgba.size),
            "sourceBytes": source.stat().st_size,
            "exportBytes": output.stat().st_size,
            "identicalDecodedPixels": True,
        })

report = root / ".local/audit/artwork.json"
report.parent.mkdir(parents=True, exist_ok=True)
report.write_text(json.dumps(measurements, indent=2) + "\n", encoding="utf-8")
print(report.read_text(encoding="utf-8"))
