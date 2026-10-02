# Grouped auction review — October 2, 2026

The initial review below covered local changes. The October 2 release follow-up published the website through `free-preview` to https://bazaarsignal.web.app, verified production bundle `app-DDw54z0S.js`, and prepared these changes for commit and push.

The cache API deployment is blocked: read-only inspection at 22:00 UTC found Scheduler PAUSED and the operating ledger stopped after a timeout. `prepare-usage-release.mjs` refused the stopped period with `Missing fresh active-period evidence`. The API image was built and both handlers passed local startup checks with outbound connections blocked, but no image was uploaded and no API revision was changed. Grouped live auction responses therefore remain unavailable pending an authorized recovery of the stopped service. No collector restart, ledger reset, billing change, alert mutation or email was performed.

Release verification: 260 unit tests, production frontend/backend builds, and 36 public/companion browser tests passed (two optional captured-cache tests skipped). The authenticated watchlist test initially exposed an incomplete fixture route: reopening the representative auction could reach the real API before the fixture list loaded. Both saved fixture IDs are now intercepted explicitly.

## Candy Artifact: reproduced before and after

Source: existing SQLite cache, opened read-only at `.local/current-market.sqlite`. The normalized Candy Artifact subset is retained in `tests/fixtures/candy-auctions.json` for deterministic regression coverage. The source timestamp is **October 2, 2026, 1:48:09.014 AM EDT** (05:48:09.014 UTC). Candidate observation: 1:48:51.842 AM EDT. This is historical evidence, not a claim about today's executable market.

- Candidate `e5079e46c2cc46d68497355cef1a9667`: **1,210,000 coins**, EPIC, quantity 1, no enchantments. Fingerprint `v1_23ecdf8c35f46e2b7aa207758484209c839f3ee5308c052707e935511eb36bfd`.
- There are **49 Candy Artifact listings, across five configurations**. The candidate has **43 other exact matches**. Grouped details show all 49 when purchase/evidence/age filters admit them; narrower filters correctly reduce that list. The comparison pool remains complete.
- Ask `9200d22a4a534a9996b877ad6234f9ae`, seller `fe95843f6ef740579e55e3d3ad28f85b`, is **15,432,000,000 coins**. The other 42 exact asks are **1,300,000–2,000,000**. This one extreme ask inflated the arithmetic mean to **360,473,261.07**.
- Raw median: **1,749,999**. The upper outlier threshold is **2,624,998.50**. That single extreme ask is excluded from the primary estimate but remains visible, labeled with the rule. Its seller's intent cannot be inferred from the ask alone.
- Remaining lower quartile: **1,425,000**. Lowest valid competitor: **1,300,000**. Conservative estimate = `min(1,425,000, 1,300,000)` = **1,300,000**.
- Verified snapshot fee context: Diana, multiplier **1**, checked at **1:48:49.577 AM EDT**, 2.265 seconds before the candidate observation. Duration is **24 hours**. The existing bracket/duration/collection-tax formula is unchanged.

| Calculation | Previous arithmetic-mean estimate | Conservative estimate |
| --- | ---: | ---: |
| Purchase | 1,210,000.00 | 1,210,000.00 |
| Hypothetical resale | 360,473,261.07 | 1,300,000.00 |
| BIN listing fee | 9,011,831.53 | 13,000.00 |
| Duration fee | 350.00 | 350.00 |
| Collection tax | 3,604,732.61 | 13,000.00 |
| Total fees | 12,616,914.14 | 26,350.00 |
| Required capital (purchase + listing + duration) | 10,222,181.53 | 1,223,350.00 |
| After-fee gap | 346,646,346.93 | 63,650.00 |
| Gap / required capital | **3,391.1191%** | **5.2029%** |

The new gap is `1,300,000 - 1,210,000 - 26,350 = 63,650`. ROI is `63,650 / 1,223,350 × 100 = 5.2029%`. It remains **low confidence** because the pool contains an excluded extreme ask. Neither calculation establishes a completed resale or buyer demand.

## Why the default order is more credible

Previously, all six results on the first page of this cached snapshot were Candy Artifact auctions with inflated arithmetic margins. Now there is one result per canonical ID; counts and page boundaries are calculated after matching listings are grouped over the full snapshot. The first six default results replaying the same snapshot are Pig Mask, Superior Dragon Helmet, Fire Veil Wand, Water Hydra Head, Gloomlock Grimoire and Night Crystal. Each has medium/high comparison confidence. This describes ranking behavior, not a recommendation to buy these historical listings.

