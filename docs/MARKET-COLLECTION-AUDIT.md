# Market collection resource audit — October 3, 2026

**Recommendation: keep the hourly configuration and its existing slowdown. Thirty-minute operation is not ready.** Safe optimizations were implemented and verified locally during the audit. At audit completion, no commits, pushes, deployments, schedule changes, billing changes, alert creation or email sends had been performed. Production evidence was obtained through read-only administrative APIs; tests never invoked production handlers. The user subsequently authorized committing, pushing and deploying these optimizations under the existing hourly profile; release evidence is recorded separately in local deployment receipts.

The source baseline is `de9173bf292b7fd895611d2cd6bc764cc87a19b6`. The checkout was clean before this work. The fixed operating period is October 1 at 11:47:34 PM Eastern through **November 1, 2026 at 2:00 AM Eastern** (`2026-11-01T07:00:00Z`). There is no period renewal in this change.

## Evidence and its scope

- `.local/market-audit/state.json`: ledger, control, Scheduler and bucket metadata read October 3 at **9:32:17 PM Eastern**. Two Firestore reads, one Scheduler get and one bucket metadata get; no writes or handler invocations.
- `.local/market-audit/meters.json`: direct read-only measurement at **9:39:42 PM Eastern**, using the existing measurement adapter without its cache writer. Includes two more collector-project document reads, one existing alert-worker control read, and bounded Monitoring/inventory reads. No collection, worker execution, cache invalidation or billing API mutation.
- `.local/recovery-free-20261001-usage-budget-repair-apply.json`: prior ledger at October 2, 10:56 PM Eastern. The audit preserves this earlier evidence and compares counters over the interval, not as individual-run costs.
- `.local/zero-cost-backup/{catalog,election,bazaar,auctions}.json.gz`: complete saved normalized snapshots. The auction snapshot contains **39,712 listings**, Bazaar **2,197 products**, catalog **5,655 entries**. They are approximately 28.0 MB, 7.87 MB and 0.40 MB decoded JSON; 4.99 MB, 1.03 MB and 0.082 MB compressed.
- `.local/local-trial-20261001a/report.json`: earlier per-request measurements and complete publication records. Its 94 auction requests averaged **2,489,591 decoded bytes/page**, maximum **2,818,471**. This is a useful payload-size sample, not a new production test.
- `.local/market-audit/{before,after,projection}.json`: reproducible offline measurements and arithmetic. Original saved files are never edited. No secrets or private account records are included in these results.

Provider counters lag and have different periods from the app ledger. Document operation attempts are distinct from successful writes and settled billing. Local CPU and resident memory are process measurements on Windows/Node 24, not Cloud Run billable usage. The report does not divide cumulative counters by one run or double unrelated browser, Hosting or alert traffic.

## Operational baseline

