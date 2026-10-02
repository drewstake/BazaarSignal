# Shared market deployment procedure

**October 1 update:** the owner linked billing for the new Google project and the shared Functions cache is deployed. Follow [Google deployment status and procedure](GOOGLE-MARKET-DEPLOYMENT.md) for current production details. The original existing-host procedure below remains an alternative.

The alternative below was prepared September 30, 2026. No standalone host or Redis service was purchased. Do not promote a frontend or Apps Script bundle until its shared API is running and the configurations below point to it.

## Required infrastructure

The current project uses Firebase Spark static Hosting, Google Authentication, Firestore and an Apps Script email worker. Static Hosting cannot run a Node scheduler. [Firebase documents that Spark excludes Cloud Run and other paid Google Cloud features](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans). Do not enable billing or deploy Functions/Cloud Run as part of this procedure without separate approval.

An existing always-on host running Node 24, persistent storage and a public HTTPS origin are needed. There are two supported arrangements:

1. One host, any number of API/collector processes, one shared SQLite file on persistent **local** disk. This requires no additional database service. All processes must point to the same absolute file, and it must survive releases/restarts. Network filesystems and separate replica volumes are unsupported.
2. Multiple hosts, all using one authoritative Redis service/database/namespace. Use TLS/private networking, authentication, persistence (AOF with durable writes), and `maxmemory-policy noeviction`. No key TTLs or flush-on-deploy jobs. Do not use independent regional primaries or caches that can evict coordination state. This service must already exist or receive separate infrastructure approval; no Redis service was provisioned here.

Measured payloads are approximately 28 MB auction JSON, 7.9 MB Bazaar JSON and 0.4 MB item catalog. Redis and Node need additional memory for parsed objects, in-flight pages and temporary publication copies; those JSON sizes are **not** memory capacity estimates. Measure peak resident memory on the selected host under load before setting process limits.

Apps Script's cache is unsuitable as the durable auction store: [Google limits individual values to 100 KB, has a 1,000-entry cap, and permits early eviction](https://developers.google.com/apps-script/reference/cache/cache). Using it for five-second visitor polling would also consume [URL Fetch/execution quotas](https://developers.google.com/apps-script/guides/services/quotas) needed by the email worker. No new Apps Script trigger, Firestore market collection or paid Google product is required by this implementation.

## Configure and start the service

Use Node 24 (verified with 24.19.0), then run `npm ci` and `npm run build:collector`. The generated entrypoint is `.local/collector-runner.mjs`. Keep the repository's `node_modules` beside it because server packages are external to the bundle.

Set server environment variables through the existing host's service manager. Example for one Linux host:

```dotenv
NODE_ENV=production
MARKET_STORE=sqlite
MARKET_CACHE_FILE=/var/lib/bazaarsignal/current-market.sqlite
COLLECTOR_HOST=127.0.0.1
COLLECTOR_PORT=8787
COLLECTOR_ALLOWED_ORIGINS=https://bazaarsignal.web.app
HYPIXEL_REQUEST_LIMIT=120
HYPIXEL_WINDOW_MS=300000
HYPIXEL_RESERVE=0.20
MARKET_BAZAAR_MS=60000
MARKET_AUCTION_MIN_MS=120000
MOJANG_REQUESTS_PER_MINUTE=30
```

For multiple hosts, replace the SQLite settings with `MARKET_REDIS_URL` pointing every instance at the same Redis database. Never place Redis credentials or an optional server-side `HYPIXEL_API_KEY` in VITE variables, client bundles or source control. Reserve at least 20% when adjusting the upstream ceiling; the default is a local planning limit, not an asserted Hypixel allowance. Account for any other application using the same key or outbound IP.

Launch `node .local/collector-runner.mjs` with the repository as its working directory under the existing service supervisor, with automatic restart. Proxy its port through the host's existing HTTPS setup. Keep backend storage ports private. Configure exactly the needed production/preview origins. Multiple copies of the service may run only when they use the same store, budget settings and policy.

The scheduler runs without visitors. Cold reads return an explicit warming/error response until the first complete snapshot exists. Monitor `/api/companion/status`: both feeds should have current `upstreamAt` timestamps; auction `pages`, `durationMs`, `intervalMs`, `nextAt`, errors and the shared request ledger are reported. No status/read endpoint forces collection.

## Connect the existing website and alerts

