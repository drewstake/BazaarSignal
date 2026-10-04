# Free-tier infrastructure preparation — October 4, 2026

**Local preparation only; the supported production configuration remains paused.** No deployment, activation, billing/IAM change, production ledger write, upstream collection or email was performed. Unrelated workspace edits were preserved.

## Decision

Continuous 60–90-second Bazaar collection cannot fit the retained object-per-snapshot design: a 31-day month needs at least 44,640 or 29,760 uploads, respectively. Cloud Storage's 5,000 monthly Class A allowance is already smaller, before other users, operations and safety margins. Browser delivery changes cannot remove this storage constraint. Other independent budgets further restrict cadence.

Keep the existing shared collector/cache and conditional polling **disabled** until complete headroom is established. The new planner chooses the shortest interval satisfying every allowance and the existing application limits. Today's evidence returns `paused`; **no active interval, including hourly collection, is certified**. A different storage design would need its own measured costs and complete scopes, not another unverified published allowance.

## Read-only state and evidence

Inspection at **1:38:26 p.m. Eastern / 17:38:26 UTC** confirmed:

- `bazaarsignal`: billing disabled, no linked billing account. Static Hosting, Google authentication and private default Firestore remain separate from the collector project.
- `bazaarsignal-510305`: billing enabled. The billing-account project list returned only this currently linked project, with pagination complete. Former projects `hip-fusion-451104-t5` and `nail-salon-app-457601` remain unreconciled. Empty billing-change logs do not prove zero historical consumption.
- Scheduler `firebase-schedule-refreshMarket-us-central1` is **PAUSED**. `marketapi` has no public invoker binding. Both Run services retain request billing, 1 vCPU / 1 GiB, no configured minimum instances, maximum one instance, with 15/90-second API/collector timeouts.
- Three `us-central1` Standard buckets remain: market cache without versioning/soft delete; sources with versioning and seven-day soft delete; uploads with seven-day soft delete. Retained versions/deleted objects still consume storage.
- Artifact Registry has **90,717,025 bytes**, scanning disabled. Inspected Logging buckets retain default/required logs for 30/400 days. No resources, cloud builds, images or hosting releases were created.

The local preparation additionally gates off legacy queued-mail draining, scheduled workers, trigger installation and editor test sends. **This code is not deployed.** Available evidence cannot certify the sender's current production Apps Script trigger/mail state. Earlier source allowed queued mail despite disabled price evaluation. Verification of the deployed sender is a blocker; this task did not run or modify that service.

Receipts: `.local/trial-resources-2026-10-04T17-38-26-754Z.json` records 13 read-only inspection calls, including a log-list RPC. The initial `.local/usage-dashboard-measured.json` used for this assessment was generated 09:39:14 UTC, with most counters through 09:00 UTC. `.local/paused-cadence-inspect.json` preserves the ledger copied at 09:40 UTC. Saved data was not re-timestamped as current evidence. Audit calls also consume resources; missing audit/Monitoring totals are not zero.

Follow-up dashboard repair: an owner-requested read-only refresh at 18:37:58 UTC on October 4 confirmed Scheduler `PAUSED` and replaced the local report. Missing samples remain unknown; this partial report does not establish shared-account headroom or authorize collection. The local page now requests fresh readings when its durable 30-minute slot permits, rather than always labeling a saved file stale. SQLite admission is shared by the page and diagnostic CLI across tabs/restarts; failed slots are retained. Cloud reporting is GET-only, bounded to 32 requests per admitted measurement, and never runs automatically in the background. No production write or permission change was made. Retain `.local/usage-report.sqlite` when rolling back UI/reporting code so restart/rollback cannot erase the admission history.

Activation-access follow-up at 19:02:37 UTC: six bounded read-only calls succeeded using the existing owner login. Both former projects (`hip-fusion-451104-t5`, `nail-salon-app-457601`) are active project records with billing currently disabled and no linked account. Each returned a complete empty list of visible BigQuery datasets. Receipt: `.local/activation-access-20261004.json`. No additional read permission is indicated by these checks. Current unlinking does not establish historical shared allowance consumption; an absent export does not establish zero usage. The remaining audit is unfinished engineering work, not a demonstrated access problem for the owner to fix. Conditional approval to unpause once safe has been given; it does not establish headroom or waive the original restrictions on billing and permission changes.

## Allowances and headroom

