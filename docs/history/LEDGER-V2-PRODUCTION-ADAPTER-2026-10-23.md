# Ledger v2 production adapter and live evidence

> Historical record. Dates, deployment versions, service status, costs and approvals below apply only to the recorded work. They are not current setup instructions or authorization to operate services. See the [documentation index](../README.md).


The production management adapter is implemented and tested with isolated REST fixtures. Only read-only observation mode ran against Google. No artifact was uploaded, no deployment or production configuration was changed, no collection was invoked, and no email was sent.

This supersedes the missing-adapter prerequisite in the [release packet](LEDGER-V2-RELEASE-PACKET-2026-10-23.md). The previously prepared candidate and fallback artifacts remain unchanged. This is not a production go-ahead: execution still requires fresh evidence, an owner maintenance checkpoint, a reviewed admission forecast, and explicit authorization.

## Implemented behavior

| File | Responsibility |
| --- | --- |
| [ledger-v2-production.mjs](../../scripts/ledger-v2-production.mjs) | Production coordinator adapter, CLI, durable journals, OCI upload, async Cloud Run updates and traffic pinning, worker saved source/version/deployment, Hosting publication, fallback, and natural-run evidence validation |
| [ledger-v2-google-http.mjs](../../scripts/ledger-v2-google-http.mjs) | Fixed-scope management transport; read-only by default; bounded responses/calls; no redirects, automatic mutation retries, app endpoints, script execution, collection endpoints, or mail APIs |
| [ledger-v2-observe.mjs](../../scripts/ledger-v2-observe.mjs) | Bounded read-only inventory and an honest summary of missing evidence |
| [prepare-ledger-v2-migration.mjs](../../scripts/prepare-ledger-v2-migration.mjs) | Local plan and checkpoint drafts; never grants permission or invents missing values |
| [ledger-v2-migration.mjs](../../scripts/ledger-v2-migration.mjs) | Existing coordinator, now accepts a specifically authorized production adapter and delegates compound-action reconciliation |

Execution permission binds the exact plan hash, packet hash and release ID, identifies its reviewer, and expires within 30 minutes. Maintenance permission does not authorize collection, API reopening, daily-job resumption, or mail resumption. Those are separate capabilities. No approved authorization file was created in this task.

The adapter independently checks each reservation is exactly the retained $0.50 hold plus reviewed resource allowances. It rejects ledger resets, unrelated IAM grants, incompatible managed runtime bases, changed etags/configuration, and attempts to reduce the artifact allowance below the packaged requirement. Both cloud services must remain contained through their transition to v2. Production rollback selects only the verified v2 fallback; no v1 downgrade path is exposed.

Cloud changes use conditional image updates, bounded operation polling, ready-revision image verification, and a separate traffic update. Real Cloud Run responses use short revision IDs in traffic targets and full resource names in `latestReadyRevision`; the adapter normalizes these for the coordinator. It checks actual serving traffic as well as desired routing. See Google's [service update](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/patch) and [operation polling](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.operations/get) contracts.

Hosting files use gzip-level-9 content hashes, matching the installed Firebase CLI. The two existing reserved Firebase initialization files and the current serving configuration are preserved. Saved worker source and the versioned web deployment are both updated and verified; the existing script ID, deployment ID, manifest/scopes and description are retained. See the [Hosting upload contract](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.versions/populateFiles) and [Apps Script deployment update](https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments/update).

The journal records intent before requests, operation IDs, verification outcomes, and reconciliation state. Two fsynced checkpoints retain the entire history while bounding local disk use; a single-writer lock prevents concurrent journal owners. Restarts recover the last valid checkpoint and retain request counts. Requests are capped at 1,500 per run, 30 seconds each, 3 MiB per response and 64 MiB total response data; each Cloud Run operation has at most 20 five-second polls. The coordinator retains its separate 200-call bound.

Lost acknowledgements are reconciled from current state. A lost Apps Script version response can be recovered from one matching release marker plus the immutable content hash. Unknown upload-session or Hosting-version creation outcomes remain blocked rather than creating duplicates. A terminal deployment error or unresolved outcome leaves writers contained and requires investigation; there is no automatic production rollback or reopening.

## Fresh read-only findings

The final inventory ran **October 23, 2026, 13:29:50–13:29:58 UTC** (09:29 EDT). Its summary (local evidence: `.local/ledger-v2-production-adapter/live-final/summary.json`) and raw management evidence (local evidence: `.local/ledger-v2-production-adapter/live-final/evidence.json`) are local and ignored by Git. These observations are historical once captured and must be refreshed for execution.

| Area | Confirmed at observation time |
| --- | --- |
| Collector | `refreshmarket-00026-gmt`; expected October 21 digest; private invocation policy |
| API | `marketapi-00029-nxg`; same expected digest; public invocation policy |
| Traffic | Both desired and actual traffic at 100% on their expected ready revisions |
| Schedules | Both enabled; quarter-hour `*/15 * * * *` UTC and daily `59 4 * * *` UTC |
| Paid ledger | v1; 71,699 bytes; 681 admissions; zero external receipts; 3,319 slots remaining; stable across the paired reads |
| Accounting | $7.28954 retained internal reservations; separate latest Google-reported cost **$0**, published 12:51:31 UTC; no recorded stop or billing error |
| Integrity/expiry | Legacy ledger hash matches; expiry remains November 1, 2026, 07:00 UTC |
| Apps Script | Existing web deployment remains version 23; saved source and deployed source inspected |
| Hosting | Version `f1d67549bb434abf`, released October 21; 111 listed files, including two reserved Firebase initialization files |

