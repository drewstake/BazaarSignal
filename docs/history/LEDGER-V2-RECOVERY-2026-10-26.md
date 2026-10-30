# Ledger v2 recovery — October 26, 2026

> Historical record. Dates, deployment versions, service status, costs and approvals below apply only to the recorded work. They are not current setup instructions or authorization to operate services. See the [documentation index](../README.md).


Execution authorized by the user's instruction to deploy the coordinated recovery, preserve changes/data/reservations/budget controls, verify a natural scheduled run, and avoid manual collection or email.

## Release

- Collector: `refreshmarket-00027-m5s`.
- API: `marketapi-00030-84n`.
- Both pinned to `sha256:f13f47ff6e4c1377a8add1dc81e85829b47e868c7ba8879df8c6e2848ae26fb0`.
- Apps Script saved source and web deployment: version 24, digest `095316b003c6b193c54c6355cedac0aab76a36cadef46fc3e629c86110136309`.
- Website version: `7aaf1f4d6f223ecd`, published at 03:13:56 UTC; digest `2844417bc7a986ea328db0689b10dfbfde643838874283a5061fe63cafab55c4`.
- Original verified packet SHA-256 remains `96a54c68cf688db7cf1efd79c16857212e4f94d4f3dc01d47acbc2836c6ad711`.

The automatic shutdown was caused by a 131,118-byte ledger response exceeding the old 131,072-byte reader limit. Audit logs identify the runtime service account removing API public access and pausing both existing jobs at 00:02 UTC October 27. The recovery plan preserves that actual private/paused starting snapshot and separately authorizes restoring only the prior price API grant and the two unchanged schedules after natural verification.

## Preservation and budget checks

The deployment audit verifies unchanged runtime configuration, concurrency, scaling, timeouts and managed base images. The legacy allowance and all 1,188 inline admission receipts were preserved.

| Reservation | Before recovery | After recovery hold |
| --- | ---: | ---: |
| USD | 8.318305671000271 | 8.818305671000271 |
| CPU seconds | 182,880 | 192,880 |
| Memory GiB-seconds | 182,880 | 192,880 |
| Artifact bytes | 835,258,735 | 918,808,917 |
| Log bytes | 271,990,784 | 288,768,000 |

These are retained internal reservations, not actual spending. The latest reviewed Google billing report was $0 and remains delayed evidence. The $5 budget, $4.50 application stop, $1 fixed reserve, 4,000-admission limit, billing-freshness checks and November 1 07:00 UTC expiration are unchanged. The initial paid CPU admission and the retained fallback gate both passed without reducing any counter.

The worker's `MARKET_UPDATES_PAUSED` property is `true`. The existing every-minute trigger was inspected but not changed. The settings form could not save because its existing `PORTFOLIO_CURSOR` was empty; a temporary helper set only the pause property and was removed with exact source restoration. It made no collection or mail calls. A naturally advanced pre-pause `PAID_LAST_MAIL_SLOT` was preserved, as were the cursor and delivery receipts. Subsequent property hashes remained unchanged.

## Adapter corrections verified during execution

- Hosting metadata fingerprints now ignore JSON object-key order while still detecting value changes.
- A rejected action can be reconciled without retry only when durable evidence proves no mutation began and accounting/source anchors remain unchanged.
- Registry verification checks bounded content bytes and SHA-256 when a successful HEAD response omits `Docker-Content-Digest`.
- A large registry blob may use one GET redirect to the exact same host, project and repository download path. Other hosts, repositories, query parameters and redirect chains remain rejected.
- A short execution window can be renewed before expiry only while awaiting a natural run with fresh, stable, unopened-release evidence. This changes only the observation clock; it retains the reservation, receipt baseline, request counters, limits and authorization scope. Both original and renewed plans are saved.
- Natural-run verification accepts Firebase's exact short job name as well as its full resource name, and compares RFC3339 offset timestamps as instants against the actual Scheduler attempt. A different job is rejected; logs, finished receipt, pinned revision, accounting and freshness checks still apply.

The worker's immediate post-deployment read briefly returned stale metadata. Fresh reads verified version 24 and both code digests; reconciliation did not create another version or repeat the deployment mutation.

## Scheduled verification

The collector resume completed at `2026-10-27T03:15:00.397810Z`, just after the 03:15 boundary. Cloud Scheduler assigned `2026-10-27T03:30:00Z` as the next run. No collection endpoint or Scheduler run operation was manually invoked.

**Completed:** the natural collector run at 03:30 UTC (11:30 p.m. Eastern, October 26) passed all gates. Scheduler's actual attempt was `03:30:00.792063Z`. The finished receipt is `firebase-schedule-refreshMarket-us-central1:2026-10-26T20:30:00-07:00`, and the new snapshot timestamp is `03:30:02.818Z`. It contains all 2,201 parsed items, including Summoning Eye. Ledger version changed to 2 with exactly one additional admission, 1,189 total, and one external receipt before reopening.

Public price access and the original daily-close schedule were restored only after verification. The collector remains private. Both schedules are enabled with their original expressions (`*/15 * * * *` and `59 4 * * *`, UTC). The daily-close job was enabled but not manually run. Alert email processing remains paused.

The live portfolio now shows Summoning Eye at **1,299,997.2 coins**, unchanged quantity **2,785**, unchanged average cost **1,368,000**, and estimated value **3,620,492,202 coins**. The previous four local history snapshots remain, with a fifth recorded by the normal live view. The final 03:35 UTC management observation shows 1,190 admissions and two external receipts after that ordinary price read; the legacy ledger and original inline receipts remain unchanged. Retained reservations are $8.821747010000271, including the full recovery hold and normal runtime increments. The latest Google-reported net cost remains $0; it is still delayed evidence.

## Validation and recovery

225 isolated tests pass, including the production transport/adapter fixtures, initial paid CPU admission, retained rollback gate, packet verification, automatic-shutdown recovery, registry behavior, execution-window renewal and Firebase's actual scheduled-event format. TypeScript and syntax checks pass. No test used production data or invoked a live collector or mail function.

All application source files present at the beginning of this turn are unchanged. Of 648 pre-existing tracked/nonignored files, 642 remain byte-for-byte identical; the six edited files are migration tools and their tests/support. A new isolated recovery test file and this record were added. Existing release packets and earlier plans were not overwritten. The durable migration journal finished in phase `open`, without pending operations, at 1,455 of its unchanged 1,500-request limit.

Use the retained **v2-compatible fallback**, with fresh owner/drain/billing evidence and containment first, if rollback becomes necessary. Do not restore the old v1-only reader or refund the recovery hold. The fallback shares this Cloud image; a Cloud-code defect requires a contained forward fix. No production rollback was performed merely for rehearsal.

Evidence is in `.local/ledger-v2-recovery-oct26/`: the durable journal, both plan/approval windows, deployment audit, owner checks, provider observations, natural-run proof/logs, live-portfolio screenshot, test reports and `completion.json`. The final read-only management snapshot is in `.local/ledger-v2-recovery-oct26-final/`. The original outage evidence is in `.local/portfolio-unavailable-oct26/`. The Apps Script process-list REST scope remains unavailable (403); owner UI supplied the properties, trigger and execution checks without expanding OAuth access.
