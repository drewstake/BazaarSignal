# Market companion: setup and operating notes

Implemented September 30, 2026. The new market board is the default route; existing item/order-book pages, Google sign-in, private alerts, alert editing, and secure disable links remain available. `#alerts=1` opens price alerts and `#legacy=1` opens the original public search.

**Release status:** locally implemented and tested, with real Hypixel ingestion. This change has not been deployed to Firebase Hosting or Apps Script. No billing, paid service, production history collector, or new email delivery was enabled. Existing deployment details in [SETUP.md](../SETUP.md) describe the previous release.

## Run locally

```sh
npm ci
npm run dev
```

Vite serves the React app and a shared local market API. Bazaar loads live prices immediately. Opening Auctions starts 30-second completed-sale collection and a full active snapshot every two minutes. History persists in ignored `.local/collector/history.json` while that server runs. Stopping the computer or development server stops collection; later restarts report missed windows. The API never silently supplies sample prices on failure.

For an explicitly labeled design/test fixture, visit `/?fixtures=1`. Fixture imports are gated by Vite's development flag; production builds ignore that query. The fixture is not historical market evidence. Private-data tests use Firebase emulators, not real user accounts.

Copy `.env.example` to `.env.local` and use the existing Firebase browser configuration and Apps Script URL to use Google sign-in and existing alerts. Firebase browser settings are public identifiers. Service-account credentials and Hypixel API keys must **never** be `VITE_` variables. Existing local-preview mode does not grant access to the new private watchlist.

## Standalone shared collector

```sh
npm run collector
```

Default: Node service at `http://127.0.0.1:8787`, local disk history, all item IDs, no credentials required for public market feeds. `npm run build:collector` type-checks and builds `.local/collector-runner.mjs`; run that bundle from the repository root with installed dependencies. Node 22+ is supported. Run **one process per history file or Firestore project**, under a supervisor with restart-on-failure and no overlapping instances. The write counter assumes a single writer; it is not a distributed lease.

| Server variable                     | Purpose                                                                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COLLECTOR_STORE=firestore`         | Enable the real Firestore history adapter; default is local.                                                                                                                              |
| `GOOGLE_CLOUD_PROJECT=bazaarsignal` | Target Firebase project. Use a separate test project for staging.                                                                                                                         |
| `GOOGLE_APPLICATION_CREDENTIALS`    | Absolute path to a private service-account file outside the repository, or use application default credentials on a trusted host. Grant only needed Firestore access.                     |
| `COLLECTOR_ITEM_IDS`                | Comma-separated stable IDs, e.g. `LIVID_DAGGER,ASPECT_OF_THE_DRAGONS`. **Required for Firestore mode** to limit Spark costs. Expand only after measuring actual sales and variant counts. |
| `COLLECTOR_DAILY_WRITE_LIMIT`       | Default 12,000; accepted range 100–15,000, including conservative accounting of deletes. Pacific quota day; durable counter.                                                              |
| `COLLECTOR_HOST`, `COLLECTOR_PORT`  | Default `127.0.0.1`, `8787`. Put a public deployment behind HTTPS and request limits.                                                                                                     |
| `COLLECTOR_ALLOWED_ORIGINS`         | Exact comma-separated web origins; include the chosen Hosting/preview origins. CORS is not an authentication or abuse-prevention boundary.                                                |
| `HYPIXEL_API_KEY`                   | Optional server-side key for the specific-auction availability endpoint. Without it, availability uses a complete public snapshot no older than 75 seconds.                               |

The browser variable `VITE_MARKET_API_URL=https://your-collector.example` selects the shared API. Build after changing it. Do not point public Hosting at `localhost`.

Public GET routes: `/api/companion/bazaar`, `/auctions?filters=<JSON>&page=0`, `/auctions/:uuid`, `/auctions/:uuid/check`, and `/status`. All paths start with `/api/companion`. Results contain six listings per page; cached query pages last ten seconds. Buyer/seller IDs used internally for concentration checks never appear in public comparable-sale results. Availability checks have a shared limit of 30/minute and return no command when unavailable. Even a recheck cannot reserve an auction or eliminate the race with another buyer.

## Deployment choices on the existing Spark plan

The repository's existing verified deployment uses Spark, static Hosting, Firestore, Google Auth, and a five-minute Apps Script email worker. Static Hosting cannot run this Node collector. That worker's cadence cannot capture the ended-auction feed's approximately one-minute retention.

