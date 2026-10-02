# Item artwork review — 2026-10-02

## Subsequent interface changes and release scope

After the artwork review below, the user requested clickable item cards, an L2 order book with all available levels (up to 30 per side), gray quantity bars sharing one scale across both sides, and a wider two-column details panel. The final panel is 820px on desktop, uses side-by-side buy/sell tables when space permits, and stacks them on phones. Save stars and auction copy actions stay independent of opening details. The L2 display uses the already-loaded snapshot and adds no collection or network request. Existing local work on the seven-column Bazaar layout, 21-item pages, default quantity/depth of one, and concise card text is included in this release.

The user subsequently authorized committing, pushing, and deploying this reviewed web state. Deployment is limited to the existing Firebase Hosting site; backend workers, alerts, security rules, billing, counters, quotas, cache policy, hourly collection, and the fixed operating deadline are unchanged. The earlier local-only statements and 79-test artwork audit below describe the initial artwork milestone.

Release validation passed the complete 248-test unit suite, the TypeScript/Vite production build, and 22 desktop/mobile browser checks (12 production-build checks and 10 market checks). The production cache review uses the captured response, verifies all available buy/sell levels against that response, and rejects unexpected market or alert requests. All 27 optimized files are checked against the recorded hashes before upload. Hosting is verified on the existing preview channel before promotion to live.

## Original artwork scope

Completed the user's revised scope: the **20 highest-volume Bazaar items**, ranked across all 2,197 saved products by `instantBuyActivity7d + instantSellActivity7d`. This is combined seven-day unit activity, not coin turnover. The saved snapshot was observed at **2026-10-02 05:48:50 UTC (1:48:50 AM EDT)**. No market collection was run to choose the items.

The seven icons completed before the scope change are also retained: Great White Shark Tooth, Summoning Eye, Booster Cookie, Enchanted Diamond Block, Necron's Handle, Enchanted Blaze Rod, and Enchanted Sugar Cane. **27 icons are generated and connected; no selected item is unresolved.** The remaining 7,274 IDs are explicitly out of scope and retain their prior artwork.

## Inventory and evidence

- [Complete inventory](catalog-inventory.json): 7,301 unique IDs, names, original mappings, categories, snapshot sources, appearance modifiers, final scope, and per-item progress. This is the union of 5,655 catalog IDs, 2,197 Bazaar products, and 2,272 distinct item IDs across 39,713 cached auction listings. Counts overlap. It covers the complete saved snapshots, not only visible listings.
- [Top 20 ranking](top-20-volume.json): exact IDs and the two activity values used to select them.
- [Verification and provenance](verification.json): per-icon reference URLs, output sizes, PNG/WebP comparisons, hashes, and verification results.
- [ImageGen prompts](generation-prompts.json): the exact prompt for each of the 27 individual built-in ImageGen generations. Reference images were supplied and every raw result was visually inspected.
- [App mapping](../../src/companion/item-artwork.ts): exact ID lookup shared by cards, inspectors, and repeated listings. Final assets live in [public/assets/items](../../public/assets/items).

The SkyBlock appearance references preserve the actual subjects and distinct variants, including the tooth silhouette, green Summoning Eye, the differing rough gemstone shapes/colors, and normal versus enchanted crops. These are generated interpretations of the verified references. Item-specific source links are recorded in `verification.json`.

## Storage

| Measure | Result |
|---|---:|
| Optimized files | 27 |
| Total | 360,892 bytes / 352.4 KiB |
| Average | 13,366 bytes / 13.1 KiB |
| Largest | 19,764 bytes / 19.3 KiB — Helix Log |
| Smallest | 5,996 bytes / 5.9 KiB — Necron's Handle |
| Dimensions | 236 × 236, supporting the current largest 118px display at 2× |

Each object is centered with its longest dimension around 76% of the square canvas. Nearest-neighbor resizing preserves pixel edges. RGB palettes use 128 colors, or 64 for the two textured cubes; the resized alpha channel is retained unchanged during palette reduction. Optimized PNG and lossless WebP were compared for every icon. WebP was smaller in all 27 cases, so only that export was saved. Decoded export pixels match the normalized input exactly; metadata is stripped. Full-resolution ImageGen originals are outside the project and no alternate exports are included in the app.

## Verification

All 27 new files decode successfully and have transparent corners. There are **zero missing selected images, incorrect selected ID mappings, duplicate file/pixel hashes, or broken new files**. All 13 referenced legacy atlas/pack files also exist and decode. Shared legacy fallbacks remain for out-of-scope items; their subject accuracy was not reviewed under the revised scope.

Every compressed icon was visually inspected at actual 64px and 80px sizes on checkerboard and dark surfaces. Local desktop (1440 × 1000) and mobile (390 × 844 at 2×) app checks passed for all 20 selected IDs plus the six retained Bazaar items: 52 item/viewport checks, no page errors or horizontal overflow. Great White Shark Tooth and Summoning Eye were also inspected in both detail views. Necron's Handle was inspected in the complete icon sheet because it is an auction item.

Preview requests were served from the frozen local snapshot in isolated browser contexts. External requests were blocked and reloads exercised the existing browser cache. The static preview server contains no collector code. No live alerts, watchlists, targets, settings, email delivery, or production services were changed or contacted during the preview. Network fonts were blocked too, so screenshots use fallback fonts.

TypeScript and the local Vite production build passed. Eight existing regression suites passed **79 tests**, covering Bazaar calculations, request/shared caching, polling, sampled prices, price alerts, usage, and authorization. Hashes of 164 existing source/test files were compared with the start-of-task baseline: only `components.tsx` changed, and removing its artwork import/lookup recovers the original contents (allowing patch context line-ending changes). The user's pre-existing edits are preserved. Calculations, authorization, collection cadence, freshness, deadlines, safeguards, quotas, counters, cleanup, and caching code were not edited.

Only artwork, image mappings, and their documentation were added. Nothing was deployed, committed, or pushed.

## Local screenshots

Screenshots are review artifacts under the ignored `.local` directory and are not shipped in the app.

- [All 27 icons at 64px and 80px](../../.local/artwork/screenshots/all-icons-64-and-80.png)
- [Desktop — Great White Shark Tooth](../../.local/artwork/screenshots/desktop-great_white_shark_tooth.png)
- [Mobile — Great White Shark Tooth](../../.local/artwork/screenshots/mobile-great_white_shark_tooth.png)
- [Desktop — Summoning Eye](../../.local/artwork/screenshots/desktop-summoning_eye.png)
- [Mobile — Summoning Eye](../../.local/artwork/screenshots/mobile-summoning_eye.png)
- [Desktop — Seeds](../../.local/artwork/screenshots/desktop-seeds.png)
- [Mobile — Rough Sapphire Gemstone](../../.local/artwork/screenshots/mobile-rough_sapphire_gem.png)
