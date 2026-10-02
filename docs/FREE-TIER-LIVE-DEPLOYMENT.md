# Live deployment targeting Google’s free allowances

## Saved-alert request recovery — October 2

The follow-up report showed a separate account-read failure. The old frontend produced “The email backend is unavailable” only for a non-success HTTP response, discarded the status code, and stored that account error in the same banner as market errors. A successful manual saved-alert reload restored the real Summoning Eye card and counts, but did not clear that banner. Consequently the page still claimed the email backend was unavailable and told the user to wait for an unrelated hourly market check. At 15:16 UTC, read-only public endpoint probes returned HTTP 200 with the expected GET rejection and missing-identity rejection; the existing signed-in browser's Retry alerts request then succeeded. The original failed response's status/body was not retained, so its precise upstream cause is unknown. A failed account read is not evidence of failed email delivery.

The frontend now keeps saved-alert read errors in the alert board, reports HTTP status, clears errors on successful manual or background reads, and preserves previously loaded cards/counts with a last-loaded warning if refresh fails. Initial failures retain unknown counts. Concurrent reads for the same authenticated user share one in-flight request, with no persistent private-data cache; readers for different users remain isolated and abandoned reads are cancelled. Only account reads may retry once after a network failure or HTTP 429/500/502/503/504. Short Retry-After values are honored and longer cooldowns are not shortened. Mutations, authorization/application failures, and market reads are never automatically retried by this code.

This is a Hosting-only correction. Worker code/deployment, email delivery safeguards, owner authorization, collection cadence, market cache, counters, quotas, cleanup, billing configuration and November 1 deadline remain unchanged. Tests: **243 unit/handler tests** and **14 authenticated desktop/mobile browser tests**, covering transient/persistent failures, no duplicate account requests, cancellation, owner isolation, retained/unknown counts and recovery without market collection. Production frontend and Apps Script bundle builds passed; the Apps Script bundle was not pushed or deployed.

Published through the existing `free-preview` channel to live at approximately 15:43 UTC; verified production bundle `app-CrDiXdmQ.js`. The real account loaded Active 1 / Completed 1 / Disabled 0, with its active Summoning Eye instant-buy sample at 1,482,424 coins. Desktop 2560px and mobile 390px loaded without the old error banner; a mobile Refresh alerts kept the existing card/counts visible. Bazaar at 390px and 1440px retained sampled buy 1,455,447, sell 1,482,424 and net profit +8,447 for one unit. Both layouts had no horizontal overflow. Cache/collector job metadata and collection reservations remained identical across navigation/refresh checks from 15:44:34 to 15:48:19 UTC (13 collector admissions, 1,248 reserved upstream requests). Screenshots and counter evidence are in `.local/price-fix/account-recovery-*`. Existing browser tabs or cached HTML may require one reload to pick up this release; asset/market caching remains unchanged. No real alert mutation or test email was performed.

## Sampled price display correction — October 2

Released October 2, 2026, approximately 11:03 a.m. Eastern to https://bazaarsignal.web.app. Cache API revision `marketapi-00012-th7` uses image `sha256:6223c8b37a0977a6ee8a9de100a7cfabf71c19424cb4d52b2bc9fc6efa829251`. Hosting was built, uploaded to the existing `free-preview` channel, then cloned to live. The collector remains `refreshmarket-00009-4bz`; Apps Script, owner identity, alert records, queued delivery, triggers, scheduler, cleanup and budget configuration were not redeployed or changed.

