# BazaarSignal reliability rollout and rollback plan

Prepared October 22, 2026. **Planning only. No deployment or production action is authorized by this document.**

Release the bounded paid ledger, complete alert-evaluation passes, and item refresh/retry fixes through a maintenance window. Keep the API closed and every collector entry point paused until both market services run tested v2-compatible code. The first successful admission upgrades the ledger automatically; after that point, an old v1-only image is not a valid rollback.

An old runtime does more than reject the new format: its paid-runtime error path can record a stop and invoke infrastructure shutdown. Preventing any old writer from receiving traffic after migration is therefore an availability requirement.

This plan is based on local source, tests, and the historical October 21 release record. Current cloud state, permissions, revision IDs, traffic tags, remaining admission capacity, and rollback artifacts need fresh verification before execution. No live handlers or production management tools were invoked to prepare it. Only this document was added.

## Scope and fixed safeguards

| Component | Intended change | Preserve |
| --- | --- | --- |
| `marketapi` and `refreshmarket`, project `bazaarsignal-510305`, region `us-central1` | Deploy the same reviewed image digest with v1/v2 readers and atomic receipt writes | Service identities, endpoints, environment, limits, shutdown authority, price sources, fixed expiry |
| `marketCache/paid-budget-october` | First admission writes `version: 2`, total `admissionCount`, and a separate receipt atomically | Existing inline admissions, observed/reserved counters, deployment holds, billing evidence, legacy hash, stops |
| Apps Script | Complete bounded subscriber sweeps, truthful outcome counters, safe inactive-subscriber cleanup, v2 Admin reader | Script and deployment IDs, sender, scopes, trigger ownership, opt-ins, delivery receipts, crossing state and cursors |
| Hosting site `bazaarsignal` | Quarter-hour item checks and bounded recovery at server retry deadlines | Authentication, private records, deployed design and unrelated user changes |

The existing collection schedule is expected to be `*/15 * * * *` UTC, and the daily archive `59 4 * * *` UTC. Change neither expression, target, identity, nor retry policy. A future authorized maintenance operation may temporarily pause and resume their existing enabled states. Do not resume a job that was already paused before maintenance without separate authorization.

Keep the 4,000-admission ceiling, $5 target, $4.50 stop, and **November 1, 2026 at 07:00 UTC** expiry. Code uses Google-reported net cost when available and conservative reservations before the first report; these are different measurements. The existing $0.50 rollout reservation is an internal retained allowance, not an actual charge. Do not increase limits, renew the pilot, refund holds, clear an existing stop, or restore an older accounting snapshot.

## Required preparation before production authorization

1. **Freeze an explicit source manifest.** Preserve the dirty workspace. Use a separate staging directory with the actual deployed source plus the reviewed fixes and their dependencies; compare against the working tree and record inclusions and exclusions. Do not build an unreviewed whole-workspace deployment. `.local/first-three-fixes/before/` is a pre-change working-tree backup, not proof of deployed source; `.local/cadence-oct21-source.json` is historical evidence, not a current manifest. Pin source hashes, dependency locks, image digest, Hosting file hashes, and Apps Script bundle hashes.
2. **Prepare a v2-compatible fallback.** Retain the previous cloud images and configuration, but also build and test a fallback from the previous behavior with the necessary ledger-v2 storage/read/finish compatibility backported. It must retain separate receipt writes, total-count validation, deduplication, the larger ledger reader, and atomic accounting. Include the v2 Admin reader in any Apps Script fallback. Record the fallback image digest and both handler test results. This fallback does not yet have a verified release artifact; it is a prerequisite, not an existing rollback promise. If the ledger change itself is defective, the safe fallback is containment followed by a tested forward repair.
3. **Rehearse the exact artifacts in isolation.** Existing implementation results are 643 unit tests passed, one skipped, 54 public browser cases and two emulator portfolio-retry cases passed, with type checks and local bundles passing. Re-run appropriate checks against the staged candidate and fallback. Cover v1-to-v2 transition, a legacy ledger above 128 KiB, 4,000 maximum-length IDs, duplicate admission/finish, ambiguous commits, contention, expiry, stop/budget/cap preservation, paginated subscriber sweeps and failures, re-enable races, hidden-tab recovery and 503 retry deadlines. Verify the packaged image using `scripts/verify-market-image.mjs`: it blocks outbound connections and starts both handlers without invoking them.
4. **Rehearse the operator workflow with a fake control plane.** Test a failure after either service update, expired evidence, IAM/schedule drift, a lost response after an applied mutation, rollback before and after migration, and any unexpected ledger write during containment. Uncertain operations must be reconciled by operation ID/current state; never blindly repeat a mutation or reserve another hold. No rehearsal may use live credentials, Firestore, collection endpoints, or MailApp.
5. **Prepare a bounded migration coordinator or equivalent reviewed operator procedure.** The existing active-update command cannot safely execute this transition unchanged. It requires an enabled Scheduler and public API, and it updates the services sequentially while retaining latest-revision traffic. Its `--both-services` preparation flag selects both services but provides no barrier between writers. The throttle-repair path requires a real, specific stopped ledger and must not be repurposed by manufacturing a stop.

