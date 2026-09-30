# Market artwork

Created September 30, 2026 with the built-in image generation tool using the imagegen skill. These are separate decorative assets; all navigation, controls, prices and cards are accessible HTML/React. They are original Minecraft-inspired illustrations, not official item textures or screenshots. The atlas uses category stand-ins and a chest fallback for items outside its twelve cells.

## Skyline

Output: `public/art/sky-islands.png`.

Final prompt:

> Use case: stylized-concept. Asset type: decorative website masthead background, not a screenshot. Create a wide 3:1 panoramic illustration of floating grassy voxel islands in a bright Minecraft-like blue sky. Tiny cheerful merchant stalls with green and red striped awnings, oak bridges, small trees, golden lanterns, stone and dirt undersides, soft distant clouds. Detailed crisp pixel-art/voxel aesthetic, charming and refined. Central sky has generous breathing room. Islands arranged in a narrow horizontal skyline, usable cropped to a 160px tall header. Sky blue, leafy green, warm oak, cream sunlight. No lettering, no logos, no UI, no cards, no border. Save this as a standalone artwork asset.

## Transparent item atlas

Output: `public/art/item-atlas.png`. Requested transparent background. CSS crops the regular 4×3 atlas into individual icons.

Final prompt:

> Use case: stylized-concept. Asset type: a single game item icon atlas for a Minecraft SkyBlock market website. A perfectly regular 4 column by 3 row grid of 12 equally sized square cells with no borders and transparent background. Each cell contains ONE large centered detailed pixel-art inventory collectible, generous empty padding, no shadows outside each cell. Row 1: purple glowing summoning eye orb; golden chocolate-chip booster cookie; cyan enchanted diamond cube; red enchanted book. Row 2: orange blaze rod; green sugar cane bundle; golden metal cube; silver iron cube. Row 3: emerald green cube; blue lapis cube; turquoise ender pearl; small oak treasure chest with golden latch. Crisp textured voxel pixel art, luminous small highlights with restrained glow, each recognizable isolated object. No text, no labels, no UI, no scenery. Exact equally spaced atlas layout, consistent scale. Transparent background.

No further image-generation edits were made. The supplied reference guided the cream/sky/oak palette, hanging tabs, left feature card, six-card center and narrow paper inspector. Artwork remains separate from live UI and market data.

## UI textures

Output: `public/art/ui/` (`wood-dark.png`, `wood-mid.png`, `wood-light.png`, `stone-dark.png`, `vine.png`).

Small original pixel-art tiles drawn procedurally by `scripts/generate-ui-textures.py` (Pillow, fixed seeds, so re-running reproduces the same files). CSS scales them up with `image-rendering: pixelated` for the wooden signs, tabs and board frame, the dark stone niches behind item art, and the vines on the board edges. The item glow colour on each niche comes from the atlas cell (`artGlow` in `src/companion/components.tsx`).

## Sky Island Market icon pack (v1)

Source pack: `Sky-Island-UI-Assets/` (reference copy) and `public/assets/sky-island-v1/` (served). The app never loads the 1100–1400 px originals directly. `scripts/build-sky-icons.py` writes web-sized copies to `public/assets/sky-island-v1/web/` (`ui-*` at 64/128 px, `item-*` at 256/512 px, longest side), keeping each original canvas, transparent padding and aspect ratio, resized on premultiplied alpha. Components pick a size with `srcset`/`sizes`; re-run the script after replacing a pack image.

Interface icons (`SkyIcon` in `src/companion/components.tsx`): emerald brand, Bazaar crate, auction gavel, watchlist heart, price-alert bell (navigation); deal crown; hot flame; favourite star (save toggles, drawn pale when unsaved and gold when saved); gold coin (all prices); heart (Add to Watchlist, remove, footer); chest (My Watchlist panel, watchlist page, empty states, saved auction listings). Sizes compensate for each icon's transparent padding; button backgrounds, ribbons, borders, the wooden peg, corner brackets and sparkles are drawn in CSS.

Item illustrations map only to the item each was drawn for: `SUMMONING_EYE`, `ENCHANTED_DIAMOND_BLOCK`, `BOOSTER_COOKIE` (golden cookie), `DIAMOND_SWORD` (enchanted sword), `NECRON_HANDLE`, and enchanted books (`ENCHANTED_BOOK` and every `ENCHANTMENT_*` product). They are concept illustrations, not official textures. Every other item keeps the atlas stand-ins above; weapons, armour, tools and accessories that previously borrowed the book now use the neutral chest until matching art exists.
