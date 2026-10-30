# Free-tier infrastructure preparation — October 4, 2026

> Historical record. Dates, deployment versions, service status, costs and approvals below apply only to the recorded work. They are not current setup instructions or authorization to operate services. See the [documentation index](../README.md).


## Initial bounded collection completed — October 13, 2026, 12:30 a.m. Eastern

**The private measurement run completed one Bazaar collection (2,201 products, three upstream requests) and stopped. Scheduler remains `PAUSED`; the API and collector remain private.** No code was redeployed. The successful grant `measure-1791865811570` finished at 04:30:45.086 UTC; a later cloud inspection verified terminal grants, released lease and unchanged control. Auctions, email, evaluation and unrelated background work remain disabled.

Cloud Shell authentication resolved the earlier 401. The first authenticated attempt failed before upstream I/O because the shared policy retained two retries. A tested atomic configuration transition set zero retries while preserving the unchanged stopped ledger and all counters/history; a separately budgeted grant then completed, and the original retry setting was restored. The operator now checks policy compatibility before arming a grant. Failed-attempt holds were not refunded.

Observed collection work: 5.156 seconds, 18 Firestore reads, 14 writes, three public upstream requests and one legacy Storage read. Separate handler accounting used two reads/two writes. Provider revision totals currently report approximately 11.19 CPU/GiB-seconds, including startup and failed work; reporting is provisional, not settled billing. All deployment holds and measurement reservations remain, with ledger totals of 10,140 CPU/GiB-seconds, 4,696 daily reads and 1,904 daily writes. Period identity/expiration and owner-stop history are unchanged.

Another bounded run fits the numeric projection with fresh checks and newly enforced 1 MiB diagnostic response caps; prior larger diagnostic holds remain. No further run or ongoing scheduling was started. **442 tests passed**, plus 53 focused tests after final operator changes, and relevant typechecks passed. Full measurements, errors and remaining reservations are saved in `.local/private-measurement-success-receipt.json` and [the measurement record](PRIVATE-MEASUREMENT-RUN.md). Earlier sections below are historical.

## Bounded measurement evidence resolved; authentication blocked — October 13, 2026 UTC

The existing billing/cloud access supplied the required scope evidence. With conservative reporting-tail and retention bounds, preserved deployment/accounting holds and the owner's exclusive-use confirmation, **both measurement capacity checks passed**. The validator retains unknown historical usage where a documented zero-increment path applies, and the public Hypixel mode enforces one call per documented endpoint with no retries while retaining all nine request holds.

Only the changed collector was deployed: `refreshmarket-00017-g9f`, image `sha256:299a81863ad55164ac1d84c8b68ec2d327972866a8e3bfdd116bfee9e184595e`, 12,963,962 uploaded bytes, zero Cloud Build. The API stayed on `marketapi-00019-gl8`. **The single private invocation returned HTTP 401 before a handler claim; no Bazaar collection or upstream request ran.** The Firebase login's user ID token was not accepted by Cloud Run, and no gcloud session is installed/configured locally. No IAM/OAuth or billing permissions were changed.

The grant was closed at 03:58:08.484 UTC using an exact-value CAS. An earlier closure write was throttled; readback plus backoff preceded the one separately recorded successful CAS. All counters, the original owner stop, period identity/expiry, prior deployment holds and new reservations remain. Final reads confirm `PAUSED` Scheduler and two private services. The ledger now reserves 8,940 CPU/GiB-seconds, 2,896 daily reads and 1,152 daily writes; no failed-attempt holds were refunded.

Private receipt: `.local/private-measurement-resolution-receipt.json`. See [the current measurement record](PRIVATE-MEASUREMENT-RUN.md) for actual deployment observations, delayed provider metrics, budgets and the exact remaining action: supply a Cloud Run-compatible ID token from an already-authorized owner Google Cloud CLI/Cloud Shell session as a private local file. A further bounded run fits the numeric budget without redeployment, subject to fresh checks and that token. 438 tests passed; 49 focused tests passed after final operator updates. Earlier sections below are historical.

## Private bounded measurement preparation — October 12, 2026, 10:28 p.m. Eastern

