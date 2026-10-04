# October 4, 2026 portfolio cleanup release

The user authorized commit, push and deployment to the existing projects. The original sky, wood and parchment UI is retained. Local records remain separate from production records.

## Changes and bounded usage evidence

- Removed discovery/watchlist screens, filters, opportunity ranking, seller lookup, auction commands, ended-sales history and obsolete tests. Retained normalization, exact-variant valuation, shared cache, fee rules, authentication and legacy delivery compatibility. Every remaining package dependency still has a consumer.
- Retired public auction/discovery routes return HTTP 410 before storage or allowance admission. Old Apps Script discovery actions are rejected. Watchlist/filter records remain private and read-only.
- Usage & Costs loads no portfolio collections. Account reads only preferences. Holdings and market polling are scoped to Portfolios. Private reads use a per-session 60-second cache with in-flight deduplication and mutation-specific invalidation; the cache never crosses accounts or persists private data in shared browser storage.
- Ten concurrent private reads produce one underlying read in tests. Repeated tab visits reuse the cached read; modifying holdings does not refetch portfolio parents or notification settings. Cache expiry still permits external changes to appear.
- Fresh legacy evaluation is retired. Previously queued messages retain quota, claim, receipt and retry behavior. Empty active-work indexes are retired without deleting alerts. Eleven repeated idle worker calls performed zero reads, writes or sends after warming the idle hint. This is mocked-worker evidence, not a billed-usage estimate.
- Shared collection tests still verify one 46-request fixture cycle across 100 collector contenders and 1,200 cache readers. This demonstrates deduplication; it is not a live request count. Auction demand still requires broad pagination, while no demand or Bazaar-only demand can skip that work. Both live collection and new notification evaluation are disabled.

## Production preflight

Read-only backup at 08:26 UTC saved original Positions, migration markers, portfolios, holdings, settings, preferences, legacy ledgers and disable-link records under ignored `.local/portfolio-release-before/`. There were zero cloud Positions/portfolios, two user ledgers, two shared backend documents and four disable-link records. No original records are deleted or converted into notifications.

The existing hourly Scheduler was found ENABLED and was explicitly paused before release. The collector remains private; the API remains accessible for owner usage reporting. API/collector IAM is unchanged. The website/auth project `bazaarsignal` has billing disabled. The pre-existing collector project `bazaarsignal-510305` has billing enabled; this release does not change it or add services.

The live upstream-request counter was 1,301 before deployment. The read-only usage report at 08:27 UTC measured 64,800,976 bytes of retained images, 1,600.56 CPU seconds, 1,600.56 GiB-seconds and 1,524,375 log bytes in their reported windows. The locally built application image reserves 83,458,314 additional artifact bytes and uses no Cloud Build minutes. Existing usage/capacity guards remain enforced. These are measured resources, not an assertion of a zero bill; actual billing reconciliation remains unavailable.

## Verification

314 unit tests passed. The isolated emulator suite passed 27 checks; the 14 ownership/migration checks were rerun after archive rules were tightened. All 16 desktop/mobile browser journeys passed. Desktop/mobile screenshots preserve the original visual design and were reviewed. Production frontend/Apps Script, collector and market-function builds passed. Both image handlers booted with outbound connections blocked and no handler invocations. No test sent real email.

The test emulator uses ports 9098/8081; the user's local workspace stays available on 5173/8080. Local database exports and Windows export-recovery preserve saved local records.

## Deployed release

Implementation commit `2036d89361a5ae69964149b94d3686dda5e17d9e` was pushed to the unprotected `main` branch through a normal fast-forward push. Firestore rules/indexes, Apps Script version 12 at the existing deployment URL, and Hosting were deployed to `bazaarsignal`. The script manifest/scopes, sender, trigger and signing properties were preserved. Version 11 was pulled into an ignored rollback copy before updating source.

The existing market services now serve the verified image `sha256:fb00c272b9f3d90eb9d330c48e5a9df463aba297b0b84c736f5480d3a27af9f6`: API revision `marketapi-00017-flb` and collector revision `refreshmarket-00014-s9p`. Rollout used 43 bounded control-plane calls and uploaded 12,957,790 bytes. No Cloud Build, billing, IAM, schedule-resume or accounting-reset action ran.

Production smoke checks at [bazaarsignal.web.app](https://bazaarsignal.web.app) confirmed signed-in Portfolios and Notifications without permission errors and owner Usage & Costs with 22 of 27 resources measured and collection Paused. An initial browser sign-in connection error resolved; an immediate dashboard reload correctly hit the one-minute refresh guard, then loaded normally. Retired auction/seller routes return 410 with correct CORS; unauthenticated usage returns 401; Apps Script rejects retired actions and requires verified identity for portfolio mutations. No production holding or notification was created for testing and no real test email was sent.

The 08:38 UTC post-release receipt confirms the Scheduler remains PAUSED, the upstream counter remains **1,301 → 1,301**, and the entire market allowance ledger and both IAM policies are unchanged. Every original alert, mail entry and disable link is preserved. The old worker changed only its monitoring/runtime fields between the preflight snapshot and source rollout. Retained image storage was subsequently reported as 74.16 MiB; actual dollar savings cannot be inferred from this short observation. The bandwidth projection still extrapolates earlier activity, so it is not a forecast of the now-paused collector.

Private receipts remain under ignored `.local/portfolio-release-before/`, `.local/portfolio-release-after/` and `.local/private-release-free-20261001-usage-portfolio-cleanup-apply.json`. Local and production screenshot evidence remains under `.local/portfolio-*.png`. Follow-up documentation/UI wording changes do not alter the deployed market image.