1. **Keep the existing free stack for Bazaar and alerts.** The new public Apps Script `companion` action normalizes cached Bazaar order books and election context. Build with `npm run build:backend`, update the existing Apps Script deployment using the procedure in [SETUP.md](../SETUP.md), then deploy rules/indexes and Hosting. Preserve the existing deployment URL, properties, origin allowlist and trigger. Without `VITE_MARKET_API_URL`, the production board uses that action for Bazaar and explains that Auctions needs a collector. An older backend returns an explicit error plus a link to existing price search.
2. **Run collection on an existing always-on machine.** Keep a single supervised Node process, persistent disk/ADC, HTTPS reverse proxy, uptime monitoring, and the bounded Firestore scope. This adds no new Firebase billing service. Host electricity, networking and maintenance remain the operator's responsibility. A sleeping laptop is useful for development, not continuous coverage.
3. **Choose a hosted always-on server later.** Configure the same process and storage adapter on a suitable host. Hosting cost depends on the provider and plan; none has been selected or purchased. A service that sleeps when idle misses sales. Cloud Functions/Cloud Run or another paid host requires an explicit infrastructure/billing decision before deployment. This implementation does not enable them.

For a release, run `npm run build`, `npm run build:collector`, deploy `firestore.rules` and `firestore.indexes.json`, update Apps Script, set the collector URL if available, and deploy Hosting. Existing `npm run deploy` deploys only Hosting/Firestore; it does not update Apps Script or provision a collector. Keep the existing email trigger at five minutes; do not repurpose it for auctions.

## Data model, retention, and estimated cost

| Firestore path                           | Writer / use                                                                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `completedSales/{auctionUUID}`           | Server-only idempotent completed BIN observation: sold/observed timestamps, full normalized variant, internal buyer/seller IDs, top-level item ID/fingerprint. |
| `itemVariants/{versionedFingerprint}`    | Server-only exact configuration, decoding issues, last seen timestamp.                                                                                         |
| `comparablePrices/{fingerprint}`         | Server-only robust exact-match statistics and bounded comparable evidence.                                                                                     |
| `collectorStatus/main`                   | Server-only coverage timestamps, gaps, scope, failures, counters, durable quota day. Exposed through the sanitized public API.                                 |
| `users/{uid}/watchlist/{kind_itemId}`    | That verified Google user only; item references, never trusted price overrides.                                                                                |
| `users/{uid}/filters/{bazaar\|auctions}` | That verified Google user only; bounded serialized preferences.                                                                                                |

The browser cannot directly read or write shared historical collections. Admin credentials bypass rules and stay on the server. Existing alert ledgers and per-user status restrictions are preserved. Composite indexes support fingerprint/item ID plus sale time; large nested payloads have indexing disabled. No Cloud Storage archive is needed.

Sales and aggregates have a 14-day working horizon. Inactive variants expire after 30 days. Hourly cleanup deletes up to 200 expired documents per collection per pass, subject to budget; expiry is bounded cleanup, not a paid TTL policy. At a low-volume scoped deployment that is ample; budget exhaustion, downtime, or more than 4,800 expired records/day/collection can create a cleanup backlog. Monitor stored bytes and narrow the scope before approaching limits. Startup loads at most 10,000 recent sales and reports a coverage warning at the cap. Local collection stops at 100,000 in-memory sales pending scope reduction.

Firestore's documented free allowance is 50,000 reads/day, 20,000 writes/day, 20,000 deletes/day and 1 GiB storage, shared with existing alerts and private data. It resets near midnight Pacific. [Firebase quota documentation](https://firebase.google.com/docs/firestore/quotas).

Illustrative small-scope daily budget, **not a measured promise**: 500 completed sales, 100 new/refreshed variants, 500 changed variant aggregates, and at most 2,880 feed checkpoints yield roughly 1,000 sale/status writes + 100 variant writes + 1,000 aggregate/status writes + 2,880 checkpoints = **4,980 writes/day**, plus bounded cleanup. Actual feed timestamps commonly repeat, reducing checkpoints. Steady retention might delete roughly 500 sales plus obsolete summaries/variants/day. Cleanup also writes a counter checkpoint per nonempty batch. Quota accounting reserves room for final status and stops ingestion writes at 12,000 by default; other project clients can still exhaust the shared quota first.