The requested one-shot measurement mode is implemented and passes 434 unit tests, typechecks and network-blocked local image startup checks. It preserves the owner stop, every existing counter, allowance identity/expiry and prior history while admitting at most one explicitly granted Bazaar cycle with a fixed deadline. The collector-only release path leaves the API unchanged and private; Scheduler remains paused. No browser activity or visible demand is fabricated.

**The actual measurement preflight remains blocked; no code was deployed and no collection was invoked.** Five bounded cloud evidence inspections made 85 requests and confirmed the unchanged ledger hash and private/paused state. Fresh read/write and compute samples narrowed some gaps, but complete shared allowance/tail bounds, deletes/transfer/integrated-retention evidence, all-ingress bounds and numeric upstream entitlement remain unestablished. Missing usage was not converted to zero. All existing deployment holds and the new diagnostic holds remain retained.

See [the measurement run record](PRIVATE-MEASUREMENT-RUN.md) for the exact proposed budget, evidence limitations, smallest next actions and execution procedure. Private artifacts: `.local/private-measurement-run-receipt.json`, `.local/private-measurement-plan-reviewed.json`, `.local/measure-1791858378666-inspect.json`, and `.local/measurement-state-after.json`. The new local image is verified but unuploaded. Another bounded run is not certified, and no repeat restart approval is needed.

Earlier release: the user authorized committing and deploying all pending work. The [night-market release](NIGHT-MARKET-RELEASE.md) published Hosting, private Firestore rules/indexes and Apps Script version 14, including the disabled worker/email source gates described below. The optimized market-service code was subsequently deployed on October 12, as recorded below. Scheduler remains `PAUSED`.

**Supported production configuration: paused.** The owner subsequently authorized finishing preparation and unpausing collection when safe, then explicitly requested commit, push and deployment of the optimizations. No repeat approval is needed for those scopes. This does not waive verified headroom or the restrictions on billing and production permissions. Reporting publications and Hosting releases are documented below; market collection remains stopped.

## Optimized backend deployed; activation validation — October 12, 2026, 10:01 p.m. Eastern

**The optimized image is now deployed to both existing services. Activation did not pass the fresh validation.** The user authorized deployment and activation within the free tier. The release completed at 02:00:36 UTC October 13; ready revisions are `marketapi-00019-gl8` and `refreshmarket-00016-wzm`, both serving `sha256:dd601e4c2f453b6fcd105adecd73aa19fda52c7fcd5031edfefdbf8f3f22ce2f`. The application-only upload was 12,959,693 bytes and required no Cloud Build. Both source collection gates and the scheduler remain off; no collector invocation was requested.

