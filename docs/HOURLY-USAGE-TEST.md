# Temporary hourly usage test

## October 2 budget-refusal repair

The initial trial did not produce a new snapshot. At 10:18 PM Eastern a browser admission hit `firestoreReads` with 29,972 of 30,000 daily operations reserved. The catch-all runtime handler treated that refusal as a fatal fault and disabled Scheduler and public cache API access. The last real market snapshot remained 6:13 PM. The saved log evidence is `.local/hourly-trial-pause-logs.json`.

The repair distinguishes a validated budget refusal from accounting, deadline or integrity failures. Budget refusals return a bounded 429 with the next eligible reset, preserve all charged reservations, and leave Scheduler enabled. An admitted request that cannot extend its reservation must still complete its accounting; a failure there remains fatal. Repeated refused requests within a warm runtime avoid extra ledger reads. The client retains its saved data and stops network requests until the reported retry time; seller commands are never replayed from cache. The UI shows the waiting condition and next check rather than suggesting ongoing updates.

Browser admission now protects the full existing 700-read/296-write collector charge for every remaining hourly slot before the natural Pacific reset. This protects headroom without charging future work or refunding past reservations. Ordinary cached requests and preflights no longer reserve seller-profile calls; actual seller lookup routes retain those bounds. A collector does not reject on an unrelated zero-cost seller counter. Hard limits, permanent stop/deadline behavior, cache cadence, collection-only routes and authentication remain intact.

Recovery requires an explicit read-budget repair plan, the exact inspected stopped-ledger hash, both verified private revisions and unchanged limits, identity and deadline. It clears only the two verified stop markers and restores the existing API access and hourly schedule. It does **not** reset the 29,972 reserved reads, so fresh collection must wait for October 3 at 3 AM Eastern. The repair has 281 passing unit tests, including refusal, accounting failure, automatic day-boundary recovery, protected collector capacity, browser cache deferral and fixed limits. Deployment, recovery and live verification receipts are stored in `.local` under `usage-budget-repair` / `budget-repair`.

## Original test configuration

The owner requested hourly Bazaar and Auctions updates on October 2, 2026, and will review usage the following day. The test window ends **October 3 at 8 PM Eastern (October 4, 00:00 UTC)**. The shared policy returns automatically to the normal 65% reservation slowdown afterward; the original November 1 operating deadline is unchanged.

During the window, scheduled collector admission and browser price checks use hourly opportunities even above 65% reserved. The hourly scheduler, single admission per UTC hour, source freshness/backoff, permissions, caching, collection isolation, fees, alert delivery, quotas, cleanup and counters remain in place. Page requests do not collect market data.

Each collection still reserves its full existing envelope: 700 Firestore reads and 296 writes, including accounting margins. Twenty-four collections reserve 16,800 reads and 7,104 writes before browser traffic. This is reservation arithmetic, not a prediction of measured Google usage.

A test collection is skipped without changing the ledger or shutting down the service if admitting its full reservation would exceed 95% of any application budget. The final 5% retains some headroom for cached reads and accounting; it does not guarantee unlimited website traffic. Existing hard limits and failure shutdown still apply. Since October 2 reservations were already high when the test was requested, some overnight collections may skip before the usual Pacific-midnight reset. No reservations are refunded or manually reset. Admission pressure now recognizes the natural day boundary before deciding whether to slow a run, so yesterday's daily reservations do not defer today's first eligible collection.

Usage & Costs reports “Hourly test”, its end time, and the skip condition in the next normally eligible cached measurement. The reporting cache remains 30 minutes. A report generated before the API update can retain its old collection label until then. A page reload loads the latest website code; it does not trigger market collection.

For comparison, retain the predeployment state in `.local/usage-hourly-trial-predeploy-ledger.json` and the measured report in `.local/hourly-trial-baseline-measured.json`. Compare like-for-like Google reporting periods, separately from reservations; measurements can lag and the test crosses a daily quota reset.

Validation: 273 unit tests passed, including consecutive hourly admission under pressure, duplicate suppression, automatic expiry, safe skips, daily rollover, monthly limits, hard limits and fixed deadline checks. Frontend and packaged backend builds passed. Production deployment and verification receipts are stored locally alongside the release plan.
