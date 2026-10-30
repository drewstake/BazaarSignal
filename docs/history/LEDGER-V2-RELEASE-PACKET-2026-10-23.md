# Ledger v2 release packet — October 23, 2026

> Historical record. Dates, deployment versions, service status, costs and approvals below apply only to the recorded work. They are not current setup instructions or authorization to operate services. See the [documentation index](../README.md).


The candidate, v2-compatible fallback, offline migration coordinator, and isolated rollout/rollback rehearsals are prepared. Nothing was deployed or uploaded; no production state, schedules, collection, or email delivery was changed. Existing workspace files were preserved byte for byte.

This packet completes the local preparation in the [October 22 plan](LEDGER-V2-ROLLOUT-PLAN-2026-10-22.md). Its statements that artifacts and a rehearsal coordinator were not yet prepared are historical. The remaining production gates below still apply.

## Frozen artifacts

The authoritative manifest is packet.json (local evidence: `.local/ledger-v2-release-oct23/packet.json`). It contains full source, output, image-receipt, Hosting, and Apps Script hashes for both variants. Build logs and source/output manifests are beside it. Keep this private local directory with the release record; it is ignored by Git.

| Artifact | Candidate | Fallback |
| --- | --- | --- |
| Cloud API and collector | Ledger v2 atomic receipts and bounded ledger reader | Identical v2 compatibility implementation |
| Apps Script | Complete bounded alert passes, failure accounting, safe cleanup, v2 Admin reader | Earlier worker behavior with the v2 Admin reader retained |
| Hosting | Item quarter-hour refresh and retry recovery | Earlier deployed browser behavior |
| Location | `.local/ledger-v2-release-oct23/candidate/` | `.local/ledger-v2-release-oct23/fallback/` |

Both cloud artifacts have digest `sha256:f13f47ff6e4c1377a8add1dc81e85829b47e868c7ba8879df8c6e2848ae26fb0`. This is intentional: the cloud changes are the compatibility backport. The fallback can undo the worker/browser fixes, including restoring their known old limitations; it cannot undo a ledger implementation defect. For that defect, contain all writers and prepare a tested forward repair.

Each image is an application-only OCI artifact built for the existing managed Node 24 base, not a standalone container. The receipt records the required base, 12,979,002 registry upload bytes, 83,550,182 storage-hold bytes, zero Cloud Build minutes, and `uploaded: false`. Those sizes/holds are estimates and internal reservations, not observed Google charges. Local smoke checks ran on Windows x64 Node 24 with outbound networking blocked and zero handler requests. Cloud runtime execution remains unverified.

The starting source is the archived October 21 release. Its cloud and worker bundles reproduce the historical receipts after normalizing only esbuild dependency-path comments; the old worker receipt also trimmed surrounding whitespace. All eight historical Hosting HTML/JS/CSS hashes match the fallback build exactly. This proves correspondence to the archived release, not to current production.

The builder overlays only the five compatibility files and six candidate behavior files listed in `packet.provenance`, plus regression tests. It does not deploy the dirty workspace wholesale. Semantically different workspace files outside this scope remain excluded: `README.md`, `docs/history/PAID-PILOT.md`, `scripts/dev-local.mjs`, `scripts/private-trial-release.mjs`, `scripts/read-paid-pilot.cjs`, `tests/active-paid-release.test.ts`, `tests/admin.test.ts`, and `tests/private-browser/portfolio.spec.ts`. The manifest also lists byte differences caused solely by line endings. Staging uses the existing local dependencies through a junction; source staging is not a portable dependency archive.

## Tooling and repeatable local checks

- [prepare-ledger-v2-artifacts.mjs](../../scripts/prepare-ledger-v2-artifacts.mjs) builds new isolated candidate/fallback directories, requires cached offline dependencies, and refuses overwrite.
- [verify-ledger-v2-packet.mjs](../../scripts/verify-ledger-v2-packet.mjs) checks source/output inventories, image receipts, OCI content hashes, scope, and compatibility. It rejects changed files, extra outputs, links, and paths escaping the packet.
- [ledger-v2-migration.mjs](../../scripts/ledger-v2-migration.mjs) models containment, drainage, a single retained reservation, coordinated service changes, natural-run verification, explicit reopening, and contained rollback. It journals intent before mutation and reconciles ambiguous outcomes without blind retries.
- [ledger-v2-requests.mjs](../../scripts/ledger-v2-requests.mjs) compiles disabled management requests with CAS/etag guards for review. Cloud revision updates and traffic pins are separate requests. Apps Script property/source/deployment changes and Hosting releases are explicit operator steps.
- [ledger-v2-fixture.mjs](../../scripts/ledger-v2-fixture.mjs) supplies only synthetic state, virtual time, and failure injection. [rehearse-ledger-v2.mjs](../../scripts/rehearse-ledger-v2.mjs) binds this fixture to the actual artifact hashes and writes journals and reviewable requests.

From the repository root, these commands verify or rehearse locally:

```powershell
node scripts/verify-ledger-v2-packet.mjs .local/ledger-v2-release-oct23/packet.json
npx vitest run tests/ledger-v2-migration.test.ts tests/ledger-v2-packet.test.ts tests/active-paid-release.test.ts
node scripts/rehearse-ledger-v2.mjs --rehearse .local/ledger-v2-release-oct23/packet.json .local/ledger-v2-rehearsal-new
```