Fresh Cloud Asset searches returned permission errors. The direct fallback successfully enumerated all **46 supported Artifact Registry locations** in the currently billed project and found one repository. Global Run inventories found only the two expected services and no jobs. Both services have zero minimum instances and request-based CPU billing. Current account membership is unchanged; the two former projects have billing disabled and their Registry APIs are disabled. Those disabled APIs are not historical-zero evidence: historical shared consumption is covered by the all-project billing export and its retained settlement uncertainty. Current repository inventory plus the provisional historical byte-month settlement supports this paused code rollout. [Repository location listing](https://docs.cloud.google.com/artifact-registry/docs/reference/rest/v1/projects.locations/list), [global Run inventory](https://docs.cloud.google.com/run/docs/reference/rest/v1/namespaces.services/list).

The reviewed deployment plan includes all existing market/deployment reservations, this rollout's full holds, settlement uncertainty, additional remaining-work headroom and the unchanged 25% provider margin:

| Deployment dimension | Reserved/projected total including headroom | Protected ceiling |
|---|---:|---:|
| CPU | 40,023.8 vCPU-seconds | 135,000 |
| Memory | 40,023.8 GiB-seconds | 270,000 |
| Artifact storage | 290,718,852 byte-month equivalents | 402,653,184 |
| Logs | 262,039,603 bytes | 40,265,318,400 |

These are conservative reservations, **not measured deployment costs**. The existing shutdown-only grants were verified through November 1 at 08:00 UTC; they were not extended. The rollout receipt permanently adds another 10,000 CPU/GiB-second hold, 83,475,577 artifact-byte-month hold and 16,777,216 log-byte hold. Do not run a second deployment merely to repeat validation.

The post-deployment inspection at **02:01:03 UTC** completed 15 bounded reads without errors. Scheduler is `PAUSED`, the API is private, and the complete stopped ledger hash remains `b4346cd44a5d2a91786c27908669a8523f3eabfe9aa3695adaeb5af27798e948`. Monthly and daily counters, allowance identity and expiry are unchanged. Current Registry metadata now reports 12,959,693 bytes; that gauge cannot refund historical or new byte-month holds.

**Activation blockers:** the ledger has no operating-capacity plan; daily Firestore operations remain unreported, account-wide Apps Script use remains unavailable, and verified upstream entitlement plus a bound on incoming/rejected traffic have not been established. The fresh 01:57:22 UTC usage query retains the original sample dates: its Run compute/request data still ends October 4. A fresh query is not fresh usage. The strict planner returns `paused` with no admitted cadence. Browser delivery also fails because Cloud Run invocation remains private; a Firebase browser token alone does not grant Run invocation. Enabling source gates or clearing the owner stop before resolving these blockers would not meet the selected free-tier requirement. No production permissions, billing settings or application ledger were changed.

Receipts: `.local/optimized-oct12-release.json`, `.local/private-release-free-20261001-optimized-oct12-apply.json`, `.local/deployment-inventory-20261012.json`, `.local/activation-readiness-20261012-postdeploy.json`, `.local/activation-validation-20261012.json`, and `.local/usage-dashboard-20261012-predeploy.json`. `scripts/read-deployment-inventory.cjs` provides the bounded direct inventory fallback. `scripts/validate-activation-readiness.ts` runs the actual capacity/access validators against captured fresh state without cloud writes or counter changes. The earlier settlement remains in force.

Validation: both deployed revisions reached ready on the exact reviewed image; **59 focused tests passed**, root TypeScript checking passed and `git diff --check` passed. The earlier complete suite passed 403 tests before deployment.

## Deployment reservation settlement — October 12, 2026, 9:47 p.m. Eastern

The owner explicitly authorized reconciliation. **The old deployment-reservation arithmetic no longer exceeds the protected ceilings**, after a provisional, evidence-backed settlement. This supersedes the earlier rule that every deployment estimate remains a full-period hold, only for the covered deployment batch. The runtime market ledger, its 8,340 CPU/GiB-second reservations, owner stop, deadlines and disabled gates are unchanged. Neither the optimized image nor any other cloud code was deployed during reconciliation.

The read-only reconstruction found **13 distinct private-release image digests and 22 service updates**, each matched to a unique ready revision and terminal service event. These match the documented aggregate of thirteen deployment reservations; the original local receipts themselves were not recovered. The history query returned 99 Run audit events and complete lists of 18 API and 15 collector revisions. The latest covered service update became ready on October 4 at 09:43:12 UTC. No Artifact Registry deletion audit entries were available.

The account-wide Google Billing CSV exported October 12 used all three projects, all services, all SKUs and all locations. It reports **1,683.7 CPU-seconds**, **1,683.7 GiB-seconds**, and **0.02 GiB-month** of Artifact Registry storage. These are rounded, provisional usage figures, not a finalized invoice. The CSV's unrounded total is $0.000001 from an existing Artifact Registry transfer row; the console rounds this to $0.00. No zero-cost claim is inferred from the displayed bill.

The settlement uses 1,683.8 for each compute meter and retains a separate **10,000-second uncertainty buffer** for each, in addition to the next rollout's 10,000-second hold and the existing 25% provider margin. It requires terminal deployment evidence at least 48 hours old. This is an application risk policy, **not a Google guarantee that reporting is final after 48 hours**. Google documents that reporting can take more than 24 hours: [Billing report availability](https://docs.cloud.google.com/billing/docs/how-to/reports).

Artifact storage is reconciled in **byte-months**, not current bytes. The current repository file list is complete and empty; its sparse historical size series is not integrated and missing samples are not treated as zero. The reported 0.02 GiB-month is rounded upward to 0.03 GiB-month (32,212,255 byte-months). The storage uncertainty calculation uses the larger of the original aggregate hold and the observed 1,588,252,852-byte peak throughout the uncovered reporting interval plus another 48 hours, and adds 1 MiB for metadata retention. This retains **158,253,804 byte-months** of uncertainty. Future uploads retain their entire new full-period holds. [Artifact storage units](https://cloud.google.com/artifact-registry/pricing).

| Deployment resource, including next rollout | Revised projected use | Protected ceiling |
|---|---:|---:|
| CPU | 30,023.8 vCPU-seconds | 135,000 |
| Memory | 30,023.8 GiB-seconds | 270,000 |
| Artifact storage | 273,941,636 byte-months (~0.255 GiB-month) | 402,653,184 (~0.375 GiB-month) |
| Logs, retaining every old log reservation | 245,262,387 bytes | 40,265,318,400 |

`scripts/deployment-reservations.json` preserves the documented floor even when `.local` receipts are absent. `scripts/deployment-accounting.mjs` reconstructs every settlement from hash-checked source files, rejects duplicate credits, wrong periods/scopes, changed evidence and unclassified compute SKUs, and keeps newer/ambiguous attempts additive. Recovered old receipts do not count twice; a larger recovered total rejects the settlement. The release helper separately enforces unchanged market reservations. A later observation uses the larger observed amount instead of adding the same covered use twice. Missing settlement files restore the documented floor; missing or changed files referenced by a settlement block its use.

The append-only saved record is `.local/deployment-settlement-rollouts-27701f7e19b7fc804ec2026e.json`, referencing `.local/deployment-history-20261012.json`, `.local/billing-skus-20261012.csv`, `.local/billing-scope-20261012.json`, and `.local/reconciliation-storage-20261012.json`. Keep these private files together when moving checkouts. The source baseline remains in Git; the private billing evidence is ignored. The concrete assessment is `.local/paused-release-assessment-1791856048879.json`. It remains **`deployable: false`**: numeric headroom alone does not supply fresh deployment scope, remaining-work bounds, or the missing operating-capacity plan.

Reproduce the offline reconciliation with:

```sh
node scripts/reconcile-deployments.mjs .local/deployment-history-20261012.json .local/billing-skus-20261012.csv .local/billing-scope-20261012.json .local/reconciliation-storage-20261012.json
```

Append `--write` to save the immutable record; repeating exactly the same evidence is idempotent. New evidence does not overwrite or credit an existing settlement a second time. `scripts/read-deployment-history.cjs <period-start-ISO> .local/<new-file>.json` and `scripts/read-reconciliation-storage.cjs <period-start-ISO> .local/<new-file>.json` collect bounded read-only evidence. The billing scope sidecar must record the actual visible report filters and reporting window when exporting the CSV; it must never be re-timestamped to make an old export appear fresh.

Validation: **403 unit tests passed**, including ten reconciliation tests covering missing receipts, unknown attempts, duplicate settlements, changed/missing evidence, account scope, terminal revisions, rounded units, storage retention, period isolation and preserved market counters. The production scheduler and ledger remain paused and unchanged.

## Free-tier restart review — October 12, 2026 (Eastern)

Historical pre-settlement assessment; the deployment reservation figures below are superseded by the reconciliation above.

The owner requested optimization before restarting to collect fresh usage data, and explicitly selected **stay within the free tier**. Collection remains paused. This review made no cloud deployment, scheduler change, ledger reset or permission change.

The collector now shares one fresh coordination read across immutable metadata reads and reuses the previously read Bazaar generation. A Bazaar response uses the same fresh control state for its payload identity and status. Mutable control is never cached between responses; request accounting, publication preconditions, lease checks and conservative admission reservations remain intact.

A local pass at **2026-10-13 01:28:04 UTC** successfully fetched catalog, election and Bazaar using three public-source requests, producing **2,201 products**. The Bazaar refresh took 121 ms locally. These are local source measurements, not deployed Cloud Run usage or a cloud CPU estimate. No rate-limit entitlement was inferred from the absent rate-limit headers.

An offline replay of that saved source against `HEAD` and the optimized engine produced the identical final snapshot SHA-256 (`a2c30b5c86a4e970d89d4b71b66a6ff7281177e1d6e5e5790f78b24dc5d46412`):

| Operation | Firestore reads before | After |
|---|---:|---:|
| Cold catalog/election/Bazaar collection | 27 | 22 |
| Cold Bazaar response | 3 | 2 |
| 20 warm Bazaar responses | 40 | 20 |
| Next Bazaar generation | 11 | 8 |
| Unchanged Bazaar generation | 12 | 8 |

These are modeled document operations in the offline Google transport, excluding live allowance admission/finish overhead. Writes and source-request counts were unchanged. The inline snapshot path used zero object-storage uploads. The unchanged-generation fixture was made due only in its isolated offline store; no live schedule or counters were altered. Raw replay results are `.local/benchmark-reads-before.json` and `.local/benchmark-reads-after.json`; the public sample is `.local/current-market.sqlite`.

Validation: **393 unit tests passed**; collector and market-function typechecks/build passed. The local application image passed both handler startup smoke checks with outbound connections blocked. It contains a 12,958,841-byte compressed application layer and retains an 83,475,577-byte conservative artifact hold. Image digest: `sha256:dd601e4c2f453b6fcd105adecd73aa19fda52c7fcd5031edfefdbf8f3f22ce2f`. It is **not uploaded or deployed**.

The read-only cloud inspection at **01:27:16 UTC** confirmed Scheduler `PAUSED`, a private API, the existing owner stop, **no capacity plan**, and the unchanged October allowance counters (8,340 CPU/GiB-seconds reserved). Project Monitoring returned about 1,658.92 CPU-seconds, but its latest reported Run sample was October 4; refreshing the dashboard does not make that sample current. Inspection receipt: `.local/activation-readiness-20261012.json`.

The previous thirteen rollout receipts are absent from this checkout. Their documented **130,000 CPU-second** and **1,187,621,148 artifact-byte** holds must not be treated as zero. Together with 8,340 market CPU-seconds and the next 10,000-second rollout, the documented CPU holds alone total **148,340**, exceeding the protected **135,000** ceiling. These are conservative reservations, not billed use. Artifact Registry returned an empty Docker-image list and no repository `sizeBytes`; neither proves historical byte-month usage or authorizes releasing old holds.

Restart still requires reconciliation of those retained deployment reservations and complete current capacity evidence within the existing free-tier controls, followed by the optimized deployment and activation. The lower read counts and small billed totals do not supply that missing evidence. No further owner approval is needed merely to restart within the already authorized free-tier scope.

## Cache optimization and rollout assessment — October 4, 22:02 UTC

The prepared market release replaces per-generation Storage objects for Bazaar, catalog and election with three fixed, private Firestore documents. Brotli quality 5, a checksum and explicit raw/encoded limits preserve the entire original snapshot, order books and source timestamps. The existing exempt `value` field holds the payload. One atomic preconditioned batch updates the snapshot and coordination state; stale/expired owners cannot publish. Oversize or corrupt data fails closed, with no fallback upload. Auction House continues to use its separate full-generation blob path and remains disabled. Legacy blobs remain readable during migration.

An offline replay of the saved 2,197-product snapshot preserved all **7,867,023 raw bytes** in **868,742 encoded bytes**, below the Bazaar **917,504-byte** field bound and Firestore's 1-MiB document maximum. Catalog/election fields are bounded at 128/16 KiB. Each new Bazaar-only invocation reserves **1,179,648 Firestore storage bytes**, including document overhead and coordination margin. This deliberately retains each hold even after overwrite or uncertain failure; it is not a claim that the fixed documents physically grow each cycle. Individual REST reads and decompression are bounded. [Firestore limits and free units](https://docs.cloud.google.com/firestore/quotas).

The new enforced `bazaar-inline` envelope permits at most nine Hypixel attempts across three single-page jobs, **zero snapshot uploads/Class A publication calls**, and three legacy blob reads during migration. Auction scans and unreserved uploads are refused. The planner and admission use the same envelope. CPU/GiB-second, read/write coordination reserves, 90% app stop, 25% provider margin, existing counters, stop markers and expiration stay intact. Daily orphan cleanup retains its separate reservation; Storage consumption is not globally zero.

This removes the Class A publication bottleneck but **does not certify minute freshness**. Complete 28/29/30/31-day model runs include the old app reservations and separately check every unit. With the existing conservative Firestore-transfer bounds, both old/new synthetic profiles select 12 hours for 28/29 days and 24 hours for 30/31 days. These are arithmetic fixtures, not current headroom or an operating recommendation. Actual supported production intervals remain **none for Bazaar and none for Auction House**. Browser polling remains conditional, small, nonoverlapping, shared between tabs and suspended when hidden; push adds no justified capacity benefit.

Backend deployment itself is blocked by retained rollout reservations, independently of collection activation:

| Deployment resource | Measured evidence | Prior retained reservations | Proposed rollout | Ceiling after 25% margin |
|---|---:|---:|---:|---:|
| CPU seconds | 1,658.92, project-only delayed sample | 130,000 rollout + 8,340 market | 10,000 | 135,000 |
| GiB-seconds | 1,658.92, project-only delayed sample | 130,000 rollout + 8,340 market | 10,000 | 270,000 |
| Artifact storage bytes | 51,837,574 current known repository | 1,187,621,148 conservative retained image holds | 83,486,629 | 402,653,184 |
| Log bytes | 1,632,307 project sample | 218,103,808 rollout + 8,749,056 market | 16,777,216 | 40,265,318,400 |

These numbers are **not actual billed spending**. Thirteen prior `.local/private-release-*-apply.json` receipts each retain a 10,000-second compute hold. Even those holds alone plus the next rollout exceed the compute ceiling. A smaller current storage sample is not permission to refund old image holds or uncertain retention. The release helper now checks all retained same-period rollout receipts, instead of relying on the latest project's sample. Separate shared-account history and byte-month evidence remain incomplete. Current billing membership lists only the collector project; former projects return no Run series and their Artifact Registry APIs are disabled. Those responses do not establish historical zero usage. Cloud Asset inventory returned permission denied; no API or permission was enabled. [Run allowance](https://cloud.google.com/run/pricing), [Artifact storage allowance](https://cloud.google.com/artifact-registry/pricing).

The local application image is built without Cloud Build, verified with outbound connections blocked, and retained locally without upload. `scripts/prepare-paused-release.mjs <image-directory>` writes a concrete assessment without deploying. The narrow `pausedCodeOnly` release path requires an unchanged stopped-ledger hash, both existing private services, false collection/evaluation/Auction House/mail/background gates, complete deployment evidence and preserved rollout holds. The generic Firebase market-deploy guard remains closed. A paused API response also returns before ledger, credential or shutdown I/O.

Validation: **400 unit tests**, **29 Firestore emulator tests** (including nine cache tests), and **26 desktop/mobile browser journeys** passed. Tests cover racing snapshot publishers, restart/legacy reads, exhausted inline storage before network I/O, failed/oversize publication retaining the previous snapshot, concurrent reservations, idle demand, source timestamps, private reporting and unchanged portfolio semantics. All application bundles/typechecks passed. The source-controlled model reads saved evidence only and makes no upstream calls.

Release scope: commit/push all reviewed preparation and reporting changes; Hosting can use its separate Spark storage allowance (948,532,519 bytes measured, with the entire local site conservatively added for rollout). The existing Apps Script reporting release is version 15. Market image upload/deployment remains blocked; no cloud build, permission change, billing change, collection, notification, email or scheduler activation is part of this release. Pausing still leaves retained infrastructure costs to reconcile.

Completed Hosting release at **22:06 UTC**, verified at **22:07 UTC**: implementation commit `768cfa6` is pushed to `origin/main`; version `7a2afaaf8a3466d4` serves matching SHA-256 hashes for the local HTML, app bundle and Usage dashboard bundle. A complete 48-version inventory conservatively counted 1,147,632,692 retained bytes; reserving the entire 39,344,216-byte local site remained below the 7.5-GB protected Hosting ceiling. Billing remained disabled for the Hosting project. Scheduler was rechecked `PAUSED`, and the complete stopped ledger matched its pre-release hash `b4346cd44a5d2a91786c27908669a8523f3eabfe9aa3695adaeb5af27798e948`. Receipt: `.local/optimization-hosting-release.json`. Apps Script deployment still points to version 15. The market image `sha256:d26639265cf89fc38584be9e38d29f8d3cc4f3a4f780b2724c426249dfe5f8da` is locally verified in free-tier mode, **not uploaded or deployed**.

Rollback: restore the preceding Hosting release if needed, keeping Apps Script v15 for the working private report path. For the unshipped market optimization, revert only the code commit; preserve every receipt, ledger, report cache and stored snapshot. Do not roll production back to an active legacy market image. A later backend rollout requires fresh complete deployment evidence and a period with sufficient capacity; neither a date change nor this commit resets old counters or resumes anything. Then complete the activation checklist at the end of this document using the owner's existing conditional authorization.

## Activation result — October 4, 19:31 UTC

The read-only check is complete enough to establish that **the present deployment cannot be unpaused safely**. It is not an activation-ready release. The following are distinct blockers, not an additional 65% throttle:

1. The production API is private. The deployed browser sends Firebase application credentials, which do not grant Cloud Run invocation. The old activation/recovery utilities silently granted `allUsers` invocation. They now require existing delivery access **before** any resume or ledger write and never grant permissions. A separate reviewed delivery change is necessary; simply resuming Scheduler would not deliver portfolio prices. [Run authentication](https://docs.cloud.google.com/run/docs/authenticating/public).
2. The persisted ledger has an explicit owner stop and **no capacity plan**. Its 39 collector admissions, 222 browser admissions, 8,340 CPU/GiB-seconds and all other existing reservations remain untouched. Source gates remain false, and the newer market runtime has not been released.
3. Whole-period headroom is not established. Billing Reports now provides account-wide quantities across all three listed projects, but it is delayed/rounded and does not report every required meter. Integrated Storage usage, database transfer, non-cloud sender usage, bounds on rejected requests/other writers, and a funded evidence-renewal path remain unresolved. No current plan can pass the mandatory checks, even at a daily cadence. Granting API access alone would not fix this.

Receipt `.local/activation-readiness-20261004.json`, collected at 19:21 UTC, confirms Scheduler `PAUSED`, private API IAM, and the stopped ledger. The inspection reserved 24 read requests and attempted 15, with no retry or production write. A wildcard Artifact Registry location returned HTTP 400; it is recorded as failed, not an empty inventory. The inspector now uses the known region and explicitly labels its repository scope incomplete.

Cloud Billing was read through the owner's existing browser session. October 1–4, all three projects, all services and locations: the UI displays **$0.00 net, $0.04 usage cost and -$0.04 savings**, rounded to cents. Only `bazaarsignal-510305` appears in the current-month project totals. Reported quantities include 447 Run invocations, 1,674 CPU seconds and GiB-seconds, 66 Storage Class A / 239 Class B operations, 433 Monitoring series, 0.02 GiB-month Artifact storage, and three Scheduler billing units. The latter is a cumulative billed unit, **not proof of three currently retained jobs or three consumed job-months**. The only listed issued credit is an expired 2025 trial; no trial balance is counted as allowance. An October invoice is not yet available in Cost Table. This manual observation is not a connected spend feed or proof of zero future charges. [Report quantities and limitations](https://docs.cloud.google.com/billing/docs/how-to/reports).

The latest durable local dashboard measurement is 19:19:26 UTC, with individual sample times retained. It reports 452 Run requests, 1,658.916656 allocation seconds, 64,798,686 Artifact bytes, 948,532,519 Hosting bytes and 102,304,944 observed Hosting transfer bytes. Different billing/Monitoring totals have different coverage and units; they are not netted against durable reservations. A fresh object inventory includes all versions and soft-deleted objects in the three known buckets: **7,022,121 bytes**. This closes the current object-list gap but is not a byte-month integral. The previously observed larger storage gauge remains evidence of earlier retention.

Local activation/recovery hardening passes 55 targeted tests, including strict capacity, reservation concurrency, paused automation, release checks and new access/capacity preflights. The full unit suite subsequently passed **380 tests across 39 files**. Collector typechecking and both activation CLI bundles pass. The preflight checks a full-period sustainable cadence, not merely the presence of a report. Missing/expired/exhausted evidence or a stopped ledger is rejected without changing counters. Recovery cannot bypass the false collection source gate. No production activation was attempted.

## Decision

Production reporting repair, October 4 at 19:55 UTC: the deployed Usage & Costs page now retrieves the private published report through the existing Apps Script backend (version 15). That backend verifies the Firebase identity and reporting-owner email before reading the configured owner report; it performs no collection, measurements, writes, email or scheduler action. The legacy datastore owner ID differs from the current reporting user's Firebase ID, so a direct browser read under the old owner namespace was refused. Existing permissions, rules and OAuth scopes remain unchanged. The live signed-in page was verified with **21 of 27 resources measured**, collection `Paused`, and actual spending `Unknown`. Screenshot: `.local/usage-report-fixed-production.jpg`.

Publication is explicit, not scheduled. `scripts/publish-usage-report.ts --publish` uses the existing durable 30-minute measurement admission, preserves observation timestamps and writes only the owner report with a Firestore version precondition. Same-report publication is a no-op; older/conflicting/uncertain writes are not retried. Receipt `.local/usage-publication-2026-10-04T19-55-23-989Z.json` records the final publication. The page's Refresh button reads the latest published report; it does **not** run cloud measurements. A report still becomes stale after its original freshness window, until a new measurement is explicitly published. This delivery fix does not provide continuous automatic reporting or establish collection headroom.

Run an explicitly requested report publication from the workspace with:

```powershell
npx esbuild scripts/publish-usage-report.ts --bundle --platform=node --format=esm --packages=external --outfile=.local/publish-usage-report.mjs
node .local/publish-usage-report.mjs --publish
```

The reporting release passed 388 unit tests, eight desktop/mobile usage journeys and seven owner/rules checks; frontend and Apps Script builds passed. Hosting and the existing Apps Script deployment were updated. Market services, scheduler state, billing, IAM, security rules and OAuth scopes were not changed. Rollback requires restoring the website and Apps Script version 14 together; retain the private report, original measurement cache/receipts, and every collection counter. Reverting would restore the former unavailable reporting path while market invocation remains private.

Continuous 60–90-second Bazaar collection cannot fit the retained object-per-snapshot design: a 31-day month needs at least 44,640 or 29,760 uploads, respectively. Cloud Storage's 5,000 monthly Class A allowance is already smaller, before other users, operations and safety margins. Browser delivery changes cannot remove this storage constraint. Other independent budgets further restrict cadence.

Keep the existing shared collector/cache and conditional polling **disabled** until complete headroom is established. The new planner chooses the shortest interval satisfying every allowance and the existing application limits. Today's evidence returns `paused`; **no active interval, including hourly collection, is certified**. A different storage design would need its own measured costs and complete scopes, not another unverified published allowance.

## Read-only state and evidence

Inspection at **1:38:26 p.m. Eastern / 17:38:26 UTC** confirmed:

- `bazaarsignal`: billing disabled, no linked billing account. Static Hosting, Google authentication and private default Firestore remain separate from the collector project.
- `bazaarsignal-510305`: billing enabled. The billing-account project list returned only this currently linked project, with pagination complete. Former projects `hip-fusion-451104-t5` and `nail-salon-app-457601` remain unreconciled. Empty billing-change logs do not prove zero historical consumption.
- Scheduler `firebase-schedule-refreshMarket-us-central1` is **PAUSED**. `marketapi` has no public invoker binding. Both Run services retain request billing, 1 vCPU / 1 GiB, no configured minimum instances, maximum one instance, with 15/90-second API/collector timeouts.
- Three `us-central1` Standard buckets remain: market cache without versioning/soft delete; sources with versioning and seven-day soft delete; uploads with seven-day soft delete. Retained versions/deleted objects still consume storage.
- Artifact Registry has **90,717,025 bytes**, scanning disabled. Inspected Logging buckets retain default/required logs for 30/400 days. No resources, cloud builds, images or hosting releases were created.

The local preparation additionally gates off legacy queued-mail draining, scheduled workers, trigger installation and editor test sends. These gates were subsequently deployed in Apps Script version 14 by the separate release. That closes the earlier deployed-code blocker; whole-account trigger/property/runtime consumption is still not established. This task did not run or modify the sender.

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
7. Verify the exact source/image digest, immutable ledger/evidence diff, schedule, delivery access and rollback receipt before using the owner's recorded authorization to unpause collection. Do not ask for the same activation approval again. Production permission changes, new paid services, email/evaluation and Auction House remain outside that authorization; prepare any necessary separate decision concretely before asking. Do not activate while headroom is unknown.

Rollback: keep every false gate and production job paused; revert only this task's local edits, preserving concurrent user work. Never restore an old ledger snapshot, reset counters or return to an active legacy release. For a future deployed rollback, use existing shutdown first, preserve all reservations/receipts/cache/private records, then restore the last approved **paused** image. Retained storage and delayed costs still require reconciliation afterward.