1. Wait for valid current Bazaar and complete auction snapshots. Check `/api/companion/bazaar`, `/api/companion/auctions` and `/api/companion/raw-bazaar` through HTTPS. A first read must never cause a new Hypixel refresh.
2. Set `VITE_MARKET_API_URL` to the shared HTTPS origin before building the frontend. Keep all existing Firebase/Auth/Apps Script configuration. The frontend refuses to download Hypixel data directly if this is missing.
3. Add `MARKET_API_URL` with that same HTTPS origin to the **existing Apps Script project's Script Properties**. This is separate from `VITE_MARKET_API_URL`. Preserve the signing key, sender account, existing properties, web-app URL and `scheduledPoll` trigger.
4. Build the website and Apps Script bundle (`npm run build`). Update the existing versioned Apps Script deployment only during an authorized rollout, preserving its URL. Browser public prices and books use the shared API directly, preserving Apps Script quota for private operations. The new script reads cached prices from `raw-bazaar` for alert validation/evaluation; it does not call Hypixel. Cached prices are obtained outside alert mutation/email delivery locks. Stale prices defer evaluations; queued confirmation/delivery work still runs if market reads fail.
5. Use the existing Firebase preview procedure in `SETUP.md`. Verify current/stale data, browser visibility behavior, seller commands, item links, authentication, private watchlists, quantity-aware quotes and target editing before any authorized promotion. Existing alert-account refresh controls remain; market refresh controls do not.

Do not leave the old Apps Script upstream-fetching deployment in use alongside the new collector after rollout: all production market readers must use the same cache. Do not deploy the legacy `functions/` implementation or the archived history collector as another market source.

## Verification performed and remaining deployment checks

Locally verified:

- 111 deterministic unit/handler tests, including 100 independent collector instances and eight separate OS processes.
- A 43-page fixture consumed 46 requests on initial collection. 1,200 additional simulated user reads/actions consumed zero Hypixel requests.
- Cache misses/eviction, budgets, 429/Retry-After, transport retries, mixed/failed pages, lease expiry, host clock skew, atomic publication and recovery.
- Ten desktop/mobile companion browser checks, ten production-build browser checks, two authenticated alert emulator checks, 18 broader app browser checks and 15 Firestore/security/backend checks.
- Existing handler tests preserve quantity-aware pricing, Google identity isolation, target revisions, email delivery retries and deduplication. No live user records or emails were changed by verification.
- Website, Apps Script and standalone collector builds; screenshots of desktop/mobile current and stale states.

SQLite is verified against real independent connections and OS processes. The Redis adapter's Lua and TypeScript build successfully, but a real Redis integration test was not run because no test service was available. Before selecting Redis for deployment, run concurrency, restart and persistence checks against a disposable instance with the intended persistence/eviction settings. Production host capacity, DNS/TLS and live alert delivery remain rollout checks; none is claimed as already verified.

Browser test builds use the mock origin `https://market.test` (set `VITE_MARKET_API_URL` for that build). Never deploy that build. Rebuild using the actual approved HTTPS origin before creating a release.

## Operations, configuration changes and recovery

Defaults select 60-second Bazaar refreshes and, with the measured 43 auction pages, a 145-second auction planning interval. Full fetching took about 16 seconds in a successful live pass. Budget pressure, cached-page inconsistencies or throttling can increase that interval. After 180 seconds, comparisons are withheld while the last complete snapshot remains visible. See [request accounting and measured usage](MARKET.md#budget-cadence-and-measured-usage).

`npm run measure:market` reports a normal scheduler pass and writes `.local/market-measurement.json`, using the same configured store and request budget. Another running instance may own the lease; zero new requests in that case is expected. Never run measurement with a fresh independent ledger against the same upstream allowance.

Policy mismatches fail closed. To change budget/interval settings, stop **all** collectors, wait at least the larger of the old/new budget windows after the last request, set the new environment consistently, and run `npm run configure:market`. It refuses an active lease or an unexpired budget and preserves source snapshots, counters and cooldowns. Restart all instances with the matching settings. Do not delete the control record to work around this check.

On a process crash, the shared lease expires and the next worker resumes due work; an old worker cannot publish. During upstream failure, preserve the store and let bounded retries recover. During a storage outage, requests/collection fail closed and Redis reconnection backs off. Do not erase/evict the coordination ledger. If storage is lost entirely, stop all workers and wait out the upstream budget and any known Retry-After before rebuilding; a data-loss restore is an operational recovery, not a normal cache expiration.

Rollback must preserve the database, signing keys, identities and alert records. Roll back frontend/backend/service versions together to a verified compatible deployment. Reinstating the old browser worker would restore per-user Hypixel traffic, so prefer a cache-unavailable state to a direct-upstream fallback. No rollback should enable billing, delete history files, or change the existing email trigger.