Official documentation checked October 4. Amounts are published entitlements, **not available capacity**. Every row currently has **unknown verified headroom** because use is delayed, scope-incomplete or unmeasured. Capacity gauges are not byte-month integrals. Separate units/projects/windows are never combined into a percentage.

| Resource | Published allowance / eligibility / reset | Measured use, reservations and gaps |
|---|---|---|
| Run requests | 2,000,000/month, request billing, billing account | 419 measured; 261 app-reserved. Whole-account historical use incomplete. |
| Run CPU | 180,000 vCPU-s/month, Tier 1 equivalent, account | 1,644.174 allocation seconds; 8,340 reserved. Billed startup/rounding and other services unresolved. |
| Run memory | 360,000 GiB-s/month, same scope | 1,644.174 measured; 8,340 reserved, independent of CPU. |
| Run Internet transfer | 1 GiB/month within North America, account | 279,230,193 gross sent bytes; 45,492,952 reserved. Destination/exemption evidence missing. |
| Collector Firestore reads | 50,000/day, eligible default DB/project; around midnight Pacific | 203 measured; 1,996 reserved. Include index/rules reads and rejected/retried operations. |
| Collector Firestore writes | 20,000/day, same scope/reset | 133 measured; 776 reserved. |
| Collector Firestore deletes | 20,000/day | Missing series, not zero. Existing app limit stays **zero**. |
| Collector Firestore capacity | 1 GiB, documents plus indexes; no reset | 43,333-byte gauge; index/completeness evidence missing. |
| Collector Firestore transfer | 10 GiB/month; path-specific exemptions | Billed transfer unknown; retain conservative gross RPC bounds. |
| Owner Firestore reads | Independent 50,000/day | 116 measured; whole private-workload reservation incomplete. |
| Owner Firestore writes | Independent 20,000/day | 182 measured; other portfolio/account activity must fit too. |
| Owner Firestore deletes | Independent 20,000/day | Unknown, no reported series. |
| Owner Firestore capacity | Independent 1 GiB; no reset | 37,332-byte gauge; documents/index scope incomplete. |
| Owner Firestore transfer | Independent 10 GiB/month | Unknown; include all client/admin access. |
| Storage Class A | 5,000/month/account across eligible `us-central1`, `us-east1`, `us-west1` | 88 observed uploads/listings; 168 reserved. Other methods/projects/regions incomplete. |
| Storage Class B | 50,000/month, same scope | 313 measured; 2,190 reserved. Cold/missed caches still read objects. |
| Storage retained bytes | 5 GB-month/month, eligible regional Standard | 72,432,395-byte gauge, not integral; versions, source/uploads and soft deletes incomplete. |
| Storage transfer | 100 GB/month from North America to eligible destinations, excluding Australia/China | 497,372,805 gross bytes; 18,371,051,520 internal-gross bytes reserved. The 512-GiB internal app bound is **not** Internet allowance. |
| Scheduler | Three jobs/month/account, daily prorating over 31 days | One retained regional job. **Paused jobs count**; other regions/historical members unresolved. Execution compute is separate. |
| Build | 2,500 minutes/month/account; promotional `e2-standard-2` default pool only | Zero October minutes observed in two locations; full scope/machine eligibility unresolved. This work used local builds. |
| Artifact storage | 0.5 GiB-month/month/account | Current repository 90,717,025 bytes; integrals/other repositories unknown. Continues while paused. |
| Artifact transfer/scanning | Path-dependent transfer; scanning separately charged | Inspected scanning disabled; other paths/resources unverified. No new scan or transfer. |
| Collector log ingestion | 50 GiB/project/month, default 30-day retention | 1,555,513 reported bytes; 8,749,056 reserved. Include platform, rejection and system logs. |
| Owner log ingestion | Independent 50 GiB/project/month | Missing series, not zero. |
| Log retention | Extra retention separately priced; required audit logs exempt | Inspected buckets 30/400 days. Other buckets/sinks unverified; exemptions aren't transferable. |
| Monitoring | First 1,000,000 returned series/month/account; Google-provided metrics generally non-chargeable | Historical API reads unknown; queries have minimum read charges. Budget dashboards, audit and renewal work. |
| Hosting retained releases | 10 GB/project across sites/channels; capacity | 861,711,450 bytes in saved inventory; retained versions continue consuming space. |
| Hosting transfer | Pricing says 360 MB/day; Hosting guide says 10 GB/month | 61,350,587 observed bytes with incomplete period reconciliation. Require **both** windows until project entitlement is resolved. CDN hits count. |
| Google Authentication | Non-phone auth no-cost; Identity Platform separately 50,000 MAU, Spark Tier 1 3,000 DAU | Two reported users does not establish MAU/DAU/provider mode or request headroom. No SMS/SAML/OIDC upgrade. |
| Apps Script fetches | Consumer sender 20,000/24h, across scripts | Whole-account use unknown. |
| Apps Script trigger runtime | Consumer sender 90 minutes/24h | 10.16795 minutes is an app reservation, not account measurement; existing 70-minute protective budget retained. |
| Apps Script recipients | Consumer sender 100/day | Unknown across scripts; local sending/evaluation remain off. |
| Apps Script properties | Consumer sender 50,000 read/write operations/day | Unknown across scripts, including durable receipt work. |
| Apps Script capacity/execution | 500 KB property store; 20 triggers/user/script; six minutes/execution; 30 simultaneous/user, 1,000/script | Actual triggers/property capacity/other scripts unknown. Daily reset is 24h after first request. |
| Hypixel | Key-specific five-minute limits, response minute headers and global throttles | No guaranteed anonymous Bazaar/Auction rate or source-update SLA published. Current key/IP sharing and cadence unknown. Local 120/rolling-five-minutes with 20% reserve is an extra ceiling, not entitlement. |
| Seller / Redis / alternative hosts | No active seller routes or deployed Redis/alternative host established | Seller routes remain retired. No new service allowance is assumed. |

