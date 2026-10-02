# Live deployment targeting Google’s free allowances

Verified October 2, 2026, 04:02:54 UTC (12:02 a.m. Eastern).

The user authorized unpausing and deploying the site, and clarified that $0 is a preference rather than an absolute spending limit. Production is **https://bazaarsignal.web.app**. The following controls target free allowances; they are **not a Google-enforced spending cap**. No billing upgrade, purchase, project deletion, private-data migration or billing unlink was performed.

## Current operation

| Activity | Live setting | Purpose and maximum in 31 days |
| --- | --- | --- |
| Collector invocation | At most once per clock hour; existing Scheduler `0 * * * *` UTC, retries disabled | Up to 744 opportunities to collect shared data. Persisted due times, backoff and budget pressure can skip an opportunity. |
| Full market collection | Bazaar, auctions and election no more often than hourly; catalog daily | First successful collection needed 46 physical Hypixel requests, including 43 auction pages. 120 full collections/hour is not enabled. |
| Snapshot uploads | At most four per admitted collection; unchanged metadata is reused | Up to 2,976 uploads before slowdown or other limits. Uploading is distinct from fetching an upstream page. |
| Old-snapshot cleanup | Once daily, at most four listing pages per cleanup | Normally 31 listings/month; hard listing reserve 124. Current snapshots and recent staging objects are preserved. |
| Browser checks | Hourly while visible, then every two hours under pressure | Cache-only requests. Hidden tabs stop; identical requests reuse cached responses across tabs where supported. Opening different datasets can add requests. |
| Alert market download | At most one shared raw-Bazaar download per clock hour | Existing five-minute email worker reuses the hourly public snapshot. Failed downloads/cache eviction do not cause same-hour retries. |
| Review deadline | November 1, 2026, 07:00 UTC | Fixed expiry. No automatic renewal or reset of monthly counters. |

The original three-minute freshness rule remains. **Hourly data will be marked stale for much of each hour; stale price comparisons and new price-triggered alerts are withheld.** Existing accounts, targets and queued-email delivery remain available. We did not send test emails during deployment. Existing scheduled email processing continues normally.

## Usage, estimates and maxima