The migration procedure must verify both jobs paused, API access contained, both service identities and configurations, stable ledger state, immutable candidate/fallback digests, and current etags before each update. It must retain the existing reservation and continuity checks while explicitly supporting a **temporarily contained, otherwise active paid ledger**. Record every intent, API operation ID, response and verification in a private receipt. Bound calls, response sizes, timeouts and retries. Revalidate evidence after containment instead of bypassing the existing guards. Review and test this procedure before requesting execution authorization; this planning task does not implement it.

## Preflight evidence and go or no go

Collect the following directly from management APIs and Firestore, without invoking application handlers. Store raw evidence securely outside tracked source; never put tokens or private account records in release notes.

| Evidence | Required decision |
| --- | --- |
| Both service configurations, effective IAM, revision traffic and tags, image digests, health/startup probes, service accounts and limits | Identify all callable routes, including old tagged revisions and authenticated callers. Verify `invokerIamDisabled` is false. A probe that invokes a paid handler is a writer and must be addressed before staging. |
| Every Scheduler job or other integration targeting the collector | Include both the quarter-hour job and `bazaar-daily-close`; resolve any additional writer before proceeding. Preserve exact cron, timezone, URI, OIDC audience/identity, retry settings and original state. |
| Raw paid ledger with document update time, control state, legacy-ledger bytes/hash, any existing v2 receipts | Confirm expected format, capacity, active period, no stop, and immutable identity. Hash raw legacy bytes rather than reserialized JSON. Already-v2 means rollback restrictions already apply. Unexpected receipt/count disagreement is a no-go. |
| Billing observation, its time/scope/errors, retained reservations, repository storage and deployment holds | Confirm real cost evidence separately from holds. If evidence is unavailable or too old to assess remaining headroom, defer; do not interpret it as zero or reset accounting. |
| Apps Script current saved source and manifest, web deployment version/source, properties, trigger inventory and owner, current executions, worker control and relevant delivery state | Preserve both source and web deployment. Confirm the existing sender-owned minute trigger and inspect duplicates under relevant owners; one account cannot see another owner's triggers. |
| Hosting current release/version and downloaded artifact hashes | Verify an exact rollback release, including Firebase and Apps Script configuration. |

Use fresh evidence, no older than the existing release tooling's 30-minute window, and refresh it after any material change. Record the maintenance window, operator, release ID, candidate/fallback digests, per-service old/new revision IDs, expected IAM deltas and precise stop conditions before execution.

Check admission headroom for the expected remaining quarter-hour runs, daily runs, browser/API demand, and verification reads until expiry. A useful baseline is `ceil((expiresAt - now) / 900000)` quarter-hour admissions, plus daily work and a documented API forecast. Less than 4,000 used is not sufficient evidence of adequate remaining capacity. Rollout accounting must have room for its retained hold and fallback; add no hold until an authorized execution actually reserves it.

The new implementation retains old inline receipts. It prevents further receipt growth in that map but does not compact an already-large document. Measure the actual document and remaining Firestore headroom before adding deployment metadata. The under-8-KiB test result applies to a fresh aggregate with separate receipts, not every existing production ledger. Operator readers also need an adequate wire-size bound: the current preflight and `read-paid-pilot.cjs` cap responses at 1 MiB, which may be insufficient for JSON-escaped legacy data even though the application reader was enlarged.

## Ordered execution for a later authorized maintenance window

### 1 Contain all writers and drain ongoing work

Choose a window away from the daily archive at 04:59 UTC and Admin collection around 12:10 UTC. Start just after a completed quarter-hour cycle where practical. Tell the user the expected interruption is at least the deployment/drain time plus up to one natural 15-minute collection interval; do not promise a fixed duration.