The default order prioritizes positive medium/high-confidence comparisons before positive low-confidence ones. Within those tiers, the monetary gap is discounted for sparse matches, few sellers, seller dominance, price dispersion and excluded upper outliers. Unsupported results follow. The displayed gap and ROI use the real conservative calculation without a percentage cap. Exact rules and the sorting formula are documented in [MARKET.md](MARKET.md#auction-comparison-contract).

## Verification

- Unit checks cover canonical IDs versus display names, 285 unique auctions across 15 items and three pages, duplicates, filters spanning page boundaries, empty groups, full-pool comparisons outside purchase budgets, and exact configuration/rarity/quantity isolation.
- Pricing checks cover sparse and single listings, extreme upper asks, low competing asks that must never be removed, multiple and concentrated sellers, confidence ranking, missing/invalid/future fees, stale snapshots, timestamp provenance and availability safeguards. The saved Candy snapshot reproduces the numbers above.
- Browser checks run at desktop 1440×1000 and mobile iPhone 13 viewport sizes. Candy's 49 group rows appear exactly once; all 43 evidence rows remain inspectable, including the excluded outlier. Price sorting, different configurations, selection-specific evidence, keyboard card opening, independent saves and seller-command selection are exercised. Reducing the purchase budget to 1.3M leaves two group rows while keeping all exact comparison evidence.
- Fresh, historical, expired/stale, unavailable and failed cache states retain accurate labels and original sample/fee evidence. No automatic collection occurs from loading, filtering, pagination or selecting details. Mock browser request logs contain no Hypixel or Mojang collection requests; collector read tests assert zero upstream fetches and unchanged stored snapshots.
- Auth/Firestore emulator tests verify independent auction-ID saves, reload, reopening a non-representative saved auction, removing only that entry, and existing watchlist/user isolation.
- Visual screenshots are under `.local/grouped-auctions/candy-{fresh,stale}-{desktop,mobile}.png`; representative desktop/mobile renders were inspected. A global button style that squeezed grouped row fields into columns was corrected. The parchment/wood artwork, card actions and responsive inspector remain in place.

Final results: **257 unit tests passed across 26 files**; **28 targeted browser checks passed** (12 production-cache checks, 12 companion regressions, four authenticated watchlist checks, all across desktop/mobile). `npm run build` passed, including frontend and Apps Script type checks/builds; collector and market-functions TypeScript checks also passed. The existing large-chunk build warning remains. Authenticated testing also exposed and fixed a hash-navigation race that immediately closed a cached auction reopened from Watchlist on mobile; the regression now passes. Browser fixture timestamps are translated to exercise both fresh and stale views; the retained source snapshot and calculation above preserve the original timestamps.

## Scope and limits

No collector scheduler, request budget, quota/counter implementation, authorization route, cleanup policy, operating deadline, polling/cache protocol, alerts or email code is changed. Derived grouping and pricing operate on the existing complete cache. Server name/availability checks still gate seller commands. A historical comparison never authorizes a command.

Asking-price consistency is the only pricing evidence available here. There is no completed-sales feed, demand model or sell-through estimate. If the entire available pool is unrealistic, consistency alone cannot prove value; the UI labels the result as hypothetical and explains the evidence rather than claiming profit.


## Local preview correction

The open preview at port 5197 originally imported `.local/auction-average-review/active-page.mjs`, an old one-off bundle. Its frontend updated through Vite while its backend kept returning individual auctions and arithmetic means. The read-only preview now loads `shared/companion/active-auctions.ts` through Vite for its requests and clears derived pages when comparison source files change. The collector remains unloaded and the SQLite snapshot remains read-only.

The browser also retained legacy responses in its hourly public cache. Auction requests now use a stable `format=grouped-conservative-v1` URL parameter, preserving the existing cache limits, scheduling, accounting and deadline checks while separating the changed response schema. Legacy list/detail responses are rejected instead of being displayed as conservative estimates. Three new API regression tests and the existing request-cache/auction tests passed (21 focused tests total). The actual open 5197 page was reloaded and verified to show one Candy Artifact result, a 1,300,000 conservative estimate and a 63,650 / 5.2% historical after-fee gap.

Authenticated release recheck: all four desktop/mobile watchlist tests passed after completing the fixture routes.
