# Audit fixes release — October 29, 2026

The user authorized deployment of the [tested audit fixes](APP-AUDIT-FIXES-2026-10-29.md), preserving production settings, budgets, schedules, and expiry, with no manual collection or email. **The website and both market services are deployed and verified**, including the natural 19:15 UTC collector run. Final preservation checks passed at **19:18:50 UTC**.

## Released artifacts

| Component | Previous | Released |
| --- | --- | --- |
| Firebase Hosting | `df75d5a80c0d3ce1` | `ec64884a3b8e67fa`, published **2026-10-29 19:04:55 UTC** |
| Market API | `marketapi-00030-84n` | `marketapi-00031-sc4` |
| Collector | `refreshmarket-00027-m5s` | `refreshmarket-00028-2fn` |
| Shared Cloud image | `sha256:f13f47ff6e4c1377a8add1dc81e85829b47e868c7ba8879df8c6e2848ae26fb0` | `sha256:52c2ba960b5d6a5bf30f5f549a71f0c175dc8380f8fd8a9381ddecac650f7847` |
| Apps Script | Version 24 | Unchanged; saved and deployed source both match `095316b003c6b193c54c6355cedac0aab76a36cadef46fc3e629c86110136309` |

This ships R1, F1, F2, F3, R2, F4, F5, and R4 as described in the implementation record. Apps Script, Firestore rules/indexes, account data, permissions, and billing configuration were not deployed or edited.

## Production preflight and preservation

At **18:51:35 UTC**, production still matched the October 27 Hosting release and the October 26 ledger-v2 service image. Both schedules were enabled. The ledger was version 2, unstopped, with 1,465 admissions and 1,188 retained inline receipts. The legacy ledger hash matched its recorded integrity anchor. All 50 hashes in the implementation evidence manifest matched the workspace.

An isolated staging tree was built from the preserved workspace. Its 143 production-source/configuration files were checked against the retained October 27 source, allowing only the tested audit changes and two new client helpers. All **726 pre-existing tracked/nonignored workspace files remain byte-identical** to the deployment-start inventory. No source reset, commit, push, or cleanup of existing work occurred. Eleven static text/SVG files had only Windows line-ending differences; the staging tree retained their exact previously released bytes.

Post-release checks confirm:

- Runtime environment values, service accounts, managed base-image references, probes, timeouts, CPU/memory, concurrency, scaling, ingress, and IAM policies are unchanged. Both services retain **100% explicitly pinned revision traffic**.
- The quarter-hour job remains `*/15 * * * *`, and daily close remains `59 4 * * *`, both enabled in `Etc/UTC`, with their original targets, identities, retry settings, and deadlines.
- The pilot still expires **November 1, 2026 at 07:00 UTC**. The **$5 budget, $4.50 application stop, 4,000-admission ceiling, billing-freshness checks, and collector policy are unchanged**.
- The legacy ledger, all 1,188 inline receipts, and every previous deployment reservation remain intact. Counters were not reset or reduced.
- Hosting serving configuration and both reserved Firebase initialization files are unchanged. All **111 hosted file hashes** match the release plan; direct downloads of the nine HTML/JavaScript/CSS files match their staged SHA-256 hashes.

The established release process retained **one additional $0.50 internal rollout reservation**, plus its existing compute/log/artifact accounting envelope. This is not a budget increase or measured spending. Artifact reservation increased by 83,651,492 bytes to 1,002,460,409 bytes; no old image or hold was deleted. No Cloud Build ran. The registry upload was 12,998,392 bytes. Hosting reused unchanged files and uploaded six compressed files totaling **297,448 bytes**; seven file paths changed, with another content hash already available.

The user's October 1–29 billing report remains **$0.30 gross, $0.29 savings, $0.01 net**. The separate, delayed, project-scoped budget feed reported $0 net. Neither is equated with cumulative internal reservations.

## Release verification

| Check | Result |
| --- | --- |
| Tested source/evidence hashes | 50/50 match |
| Staged paid website and market-functions build/typecheck | Passed |
| Extracted production image startup | Both handlers and supported modes start with outbound networking blocked; no handler invocation |
| Focused pre-release regressions | 75 passed across six test files |
| Earlier implementation checks for these unchanged sources | 917 unit tests; 31 rules/integration tests; 122 distinct browser cases; opt-in benchmark; frontend/backend/collector builds passed |
| Release-tool guards and offline rehearsals | Passed, including explicit traffic pins, inactive no-traffic revisions, continuation after status-read failure, preserved reservations, and changed-expiry rejection |
| Cloud service readiness | Both new revisions healthy and serving their pinned traffic |
| Live invalid-route/query checks | Three bounded GETs returned expected 404/400; ledger bytes, update time, reservations, and admission count stayed identical |
| Live desktop/mobile browsing | 1440px and 390px: search, item direct link, quote/order book, archive chart, invalid item, and no horizontal overflow passed; four ordinary market GETs total, all HTTP 200 |
| Daily-history failure visibility | Production returned 190 retained Booster Cookie points and the new overdue-close warning; warning displayed on desktop/mobile |
| Visual/font check | Passed with live website/fonts and replay of the four just-verified public responses; no extra market reads, page exceptions, or console errors |
| Natural scheduled collection | Passed: 19:15 UTC slot, HTTP 200 on `refreshmarket-00028-2fn`, finished receipt, fresh 2,201-item snapshot |
| Existing workspace preservation and whitespace | 726 files unchanged; `git diff --check` passed |

