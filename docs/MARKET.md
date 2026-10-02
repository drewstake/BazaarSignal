# Market companion: setup and operating notes

Updated October 1, 2026. The shared cache is deployed to the owner-authorized Google project `bazaarsignal-510305`, after the owner linked billing. Production website and Apps Script reads use that cache. Price Alerts, Google sign-in, item/order-book routes, private watchlists, saved filters, user records and the existing email trigger are preserved. See [Google deployment details](GOOGLE-MARKET-DEPLOYMENT.md).

## Current auction architecture

The browser reads the shared HTTP API. `src/companion/auction-worker.ts` and `current-auctions.ts` are removed; there is no browser Hypixel fallback. An unset production `VITE_MARKET_API_URL` shows a configuration error. Reads, reloads, searches, filters, pagination, details, item books, availability checks and copy actions cannot start a Hypixel refresh. Force/refresh query parameters are rejected.

`collector/engine.ts` runs a scheduler independently of requests, including with zero visitors. Its five-second timer checks which jobs are due; it does not download all auctions every five seconds. Only the scheduler calls the budgeted client in `collector/coordinator.ts`. Current snapshots, item catalog, election context, request ledger, scheduling state and seller cache are persisted. Completed sales are neither fetched nor stored.

SQLite WAL coordinates separate processes sharing one persistent local file on **one host**. It must not be placed on NFS or separate per-container disks. Multiple hosts must use the **same Redis service/database** via `MARKET_REDIS_URL`; atomic server-side Lua coordinates publication and leases, and Redis TIME supplies the coordination clock. All keys share a Redis Cluster hash slot. Use persistence, no eviction, private access/TLS and adequate memory. Unreachable storage fails closed; there is no uncoordinated memory fallback. See [deployment instructions](MARKET-DEPLOYMENT.md).

The global Hypixel lease lasts 60 seconds, renewed before each charged physical request; requests time out after 12 seconds. Ownership/expiry are checked before spending and publication. An expired worker cannot overwrite its successor. In-flight pages are drained before release. Every page must agree on timestamp, page index, page count and auction count; the final aggregate needs unique IDs, the exact total and a still-fresh timestamp. Only then does one transaction replace payload and control metadata. Failed or mixed snapshots leave the prior complete data intact.

Decoded payloads and derived pages have bounded local read caches to reduce CPU and Redis transfers. These do not coordinate refreshes. The companion polls cached results every five seconds while visible, waits for each request to finish, aborts on hiding/cleanup, and resumes on visibility. Unchanged snapshot versions do not replace displayed data. Local freshness timers remove expired comparisons without downloading a new snapshot. User-controlled price refresh/retry buttons are removed; alert-account refresh remains an account read.

Seller lookup uses separate shared leases, positive/negative caching and a provider budget. Validated UUID/name pairs live for one hour, failures for one minute, and lookups default to 30/minute globally (`MOJANG_REQUESTS_PER_MINUTE`). A provider-wide Retry-After cooldown takes precedence. A current official numeric allowance for Mojang's session profile endpoint was not established; 30/minute is a conservative application policy, not a claimed entitlement. There is no seller prefetch on pagination/search. Copy resolves only the selected seller and checks the shared snapshot again afterward, copying `/ah username`, never a UUID. Availability spends zero Hypixel requests and accepts snapshots up to 180 seconds old; it is an as-of-snapshot check, not an in-game reservation.

## Auction comparison contract

- Compare only fresh, unexpired active BIN listings with the same exact fingerprint: stable item ID, stack quantity, rarity, enchantments, upgrades and other supported attributes. No cross-configuration enchantment premiums.
- Exclude the candidate itself, duplicate auction IDs, expired/sold/unavailable listings, nonpositive/nonfinite asks and stale/future snapshots.
- AH average is the arithmetic mean of all remaining matching asks, without silent trimming. No matches means unavailable, not zero or an invented estimate.
- Show match count, median and 25th–75th percentile range. Thin samples, wide dispersion, high outliers or seller concentration reduce comparison confidence. Even a large matching sample does not establish resale value.
- After-fee gap is hypothetical average ask minus purchase price and the existing listing/duration/claim fees. Current election context is required for the fee calculation. Averages remain visible when taxes are unknown; the gap is withheld.
- A snapshot older than three minutes cannot supply a current comparison. Refresh failures preserve the last complete data, with a visible error and stale label when appropriate. Stale averages, ranges, profits and fees are withheld. The displayed timestamp is Hypixel's `lastUpdated`, never browser request time.

Existing historical valuation/store modules and `legacy-history-engine.ts` remain solely for compatibility and regression tests. No browser, Vite or standalone entrypoint imports the legacy engine, loads/writes history or schedules an ended-sales feed. Previously saved local files and Firestore history are untouched. Historical settings such as `COLLECTOR_STORE` do not activate storage through the current entrypoint.

## Development and required shared API

Use Node 24 (verified on 24.19.0), `npm ci`, then `npm run dev`. Vite starts the same scheduled shared collector backed by `.local/current-market.sqlite` by default. Explicit fixtures use `/?fixtures=1` in development only. Set `MARKET_SCHEDULER_DISABLED=1` for mocked browser tests; this is included in the companion/alert test configs.

