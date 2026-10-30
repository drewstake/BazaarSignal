# Artwork sources and regeneration

This folder holds the canonical high-resolution inputs used by the artwork exporters. It is outside Vite's `public/` directory and is not deployed. Runtime URLs and artwork pixels are unchanged by the repository cleanup.

| Inputs | Generator | Runtime output |
| --- | --- | --- |
| `sky-island-v1/*.png` (15 originals) | `python scripts/build-sky-icons.py` | `public/assets/sky-island-v1/web/`: UI 64/128px, item 256/512px |
| `night-market/{scene-only,reference,workspace-courtyard}.png` | `python scripts/build-night-market-webp.py` | Three lossless WebP files in `public/assets/night-market/` |
| Fixed-seed procedural textures | `python scripts/generate-ui-textures.py` | `public/art/ui/` |

Run from the repository root with Python 3 and Pillow installed (`python -m pip install Pillow`). Icon resizing preserves the full canvas, transparent padding and aspect ratio, using premultiplied alpha. Night-market export checks exact decoded RGBA equality and records its report under ignored `.local/audit/artwork.json`. Review generated diffs before committing.

## Provenance and attribution

Sky Island originals and night-market scenes were generated using the built-in image generation tool. The adjacent prompt files preserve generation/edit instructions. The night-market `reference` is also the source of the logo/icon CSS sprite, so both its PNG input and WebP runtime export are required. These are Minecraft-inspired interpretations, not official Minecraft/Hypixel textures or screenshots.

The [original artwork notes](../../docs/history/ARTWORK.md) retain the atlas/skyline prompts. `public/art/item-atlas.png`, `public/art/sky-islands.png` and UI tiles remain in place because runtime styles or generators reference them. Their retention is not based solely on filename search. Some legacy styles remain; removing those is a separate behavior review.

The 27 optimized item WebP files in `public/assets/items/` retain [per-item prompts](../../docs/artwork/generation-prompts.json), [verification/source references](../../docs/artwork/verification.json) and the [historical inventory](../../docs/artwork/README.md). Full-resolution originals for that set were never tracked here; the historical record says they were stored outside the project. Regeneration of those exact originals is therefore not self-contained.

Pixelify Sans stays alongside its [SIL Open Font License](../../public/assets/night-market/OFL.txt). No overall project license has been selected; asset provenance does not grant a new project-wide license.

## Retired design material

Duplicate pack copies, ZIP bundles, gallery pages, Claude outputs, root previews, design alternatives and unused background/account studies were removed from the tracked tree. Their original bytes are preserved locally under ignored `.local/repo-cleanup/archive/`, with a checksum manifest under `.local/repo-cleanup/`. That archive is machine-local and is not required to build the app. Historical prompts can mention retired icons; the current 15 source originals cover all generated runtime pack files, including dynamically constructed paths in `components.tsx`.