Choose a new output directory for each rehearsal. `--apply` is rejected. The coordinator accepts only the isolated fixture transport; it does not discover credentials, send compiled requests, or run application handlers. The six journals use synthetic identities, etags, ledger values, and execution evidence. They must not be submitted to production.

The coordinator bounds itself to 200 persisted transport calls. A future live adapter must separately bound all underlying HTTP calls and operation polls, response bytes, timeouts, and retries. The current in-memory deploy operation models successful readiness and traffic pinning; it does not implement or validate real Google long-running-operation polling. Do not bypass the transport restriction or wire in a generic fetch function to make this a deployment command.

## Verification results

| Check | Result |
| --- | --- |
| Candidate staged unit suite | 642 passed, 1 skipped |
| Fallback ledger, budget, runtime, throttle, worker, mail, Admin tests | 53 passed |
| Candidate desktop/mobile browser checks | 54 passed |
| Candidate private portfolio retry checks | 2 passed against local Auth/Firestore emulators, project `demo-bazaar-watch` |
| Migration fault-injection tests | 40 passed |
| Packet-integrity/disabled-execution tests | 16 passed |
| Existing paid-release guard regression tests | 12 passed |
| Candidate and fallback type checks, site, worker, cloud builds | Passed |
| Both packaged images | Both exported handlers loaded; networking blocked; no requests |
| Root TypeScript check and Git whitespace check | Passed |
| Complete artifact-bound rehearsals | 6 passed |

The candidate's count differs from the earlier 643-test workspace result because staging intentionally retains the historical release-guard test outside the behavior allowlist. Browser tests run staged source with local Vite and intercepted market responses; they do not claim a deployed Hosting or production end-to-end check. Unit tests use synthetic stores and mail stubs.

The rehearsals cover rollout with mail left paused, original rollback before migration, fallback rollback after migration, rejected API deployment, lost reservation acknowledgement, and lost service-update acknowledgement. Unit tests additionally cover either service failing, process interruption immediately after the reservation CAS, restart without duplicate holds, late accounting writes, unfinished executions, drift, receipt/count mismatch, wrong revision, stale samples, manual-run evidence, and oversized legacy rollback.

See validation.json (local evidence: `.local/ledger-v2-oct23/validation.json`), rehearsal summary (local evidence: `.local/ledger-v2-oct23/rehearsal-verified/summary.json`), and the per-scenario journals beside it. The validation receipt identifies the frozen tooling copy and preservation hashes. Rehearsal “natural” evidence is fabricated test input; no collector was invoked.

## Future authorized rollout and rollback

1. Verify the frozen packet again. Obtain fresh management-plane evidence for the two services, both Scheduler jobs, IAM including inherited access, active executions, worker saved source and versioned deployment, Hosting, ledger, receipt inventory, billing, stops, and admission/meter headroom. Reconcile any changes since October 21 before choosing an artifact. The plan freshness window is 30 minutes; individual snapshots must be no older than 60 seconds.
2. Review the production execution adapter or equivalent manual operator procedure. It must handle exact current resources, safe upload of the existing OCI format, async completion, fresh revision/image evidence, conditional updates, and durable receipts. No production executor is included in this packet. Do not use the old active-update command while the API/collector are uncontained, and do not manufacture a throttle stop to enter its repair path.
3. During a separately authorized maintenance window, pause the worker and both existing jobs, contain public and authenticated API callers and any Admin writers, and drain executions. A quiet interval alone is insufficient. Verify stable accounting and unchanged configuration. Preserve the existing pause states for eventual restoration.
4. Retain one $0.50 rollout allowance through a ledger CAS, without converting it into reported spending or refunding it on rollback. Behind the barrier, update and pin both cloud services to the verified v2 image. Verify both ready revisions before updating the worker's saved source and existing web deployment and publishing the matching Hosting artifact.
5. Only with authorization to resume collection, restore the originally enabled quarter-hour job and wait for its next natural execution. Do not manually run it. Verify its event, exact revision, finished receipt, one admission increment, fresh complete snapshot, and accounting continuity. Then restore permitted API access and the originally enabled daily job. Leave mail paused until separately authorized and fresh evidence is available.

Before the first v2 admission, the original image is eligible only when the ledger is still v1, no external receipts exist, and the retained ledger fits the old reader. After any v2 admission, reject original-image rollback. Recontain and drain all writers, select the v2 fallback, preserve every receipt/count/hold/stop and the newest worker delivery state, and remain contained after rollback. No rollback restores an old ledger snapshot or automatically reopens jobs, API access, or mail.

Keep the 4,000-admission ceiling, $5 target, $4.50 stop and **November 1, 2026 at 07:00 UTC** expiry. Fresh evidence must show capacity for the actual remaining workload; the fixture's 1,000-admission headroom is synthetic, not a production forecast. Current production headroom, billing freshness, IAM effectiveness, cloud behavior, and email delivery were not confirmed in this task. Deployment, production migration, natural-run observation, and email resumption require a later authorized operation.