1. Capture the pre-maintenance state. Set only the existing Apps Script `MARKET_UPDATES_PAUSED` property to `true`. Preserve `PAID_LAST_MAIL_SLOT`, `PORTFOLIO_CURSOR`, all `portfolio-sent:*` receipts, runtime/admission counters, preferences and delivery state. This gates new alert passes but does not cancel a pass already executing. It also does **not** gate the earlier daily Admin branch; avoid that window and drain any active Admin execution.
2. Pause both existing Scheduler jobs if enabled and verify their state is `PAUSED`. Disable no APIs, delete no jobs, and change no cron expressions. Freeze operator billing/configuration/recovery scripts and any other identified writers for the window. A Scheduler pause is a scheduling control, not evidence that a previously dispatched request has finished. [Scheduler pause and resume semantics](https://docs.cloud.google.com/scheduler/docs/reference/rest/v1/projects.locations.jobs/pause).
3. Restrict public API invocation using the exact reviewed IAM delta and a current policy etag. Keep the Invoker IAM check enabled. Inspect inherited access and coordinate every authenticated caller; removing `allUsers` alone does not stop them. Keep the collector private. Do not grant new invocation privileges or merely hide the Hosting page. [Cloud Run public access controls](https://docs.cloud.google.com/run/docs/authenticating/public).
4. Verify the barrier from configuration, execution/log evidence, and stable data. Require all known pre-barrier API/collector requests and Apps Script executions finished; compare two bounded ledger/control observations at least 30 seconds apart. Budget at least three minutes for drainage after access changes, extending it if completion or permission propagation is uncertain. The source declares 15-second API and 90-second collector request limits, but elapsed time alone is insufficient: Cloud Run may continue work after a request timeout. Never convert an unfinished receipt into a refund. [Cloud Run request timeouts](https://docs.cloud.google.com/run/docs/configuring/request-timeout).

**Gate:** no unexplained changes to paid accounting or collection state after drainage. Pending delivery work remains untouched. If a barrier cannot be proven, keep services contained and do not introduce v2 writers. Take the authoritative pre-transition snapshot now, after old work has drained.

### 2 Deploy both market services behind the barrier

1. Retain the authorized rollout reservation once using the ledger's current update-time precondition. Record the resulting ledger as the new accounting baseline. An acknowledged or ambiguous reservation remains held; reconcile uncertainty before proceeding.
2. Upload the pinned candidate and required rollback artifacts under the reviewed storage/cost envelope. Deploy `refreshmarket` first and `marketapi` second while both jobs remain paused and API traffic remains blocked. Neither order is safe without the barrier. Keep only reviewed image/traffic changes; preserve env values, accounts, endpoints, scaling, resource settings and expiry.
3. Verify each completed management operation and ready revision's actual image digest. Assign 100% service traffic to the reviewed new revision for each service, preferably pinned by revision rather than an unverified `LATEST` pointer. Remove or contain old revision tags and alternative invocation paths before reopening. Do not split v1/v2 traffic or canary a new handler against the shared live ledger. Routing changes are not instantaneous and do not terminate ongoing requests. [Cloud Run traffic migration](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration).
4. Confirm both services now have v2-compatible code and that containment still holds. The ledger should still be v1 if it started v1, with no receipt/admission-count change from deployment itself. Changes should be limited to the explicitly reserved deployment hold. An unexpected v2 write indicates a missed writer or probe; investigate before continuing.

If either deployment fails, remain contained. Use the rollback table below; never reopen only one migrated service. A ready revision is startup evidence, not proof of successful application behavior.

### 3 Stage the worker and browser fixes

While the worker property remains paused, upload the reviewed Apps Script source/manifest, create an immutable version, and update the **existing** web deployment to that version. Retain the original URL, sender, scopes, access configuration and trigger. Verify saved source and versioned source hashes separately. Triggers are installed against a project function, not a versioned web endpoint; restoring only the web deployment is not a sufficient worker rollback. Treat saved-source changes as affecting trigger execution. [Apps Script deployments](https://developers.google.com/apps-script/concepts/deployments), [installable triggers](https://developers.google.com/apps-script/guides/triggers/installable).

Do not call `configurePaidPilot`, install replacement triggers, execute `scheduledPaidMinuteTick`, or send a test message. Those actions are unnecessary for this code release. The existing anonymous-rejection diagnostic can be included in the later approved verification packet; it does not evaluate alerts, but it is still a live endpoint call and is not part of this planning task.

Prepare and publish only the reviewed Hosting artifact once both market revisions and Apps Script versions are verified. Keep collection and mail gated during this step. Hash static files directly without opening a live page that automatically calls the market API. Do not clear browser caches or local portfolio history. Test user interactions using isolated browser fixtures.

### 4 Resume incrementally and verify the first v2 admission

This stage changes production execution. It requires explicit authorization to resume normal collection, API traffic and, separately, opted-in alert delivery. A deployment authorization that retains a no-email restriction must leave the worker paused; report the alert rollout as pending operational verification.

1. With both services on verified v2 code, resume only the previously enabled quarter-hour job. Keep the daily job paused, API private, and worker paused. Wait for the next natural scheduled run; do not use Run now, invoke the collector URL, or replay a missed schedule. Keep exact schedule and retry settings. Natural dispatch must still be treated as potentially duplicated because Scheduler provides at-least-once delivery. [Cloud Scheduler delivery semantics](https://docs.cloud.google.com/scheduler/docs/overview).
2. Observe that run through logs and direct management/Firestore reads. Confirm its revision, scheduled event identity, a successful snapshot with real timestamps, `version: 2`, the expected single additional admission, matching receipt, and finish accounting. Point-read the receipt derived from that event with `paidReceiptKey`; do not scan all 4,000 receipts to verify one run. A duplicate event must not create another receipt/hold. Preserve all legacy entries and compare monotonic counters/holds against the recorded baseline. Billing fields may legitimately advance during this run; fixed identity, expiry and prior holds may not change.
3. Only after the natural run passes, restore the API's exact authorized invoker access. Ordinary API GETs, including price-history reads, can now admit paid work; they are not read-only verification. If explicitly approved, make one bounded cached-item GET and check HTTP status, unchanged response contract, `pollMs`/`bazaarMs` of 900000, original sample timestamps and completed accounting. Otherwise observe ordinary traffic and label API behavior unverified until evidence arrives.
4. Restore the daily archive job to its captured original state after confirming it still points to the same tested collector. Its next natural run verifies archive operation; do not generate backfill or rewrite history to hide a maintenance gap.
5. Restore the worker pause property to its captured enabled value only when normal opted-in email delivery is authorized and fresh market evidence is available. Keep existing mail slots/cursors/receipts. Let the next eligible minute tick run naturally; do not reset a slot to force it. Existing queued events can be eligible for delivery on resume, so this is not a no-mail action.

If rollout time overlaps a scheduled run or evaluation window, accept the gap and record it. Do not replay missing runs or fabricate observations.

## Verification and stop conditions

Use bounded observations after the first natural collection, the next eligible alert window, a second collection/evaluation cycle, and the next natural daily archive. Prefer logs and direct state reads over repeated billable market requests. This plan creates no recurring monitor.

| Area | Pass evidence | Stop or contain when |
| --- | --- | --- |
| Ledger | Correct v2 count; old inline holds intact; new receipts match real events; finished observations recorded once; no unexpected version/identity change | Lost/decreasing count, hold or observed counter; unknown receipt; repeated parsing/contention/write errors; unexpected stop; expired/exhausted pilot |
| Collection | New revision processed the natural quarter-hour event; complete fresh snapshot and no new consecutive failures | Wrong revision, missing/failed next natural run, stale/malformed publication, or unintended schedule/target change |
| API | Bounded ordinary request or organic traffic succeeds with retained contract and 15-minute policy | Old revision handles traffic; persistent 5xx; unexplained admission growth; missing/incorrect backoff or expiry directives |
| Worker | `paidLastAttempt`, `paidLastProcessed`, `paidLastFailed`, `paidLastComplete`, cursor, and subscriber `lastSample` agree with actual work | Missing two eligible opportunities, failures without reported errors, repeated incomplete sweeps with no cursor progress, duplicate receipt/delivery behavior |
| Browser | Exact artifact hashes; isolated desktop/mobile checks pass at :02/:17/:32/:47; retry deadline survives cached error/old data; hidden pages make no catch-up loop | Failed refresh/recovery, hot request loop, lost cached values, or unrelated UI changes |

For a small active subscriber set, expect all eligible accounts evaluated each pass, zero failures and `complete: true`. Above 100 accounts or the 40-second work budget, partial progress is intentional; use cursor movement and sample advancement rather than demanding full completion every interval. No active subscribers means an idle complete pass, not a new successful-evaluation timestamp. A successful worker pass does not prove inbox delivery, and this rollout requires no test email.

Do not induce a production 503, alter thresholds/holdings, toggle user opt-ins, or create a crossing to verify these fixes. Recovery, thresholds, duplicate delivery and failure handling are verified with isolated tests. If the pilot expires or a budget/owner/unknown stop appears, preserve it and leave execution closed pending a separate decision.

## Rollback decisions

First contain the affected execution and capture current state; never start by restoring a database backup. For any cloud accounting uncertainty, repeat the full writer barrier and drainage procedure before changing either service.

| State or failure | Safe rollback | Prohibited or incomplete rollback |
| --- | --- | --- |
| No v2 admission yet; ledger verified v1 | Restore both captured old service revisions/configuration while contained, then verify continuity and restore only previously enabled access/jobs. Retain all rollout holds. Test that the existing ledger fits the old reader; if it already exceeds the old 128-KiB response bound, use a compatible fallback or remain paused. | Assuming old code works merely because the ledger says v1; refunding deployment reservations |
| Ledger v2 or any uncertain migration outcome | Keep v2 data intact. Deploy the rehearsed v2-compatible fallback to both services, verify digests/traffic and continuity, then resume with the same natural-run gates. If no trusted fallback exists, stay contained and prepare a forward repair. | Rolling either service back to v1-only code; changing `version` to 1; deleting receipts/counts; replaying an older ledger or clearing `stoppedAt` |
| Only item refresh/retry UI regresses | Restore the exact prior Hosting version; keep the v2 API/collector. Existing open tabs may retain new JavaScript until reload, so verify both client versions remain compatible. | Downgrading accounting to undo a client change; claiming Hosting rollback instantly replaces loaded tabs |
| Worker sweep or notification behavior regresses | Pause the worker property and drain execution. Restore tested fallback saved source **and** the existing web deployment, retaining v2 Admin reading and the deployed quarter-hour cadence. Keep current properties, mail receipts, crossings, sequences, queue states and runtime holds. Verify before authorized resumption. | Restoring stale script properties or delivery ledgers; clearing slots/receipts; resetting alert baselines; assuming an email can be undone |
| Accounting integrity or actual delivery outcome is uncertain | Remain paused, preserve evidence and reconcile. Treat ambiguous mail acceptance as unresolved; never resend to test it. | Blind retries, forced collection, test mail, automatic stop recovery |

Restore only the intended service image/traffic or IAM delta against a fresh etag. Do not replay a stale whole-service or whole-policy JSON over unrelated changes. Any drift from the captured state requires re-review. Old tagged revisions must remain unreachable after migration even if retained for forensic comparison.

Production backups are recovery evidence, not an automatic rollback mechanism: restoring them can remove paid holds, permit duplicate processing, or lose user edits. No database, rules, secrets or private portfolio migrations are part of this release.

## Release packet and outstanding preparation

Before requesting execution, provide one packet containing the source manifest; candidate and v2 fallback digests; exact Hosting and Apps Script versions; isolated test and image-smoke receipts; fresh preflight evidence; capacity/spending assessment; precise temporary IAM/job/property deltas; tested coordinator/procedure; stop conditions; and the permission scope for resuming collection and opted-in mail.

**Still required:** build and verify the staged candidate/fallback artifacts; implement or rehearse the contained migration procedure; gather fresh live management evidence; choose the maintenance window; and obtain execution authorization. Historical revision IDs in the October 21 notes must not be substituted for these checks. No production readiness is claimed from the earlier unit-test results alone.

Local implementation references: [ledger](../collector/paid-budget.ts), [receipt format](../collector/paid-ledger-storage.ts), [atomic store](../collector/google-cache-store.ts), [bounded reader](../collector/trial-google.ts), [shared collector and history entry point](../market-functions/src/index.ts), [worker](../apps-script/portfolio-backend.ts), [worker gates](../apps-script/backend.ts), [release validators and execution](../scripts/private-trial-release.mjs), [preflight tooling](../scripts/prepare-active-paid-release.mjs), and [unreleased implementation notes](QUARTER-HOUR-REFRESH-2026-10-21.md#unreleased-reliability-fixes--october-22).

Do not run activation, cadence configuration, throttle recovery or `check-paid-spending.ts` as a harmless inspection. Cadence inspection itself calls the paid API; the spending check consumes the feed and writes accounting; recovery/activation change operating state. The recommended rollout uses none of these shortcuts.
