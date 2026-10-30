# Portfolio price recovery — October 30, 2026

The price API returned HTTP 403 because the runtime's shutdown handler had removed its public invoker grant and paused both collection jobs. At **02:30 UTC on October 30** (10:30 p.m. Eastern on October 29), Firestore returned HTTP 503 during a billing save and the subsequent attempt to record the billing error. The generic failure path treated that temporary service outage as a permanent stop. This was not a missing Summoning Eye quote or a portfolio calculation failure.

## Fix

The Firestore REST adapter now identifies errors as originating from Firestore. The paid runtime treats identified Firestore unavailability as a temporary failure, alongside the existing explicit write-throttle handling. It ends the invocation, preserves every reservation and receipt, and leaves collection schedules and price access in place. It does not replay an ambiguous commit. A later request must reread durable state and pass the existing admission checks.

A browser admission failure receives HTTP 503 with the existing one-minute recovery directive. If only final accounting fails after a quote has already been admitted and prepared, the quote can still be delivered while its full reservation remains. A failed billing save leaves cost messages unacknowledged and defers collection without attempting another database write. Authentication failures, quota exhaustion, invalid data, budget stops, and expiration retain terminal handling.

## Deployed backend

| Component | Previous | Updated |
| --- | --- | --- |
| Market API | `marketapi-00031-sc4` | `marketapi-00032-zhg` |
| Collector | `refreshmarket-00028-2fn` | `refreshmarket-00029-jct` |
| Application image | `sha256:52c2ba960b5d6a5bf30f5f549a71f0c175dc8380f8fd8a9381ddecac650f7847` | `sha256:9765d01f02d77eb6a8bce15660c059a0200a9a04f02595fedb0c8290b29e7c9a` |

The isolated source stage reproduced the previous production bundle byte for byte before applying changes to only `collector/diagnostics.ts`, `collector/trial-google.ts`, and `collector/paid-budget.ts`. The deployed image reuses the previous dependency layer and adds only the rebuilt application bundle. Both extracted handlers passed startup checks with outbound networking blocked; no handler was invoked during packaging.

Hosting remains version `ec64884a3b8e67fa`. No frontend, Apps Script, account data, Firestore rules, billing settings, or mail processing change is needed for this backend fix.

## Preservation and validation

The fixed pilot retains its $5 budget, $4.50 application stop, 4,000-admission ceiling, and **November 1 at 07:00 UTC** expiry. Both services retain their previous runtime configuration and explicit 100% revision traffic pins. The collector remains private. Restored price access is limited to the API's previously deployed invoker grant; schedule expressions and targets are preserved.

One additional $0.50 internal rollout reservation was recorded, with the existing 10,000 CPU-second, 10,000 GiB-second, and 16 MiB log envelopes. These are conservative reservations, not measured spending. All previous reservations and 1,499 admissions remain. The image adds a 1,326,954-byte storage hold, bringing retained artifact reservations to 1,003,787,363 bytes, below the existing 1 GiB bound. Only 60,898 bytes were uploaded; no Cloud Build or dependency replacement was required.

The original stop reason and timestamp were preserved in a new recovery record before clearing the stop. The existing billing observation was valid and less than 24 hours old; it was not reset or treated as real-time spending.

Validation includes 84 distinct regression tests: 79 staged tests covering paid accounting, throttling, billing, ledger capacity, caching, and daily history, plus five additional tests for duplicate scheduled delivery after an ambiguous admission and preservation of terminal provider errors. Market-functions typechecking and compilation pass. New failure tests cover admission reads/writes, uncertain commits, final accounting, and billing-save failures without contacting production services.

## Production verification

The resumed collector's natural **11:15 UTC (7:15 a.m. Eastern)** run passed on `refreshmarket-00029-jct`. Scheduler attempted it at 11:15:00.760 UTC; the handler returned HTTP 200 in 9.18 seconds. Its finished receipt corresponds to that exact slot. Admissions advanced exactly once, from 1,499 to 1,500. A fresh 2,201-item snapshot was published with upstream timestamp **11:15:02.832 UTC**. Catalog, election, and Bazaar processing completed without a shutdown, throttle, or error event. No collection was manually invoked.

After that proof, the original public price API grant and daily-close schedule were restored. A normal live price GET returned HTTP 200, correct CORS headers, and the unchanged normal 15-minute policy. The user's existing browser tab was reloaded and visibly showed:

| Portfolio field | Verified value |
| --- | ---: |
| Summoning Eye quantity | 2,785 |
| Average cost | 1,368,000 coins |
| Cost basis | 3,809,880,000 coins |
| Fresh unit price | 1,307,738.8 coins |
| Estimated value | 3,642,052,558 coins |
| Unrealized P&L | -167,827,442 coins (-4.4%) |

The unavailable-price messages disappeared, and the normal portfolio view recorded its second local history snapshot without removing the original. Browser error/warning logs were empty. The screenshot is retained at `.local/portfolio-prices-2026-10-30/live-portfolio.jpg`.

Final management verification at **11:16:42 UTC** confirmed both serving revisions, unchanged runtime settings and traffic policy, both original schedules enabled, original access policies, the unchanged legacy ledger, all prior reservations and inline receipts, fixed budget/expiry, and unchanged Hosting. There were 1,502 admissions after the scheduled run and two ordinary price reads. Internal reservations were $10.649156664000277, including all historical holds; this is not measured billing.

Sanitized evidence: [scheduled run](measurements/portfolio-prices-2026-10-30/natural-proof.json), [live price](measurements/portfolio-prices-2026-10-30/live-price.json), [final preservation](measurements/portfolio-prices-2026-10-30/verification.json), and [validation](measurements/portfolio-prices-2026-10-30/validation.json).

Raw management observations, source provenance, local image verification, mutation journals, rollback identities, and recovery evidence are retained in `.local/portfolio-prices-2026-10-30/`. Earlier artifacts and unrelated workspace changes were preserved.