| Component | Verified behavior |
| --- | --- |
| Scheduler | Enabled, `0 * * * *`, UTC, zero scheduler retries. Last observed attempt `2026-10-04T01:00:18Z`. |
| Admission | Durable CAS on `live-allowance`; one collector per UTC hour, including failed/admitted attempts. An invocation reserves before session work. Duplicate hour admission does not collect. |
| Slowdown | Any daily or period reservation at 65% suppresses odd UTC hours; 50% gives warning. Seller reservations are **326/500 = 65.2%**, so the current effective opportunity interval is two hours. The temporary hourly exemption ended October 3 at 8 PM Eastern; its 95% skip guard remains unchanged. |
| Due jobs | Bazaar, auctions and election hourly; catalog daily. Successful due times align to UTC hours. Jobs already deferred by backoff remain deferred. |
| Ownership | 60-second renewable owner lease, durable charge before each physical upstream request, compare-and-swap publication of control and private snapshot pointer. Uploads precede atomic pointer publication. |
| Configured upstream limits | 120 requests per rolling five minutes, 20% reserved for retries; routine capacity 96. Actual header limits, `Retry-After`, global cooldown, max two retries, 12-second request timeout and bounded jitter/backoff remain enforced. Saved responses have no numeric rate-limit headers, so the provider's independent account cap is not measured here. Auction pages are fetched in groups of three and drained on failure. |
| Complete auction snapshots | Every page must agree on generation, total pages and total auctions; IDs must be unique and counts complete. Structural page ceiling 200 is not an admission guarantee: remaining routine capacity must fit the full snapshot. |
| Freshness | Three-minute source freshness. Complete older samples can be displayed with their timestamps and stale status; actionable comparisons, seller commands and alert evaluation retain their freshness checks. Thirty-minute sampling would still be stale most of each interval. |
| Compute | Collector: 1 vCPU, 1 GiB, max one instance, concurrency one, 90-second handler limit. API: same CPU/memory and max instances, concurrency two, 15-second handler limit. Both have zero minimum instances. |
| Snapshot transport | Gzip upload/download, max 8 MiB compressed object, max 64 MiB decoded download. Session upstream body ceiling 128 MiB, per-Hypixel-response ceiling 16 MiB. Public response max 8 MiB before optional gzip. |
| Cleanup | Durable daily slot; reserve four listing pages before listing. Current objects and objects younger than ten minutes are retained. Private cache bucket is Standard in `us-central1`, versioning disabled, soft-delete retention zero. |
| Browsing/alerts | HTTP routes only read snapshots. Force/refresh parameters are rejected. Existing client caching, ETags, visibility-aware polling and CORS remain. Alert bridge permits at most one shared raw-Bazaar download/hour, with a durable failed-attempt marker and a :01:30–:02:30 freshness window. It does not collect. |
| Owner reporting | Separately authenticated, private, no-store endpoint; durable 30-minute report cache and per-process owner throttle. Its reads, authentication and runtime are outside market admission reservations. |
| Deadline | Admission, session reads/writes, upstream signals, response handling and existing shutdown paths retain the fixed deadline. No counter reset or refund is introduced. |

The two-hour opportunity is not a promise of successful collection. The latest saved auction job retained a previous complete snapshot after `Auction snapshot changed during pagination; previous cache preserved.` Its last successful duration was 28.466 seconds; the latest failed attempt took 19.031 seconds. Successful Bazaar took 1.419 seconds, election 0.224 seconds. These are individual job wall times, excluding admission, all other work and startup.

## Consumption versus reservations

Current app observations are cumulative since the live period began, and can omit work from invocations that did not finish accounting. Reservations deliberately survive those failures. `control.totalRequests = 1,899` has an older lifetime scope than the live ledger's observed 1,158 requests; their difference is not a per-run charge.

| Resource | Live app observations, cumulative | Current app reservation | App limit |
| --- | ---: | ---: | ---: |
| Collector work | 33 acquired leases; 23 complete auction snapshots, 10 failed auction refreshes | 35 admissions | 744 / operating period |
| Browser/API | 109 HTTP 200, 28 HTTP 503, 49 preflights, 3 HTTP 304, 1 HTTP 404 | 191 requests | 2,000 / period |
| Upstream | 1,158 physical requests; 2,873,461,560 decoded response bytes | 3,360 requests | 75,000 / period; 128 MiB decoded/session |
| Firestore | 9,610 attempted reads; 4,818 attempted writes, cumulative across days | 16,492 reads; 6,600 writes **today** | 30,000 reads; 12,000 writes / Pacific day |
| Snapshots | 58 uploads, 150,758,970 compressed bytes | 140 uploads | 3,000 / period |
| Storage A/B | 60 A; 274 B | 148 A; 2,088 B | 3,200 A; 32,000 B / period |
| Storage downloads | 439,352,650 compressed bytes | 17,515,413,504 bytes | 512 GiB internal gross transfer / period |
| API body transfer | 33,592,550 bytes | 37,745,142 egress bytes | 553,566,958 bytes / period |
| CPU / memory time | Not measured by this ledger | 7,320 CPU-seconds; 7,320 GiB-seconds | 110,000 CPU-seconds; 250,000 GiB-seconds |
| Handler runtime | 1,063,213 ms across completed handlers; not CPU or all billable time | Covered by invocation holds | Handler limits above |
| Cleanup | 2 runs, 2 listing pages, 39 object deletes | 2 runs, 8 listing pages | 31 runs, 124 listing pages |
| Seller lookups | No corresponding count in the saved observed map; this is not proof of zero lifetime activity | 326 requests | 500 / period |
| Logs | Not measured by session logging-byte holds | 7,716,864 bytes | 512 MiB / period |