The initial browser pass deliberately blocked the external font stylesheet, producing one expected blocked-resource console message per viewport. The follow-up allowed the normal font hosts and was clean. Its price/history responses were replayed explicitly; it is not counted as another live API test.

### Natural scheduled-run evidence

Cloud Scheduler attempted the 19:15 UTC slot at **19:15:12.593414 UTC**. The new revision returned HTTP 200 in **10.573 seconds** and logged a completed `paid_market` collector event. The snapshot contains **2,201 items**, with upstream time **19:15:02.797 UTC** and successful storage check time **19:15:21.379 UTC**. Its encoded size is **878,262 bytes**. No collection error, stop, or throttle event appears in this run's captured logs.

The finished receipt is `firebase-schedule-refreshMarket-us-central1:2026-10-29T12:15:00.827718-07:00`. Admissions rose by exactly one, **1,470 → 1,471**. Runtime observations recorded 12 Firestore reads, six writes, one upstream request, and one published Bazaar snapshot. These are application counters, not a full provider billing measurement. Final internal reservations are **$10.065640048000276**, including all historical holds, this release's $0.50 hold, and normal runtime increments; the ledger remains unstopped.

The first receipt lookup assumed whole-second Scheduler timestamps. A bounded query returned 283 operational receipts and identified the actual fractional-second timestamp; no unrelated collection or user data was queried. The final proof correlates that timestamp to the same quarter-hour slot. A redundant Cloud Logging read later returned HTTP 429; the already-captured successful event entries were retained, and final proof used those entries with freshly read Scheduler/storage/ledger evidence. No application operation or mutation was retried because of that logging response.

See [natural-run proof](measurements/app-audit-release-2026-10-29/natural-proof.json), [final preservation check](measurements/app-audit-release-2026-10-29/verification-final.json), [live rejection checks](measurements/app-audit-release-2026-10-29/live-rejections.json), and [release regression log](measurements/app-audit-release-2026-10-29/release-regressions.log).

### Deployment-tool reconciliation

The older active-release tool expected automatic “latest” traffic, but the October recovery had pinned explicit revisions. Only isolated staging/operator tooling was adapted to preserve that pin policy. Expiry comparisons were also checked by instant rather than string formatting; no environment value or expiry changed.

After the first image update, Cloud Run reported the new no-traffic revision as imported/ready but inactive, retaining the previous `latestReadyRevision`. The tool stopped before promotion. Fresh management reads identified that exact state; an offline rehearsal covered it before continuation. Later, two management **GETs** returned temporary HTTP 503 responses. The already-completed API promotion was reconciled by reading the recorded operation and healthy service. Only unfinished collector work continued. Subsequent status reads had bounded retries; mutations were never blindly repeated. Exactly one rollout reservation and one image upload were retained.

## Remaining verification limits

No manual collector call, Scheduler run operation, email evaluation/delivery, account mutation, or missed-day backfill was performed. The normal quarter-hour collector verified the shared runtime. The next daily close is **October 30 at 04:59 UTC**; the daily capture retry path was exercised locally with failure/reconciliation mocks, not forced in production. The already missed close remains a gap and is now visible to users.

Private authentication, cross-tab mutation, failure-injection, expiry, and destructive scenarios retain their emulator/mock regression coverage; production accounts were not altered to repeat those tests. Apps Script source/deployment identity was read freshly, but its property/trigger UI was not changed or re-inspected. The last direct property evidence remains the October 26 pause verification.

Snapshot capacity, remaining moderate dependency advisories, and the other deferred audit items remain separate work. This release makes no new claim that those risks are resolved.

Raw source stages, provider responses, durable request journals, operation IDs, old/new artifacts, browser captures, and reconciliation evidence are retained in `.local/audit-release-2026-10-29/`. Sanitized release evidence is saved under `docs/measurements/app-audit-release-2026-10-29/`. The prior Hosting version and v2-compatible Cloud image remain available; any rollback requires fresh state/accounting checks and must preserve retained reservations and the current schedules/expiry.