Public browsing queries the process's memory cache and causes no per-visitor history reads. Startup reads at most 10,001 documents; hourly cleanup reads expired records plus empty-query minimums. A 500-sale/day scope retains about 7,000 sale records over 14 days. At an assumed 2–8 KiB per normalized sale, that is approximately 14–56 MiB before indexes, aggregates and variants. Measure real document/index size: complex NBT can be much larger. Broad whole-market Firestore ingestion is deliberately not enabled by default. After a restart, aggregates may be rewritten once; a variant's retention timestamp refreshes at most daily plus the first subsequent sale after restart.

## Pricing contract and sources

### Bazaar

`shared/companion/bazaar.ts` maps `buy_summary` to asks a player instant-buys and `sell_summary` to bids a player instant-sells. `buyVolume/buyOrders` are outstanding sell-offer quantity/count; `sellVolume/sellOrders` are outstanding buy-order quantity/count. `buyMovingWeek/sellMovingWeek` are the API's respective instant-side rolling seven-day units **including live state**. They are activity proxies, not exact daily trades or inferred fill times. Direction and examples are checked against [Hypixel's API documentation](https://api.hypixel.net/).

Instant execution walks every visible level for the entire requested quantity. Insufficient depth produces no executable quote. Slippage is already in the weighted price, never charged twice. Passive acquisition joins the best bid and passive exit joins the best ask; neither jumps the queue nor promises a fill. Each strategy labels which leg waits. At an unchanged book, instant-buy → offer and order → instant-sell commonly lose after tax; default minimum profit excludes them honestly.

Default sorting is highest total net profit after minimum activity on both sides, visible depth, a maximum share of weekly activity, a budget, and freshness checks. Profit = gross exit − acquisition − sale tax − explicit execution costs. Required capital includes acquisition and the explicit execution-cost reserve. Manual extra cost defaults to zero. Freshness is capped at 180 seconds (with 30 seconds future tolerance). Activity share and liquidity labels are sizing heuristics, not a fill-rate model. Wide spreads, movement over 15% between observed quotes, thin activity and oversized trades are flagged. There is no guaranteed hourly income or fabricated fill-time estimate.

### Fees, verified September 30, 2026

`shared/companion/fees.ts` is the versioned centralized assumption set. Bazaar account tax choices are 1.25%, 1.125% and 1.0%; choose the tier shown in your account. BIN listing rates apply to the whole proposed resale amount: below 10M 1%, 10M through 100M 2%, above 100M 2.5%. Standard listing-duration fees for supported presets are 1h 20, 6h 45, 12h 100, 24h 350, 48h 1,200 coins. Collection tax is zero through 1M; above that it is the lesser of 1% of proceeds or the amount above 1M. Listing and duration fees are included in required initial capital. Relisting, unsold inventory, financing and transfer costs are not assumed to be free profit; they are outside the single-successful-resale scenario.

The tiered BIN rates are documented by Hypixel's [0.18.5 patch notes](https://hypixel.net/threads/skyblock-patch-0-18-5-abiphone-contacts-dungeons-balancing-bug-fixes.5380870/). The former official wiki closed in July 2026, so current duration and threshold details were cross-checked against a [maintainer's current SkyblockTaxCalculator implementation](https://github.com/Rijzzz/NotEnoughCalculator/blob/26.2/src/main/java/com/rijz/notenoughcalculator/core/skyblock/SkyblockTaxCalculator.java), plus an [original in-game fee investigation](https://hypixel.net/threads/maths-auction-fee-optimization.4622542/). Bazaar account-tier confirmation also uses an [in-game tax report](https://hypixel.net/threads/even-if-i-list-the-item-at-the-set-price-the-total-price-calculation-does-not-match.5722508/). These secondary confirmations are explicit assumptions, not a live quote from the game's listing screen. Minor in-game rounding can differ; review that screen before committing coins.

The collector and Apps Script read the official [election resource](https://api.hypixel.net/v2/resources/skyblock/election) every five minutes. Current mayor/minister perks mentioning taxes, auction/Bazaar fees, or Perkpocalypse disable recommendations when their modifier is unmodeled. Missing/stale election context also withholds supported profits. The implementation does **not** guess a multiplier for Derpy, temporary item-specific effects, or account aura changes. Add verified context rules and boundary tests before enabling those conditions.

### Auction variants and evidence

`collector/nbt.ts` decodes bounded base64/gzip NBT; `normalize.ts` uses structured stable item ID, quantity, catalog rarity plus rarity upgrade, every enchantment/level, and retained ExtraAttributes. That includes reforge, dungeon conversion/stars/master-star representations, potatoes, gems/slots/quality, attributes, pet species/tier/experience/held item, runes/skins and other recognized modifiers. Pet experience is exact, not an invented level. Vanilla damage, armor display color and decoded head textures also distinguish variants. Identity-only UUID/timestamp fields do not determine value. Unsupported modifiers remain in the deterministic `v1_<sha256>` fingerprint and withhold valuation. Parser/schema changes that change comparability require a new fingerprint version before mixing deployed histories.

Fallback hierarchy: (1) exact fingerprint with recent 72-hour evidence inside a 14-day window; (2) exact older configuration evidence with lower confidence; (3) no estimate. Never fall back to clean items, a shared display name, enchantment retail prices, or an unexplained percentage penalty. Exact matching deliberately leaves many rare/highly customized configurations without recommendations.

Only actual completed BIN events with valid participants enter history. Auction UUIDs make ingestion idempotent. Each buyer and each seller contributes at most two retained events per variant/window. With at least five events, reject deviations exceeding max(6 × median absolute deviation, 15% of median). Report median, 25th/75th percentiles, trimmed mean (10% each tail for samples ≥10), count, IQR/median dispersion and recent movement. These are conservative concentration/outlier guards, not proof that manipulation has been detected.

Fewer than five retained exact sales yields no resale estimate. Fewer than three recent sales, high dispersion or concentrated activity lowers confidence. High confidence requires at least twelve retained sales, adequate recent evidence, tight dispersion, and no known coverage gaps. The resale estimate is the lower of all-window and recent 25th percentiles, capped by the cheapest fresh competing exact-configuration ask, excluding the listing itself. Asking prices only cap an evidence-backed estimate; they never create historical evidence. The displayed range is the observed interquartile range, not a guaranteed sale range. UI evidence includes actual retained sale timestamps/prices and rejection counts.

`configurationRules` starts empty. Any added enchantment rule must name exact item IDs, a mechanical or market-preference classification, an explanation and a source. No universal bad-enchantment blacklist or invented premium is applied.

## Collection coverage and recovery

The ended feed is polled every 30 seconds because its retention is short. Track both upstream and local timestamps; record uncovered intervals when consecutive upstream timestamps differ by more than 60 seconds. Successful API access cannot prove that upstream supplied every sale. Uptime and rate limits still affect coverage. Known missed coverage reduces confidence; history before collection starts is unavailable.

Active snapshots fetch in batches of three pages and require matching snapshot timestamp, page count, expected total and unique IDs before replacing the cache. Partial failure preserves the previous snapshot. A disappeared listing becomes unavailable, not sold. Only a completed-sale event establishes sold status. End time establishes expiration. Requests use bounded timeouts and exponential retries; HTTP 429 stops immediate retry. Monitor `/status` for increasing failure/gap/rejection counts, stale success timestamps, budget and startup-cap warnings. Do not repeatedly restart to evade the write budget.

If history is incomplete, keep the visible cold-start/low-evidence state. Accumulating enough exact-configuration sales can take days or never happen for rare variants. Expanding collection scope requires a new cost estimate; it cannot recover past one-minute feeds.

## Verification

September 30 local results: **85 unit/handler tests, 15 emulator-backed Firestore/backend checks, and 26 desktop/mobile browser checks passed** (8 companion, 2 private watchlist, 10 existing app, 6 production-build public browsing). Web, Apps Script and standalone collector builds passed. Desktop/mobile renders were inspected against the supplied reference. Live browser checks loaded 2,197 products without page errors or horizontal overflow; the shared collector successfully loaded a consistent snapshot of approximately 39,000 listings and persisted real completed sales. Snapshot changes during pagination were rejected, followed by a successful complete refresh. These checks do not claim production deployment, full historical coverage, or real email delivery.

```sh
npm test
npm run test:rules
npm run test:companion
npm run test:private-browser
npm run test:browser
npm run build
npm run build:collector
npm run test:public-browser
```

Emulator commands require Java 21+. `test:rules` includes real Firestore adapter persistence, budget, retention and isolation checks. Private browser tests run against a demo Firebase project with Auth/Firestore emulators; test credentials cannot sign into production. Companion browser tests label fixtures and cover both desktop and mobile filtering, quantity, valuation evidence, enchantment exclusion, inspector accessibility and failed live requests. Existing browser tests keep the legacy alert/order-book journeys. Generated design artwork and prompts are recorded in [ARTWORK.md](ARTWORK.md).