The prior-to-current interval contains **17 additional collector admissions, 17 leases, 17 Bazaar refreshes, 12 complete auctions and 5 auction failures**, plus 28 browser admissions. Its 4,804 observed document reads, 2,491 attempted writes, 596 upstream requests, 91 downloads and 462,414 handler milliseconds are **mixed interval totals**, not per-collection measurements. All upstream HTTP replies recorded in that interval were 200; completeness failures still occurred.

Google's measurement at 9:39 PM reports complete counter hours through **9 PM Eastern**. Daily document counters start at Pacific midnight; monthly counters use the dashboard's Pacific calendar window:

| Provider measurement | Observed | Published allowance / interpretation |
| --- | ---: | --- |
| Collector-project Run | 337 requests; 1,445.57 CPU-seconds; 1,445.57 GiB-seconds | 2 million requests, 180,000 vCPU-seconds, 360,000 GiB-seconds/month, request-based; shared benefit |
| Run network | 247,502,384 gross sent bytes | Destination split unknown; compare conservatively with eligible 1 GiB North American Internet allowance |
| Storage | 80 selected A, 283 selected B; 447,849,508 gross sent bytes | 5,000 A, 50,000 B/month; eligible regions/account scope |
| Storage capacity | 13,788,773 bytes latest reported | Capacity sample, not accumulated uploads or GB-months; eligible allowance 5 GB-months |
| Collector Firestore today | 5,109 reads; 1,421 writes; 43,333 bytes capacity | 50,000 reads, 20,000 writes/day; 1 GiB capacity; free eligible database |
| Main app Firestore today | 710 reads; 1,872 writes; 37,332 bytes capacity | Separate project/database, not doubled with collection frequency |
| Logs | Collector project 1,392,792 bytes | 50 GiB/project/month ingestion benefit; main-project source not reported |
| Scheduler / builds | One job; zero elapsed regional build minutes reported | 3 jobs/month shared; eligible build benefit 2,500 minutes/month; local work created none |
| Images | Repository storage-cost size 51,839,482 bytes | Shared 0.5 GiB-month; not the unsuitable older Monitoring image gauge |
| Hosting | 832,809,241 bytes stored; 37,056,589 transferred | Existing Spark project, 10 GiB storage / monthly transfer enforcement; no new deployment |
| Auth / mail | 2 active identities reported; saved mail quota consumption 0 | Separate activity, not a forecast of mail sent |

