# Paid portfolio performance review

> Historical record. Dates, deployment versions, service status, costs and approvals below apply only to the recorded work. They are not current setup instructions or authorization to operate services. See the [documentation index](../README.md).


October 13, 2026. Two small changes remove unnecessary paid-pilot presence traffic and reuse the existing bounded snapshot cache across requests in one warm runtime. The 12-visit offline workload uses 67.6% fewer market requests and 62.2% fewer Firestore reads. These are operation reductions, not reductions in the total Google bill. Existing local work was preserved. This review initially covered local validation; the later authorized [active paid deployment](PAID-PERFORMANCE-DEPLOYMENT.md) succeeded at approximately 20:13 EDT.

## External review and applicability

Reviewed challenge main commit `026bdb68d94d0d932bb5981321ad82c70618d752`, its implementation, API contract, correctness tests, and load generator. At review time, [PR 1](https://github.com/arjaythedev/twelve-dollar-server-challenge/pull/1) was merged; the reviewed PRs 4, 25 and 51 were open. A merge is not a published official benchmark result.

The [challenge methodology](https://github.com/arjaythedev/twelve-dollar-server-challenge/blob/026bdb68d94d0d932bb5981321ad82c70618d752/README.md) uses one vCPU and 2 GiB, a separate load generator, a two-minute warm-up, and a five-minute confirmation hold with latency/error limits. Its [actual k6 loop](https://github.com/arjaythedev/twelve-dollar-server-challenge/blob/026bdb68d94d0d932bb5981321ad82c70618d752/bench/load.js) reads a feed and a post with think time, likes with 15% probability, and creates with 2% probability. That workload cannot establish capacity or costs for our hourly Firebase/Cloud Run portfolio app. We adopt repeated identical workloads, warm/cold separation, concurrency, and correctness checks, using our own operations and data shapes.

| Adopted principle and external source | Application here |
| --- | --- |
| Avoid unnecessary hot-path work. The [merged FastAPI implementation](https://github.com/arjaythedev/twelve-dollar-server-challenge/blob/026bdb68d94d0d932bb5981321ad82c70618d752/submissions/python-fastapi-cknutson12/app.py) avoids response-model processing and performs the extra post-existence query only when an insert did nothing. | The paid presence endpoint accepts and discards demand while hourly collection runs independently. Skip its browser lifecycle before token retrieval, timers, CORS preflight, enter and leave calls. This applies the principle; the challenge has no portfolio-presence feature. |
| Reuse process resources while keeping authority current. The [merged implementation](https://github.com/arjaythedev/twelve-dollar-server-challenge/blob/026bdb68d94d0d932bb5981321ad82c70618d752/submissions/python-fastapi-cknutson12/app.py) retains its connection and statement cache; [open PR 51](https://github.com/arjaythedev/twelve-dollar-server-challenge/pull/51) also prepares statements once and verifies JWTs on each request. | Instantiate the existing `SnapshotReadCache` once inside `createPaidRuntime` and pass it to each request's collector. Keep each store, session, budget admission and control read independent. |

The second adaptation deliberately differs from the challenge: its rules prohibit caching data across requests. Our published market snapshots are immutable and versioned, making payload reuse appropriate. This is a BazaarSignal measurement, not a technique or speedup validated by that competition. PR 51's high-user-count figures, [PR 4's Bun results](https://github.com/arjaythedev/twelve-dollar-server-challenge/pull/4), and [PR 25's Zig group-commit results](https://github.com/arjaythedev/twelve-dollar-server-challenge/pull/25) are authors' local evidence on different hardware or generators, not official droplet scores. Their code was inspected; their benchmarks were not rerun.

## Workload and reproducibility

The [workload](../../tests/paid-performance.test.ts) runs the real paid handler, ledger, collector and Google REST adapter through [an offline fixture](../../tests/support/paid-runtime-fixture.ts). All upstream networking is blocked. Atomic document preconditions, successful writes, failed write attempts and blob downloads are counted. No cloud credentials, production reads, email or load tests are used.

The synthetic snapshot contains 1,000 Bazaar items with twelve levels on each side of each book, both normalized and raw representations: **2,573,743 JSON bytes**. Each view requests ten holdings; three overlapping asset sets repeat. Price replies use the existing gzip path. The inline format matches the paid pilot; legacy blob reads are a separate compatibility scenario. Fixture generation and compression happen outside request timers.

Each server scenario has three discarded warm-up workloads and 21 measured workloads. Sequential scenarios contain twelve requests; concurrency contains twelve pairs, matching the deployed concurrency of two. “Cold” means a new runtime per request, excluding process boot and Cloud Run startup. Invalidation replaces the generation after six requests, including a changed version with an unchanged timestamp. The visit scenario additionally exercises the real browser presence function for twelve short enter/leave cycles and models one cached preflight; the preflight is an explicit workload assumption, not a browser measurement. Its counts are deterministic and it is not used for timing claims.

Run from the repository in PowerShell with Node 24 and installed dependencies:

```powershell
$env:PAID_BENCH_OUTPUT='.local/paid-performance-repeat.json'
node node_modules/vitest/vitest.mjs run tests/paid-performance.test.ts
Remove-Item Env:PAID_BENCH_OUTPUT
```

The [baseline](../measurements/paid-optimization-before.json) was captured before either production edit; the [final run](../measurements/paid-optimization-after.json) used the identical workload and fixture hashes. Both include source hashes, all timing samples, operation counts, runtime and platform. The before-source copies remain in `.local/paid-optimization-before/`; for a baseline replay use those two production files in an isolated copy of the workspace. Do not reset the existing working tree. The benchmark is opt-in and skipped by ordinary unit tests.

## Measured results

Reductions use `(baseline - after) / baseline × 100`. Counts include admission and completion accounting unless specified. Bytes are response bodies, excluding HTTP/TLS headers. Timings are local handler elapsed times on Windows/Node 24.19.0 with in-memory transport and real parsing, decompression, freezing and response serialization; they are not network or page-load timings.

| Optimization and scope | Baseline | After | Reduction | Meaning for normal use |
| --- | ---: | ---: | ---: | --- |
| Remove paid presence, 12 visits | 24 POST + 1 OPTIONS | 0 | 100% | No budget work for entering/leaving a portfolio; 24 token API calls also disappear. Token calls are not assumed to be network refreshes. |
| Both changes, total market requests for 12 visits | 37 | 12 | 67.6% | Only the assumed twelve uncached price requests remain. |
| Both changes, Firestore reads for those visits | 98 | 37 | 62.2% | Removes presence accounting and eleven repeated payload reads. |
| Remove presence, Firestore writes for those visits | 74 | 24 | 67.6% | Price-request admission and completion still write normally. |
| Reuse snapshot, twelve requests in one warm runtime | 12 payload loads; 48 total reads | 1 payload load; 37 total reads | 91.7%; 22.9% | One load/decode per generation, while every request reads current control and budget. |
| Reuse snapshot, 24 requests in concurrent pairs | 24 payload loads; 108 total reads | 1 payload load; 86 total reads | 95.8%; 20.4% | Concurrent readers share payload work. Successful writes remain 48; attempted writes rise 60 to 61 due to one extra CAS conflict in this interleaving. |
| Invalidate on publication, twelve requests/two generations | 12 payload loads | 2 | 83.3% | The new generation is loaded immediately when its durable identity changes. |
| Legacy blob compatibility, twelve warm requests | 12 downloads; 1,937,244 bytes | 1 download; 161,437 bytes | 91.7% | Also helps older blob snapshots; the paid inline workload starts at zero blob downloads, so its blob reduction is **not applicable**. |
| Warm-runtime handler median, 252 measured requests | 22.93 ms | 0.66 ms | 97.1% | Avoids repeated decoding of 2.57 MB. The first request still loads; p95 is 31.37 → 21.89 ms. |
| Cold-runtime handler median, 252 measured requests | 21.73 ms | 21.25 ms | 2.2%, within noise | Counts remain 12 payload loads and 48 reads. No cold-start improvement is claimed. |
| Price response bodies for twelve requests | 15,220 bytes | 15,220 bytes | 0% | Price data, gzip and valuation inputs are unchanged. |
| Total response bodies including presence | 15,628 bytes | 15,220 bytes | 2.6% | Presence is mainly request/accounting waste, not a large payload. |
| Upstream calls from any browsing scenario | 0 | 0 | not applicable | Opening pages and refresh controls still cannot collect prices. |

The 21 per-workload median interquartile ranges are 22.48–24.19 ms before and 0.59–0.74 ms after for warm reads, supporting a local processing improvement. Cold ranges overlap: 21.13–22.93 and 21.11–21.99 ms. Counts are stable across measured repetitions. Simultaneous-client median latency is 45.28 → 1.24 ms, but no production latency percentage is inferred.

## Practical effect and budget

Pages make fewer background calls, and warm uncached price requests perform less CPU and storage work. The existing browser cache already avoids repeated same-slot price GETs, so this workload intentionally represents cache misses or distinct clients. A user repeatedly opening the same portfolio in one cached tab may save only presence calls. Cloud Run instances can disappear; snapshot reuse helps only while the same instance survives and serves the same generation. Persistent decoded snapshots trade bounded retained memory for less repeated allocation. The existing limit is 48 MiB of JSON weight across the three allowed snapshot keys, not an exact V8 heap limit; one generation per key can be loading, and oversized entries are not retained.

**Illustrative full-month model:** twelve short visits in one generation window per day, ten holdings per view, distinct/uncached price clients, one reused server instance, one preflight per day, and 31 days. This removes 775 market requests, 1,891 reads and 1,550 successful writes. The measured browser reservation increment would be $0.643519 before versus $0.208709 after: about **$0.434810 more application reservation headroom**. The current fixed pilot ends November 1; this model is not a renewal or a forecast of actual traffic. Longer visits, more preflights, browser-cache hits, generation changes and runtime churn change these counts.

These dollar amounts use the app's existing conservative reservation formula, not billed spending. Snapshot reuse alone leaves reservations unchanged because each price request retains its original envelope. Hourly collector/email work, the fixed reserve, deployments, storage and platform startup costs remain. Actual Google charges and the total bill reduction are unknown; the $5 target and $4.50 application stop are unchanged.

Source timestamps never advance on a cache hit. Current control errors and stale status remain current. Lowest ask before fees, value, P&L and return calculations use the same data. Hourly price collection, hourly email checks, stale-price alert protection, the daily Admin scan schedule, owner authorization, opt-ins and unsubscribe behavior retain their existing paths. The paid presence endpoint remains budgeted for old clients; updated clients simply do not call it.

## Verification and remaining limits

New regressions cover concurrent requests with separate budget holds, cold/store isolation, changed generations, failed replacement and retry, current errors, stale alert ineligibility, ask-based valuation and holding edits, owner stop, exhausted budgets, both deadlines, old presence clients, force-refresh rejection, paid browser enter/leave behavior, preserved authenticated free-tier presence, and hourly client-cache reuse. Existing snapshot tests verify frozen values, byte bounds, eviction, pending-generation isolation and failed-load retry.

Verified locally:

- Full unit suite: 479 passed, one opt-in benchmark skipped, including 12 new focused regressions.
- Firestore emulator suite: 30 passed, including ownership/schema, persistence, atomic publication and concurrency.
- Frontend/Apps Script build, collector build and market-functions build: passed. Existing Vite native-loader and large-chunk advisories remain.
- Identical before/after workload: passed with zero upstream calls and no shutdowns.
- Desktop/mobile Playwright journeys against isolated Auth/Firestore emulators: 24 passed, covering private records, holdings, purchases, notifications, migration, charts, Settings/unsubscribe, owner Admin and absence of page-triggered scans. Paid presence and hourly client behavior are additionally exercised by the new unit regressions; the browser suite uses its existing paused-release configuration.

These local tests do not measure real Cloud Run startup, heap/RSS, network RTT or Google invoices. No production state was changed during the local review. The subsequent [deployment report](PAID-PERFORMANCE-DEPLOYMENT.md) records the guarded rollout and minimal production smoke checks separately.

## Techniques rejected

- **SQLite tuning, mmap, native event loops, Bun/Zig/C++ rewrites, direct serving without Nginx:** tied to the challenge's fixed VM/database; do not fit managed Firebase/Cloud Run or justify a migration.
- **Group commit of budget writes:** open PRs 25/51 amortize SQLite commits. Firestore still charges document operations, and delaying/combining authoritative admission would complicate failure and shutdown behavior. The measured concurrent case retains its safe CAS retries.
- **Cached authorization, budget state, freshness or complete responses:** could conceal revocation, a stop, expiry, current errors or stale prices. Only immutable public payloads are retained.
- **Manual JWT verification, GC tuning, compiled JSON serializers:** add risk or complexity without a demonstrated bottleneck in this app. Keep Firebase verification and the existing response path.
- **Additional payload projections, indexes or services:** holdings already share one compact gzip price request and browser slot caching. The measured twelve replies total only 15.2 kB. Further schemas/caches or paid services need evidence beyond this workload.

The optimization implementation consists of two production edits plus regression tests, the repeatable workload and this evidence. The later release added an active paid deployment path and its own safety regressions; optional optimizations remain deferred.