The table separates extrapolation from the application’s pessimistic reservations. A reservation is not a billed measurement. Baseline operational counters were captured at 03:35:45 UTC; reporting is delayed. Relevant free allowances are published in [Google’s Free Tier table](https://docs.cloud.google.com/free/docs/free-cloud-features#free-tier-usage-limits) and [Cloud Run pricing](https://cloud.google.com/run/pricing).

| Resource / use in this app | 31-day estimate or application maximum | Google free allowance | Percentage and qualification |
| --- | --- | --- | --- |
| Run CPU, collection | 31.940 measured handler seconds × 744 = **23,763 seconds** | 180,000 vCPU-seconds/month for request billing | **13.20%**, collector-only extrapolation from one run; excludes startup and API work. |
| Run CPU, all admitted work | **110,000 seconds reserved maximum**; baseline 317 plus 20,000 rollout/reporting margin | 180,000 | **72.40%** including those margins. Admission reserves 100 seconds/collector and 20/API request against shorter configured timeouts. |
| Run memory, all admitted work | **250,000 GiB-seconds** plus baseline 317 and 20,000 margin | 360,000 GiB-seconds/month | **75.09%** maximum arithmetic; CPU cap at the same 1 GiB/1 CPU configuration is tighter in practice. No independent claim that every combined bound is below 75%. |
| Run HTTP requests, shared collection and cache serving | At most 744 admitted collector calls + 2,000 admitted API calls = **2,744** | 2,000,000/month | **0.1372%** for admitted work; external/denied/pre-admission requests are separate. |
| Storage Class A, uploads and listings | Normal ceiling **2,976 + 31 = 3,007**; four-page cleanup ceiling **3,100** | 5,000/month | **60.14%** normal, **62%** with four-page cleanup. Application aggregate reserve cap 3,200; baseline 139 + 100 margin gives **68.78%**. |
| Storage Class B, reading shared snapshots | **32,000** application maximum | 50,000/month | **64%**, before baseline/reporting margin. |
| Run outbound transfer, API responses and provider request bytes | **553,566,958 bytes** additional application budget | 1 GiB/month for eligible North American Internet transfer | **51.55%** new budget; baseline 184,630,546 bytes + 64 MiB margin brings the bound to **75%**. Eligibility matters separately from byte count. |
| Firestore reads, coordination and cache pointers | **30,000/day**, plus baseline 2,924 + 3,000 margin | 50,000/day | **71.85%** including margin. Daily reservation resets use America/Los_Angeles. |
| Firestore writes, coordination and cache publication | **12,000/day**, plus baseline 698 + 1,000 margin | 20,000/day | **68.49%** including margin. |
| Firestore deletes | **0** additional application operations | 20,000/day | Historical deletes were not treated as zero merely because the counter was unavailable. |
| Scheduler | **1** existing job | 3 jobs/month | **33.33%**. No additional job created. |
| Cloud Build | **0** builds for this release | 2,500 eligible build minutes/month | Image built locally; no source deployment build was used. |
| Artifact Registry images | Baseline 223,370,784 + full-image hold 103,968,278 + 16 MiB margin = **344,116,278 bytes** | 0.5 GiB-month | **64.10%** conservative month-long capacity bound, not a new runtime meter. Existing cleanup remains configured. |
| Cloud Logging | **512 MiB** application reservation cap | 50 GiB/project/month | **1%** before baseline and Google-managed logs. |

Storage capacity, Firestore document/index storage, Hosting, authentication, Apps Script mail/trigger quotas and monitoring remain covered by the retained inventory and [prior audit](ZERO-COST-AUDIT.md); their historical counts are not represented as continuously updated live measurements. The main Firebase project still has billing disabled. The private snapshot bucket and collector are both in `us-central1`; the ledger’s 512 GiB gross bucket-read bound is **internal same-region transfer**, not a claimed 512 GiB free Internet allowance. No new custom Monitoring metrics or paid monitoring services were added.

Bandwidth may stop the run before the calendar deadline, depending on response sizes, datasets viewed and Apps Script downloads. A browser request, a collector invocation, an upstream page and a storage upload are different counters. The 2-million HTTP allowance alone does not determine a safe collection cadence.

## First live evidence

The initial collection began around 03:50:21 UTC and completed in **31.940 seconds**. It published a consistent **43-page auction snapshot** and Bazaar data, using **46 Hypixel requests**, **four uploads** totaling **6,100,629 compressed bytes**, and one cleanup listing. Twelve superseded public snapshot objects were removed; current snapshots and private user records were retained.

At 04:02:54 UTC:

- Scheduler was **ENABLED**, hourly, with a successful 04:00 attempt. The 04:00 tick did not refresh data still within its one-hour minimum age.
- The live ledger recorded **three successful cache API responses**, 1,033,335 response-body bytes, and still **46 Hypixel requests**. Browsing Bazaar and Auctions did not multiply upstream collection.
- The website displayed **706 Bazaar items** and **15,965 matching auction listings** under the active filters, with source timestamps 03:50:08 and 03:50:09 UTC. It correctly withheld stale comparisons.
- Measured application work totaled 384 Firestore reads, 203 writes, five Class A operations and nine Class B operations. Ledger-accounting overhead has separate conservative reservations; these measurements are not account-wide billing totals.
- Two collector admissions and three API admissions reserved 260 CPU/GiB-seconds. No stop latch or active collector lease remained.

There is no verified dollar charge total in this report. Operational usage does not prove a $0 bill, and lack of an invoice is not interpreted as zero charges.

## Controls and their limits

All instances share atomic allowance reservations in Firestore. Existing provider usage, cooldowns and complete snapshot pointers were preserved during activation. Reservations are never refunded, and missing, inconsistent, stopped or expired allowance state refuses optional work. Each clock hour admits only one collector even with concurrent workers.

At 50% of an **application budget** the response warns; at 65% it slows browser checks and collector opportunities. Application budget maxima already retain space below relevant Google allowances and the deployment baseline. These percentages are not statements about Google’s settled billing balance. Exceeding a reservation cap latches a stop and attempts both Scheduler pause and removal of public API invocation. Browser polling also stops on its fixed deadline. Monthly renewal requires a new review; this release does not silently create another allowance period.

Both Run services have zero minimum/one maximum instance, request billing, no startup CPU boost and 1 CPU/1 GiB. The API timeout is 15 seconds, concurrency two; the private collector timeout is 90 seconds, concurrency one. Shutdown-only IAM grants expire one hour after the operating deadline. They do not permit enabling jobs, deleting data or changing billing.

Remaining possible charges include delayed counters, startup/shutdown and pre-admission traffic, retained storage, non-qualifying network destinations, unexpected public traffic, shutdown API failure, and other activity sharing the billing account. In particular, Hypixel/Mojang network geography is not proven eligible solely by the user being in North America. These are best-effort controls under the user’s clarified preference.

## Deployed versions and verification

- Ready Run revisions: `marketapi-00007-r9w` and `refreshmarket-00008-nwx`.
- Image digest: `sha256:949ee0cf258e0a68c32f7e0c43ee165a6bad6cd24c19b4349cb43665d0ddfdec`.
- Existing Apps Script production deployment updated to **version 10**. `configureFreeTierMarket` completed in the owner’s editor at **04:01:28 UTC**. No new deployment URL, credentials or authorization scopes were introduced.
- **186 tests passed** across 21 files, including concurrency/reservations, expiry, cache eviction, failed-download suppression and preservation of an outer alert lock. Relevant TypeScript checks and frontend, Functions, collector and Apps Script builds passed. Both handlers booted from the verified local image before deployment.
- Desktop production browser verification loaded Bazaar and Auctions successfully. Authentication retained the existing signed-in session. Earlier mobile/hidden-tab/cross-tab verification is recorded in the trial report; no additional live load test was run.
- `.env.production.local` persists the exact four public mode/id/expiry flags used for this Hosting release. It is ignored by Git; future builds do not silently extend the deadline. `.env.example` documents the configuration.

Local evidence: `.local/live-release-free-20261001.json`, `.local/private-release-free-20261001-apply.json`, `.local/live-activation-free-20261001-prepare.json`, `.local/live-activation-free-20261001-activate.json`, `.local/live-state-latest.json`, and `.local/trial-shutdown-grants-2026-10-02T03-47-50-170Z.json`. Screenshots: `.local/live-site-20261002.jpg` and `.local/live-alert-config-20261002.jpg`.

For a later usage review, read the existing live ledger and Google operational counters without resetting them. Do not rerun activation/preparation or manufacture a fresh baseline to resume a stopped period. The prior zero-overage shutdown option remains documented, but billing removal is not authorized by this deployment request.