Provider operation counts are partial reported usage, not invoices. [Firestore bills documents, not merely RPCs, and resets daily around Pacific midnight](https://cloud.google.com/firestore/pricing). [Run's request-based monthly CPU, memory and request allowances](https://cloud.google.com/run/pricing) have account scope. [Storage allowances, operation classes, and free same-location transfer](https://cloud.google.com/storage/pricing) do not make gross bucket-to-Run bytes Internet egress. [Other free-tier scopes](https://docs.cloud.google.com/free/docs/free-cloud-features) remain separate.

Standing missing measurements: per-invocation Cloud Run billing/startup, true peak/integrated cloud memory, network destination eligibility, complete other-account-project usage, actual spending records, current Firestore delete series, main-project log series, and Google-wide Apps Script URL Fetch/trigger-runtime consumption. The ledger's byte holds and worker runtime padding do not fill those gaps. Billing is not enabled or changed by this audit.

## Changes implemented and prioritization

| Priority | Change | Verified benefit and safeguards |
| --- | --- | --- |
| High | Reuse the exact Firestore read version for conditional commit | Removes the duplicate document read, not just an HTTP wrapper. `updateTime`/`exists:false` still gate the atomic batch. Read tokens are bounded and discarded on every commit outcome; stale/ABA/ambiguous outcomes never restore spend. Time is synchronized after the necessary read rather than reading control first for the same clock sample. |
| High | Serialize mutations belonging to one coordinator | Avoids three page requests repeatedly racing their own owner. Every charge/header still persists through shared CAS; external collectors are not protected by a process-only lock. Durable lease, rate-limit response updates and immediate cooldowns stay in place. Successful document writes remain the same; savings are fewer reads and failed write attempts. |
| High | Share bounded immutable decoded snapshots across API requests in one runtime | Coalesces downloads, decompression and JSON parsing. Four allowed market keys, one in-flight generation/key, 48 MiB retained serialized weight, eviction before replacement, oversized bypass, deep-frozen retained data. Coordination is reread before reuse; new publication identity invalidates even at the same timestamp. No auth/session/owner report/player-name data enters this cache. |
| Medium | Store immutable snapshot identity atomically in the job | New auction collection generations need not download old listings just to compare their version. Legacy controls fall back to payload reads. Equal identities still verify payload existence, allowing eviction recovery. The new field is internal and omitted from API status. |
| Medium | Skip Bazaar normalization for an already-published source + metadata version | Source success, shape and freshness are still checked; unchanged snapshots retain their original observation time. Changed metadata still normalizes and republishes. This adds CPU savings to the preexisting upload suppression. |
| Medium | Bound ordinary browser reservations to the route's actual maximum work | Work allowance changes from 64 reads/16 writes/8 downloads/64 MiB gross storage transfer to **8 reads/0 writes/1 download/8 MiB**. Each ordinary route uses at most one payload and three control/pointer reads; extra reads retain clock margin. The separate **100 reads/40 writes** accounting margin is unchanged. Seller routes retain all original reservations. No past amount is refunded. |

For ordinary browser requests the durable daily charge becomes **108 reads/40 writes**, previously 164/56. The eight-read cap remains enforced before transport; the route matrix tests cover cold misses, malformed input, unavailable items, stale checks, both status reads and preflight. A response larger than the initial 16 KiB egress reservation still extends durably before response transmission. CPU/memory holds stay 20/20, covering the configured 15-second API invocation and existing margin.

Collector holds remain **700 reads/296 writes, 100 CPU-seconds/100 GiB-seconds, 96 upstream attempts, four uploads/Class A, 16 downloads/Class B, 128 MiB gross storage reads and 128 KiB logs** per admission. Cleanup extends its own hold before listing. Lowering these just to fit frequency would shrink the enforced failure envelope. No such reduction was made.

Already present, not counted as new savings: gzip, browser ETags/304, client request coalescing, content hashes for catalog/election, unchanged auction-generation first-page probes, no-op CAS suppression, atomic immutable uploads and daily cleanup admission. Shared metadata caching existed inside a single collector; the live runtime previously discarded that collector at each API request.

Deferred opportunities: batching several physical page charges and headers into one document update could reduce **successful** writes but needs a separate protocol proving pre-I/O reservation and immediate out-of-order cooldown/header handling. Dynamic collector upload/request reservations require accounting for CAS losers, crashes, retries, metadata changes and extra ledger transactions. Removing diagnostic logs would reduce observability during the current failure rate. Eliminating one duplicate daily cleanup check saves roughly one read/day and is not worth expanding its publication/cleanup interface in this change.

## Offline measurements

`node scripts/run-market-audit.mjs de9173bf292b7fd895611d2cd6bc764cc87a19b6` bundles the original source with `git show`, then current local code, without switching branches or changing the checkout. The test transport cannot call a real service. It implements document preconditions, atomic batch publication, immutable blobs and gzip. Every modeled RPC advances a deterministic clock. CPU/wall timings use separate real process clocks.

Browser tests use the complete saved snapshots with timestamps shifted **in memory only** to exercise fresh listings. Collection tests use the real Bazaar/catalog plus a full-size synthetic auction set of 39,712 or 80,000 valid listings, including NBT decoding. Original raw NBT was not saved, so those synthetic auction payloads are substantially smaller/simpler than production. Their CPU, compression and memory figures cannot prove the 1 GiB cloud ceiling or justify smaller reservations.

| Workload / metric | Before | After |
| --- | ---: | ---: |
| 20 browser requests, document reads including ledger/egress extension | 200 | **92** |
| Same, successful document writes | 50 | **50** |
| Same, downloads | 20 | **2** |
| Same, compressed downloads | 60,212,050 bytes | **6,021,205 bytes** |
| Same, API body egress | 4,861,096 bytes | **4,861,096 bytes** |
| Same, reserved daily reads/writes | 3,280 / 1,120 | **2,160 / 800** |
| Same, local process CPU / wall | 7.453 s / 5.677 s | 3.735 s / 3.633 s |
| Cold 45-page collector core, document reads | 360 | **128** |
| Cold 45-page core, successful writes / attempted writes | 106 / 235 | **106 / 106** |
| Steady 45-page core, document reads | 349 | **116** |
| Steady 45-page core, successful writes / attempts | 101 / 230 | **101 / 101** |
| Steady 45-page core, downloads | 4 | **3** |
| Steady 45-page core, upstream / uploads | 47 / 2 | **47 / 2** |
| Cold 90-page core, document reads | 675 | **218** |
| Steady 90-page core, reads / successful writes | 664 / 191 | **206 / 191** |
| Steady 90-page core, attempted writes | 455 | **191** |
| Mixed generation at page 22, reads / successful writes | 211 / 60 | **76 / 60** |
| Same failed run, upstream / uploads | 27 / 1 (Bazaar) | **27 / 1 (Bazaar)** |

The mixed-generation case runs after complete publication, drains all three outstanding pages and proves the prior auction observation survives. Lower failure resource usage is not counted as a successful refresh. The core collection rows exclude live admission/finish, daily cleanup and responses; the browser rows include its live ledger. Planning below adds those costs.

Local steady 45-page CPU was 4.203→3.094 seconds, wall 1.667→1.461 seconds. Steady 90-page CPU was 10.172→7.578 seconds, wall 3.944→3.156 seconds. These are single-run observations on this host, not statistical performance guarantees. Whole-process high-water RSS reached **863,301,632 bytes (~823 MiB)** during the optimized larger-fixture process, including saved fixtures and prior scenarios. The cache's 48 MiB is serialized weight, not a promise of 48 MiB V8 heap. Cloud cold starts, concurrent readers and larger/more complex raw NBT remain unmeasured. No compute reservation was reduced from these timings.

## Thirty-minute projections

From the 9:32 PM evidence, there are **28.2276 days** left; the next half-hour slot is October 3 at 10 PM Eastern, with **1,354** half-hour opportunities before the fixed deadline. Full 31-day arithmetic is **1,488 collections**. Daily counters reset naturally; period reservations do not reset at a UTC or provider month boundary.

Scenario: 48 collections/day, 20 ordinary UI HTTP requests/day plus **up to 24 existing hourly alert bridge reads/day**. These are requests, not users; navigation/preflights consume the request count. The worker is not doubled. No seller lookups or additional owner reports are included; those require additional headroom. Cache hits receive no reservation refunds. The 29 possible remaining daily cleanup reservations fit exactly in the remaining cleanup/list slots and leave no extra cleanup slot margin.

| Resource | One day | Full 31 days, new work | End of operating period, current reservations + remaining work | Existing app limit |
| --- | ---: | ---: | ---: | ---: |
| Collection admissions | 48 | 1,488 | **1,389** | **744** |
| API/worker admissions | 44 | 1,364 | 1,434 | 2,000 |
| Run requests reserved | 92 | 2,852 | 2,823 | 1,400,000 |
| Firestore reads reserved | **38,352** | 1,188,912 across daily resets | Daily limit already fails | **30,000/day** |
| Firestore writes reserved | **15,968** | 495,008 across daily resets | Daily limit already fails | **12,000/day** |
| CPU-seconds reserved | 5,680 | 176,080 | **167,580** | **110,000** |
| GiB-seconds reserved | 5,680 | 176,080 | 167,580 | 250,000 |
| Upstream attempts reserved | 4,608 | 142,848 | **133,344** | **75,000** |
| Uploads reserved | 192 | 5,952 | **5,556** | **3,000** |
| Storage A reserved, including four list pages/day | 196 | 6,076 | **5,680** | **3,200** |
| Storage B reserved | 812 | 25,172 | 24,995 | 32,000 |
| Gross private storage download bytes reserved | 6.81 GB | 211.16 GB | 209.67 GB | 549.76 GB (512 GiB) |
| Logs reserved | 7.01 MB | 217.38 MB | 205.55 MB | 536.87 MB |
| Cleanup/list pages reserved | 1 / 4 | 31 / 124 | 31 / 124 | 31 / 124 |

The **collector alone** exceeds daily limits: 48×700 = **33,600 reads**, 48×296 = **14,208 writes**. Browser optimization cannot resolve that. The 744 collection-count cap is frequency-specific, but changing it alone would still fail at least five independent resource budgets. It has not been raised. The 65% slowdown already applies; preserving it precludes uninterrupted 48/day even before these projected hard-limit failures. Existing hourly opportunities may slow or skip as documented.

Expected physical operations are much lower than reservations, but cannot replace them without a proven smaller failure envelope. With 45 pages, modeled steady core operations plus admission/finish, daily cleanup/metadata allowance and 44 cold/uncached browser reads give about **5,988 document reads and 5,086 successful writes/day**; 31-day sums are 185,628 / 157,666 but quota enforcement remains daily. At 90 pages these become approximately **10,308 reads / 9,406 writes/day**. Failed CAS write attempts are reported separately: this report does not assume every failed write attempt was billed like a successful write.

Normal 45-page upstream work is approximately **2,257 calls/day**, **69,967/31 days**, or **63,667 additional calls** over the remaining period including one catalog check/day. A stress case where 5% of slots consume the full 96-request allowance is 2,375/day and 73,613/31 days, leaving little space under 75,000 for existing usage. At 90 pages normal work is 4,417/day and 136,927/31 days: that fails even on actual requests. A 30% mixed-generation failure scenario consumes fewer calls (~1,969/day) but yields only about 34 complete auction refreshes/day, not 48.

Payload growth is a separate hard limit. The saved real average page size implies about **112.0 MB** for 45 auction pages before Bazaar/catalog/metadata and retries; about **224.1 MB** for 90 pages. The 128 MiB per-invocation decoded upstream bound rejects the latter even though the synthetic 90-page test fits its much smaller payload. At the saved maximum page size, 45 pages alone require 126.8 MB; daily catalog + Bazaar or retries can exhaust 128 MiB. Limits remain enforced. The successful synthetic large case is not a claim that such a production snapshot can complete.

Existing hash suppression means normal publication is two market blobs/collection, not four. Assuming one changed catalog and one one-page cleanup per day, actual upload/list work is **98 A/day**, **3,038 A/31 days**, and **2,766 additional A** over the remaining period. That is beneath the 5,000 provider allowance but leaves little room under the 3,200 app budget for metadata changes, upload retries/orphans, prior use and reserved headroom. Current four-upload holds correctly account for the possible work and are not refunded when only two blobs change.

Using the real saved compressed payloads, new Bazaar+auction blobs total about **289 MB/day** at 48/day. Once-daily successful cleanup and zero version/soft-delete retention imply roughly one day's accumulation plus live/grace objects, comfortably below 5 GB for this sample. That is a retention model, not uploads equaling stored GB-months. Missed cleanups, larger objects, staging failures and source/deployment buckets require separate capacity monitoring. No storage setting was changed.

Egress can also bind independently of database operations. The measured UI mix averages **243,055 compressed bytes/request**. The saved raw-Bazaar bridge is **548,271 gzip bytes** or **3,766,326 plain bytes** before the small usage wrapper. Including existing 2 KiB response padding and collector 64 KiB holds, the scenario projects:

- With worker gzip: **21.26 MB/day**, **658.92 MB/31 days**, **638.08 MB total period reservations/estimated response holds**, exceeding the current **553.57 MB** app budget.
- Without confirmed worker gzip: **98.49 MB/day**, **3.05 GB/31 days**, **2.82 GB total period**, also threatening the eligible provider Internet allowance.

These are traffic-size scenarios, not measured invoices: Apps Script does not explicitly set `Accept-Encoding` here, the provider may add it, worker activity may be lower than 24 reads/day, and network destinations remain unclassified. The new snapshot cache reduces **internal** storage reads, not these HTTP response bodies. At 20 UI reads/day with no active worker traffic, this particular egress scenario is much smaller; the other hard-limit failures remain.

A normal 32-second collector wall-time scenario is ~1,536 allocated vCPU-seconds and GiB-seconds/day at 1 CPU/1 GiB. At 30% 90-second failed runs it becomes ~2,371/day (73,510 over 31 days), before startup, API/reporting/cleanup and other account work. These are sensitivity scenarios, not measured cloud forecasts. The **100-second durable reservation** preserves the failure/runtime envelope; lowering it based on local averages is unsupported.

## Verification

The final local test run is recorded in `.local/market-audit/validation.txt`: **291 unit/handler tests across 28 files and 22 Firestore-emulator tests across four files passed (313 total)**. Collector, market Functions, frontend and Apps Script builds passed. No production collectors, alerts, emails or browser automation against production were used.

- Unit/handler suite covers concurrent admission, crashed/ambiguous reservations, 65% slowdown and 95% temporary guard, budget exhaustion and Pacific/DST resets, response-size extensions, per-request authorization/private reporting, stale responses, deadline cancellation, and no collection from navigation/refresh routes.
- New optimization tests cover version reuse and ABA fencing, concurrent page charges, exhausted header allowance, expiry during upload, immutable and bounded cache entries, parallel/new-generation invalidation, failed download retry, distinct cache instances, same-time publication invalidation, all ordinary route envelopes and unchanged Bazaar normalization/metadata changes.
- Firestore emulator suite covers **100 competing Google-backed coordinators**, another **100 complete collectors**, atomic publication, stale CAS, upload failure, expired owner, and **60 concurrent cleanup attempts**, alongside private-data rules and backend tests.
- Full normalized snapshots, 45/90-page synthetic complete collections and mixed-generation failures are measured offline. Retry/429/timeout/byte-budget and deadline behavior are covered by the unit suite; no production latency or memory improvement is claimed.
- Collector, market Functions, frontend and Apps Script builds pass. Existing Vite extension/chunk-size warnings remain; no UI, alert, settings, target, calculation, authorization, delivery or schedule source was changed.

## Deployment and rollback procedure

Deploy only the optimizations under the **existing hourly profile**. This is not a half-hour configuration package. Preserve `MARKET_OPERATING_MODE=free-tier`, `MARKET_LIVE_ID=free-20261001`, original start/end, all limits and accumulated counters, `0 * * * *` UTC schedule, retryCount 0, 1 CPU/1 GiB, 90/15-second handler limits, concurrency and existing identities/IAM. Do not initialize a new ledger or use recovery flags to erase a stop. A naturally stopped or expired period needs a separately reviewed recovery decision.

1. Re-run the offline verification commands below. Refresh **read-only** state/meters immediately before planning; existing release guard requires evidence younger than 30 minutes. Capture current service revision/image names and the exact ledger, control policy, Scheduler, bucket and IAM state for rollback. The baseline available here is not fresh enough for later deployment.
2. Run `npm run build:market-image`; run `node scripts/verify-market-image.mjs .local/market-image-<new-directory>`. Both are local; the image builder installs pinned production dependencies locally and consumes no Cloud Build minutes. Save its printed directory/digest.
3. Prepare a new active-period release with `node scripts/prepare-usage-release.mjs .local/market-image-<new-directory> usage-market-optimization` after refreshing its expected `.local/live-state-latest.json` and `.local/usage-dashboard-measured.json` via the existing read-only operator scripts. The existing preparation utility defaults to **marketapi only**: edit the generated local `.local/usage-market-optimization-release.json` to set `services` to `["marketapi", "refreshmarket"]`. Review both services, captured original deadline/counters, new image digest and meter headroom. Do not copy stale audit meter values or enable its existing-overage exception.
4. Inspect with `node scripts/private-trial-release.mjs .local/usage-market-optimization-release.json`. With explicit deployment authorization, use the same command with `--apply`. The utility preserves live identity, refuses unreviewed changes, records receipts and updates only selected existing services. Do not use generic Firebase deployment (the repository deliberately blocks it), activate/recover scripts, or any schedule/billing mutation. No Hosting or Apps Script deployment is needed.
5. Verify unsigned/forged owner denial and private storage access using authorized read-only checks. Observe the **next naturally scheduled** admitted collection and ordinary usage evidence; do not force a collection, create an alert or send a test email. Confirm unchanged limits/deadline, nondecreasing counters, lease release, complete generation, expected document reads, cache misses/hits and peak cloud memory. A restart legitimately loses the memory cache.

Rollback: retain the two predeployment revisions/images. Restore traffic to each captured revision, for example `gcloud run services update-traffic marketapi --region=us-central1 --project=bazaarsignal-510305 --to-revisions=<captured-api-revision>=100` and the corresponding `refreshmarket` command. If the operator uses the reviewed REST path instead, PATCH only each service's traffic to its captured revision. Verify restored image/traffic and the unchanged schedule, identities, deadline and ledger; do not replay handlers or restore an old ledger snapshot. The added optional `snapshotVersion` field is backward-compatible; old code ignores it and later job updates replace it normally. Rollback discards in-memory caches and restores larger **future** browser holds; already reserved resources remain spent. If integrity/accounting fails, retain the existing protective stop instead of repeatedly resuming it.

Any future half-hour proposal must first demonstrate a bounded smaller reservation protocol (including failure paths), resolve the already-active slowdown without refunding uncertain usage, and establish network/CPU/memory headroom. It would require coordinated changes to scheduler cadence, admission slot identity, due-time alignment, browser/read slots and any intentionally changed alert schedule, remaining-collection headroom before Pacific reset **and the fixed deadline**, and the 744 frequency cap. Keep the three-minute freshness rule. No part of that frequency change is enabled here.

Reproduction from the repository root in PowerShell:

```powershell
npm test -- --reporter=dot
$env:JAVA_HOME = (Resolve-Path '.local/java21/jdk-21.0.12.1+1-jre').Path
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
npm run test:rules
npm run build:collector
npm run build:market-functions
npm run build
node scripts/run-market-audit.mjs de9173bf292b7fd895611d2cd6bc764cc87a19b6
node scripts/project-market-audit.mjs
```

The offline audit requires the existing `.local/zero-cost-backup` fixtures. `audit-market-state.cjs` and `audit-market-meters.ts` are optional **read-only cloud evidence** tools, separate from the offline replay. They require the existing authorized operator login; no credentials are printed or embedded in results. Do not treat old evidence as a new baseline after a later rollout.