`npm run collector` starts the standalone scheduler and cache API at `127.0.0.1:8787`. `npm run build:collector` type-checks and bundles it. `COLLECTOR_HOST`, `COLLECTOR_PORT` and `COLLECTOR_ALLOWED_ORIGINS` configure serving. Production requires explicit Redis configuration or `MARKET_STORE=sqlite` with one persistent absolute local file. Server credentials must never use VITE variables. `COLLECTOR_ITEM_IDS` no longer changes shared snapshot scope.

Routes under `/api/companion/`: `bazaar`, `raw-bazaar`, `snapshot`, `book?itemId=...`, `auctions`, `auctions/:id`, `auctions/:id/check`, `auctions/:id/command`, `player-names` and `status`. They never fetch Hypixel. `/api/market` provides the cached legacy price projection. Browser Price Alerts reads `snapshot` and `book` directly from this cache, keeping public price polling out of Apps Script URL Fetch quotas. Apps Script needs `MARKET_API_URL` in Script Properties; it reads this service for prices/books and does not fetch Hypixel under authentication, mutation or mail locks.

## Budget, cadence and measured usage

[Hypixel's official documentation](https://api.hypixel.net/) says five-minute limits depend on the application. For authenticated endpoints, `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` describe minute-window capacity. A 429 may be a global throttle. **300/5 minutes is not a guaranteed allowance.** The public Bazaar and paginated auction endpoints do not declare API-key authorization in that specification.

Live responses on September 30 returned `Cache-Control: public, max-age=60, s-maxage=300` for both feeds, without RateLimit headers. This primary response evidence informs pacing, not an exact-update promise. Actual source timestamps remain authoritative; independently cached pages can disagree. The collector avoids expensive pagination near an expected generation boundary, then still validates every page.

| Server setting | Default | Purpose |
| --- | --- | --- |
| `HYPIXEL_REQUEST_LIMIT` | 120 | Hard rolling-window ceiling |
| `HYPIXEL_WINDOW_MS` | 300000 | Five-minute rolling window |
| `HYPIXEL_RESERVE` | 0.20 | At least 20% reserved; 96 routine requests by default |
| `MARKET_BAZAAR_MS` | 60000 | Minimum Bazaar interval |
| `MARKET_AUCTION_MIN_MS` | 120000 | Minimum full auction interval; planner can increase it |

Catalog refresh is daily; election refresh is every five minutes. The auction interval is `max(minimum, observed cache cadence, successful fetch duration + 5s, pages × window / routine allocation)`, rounded up to a second. Allocation subtracts Bazaar, election and catalog costs. The first page discovers the actual count; if remaining pages cannot fit, work stops after that charged page. Known counts are checked before starting discovery. The rolling gate and rate-limit headers are authoritative even when burst timing delays the planned interval.

Every page, metadata request, discovery and transport retry is charged before I/O. Future probes must use the same coordinator. Availability costs zero upstream requests. Routine work cannot spend the reserve; retries may, but the hard total still applies. Other programs using the same API key/IP must join the ledger, stop, or be allowed for by lowering this budget. Separate ledgers/namespaces against the same allowance invalidate the guarantee.

Each physical request permits at most two retries with jittered exponential waits. A 429 or Retry-After (seconds or HTTP date) shares a cooldown rather than retrying immediately. Failed jobs use jittered exponential backoff capped at five minutes; longer server cooldowns and budget resets win. Out-of-order page response headers cannot restore minute tokens. Source snapshots and budgets survive normal process restarts.

| Measured scenario | Result |
| --- | --- |
| 100 instances, deterministic 43-page feed | Exactly 46 initial requests: pages + Bazaar + catalog + election |
| 3 reload rounds × 100 users × 4 reads/actions | 1,200 cached requests; zero additional Hypixel requests |
| Eight separate OS processes | Exactly one atomic publication winner |
| Live auctions | 43 pages; successful refresh 16.065s; selected interval 145s |
| Live Bazaar | 60s minimum; recorded request/normalization pass 221ms |
| Current payload sizes | Auction JSON 28.0 MB; Bazaar JSON 7.9 MB; catalog 0.4 MB |
| Cached result page on development host | 472ms initial calculation; 2ms repeated read in same cache window |
| Recorded live five-minute budget sample | 92 requests, below the 96 routine ceiling |
| Live inconsistency/failure handling | Mixed pages rejected; budget deferrals visible; prior complete snapshot retained; later full refresh recovered |

These are observations, not guarantees. With 43 pages, the default budget may defer work past 145s, especially after failed pagination; stale comparisons are withheld. Configuring a 300/5m planning ceiling reserves at least 60 (240 routine) and still enforces the 120s auction minimum, without asserting an upstream entitlement.

`npm run measure:market` performs one normal scheduler pass against the configured shared store and writes `.local/market-measurement.json`. It cannot force work due or reset the budget. If another worker owns the lease or work is not due, it reports zero new requests plus existing metrics. Do not use a separate measurement store against the same key/IP.

## Pricing contract and sources

### Bazaar

`shared/companion/bazaar.ts` maps `buy_summary` to asks a player instant-buys and `sell_summary` to bids a player instant-sells. `buyVolume/buyOrders` are outstanding sell-offer quantity/count; `sellVolume/sellOrders` are outstanding buy-order quantity/count. `buyMovingWeek/sellMovingWeek` are the API's respective instant-side rolling seven-day units **including live state**. They are activity proxies, not exact daily trades or inferred fill times. Direction and examples are checked against [Hypixel's API documentation](https://api.hypixel.net/).

Instant execution walks every visible level for the entire requested quantity. Insufficient depth produces no executable quote. Slippage is already in the weighted price, never charged twice. Passive acquisition joins the best bid and passive exit joins the best ask; neither jumps the queue nor promises a fill. Each strategy labels which leg waits. At an unchanged book, instant-buy → offer and order → instant-sell commonly lose after tax; default minimum profit excludes them honestly.

Default sorting is highest total net profit after minimum activity on both sides, visible depth, a maximum share of weekly activity, a budget, and freshness checks. Profit = gross exit − acquisition − sale tax − explicit execution costs. Required capital includes acquisition and the explicit execution-cost reserve. Manual extra cost defaults to zero. Freshness is capped at 180 seconds (with 30 seconds future tolerance). Activity share and liquidity labels are sizing heuristics, not a fill-rate model. Wide spreads, movement over 15% between observed quotes, thin activity and oversized trades are flagged. There is no guaranteed hourly income or fabricated fill-time estimate.

### Fees, verified September 30, 2026

`shared/companion/fees.ts` is the versioned centralized assumption set. Bazaar account tax choices are 1.25%, 1.125% and 1.0%; choose the tier shown in your account. BIN listing rates apply to the whole proposed resale amount: below 10M 1%, 10M through 100M 2%, above 100M 2.5%. Standard listing-duration fees for supported presets are 1h 20, 6h 45, 12h 100, 24h 350, 48h 1,200 coins. Collection tax is zero through 1M; above that it is the lesser of 1% of proceeds or the amount above 1M. Listing and duration fees are included in required initial capital. Relisting, unsold inventory, financing and transfer costs are not assumed to be free profit; they are outside the single-successful-resale scenario.

The tiered BIN rates are documented by Hypixel's [0.18.5 patch notes](https://hypixel.net/threads/skyblock-patch-0-18-5-abiphone-contacts-dungeons-balancing-bug-fixes.5380870/). The former official wiki closed in July 2026, so current duration and threshold details were cross-checked against a [maintainer's current SkyblockTaxCalculator implementation](https://github.com/Rijzzz/NotEnoughCalculator/blob/26.2/src/main/java/com/rijz/notenoughcalculator/core/skyblock/SkyblockTaxCalculator.java), plus an [original in-game fee investigation](https://hypixel.net/threads/maths-auction-fee-optimization.4622542/). Bazaar account-tier confirmation also uses an [in-game tax report](https://hypixel.net/threads/even-if-i-list-the-item-at-the-set-price-the-total-price-calculation-does-not-match.5722508/). These secondary confirmations are explicit assumptions, not a live quote from the game's listing screen. Minor in-game rounding can differ; review that screen before committing coins.

Only the shared collector reads the official [election resource](https://api.hypixel.net/v2/resources/skyblock/election) every five minutes. Current mayor/minister perks mentioning taxes, auction/Bazaar fees, or Perkpocalypse disable recommendations when their modifier is unmodeled. Missing/stale election context also withholds supported profits. The implementation does **not** guess a multiplier for Derpy, temporary item-specific effects, or account aura changes. Add verified context rules and boundary tests before enabling those conditions.


## Deployment and verification

The user subsequently authorized Google Functions deployment and linked billing. [GOOGLE-MARKET-DEPLOYMENT.md](GOOGLE-MARKET-DEPLOYMENT.md) records the live shared API, private blob storage, atomic Firestore coordination, minute scheduler, measured request usage and cost assumptions. Existing Firebase Spark Hosting/auth/users remain in the original project; the five-minute email trigger is preserved. [MARKET-DEPLOYMENT.md](MARKET-DEPLOYMENT.md) retains the alternative standalone SQLite/Redis deployment instructions.

Verification includes 111 unit/handler tests, 15 Firestore/security/backend checks and 40 browser checks: 10 companion, 10 production-build, two authenticated alert emulator and 18 broader app checks across desktop/mobile. They cover concurrency, clock skew, stale leases, eviction, budget exhaustion/recovery, throttling, retries, failed/mixed pages, matching, fees, quantity-aware pricing, identity isolation, target revisions and email retry/deduplication. Desktop/mobile screenshots are in `.local/previews/shared-cache-*.png`. Website, backend and standalone builds pass. Redis runtime integration was not exercised because no test Redis was available; SQLite was tested through independent connections and OS processes. Validate a chosen Redis service before deploying that adapter.
