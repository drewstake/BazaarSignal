# Audit fixes — October 29, 2026

> Historical record. Dates, deployment versions, service status, costs and approvals below apply only to the recorded work. They are not current setup instructions or authorization to operate services. See the [documentation index](../README.md).


**Implemented locally; not deployed.** This implements the confirmed defects from the [October 29 audit](APP-AUDIT-2026-10-29.md), plus the targeted parser vulnerability, reproduced invalid-session recovery, and invalid-route admission issue. Production services, data, permissions, schedules, counters, billing, mail, and expiry were not touched.

## Changes

| Audit finding | Local implementation | Regression coverage |
| --- | --- | --- |
| R1: vulnerable body parser | Compatible lockfile updates to body-parser 2.4.0 and 1.20.9, with the required `qs` resolution. No framework downgrade or force-fix. | Lockfile guard and isolated child-process gzip/deflate/Brotli probes verify accepted valid bodies where supported and continued process health after malformed input. |
| F1: failed daily capture | Bounded recovery within the existing daily allowance; reconcile uncertain commits by reading back the batch and checking exact intended content/original preconditions. Explicit 429 rejection can retry directly. Failed captures expose an error through metadata and the chart; an overdue-close status covers failure to save the error itself. | 429 and 503 at each of eight shard batches; lost response after committed write; persistent rejection; changed concurrent shard; expiry during backoff; missing status publication. |
| F2: item cancellation cached for a slot | Only settled selections reuse the selection promise. Pending readers use individual request-cache subscriptions, and an aborted selection is removed only if it is still the matching entry. | Same-window recovery, retained prior sample, visibility return, no extra completed-read request, existing cancellation/backoff/expiry suites. |
| F3: partial response drops old quotes | Mark transient incomplete batches as retryable, merge only requested quotes while retaining original timestamps, and use the existing bounded failure scheduler. Do not replace valid cache entries with partial failures or accept an old same-slot cache entry as recovery. | Retained valuation followed by recovery, same-slot server-deadline case, legitimate missing products, requested-asset filtering, sequential batching and existing policy safeguards. |
| F3: misleading chart point from mixed data | Suppress new portfolio-history recording while the response is incomplete, even when retained quotes allow an indicative total. The page explains that previous estimates are retained. | Browser retains the previous chart/value during failure; unit/browser checks cover complete versus incomplete valuations. |
| R2: invalid session remains displayed | Central token-error reporting handles confirmed invalid credentials. The auth observer clears private UI and signs out only the matching current user. It checks cached token expiry, refreshing near the deadline, and backs off on network failures. | Desktop/mobile emulator deletion followed by an explicit operation and automatic token refresh; terminal-error classification, nonterminal failures, existing account-switching checks. |
| F4: stale private data across tabs | Ephemeral, same-origin, user-scoped invalidation hints after successful mutations; coalesce bursts and refresh aged private reads on visibility/focus. Defer refresh while editing and apply it after the editor closes. | Quantity update across tabs, sign-out, open-draft preservation, another-device-style update with focus recovery, malformed/foreign hints and listener cleanup. |
| F5: history reads after expiry | Gate remote archive network work on pause, expiry and recovery deadlines; retain already downloaded history and explicit loopback offline access. Abort in-flight reads on policy restriction and avoid caching that cancellation beyond recovery. | Cold expired navigation makes no history call; warm cached archive remains readable; pause/backoff, cancellation/recovery, and offline-loopback cases. |
| R4: invalid route consumes allowance | Reject unknown/retired routes, unsupported methods, oversized/forced-refresh queries and invalid asset lists before durable market admission. Valid reads keep their existing gates. | Rejected requests leave the ledger byte-identical and perform zero Firestore/upstream/shutdown work. Existing admitted-request/budget tests still pass. |

### Daily-history recovery bounds

The successful path still reads and writes 32 shards plus metadata: **33 reads / 33 writes**. Recovery allows at most **six extra document reads and four repeated document writes**, with room for one final metadata read/write on failure inside the existing **40-read / 40-write** envelope. Retries wait one second and remain subject to the existing session cancellation/deadline. No new daily admission, reservation extension, automatic scheduler retry, counter reset, or manual backfill was added.

An uncertain commit is never replayed blindly: an exact readback can establish completion; unchanged original preconditions can permit one bounded retry; a conflicting change stops the capture. Partial valid points remain usable, accompanied by failure/overdue status. This does not make all 32 shards atomic or repair an already missed production close.

### Session/privacy behavior

Only confirmed invalid credential errors clear the session. Offline, throttling, and permission-denied errors do not automatically sign the user out. Error handling checks the Firebase User object, so a late failure from a previous account cannot invalidate the current account. The expiry check uses the cached token result and the normal SDK refresh path, rather than forcing a new token on every read.

Private invalidation hints contain only a user identifier and nonce, are removed from local storage immediately, and carry no holdings, tokens, preferences, or Admin data. Unavailable storage falls back to bounded focus/visibility refresh. Existing transactional revision checks remain in force; an invalidation does not authorize a mutation.

## Verification

All checks used local builds, isolated demo Auth/Firestore emulators, loopback servers, or mocked upstream/storage. Emulator suites sharing ports ran sequentially. No production browser/API calls were needed for implementation verification.