The live cached Bazaar response contained valid Summoning Eye asks and bids, with no collection failure. At the initial inspection its source timestamp was 14:00:08.470 UTC, collected at about 14:00:13 UTC, with next collection at 15:00 UTC. The top instant-buy ask was 1,482,423.7 coins and instant-sell bid was 1,455,443.6. However, `/book` returned HTTP 503 because it used the alert worker's three-minute freshness parser. `/snapshot` returned prices but mislabeled ordinary aging as an error. Bazaar's frontend explicitly replaced stale sell, profit and ROI with null, while retaining buy. Its filter also substituted the snapshot timestamp for the real clock. The collector's transaction-side normalization was correct: `buy_summary` contains asks consumed by instant buyers, and `sell_summary` contains bids consumed by instant sellers. These are depth prices, not the API's weighted quick-status prices; see the [official API description](https://api.hypixel.net/#tag/SkyBlock/paths/~1v2~1skyblock~1bazaar/get).

The correction separates browsing validity from alert eligibility:

- Public book/snapshot reads preserve valid older samples and their original timestamps, expose staleness separately, and retain actual collection errors. They remain cache-only. Invalid/future timestamps and malformed products still fail closed.
- Alert cards and the creation preview show the full-quantity instant-buy cost or after-tax instant-sell proceeds for the alert's own side, quantity and tax. Sample time, observation time, age and the next scheduled cache check are visible. A failed read/collection is explained separately. The worker's three-minute freshness validation and target-email queue safeguards remain intact.
- Bazaar cards and details show sampled buy and sell legs, units and net profit. Historical profit is labeled **Sampled profit**, with **Last sampled / Stale** provenance. Fresh recommendations still require fresh data. A partial book can display its valid leg but cannot generate an incomplete profit; unknown fees also withhold profit.
- Buy-order acquisition uses the best bid, sell-offer exit the best ask; instant legs consume full visible depth. Profit subtracts the sampled sale tax and configured execution cost. Both legs come from one item snapshot. The original ten-minute fee-evidence tolerance now compares the fee check to that sample's observation time, rather than today's browsing clock. Incompatible, missing or unverified fee evidence cannot support profit. Source and observation timestamps must also be compatible with a valid collection.

Verification: **220 unit/handler tests**, **12 authenticated desktop/mobile browser tests**, and **16 companion browser tests** passed. The new regressions cover fresh, aging-hourly, missing, partial and failed snapshots, all strategy directions, fees/units/depth/overflow, invalid or incompatible timestamps, and stale samples never queuing or sending target email. Production frontend/Apps Script and cache API builds passed, and both packaged handlers booted locally with outbound connections blocked. The existing preview hostname is absent from the API's CORS allowlist; that existing restriction prevented real-data preview browsing. The release was verified against the production origin after promotion instead of changing access configuration.

Live desktop (2560px) and mobile (390px) verification used the existing signed-in account and actual cached data. Its active Summoning Eye buy alert retained target 1,350,000 and quantity 1, and displayed **1,482,424** from the 15:00:08.510 UTC sample with age and the next 12:02 p.m. Eastern check. Bazaar displayed a one-unit buy-order cost of **1,455,447**, sell-offer proceeds before tax of **1,482,424**, tax **18,530.3** (1.25%), and historical net profit **8,446.7**. Both pages had no horizontal overflow. No alert target was changed and no test email was sent.

Post-release checks confirmed the same `free-20261001` identity, November 1 07:00 UTC expiry, hourly scheduler, limits and nondecreasing reservations. Anonymous/forged owner API requests remained 401; direct private-cache access remained 403. Across live reload/navigation checks at 15:07–15:08 UTC, upstream requests remained **1,188**, collector admissions **13**, and reserved Hypixel requests **1,248**. Browsing did not collect market data. No billing setting or paid service was added.

Remaining limits: hourly sampling still makes prices stale for most of each hour and can miss intervening moves. Passive order/offer profit is a historical estimate, not a guaranteed executable trade. Missing liquidity or unverified fee modifiers remain unavailable. Existing budget pressure, backoff and the fixed operating deadline may delay or stop updates.

Local evidence: `.local/price-fix/` contains baseline cached responses, desktop/mobile live screenshots and reload-counter verification. `.local/usage-sampled-prices-live-verification.json` and `.local/private-release-free-20261001-usage-sampled-prices-apply.json` record deployment and control checks.

## Owner usage dashboard — October 2

See [Usage & Costs implementation and remaining billing setup](USAGE-AND-COSTS.md). The dashboard preserves this release's ledger, cadence, cleanup and fixed deadline. Actual spending is unavailable until actual billing export records and read permissions are connected. New Google Monitoring repository-size evidence reports 745,985,250 bytes, above the 0.5 GiB storage allowance; the earlier compressed-image inventory below is not a current billable-capacity meter. No dollar total or zero-charge guarantee is inferred from either figure.

Verified October 2, 2026, 04:02:54 UTC (12:02 a.m. Eastern).

## Timing correction — October 2

Deployed the hourly timing fix after the user reported stale Price Alerts. The collection frequency, allowance identity `free-20261001`, accumulated reservations, cleanup rate and November 1 expiry are preserved.

- Successful collector due times now align to the next UTC clock hour. Startup jitter no longer makes a successful hourly job miss the following Scheduler tick. Failures and provider cooldowns keep their existing backoff.
- Visible browser polling runs at **two minutes past the hour**, or two minutes past even UTC hours under two-hour slowdown. Opening a page still loads cached data immediately. Cache reuse expires at this same boundary, so a recent response cannot hide the next generation. Aborted/timed-out calls wait for the next slot instead of forming a retry loop.
- The existing Apps Script trigger was replaced by one `scheduledMinuteTick` trigger. Most ticks return after a clock check with **no network, storage or email work**. Queued-mail processing retains five-minute slots, while fresh-price evaluation runs in the **:01:30–:02:30** window. The raw-market bridge refuses downloads outside that window unless it already has the hour's cached snapshot. It still permits at most one download per hour, including failed attempts and cache eviction. Fresh data can bypass a previous stale-data backoff, but cannot bypass freshness validation.
- Price Alerts displays the next scheduled check in the viewer's timezone and explains that hourly sampling can miss price changes. The original three-minute freshness limit has not been extended or backdated. This change makes checks align with new snapshots; it does not make hour-old prices current or guarantee that delayed upstream data will pass freshness validation.

At 04:24:34 UTC both updated Cloud Run revisions were ready: `marketapi-00008-9rv` and `refreshmarket-00009-4bz`, image `sha256:cffd83d3f706f04858b4d4ae8625cea05ed12988af6c97c36e89fdfde3497d88`. Apps Script production is **version 11**; trigger migration completed at 04:25:13 UTC and its single new handler was verified in the trigger list. Hosting was published and the live page displayed **1:02 AM EDT** as its next check. Existing open tabs need one reload to load this new browser code.

**193 tests passed**, covering shifted poll times, hidden tabs, aborts, shared cache expiry at the publication boundary, no premature Apps Script downloads, no I/O on off-slot timer ticks, successful collector cadence across startup jitter, and deployment refusal when an update would renew or reopen the allowance. TypeScript checks, production builds and both local image handler boot checks passed. Desktop and mobile page checks retained the schedule notice without horizontal overflow. No test alerts or forced extra collection were sent; the next full production cycle remains scheduled for 05:00 UTC, with the browser check at 05:02 UTC.

The minute trigger adds lightweight Apps Script executions and up to 24 fresh-check worker passes/day; its existing 70-minute/day work guard and Google trigger-runtime quota still apply. The minute timer is not a minute cloud poll. Google supports [one-minute clock triggers](https://developers.google.com/apps-script/reference/script/clock-trigger-builder#everyMinutes(Integer)); actual delivery can be delayed, so stale data still fails closed. [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas) remain applicable.

Evidence: `.local/timing-fix-baseline.json`, `.local/live-timing-fix-release.json`, `.local/private-release-free-20261001-timing-fix-apply.json`, `.local/hourly-timing-live-desktop.jpg`, and `.local/hourly-timing-trigger.jpg`. The release utility's explicit `updateExistingLive` mode verifies the existing identity/deadline and active ledger, updates only code/configuration, and never initializes or resets usage counters. The measurements and versions below describe the initial release unless superseded here.

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