Sources supporting the rows: [Run](https://cloud.google.com/run/pricing), [Firestore](https://cloud.google.com/firestore/pricing), [Storage](https://cloud.google.com/storage/pricing), [Scheduler](https://cloud.google.com/scheduler/pricing), [Build](https://cloud.google.com/build/pricing), [Artifact Registry](https://cloud.google.com/artifact-registry/pricing), [Observability](https://cloud.google.com/products/observability/pricing), [Firebase pricing](https://firebase.google.com/pricing), [Hosting usage/reset](https://firebase.google.com/docs/hosting/usage-quotas-pricing), [Auth limits](https://firebase.google.com/docs/auth/limits), [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas), [Hypixel API](https://api.hypixel.net/), [Hypixel policies](https://developer.hypixel.net/policies/).

Free Tier eligibility requires an active account in good standing and appropriate non-negotiated pricing. Monthly limits share a billing account unless a product specifies otherwise. Trial credit is excluded. Monthly docs do not supply an atomic application reset signal; new-period capacity requires reconciled evidence. [Eligibility and scopes](https://docs.cloud.google.com/free/docs/free-cloud-features).

## Implementation and pause triggers

`collector/capacity-plan.ts` requires independent typed reports for all modeled resources, both databases, both Hosting windows, retained capacity and sender quotas. Null, stale, ineligible, wrong-unit or incomplete-scope evidence pauses; verification lasts at most 15 minutes. An exempt zero-cost path requires explicit evidence and cannot admit nonzero charges.

Each independent constraint is:

`measured + durable reservations + projected other/retained work + uncertainty + projected application work <= 75% of that allowance`

Existing lower application limits remain unchanged. The prepared application policy now refuses a reservation before it reaches **90% of any individual daily or monthly app budget**, including collector work, browser reads and reservation extensions. Full-period forecasts use the same 90% ceiling. The former fixed slowdown at 65% of app reservations is removed; cadence still slows or pauses sooner when the independent free-tier projections require it. This is not permission to consume 90% of a provider allowance: the separate 25% free-tier margin and complete-scope evidence requirements above remain. Daily stress checks include a 25-hour DST day. Source cadence, duration and every physical retry/probe/metadata request constrain the result. The retained five-minute scheduler/policy remains an additional practical floor. No paid wait loop was introduced.

`LiveLedger` commits old app holds and new capacity reservations in the **same durable CAS transaction**. Contention recomputes from current state. Failed/ambiguous operations keep holds; observed use never refunds them. No reset or renewal installer was added. Default runtime admission requires the strict reports; explicit legacy regression fixtures test the former profile separately. Work also stops at evidence/allowance expiry, and existing infrastructure shutdown controls remain intact.

Authenticated presence is a separate bounded POST, verified with Firebase identity. The ledger stores hashed principals and public asset keys, never portfolio IDs, costs or quantities. Active tab leases are capped by the reviewed reader count and 128-KiB total storage; assets are unioned for one shared collector. GETs only read cache. Hidden/unmounted tabs release demand; crashes expire at `min(2 × interval + 1 minute, 25 hours)`. Slow cadence can thus permit bounded extra idle work after a lost disconnect; continuous-work projections cover it. Strict mode does not scan every private holding. Notification background demand remains disabled.

The UI requests one selected-asset response with complete exact books/variant evidence and original timestamps. Existing ETags, compression, Web Locks/shared public caches, bounded cache size, nonoverlap and hidden-tab suspension remain. It displays pause/actual interval and source age; the three-minute stale threshold is unchanged. Old full-cache prices remain readable locally during the paused migration. The reviewed wire-size bound is enforced before transmission; oversized portfolios require a sufficient measured bound, not unbudgeted pagination.

Local `BACKGROUND_JOBS_ENABLED=false` and `EMAIL_DELIVERY_ENABLED=false` complement the false collection/evaluation/Auction House flags. The activation helper refuses mutation while collection is disabled. No flag, date or browser request enables a service.

These are enforceable **application** limits, not provider billing caps. Rejected requests already consume startup/request/log/accounting resources; retained storage continues. The current architecture lacks verified external bounds for rejected ingress, other account writers and automated evidence renewal. Every report requires explicit fixed reserves/evidence for those costs. Missing bounds block activation rather than being silently excluded.

## Continuous-period model and freshness

Existing worst-case reservations remain: per collector, 100 CPU/GiB-seconds, 700 reads, 296 writes, four uploads, 96 Hypixel calls and large transfer bounds; per ordinary browser/presence admission, 20 CPU/GiB-seconds, 108 reads and 40 writes including accounting. Model four browser admissions per active lease/cycle: GET, presence and both possible preflights. No credit is taken for cached preflights/duplicate-tab savings. Churn, rejected work, scheduler wakes, rollout, renewal and shutdown require additional fixed reserves.

| Cadence | Collections / 31 days | Minimum Bazaar uploads | Protected CPU seconds before baseline | Protected reads / 25-hour day |
|---|---:|---:|---:|---:|
| 60 seconds | 44,640 | 44,640 | 8,035,200 | 1,698,000 |
| 90 seconds | 29,760 | 29,760 | 5,356,800 | 1,132,000 |
| 5 minutes | 8,928 | 8,928 | 1,607,040 | 339,600 |
| 60 minutes | 744 | 744 | 133,920 | 28,300 |
| 90 minutes | 496 | 496 | 89,280 | 19,244 |
| 120 minutes | 372 | 372 | 66,960 | 14,716 |

These are **reservations, not measured CPU use**. Saved app reservations already include 39 collections, 222 browser admissions, 8,340 CPU-seconds and 168 Class A operations. All remain spent. Ninety-minute operation adds 1,984 browser admissions to 222 reserved, exceeding the 2,000 app cap. Two-hour operation passes some dimensions but is not certified across all resources.

The explicitly synthetic complete-scope fixture, using the saved app reservations, published bounds, 25% margin, one visible lease and a 64-KiB wire bound, chooses **12 hours for 28/29-day periods, 24 hours for 30/31-day periods**. Conservative Firestore transfer bounds limit it: 100 MiB/collection plus four 8-MiB browser envelopes. All are counted until path exemptions are proven. These are not measured Internet bytes. This arithmetic assumes fresh complete reports and funded renewal/idle overhead, absent in production. **It is not an activation-ready daily schedule.** No counters or envelopes were reduced to force freshness.

Bazaar historically updated about once a minute; one earlier cloud refresh took 0.950 seconds. The local ten-minute trial achieved eight complete refreshes. Neither is a current SLA or full billed-cost bound. Age includes source generation, collection wait, execution and delivery; an unsynchronized browser may add another polling interval. A conservative conditional planning bound is approximately `2 × interval + source period + collection duration + scheduler jitter + response delay`, excluding outages. The UI reports actual timestamps, not this forecast. Hourly/daily samples are stale most of the time.

Auction House remains separately disabled. Historical complete generations contained 43–46 pages; cloud duration was about 15.929 seconds, local generations 3.155/3.321 seconds. Two 46-page snapshots use 92 of 96 routine five-minute slots before Bazaar/metadata/retries. No 60–90-second full-auction cadence is justified. Only complete consistent generations and exact variants with at least three matching asks qualify. Actual supported Auction House interval: **none while paused**. Bazaar cadence is never presented as auction cadence.

## Polling versus push

Conditional polling is retained. A continuously open Run WebSocket keeps the instance active. One 1-vCPU/1-GiB instance for 31 days consumes 2,678,400 vCPU/GiB-seconds, before reconnects, messages, database work, transfer, logs and coordination. Even instance-based free compute (240,000/450,000 seconds) cannot cover it. Firestore listeners avoid that connection but charge initial/changed/reconnect document reads per listener, writes, indexes and transfer. Polling has request/preflight/cold-start/ledger/object-read/transfer costs, included here. 304 saves bytes, not an invocation. No push service was added. [WebSocket billing](https://docs.cloud.google.com/run/docs/triggering/websockets), [listener charging](https://cloud.google.com/firestore/pricing).

## Verification

Offline replay of a saved 2,197-item snapshot through real cache methods returned three selected assets in **10,831 JSON / 1,931 gzip bytes**, versus **4,100,960 / 479,678 bytes** for the full response. One local replay used approximately 31 ms process CPU/wall time. This proves payload reduction, not cloud billed compute.

- Unit/integration suite: 343 passed, covering all required report dimensions, 28/29/30/31-day periods, DST, idle demand, expiration, auth, hard response bounds, retained timeout holds and existing valuation/cache/polling/failure/retry behavior.
- Fifty independent ledgers compete for exactly ten CPU-seconds of headroom: one ten-second hold succeeds; a restarted ledger refuses one more second. Old/new reservations remain consistent. Forty simultaneous collector admissions produce one collector hold.
- Desktop/mobile emulator journeys: 22 passed with market routes blocked and email mocked. Firestore ownership/schema/concurrent-transaction tests: 27 passed.
- Frontend/Apps Script, collector and market-functions builds/typechecks passed locally. Existing Vite extension/chunk warnings remain. No cloud build/upload ran.

Reproduce the model without network access:

```powershell
npx esbuild scripts/model-prepared-capacity.ts --bundle --platform=node --format=esm --packages=external --outfile=.local/model-prepared-capacity.mjs
node .local/model-prepared-capacity.mjs
```

It reads saved ignored evidence and writes `.local/free-tier-preparation-model.json`. Current decision: `paused`. The synthetic fixture is not an operating grant.

## Concrete activation checklist

Preparation is local; **do not activate yet**.

1. Verify whole-period current/former billing-account membership and consumption, all regions/resources and pricing eligibility. Resolve Hosting windows, Auth mode, anonymous upstream entitlement/cadence and sender usage/deployed trigger/mail state. Missing series stay unknown.
2. Reconcile byte-month integrals, images/releases, versions/soft deletes, indexes, transfer exemptions and paid-only features. Include the proposed rollout's retained artifacts. No deletion or cleanup is authorized by this report.
3. Establish enforceable bounds for ingress/rejected work and other writers, plus a trustworthy evidence-renewal process with its own reserved resources. Without those, remain private and paused.
4. Add reviewed evidence without replacing/resetting/refunding existing reservations or changing identities, deadlines, request history or cooldowns. Reconcile ambiguous old work. Measure/bound cold starts, worst responses, full-auction generations, retries, accounting and shutdown; keep protective margins.
5. Model actual remaining capacity for every period and reviewed active-tab limit. Choose the shortest feasible interval; budget actual scheduler wake frequency. Prepare its concrete paused schedule in the later release (the existing source schedule is five minutes), with no paid waits. Exercise renewal/period-boundary failures offline.
6. Verify existing cross-project token-validation/presence access and shutdown permissions through the fixed release; no IAM change or billing upgrade as a shortcut. Recheck exact variants, price ages, large portfolios, duplicate tabs, sign-out, hidden tabs and stale evaluation.
7. Present the exact source/image digest, immutable ledger/evidence diff, schedule, access decision and rollback receipt for **separate activation approval**. Email/evaluation/auctions each need their own explicit activation decision. No approval is requested while these blockers remain.

Rollback: keep every false gate and production job paused; revert only this task's local edits, preserving concurrent user work. Never restore an old ledger snapshot, reset counters or return to an active legacy release. For a future deployed rollback, use existing shutdown first, preserve all reservations/receipts/cache/private records, then restore the last approved **paused** image. Retained storage and delayed costs still require reconciliation afterward.