The $7.29 reservation figure is not actual spending. The $0 report is delayed billing evidence, not proof that every current operation is free. Remaining admission capacity is a count, not a forecast of remaining demand.

The app's 109 Hosting file hashes match the prepared fallback. Both cloud digests match the packet's historical baseline. The worker's saved source matches its deployed version and archived source hashes. These comparisons are recorded in validation.json (local evidence: `.local/ledger-v2-production-adapter/validation.json`).

Two live observations used 51 bounded management requests in total. The POST requests were read-only Firestore queries and project IAM reads. The request journals contain no mutation calls. The Artifact Registry file listing returned no files; that alone is not proof of zero Docker storage. The draft retains the larger existing artifact reservations rather than treating an empty listing as measured spending or zero storage.

## Evidence that remains unconfirmed

- Apps Script process listing returned **HTTP 403** with the existing credentials. No scope, login, or permission change was attempted. Active worker executions remain unknown; see the [process-list scope requirement](https://developers.google.com/apps-script/api/reference/rest/v1/processes/listScriptProcesses).
- Script properties and trigger inventory have no project-management REST accessor. Worker pause state, other properties, trigger ownership and delivery-state preservation require owner inspection. The adapter writes a checkpoint request and stops; it never invokes a configuration function. The available [project methods](https://developers.google.com/apps-script/api/reference/rest/v1/projects) do not supply those values.
- A service GET does not prove all in-flight requests have drained. Effective inherited/custom permissions, authenticated callers, Admin writers, and completion of existing executions still need an owner review tied to the fresh IAM and Scheduler inventory hashes.
- Apps Script content updates and Hosting releases lack the Cloud Run/Firestore conditional-write guarantees used here. The adapter checks before and after, and requires explicit exclusive-maintenance evidence. It cannot lock other operators out of those products.
- A natural-run acceptance requires a finished, correctly keyed v2 receipt; the expected scheduled event and current revision; matching Scheduler attempt and fresh control/snapshot metadata; and an owner-reviewed execution-log reference/hash confirming the natural run and complete snapshot. It does not infer success from a green service status.

The owner checkpoint is valid for at most ten minutes. `barrier.drainVerifiedAt` must record completion verified after the latest containment change; old zero-count evidence is insufficient. Missing fields remain unknown and block execution; the adapter does not convert a 403 or missing field into a zero execution count. Real write-path acceptance, cloud runtime behavior and delivery behavior have not been tested in production under this task's restrictions.

## Local preparation and future use

The generated draft directory (local evidence: `.local/ledger-v2-production-adapter/draft-final/plan.json`) contains `plan.json`, `owner.json`, `approval.json` and `pending.json`. `remainingAdmissionsRequired` is deliberately null, owner evidence is incomplete, and approval is false. They are review inputs, not executable authorization. Fresh observation is required before finalizing them.

Safe local/read-only commands:

```powershell
node scripts/ledger-v2-observe.mjs --observe .local/ledger-v2-new-observation
node scripts/prepare-ledger-v2-migration.mjs .local/ledger-v2-release-oct23/packet.json .local/ledger-v2-new-observation/evidence.json ledger-v2-new .local/ledger-v2-new-draft
npx vitest run tests/ledger-v2-production.test.ts tests/ledger-v2-google-http.test.ts tests/ledger-v2-migration.test.ts tests/ledger-v2-packet.test.ts tests/active-paid-release.test.ts
```

Choose unused local output directories. The production CLI requires `--execute`, explicit packet/plan/approval/owner-evidence files, a private journal directory, and one command. No execution command was run here. During a later authorized window the sequence is `contain`, `deploy`, `resume-collection`, `verify-natural`, `reopen-api`, and `resume-daily`; `resume-mail` requires its own authorization. `reconcile` resumes verified substeps after an interruption. `rollback` recontains all writers and selects the v2 fallback, then stays contained.

Do not approve the draft without reviewing admission demand and resource headroom. Recompute the approval's plan hash after any plan edit. Never remove the compatibility layer, refund retained holds, clear a stop, extend expiry, or reuse the old active-release command to bypass these barriers. The shared cloud fallback cannot repair a ledger implementation defect; that remains a contained forward-fix operation.

## Validation and preservation

**104 tests passed:** 24 production-adapter tests, 12 transport tests, 40 coordinator tests, 16 packet-integrity tests and 12 existing release-guard tests. Tests use an in-memory REST service with synthetic credentials and temporary packet files; every mutation is isolated. Coverage includes uploads, either service's operation failures/timeouts, lost acknowledgements, restarts, reservation deduplication, concurrent changes, output integrity, checkpoint enforcement, fallback, and permission separation. The existing six artifact-bound coordinator rehearsals and root TypeScript check also passed.

The only pre-existing file edited for this task is the migration coordinator, to connect the adapter and recovery hook. Application code, prior fixes, release artifacts and all other pre-existing workspace files were preserved byte for byte. The validation receipt records the preservation comparison, source hashes and test receipts. Nothing was committed or deployed.