| Check | Result |
| --- | --- |
| Full unit suite | **917 passed, 1 opt-in performance case skipped** |
| Opt-in paid runtime benchmark | **1 passed** separately |
| Firestore rules/integration | **31 passed** |
| Standard private browser, desktop/mobile | **38 passed** |
| Dedicated portfolio retry browser | **8 passed** |
| Audit private regressions, desktop/mobile | **16 passed** |
| Standard public browser | **54 passed** |
| Audit public regressions | **6 passed** |
| Final targeted partial-cache/editor browser recheck | **4 passed**; repeats included cases |
| Frontend + Apps Script build | **Passed** |
| Collector build/typecheck | **Passed** |
| Market-functions build/typecheck | **Passed** |
| `git diff --check` | **Passed** |

There are **122 distinct passing browser cases**, with the four final targeted reruns counted only once. The audit's two session-revocation failures now pass, with two additional automatic-refresh cases. The parser's Brotli rejection on the older 1.x branch is expected unsupported-encoding behavior; the 2.x branch accepts valid Brotli. Malformed-body probes establish process health, not a claim of an exhaustive exploit assessment.

The usual deferred-workspace bundle-size warning remains. Initial development runs caught stale expectations in the old audit probes, a test that tried to read a closed details section, and a Windows shell quoting error in a filtered test command; those were corrected before the final checks. Original audit measurements/reports remain intact.

Logs, dependency audit output and preservation evidence are in [measurements/app-audit-fixes-2026-10-29](../measurements/app-audit-fixes-2026-10-29). The [unit log](../measurements/app-audit-fixes-2026-10-29/unit-final.log), [private regressions](../measurements/app-audit-fixes-2026-10-29/audit-private-final.log), [public regressions](../measurements/app-audit-fixes-2026-10-29/browser-public-audit.log), and [preservation check](../measurements/app-audit-fixes-2026-10-29/preservation.json) contain the final evidence.

### Usage and dependency effects

- Invalid unknown requests now perform **0 reads / 0 writes / 0 admissions**, versus the audit's 4 reads / 4 writes / 1 admission. Valid requests still receive full durable accounting and expiry checks.
- The real paid-handler/mock-storage benchmark retains **61 reads / 48 writes / one snapshot decode for 12 warm price misses**, with zero upstream calls. This run is used to verify work counts, not to claim an improved production latency; other local checks overlapped it.
- Transient partial responses can now produce bounded recovery requests instead of waiting for the next quarter-hour. Private mutations can cause a refreshed read in another visible tab. These are intentional correctness costs, bounded/coalesced as described above.
- The production dependency audit changed from **one high + five moderate** affected entries to **zero high + four moderate**. The remaining entries are `@google-cloud/functions-framework`, `cloudevents`, `fast-uri`, and `uuid`; no broad or incompatible dependency migration was attempted. The root/tooling audit still has unrelated findings. See [server audit](../measurements/app-audit-fixes-2026-10-29/npm-audit-market.json) and [root audit](../measurements/app-audit-fixes-2026-10-29/npm-audit-root.json).
- No billed-cost savings are claimed. The user's $0.30 gross / $0.29 savings / $0.01 net report remains separate from internal reservations.

## Preservation and remaining scope

At the start of implementation, **698 existing tracked/nonignored files** were snapshotted under `.local/audit-fixes-2026-10-29/baseline/`. Of those, **675 are byte-identical** and **23 contain the targeted implementation/test/lockfile changes**; none is missing. New files provide two small client helpers, regression tests, an isolated parser fixture, and this implementation record/evidence.

Hashes confirm unchanged Firebase configuration, Firestore rules/indexes, paid pilot constants, automation restrictions, portfolio policy, deployed service configuration source, ledger storage constants, trial/session enforcement, infrastructure shutdown code, Apps Script storage/backend, and the original audit report. The paid rates, reservation envelopes, ledger admission logic and spending-stop logic are also unchanged. The current ledger-v2 recovery and October 27 scheduler fixes were preserved. No existing source was reset to Git HEAD, committed, pushed, or deployed.

Remaining audit risks and optional improvements are separate work: snapshot-size headroom/storage design (R3), unavailable Admin measurement sources, remaining dependency advisories, physical-device/accessibility coverage, art payload reduction, archive caching, and capacity planning. Live provider session-revocation semantics still require authorized staging verification; the reproduced emulator behavior and app error paths are fixed locally. No real email, destructive account operation, production failure injection, or missed-day backfill was performed.

## Re-running

Use the audit's documented local safety environment and Java 21 setup. Relevant commands:

```powershell
npm test
npm run test:rules
npm run test:browser
npx firebase emulators:exec --config firebase.test.json --only auth,firestore --project demo-bazaar-watch "playwright test --config playwright.retry.config.ts"
npx firebase emulators:exec --config firebase.test.json --only auth,firestore --project demo-bazaar-watch "playwright test --config playwright.audit-private.config.ts"
npx playwright test --config playwright.search.config.ts
npx playwright test --config playwright.audit-public.config.ts
npm run build
npm run build:collector
npm run build:market-functions
```

The audit browser probes now assert corrected behavior; their original results remain in the historical audit evidence. Future deployment requires a separate release decision and current operational preflight; these local test results are not deployment authorization.
