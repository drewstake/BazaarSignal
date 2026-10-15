# Active paid performance release — October 13, 2026

The two optimizations in [the performance review](PAID-PERFORMANCE-REVIEW.md) were deployed to [BazaarSignal](https://bazaarsignal.web.app) at approximately 20:13 EDT. Bounded production verification passed at 20:14 EDT (October 14, 00:14 UTC). Only the price API and Firebase Hosting were deployed.

## Release path and preserved safeguards

`scripts/private-trial-release.mjs` now accepts an explicit `activePaidUpdate` plan. It admits this release against `marketCache/paid-budget-october`, with paid identity `paid-202610`. The stopped historical `live-allowance` document is checked for integrity, never used to admit the paid update or rewritten. Existing paused, initial-paid and free-tier release paths remain separate.

The active path requires the original pilot dates, budget, shutdown authority, service limits, invocation policies and enabled hourly collector target. It rejects activation/recovery flags, renewal, stopped or exhausted ledgers, stale or incomplete evidence, missing rollback references and configuration drift. Immediately before upload it adds a nonrefundable $0.50 rollout reservation using a fresh Firestore update-time precondition. Contention permits at most three conditional attempts; an uncertain write or duplicate release identity stops the workflow. Existing counters, observations, admissions and prior deployment holds must remain intact and monotonic. A concurrent owner stop prevents admission.

The Cloud Run patch changes only the image in the existing template, preserving environment, accounts, probes, resources, scaling and traffic configuration. Service IAM and Scheduler are rechecked before and after. The application still enforces the $5 target, $4.50 reservation stop and fixed **November 1, 2026, 07:00 UTC** expiration. Activation was not rerun; the pilot was not renewed and no counters were reset.

`scripts/prepare-active-paid-release.mjs` prepares a fresh, hashed plan from bounded read-only evidence. This release used 15 requests against a 24-request cap; responses were capped at 1 MiB with 15-second timeouts. The existing release workflow then passed its dry run (8 control-plane calls) and applied the API update (44 calls, within its 100-call cap). The verified application-only image was built locally; no Cloud Build ran.

## Deployed versions and rollback

| Component | Current release | Retained rollback target |
| --- | --- | --- |
| Price API | `marketapi-00021-bsg` | `marketapi-00020-m4m` |
| Firebase Hosting | `sites/bazaarsignal/versions/9bbfa97966992233` | `sites/bazaarsignal/versions/fef1a908749d248e` |
| Collector | Unchanged: `refreshmarket-00018-jdq` | No collector update required |
| Apps Script | Unchanged: version 19 | No script update required |

API image: `sha256:4c1e321b5472f71125888a5bd7c6bad095133ed252b9ead2395ec9678dc1f080`. Source bundle SHA-256: `b679220ef3effe32d6fd5b52a8f2c0b88f727e6c0398873010f10d66bd50272c`. Registry upload: 12,964,315 bytes. The prior service configuration and image are retained in the apply receipt's `rollback.marketapi`; the prior Hosting version is retained in the preflight evidence. Neither target was deleted. Rollback would route the API to its prior revision and release the prior Hosting version while retaining paid accounting and the original expiry. Rollback was available but was not exercised.

The collector remains hourly at `0 * * * *`, with no Scheduler retries. Existing hourly email evaluation and daily Admin collection remain in unchanged Apps Script version 19, including its once-daily 12:10–12:11 UTC window. Firestore rules and permissions were not deployed. No forced collection, Admin scan, load test or test email ran in production.

## Verification and measured improvement

- Full unit suite: **487 passed**, one opt-in benchmark skipped. Eight new release regressions cover the paid ledger selection, image-only update, unsafe plans/budgets, monotonic accounting, reservation contention, owner stop, schedule/runtime drift and complete fresh preflight evidence. The focused release/runtime/presence/mail/Admin suite also passed all 54 tests.
- Paid frontend build, market-functions build and collector/Apps Script typechecks passed. Local image verification booted all five supported handler/mode combinations with outbound networking blocked. `git diff --check` passed. The existing frontend large-chunk advisory remains.
- The prior optimization validation also passed 30 emulator tests and 24 desktop/mobile browser journeys. Those were not rerun for this release-tooling change; the two production optimizations were unchanged from those checks.
- Production smoke used 15 requests total, capped at 18, including exactly **two ordinary price GETs**. Both returned the same gzip price data and generation. Paid accounting recorded two admissions and **three measured work reads**: two fresh control reads plus one shared payload load, versus four work reads in the previous implementation. Admission/completion ledger reads are outside that work-read counter. Upstream collection counters did not advance.
- Hosted HTML matched the local build; the hosted JavaScript hash matched `f6056c569bf794eac6a9829d71d1da6e1d323e1f449cc5d6d01c6ffcd2d41f56`, and the paid presence route was absent. Both services' IAM policies, the hourly schedule and the original legacy-ledger hash were unchanged.

The repeatable offline 12-visit workload established **37 → 12 market requests (67.6% fewer), 98 → 37 Firestore reads (62.2% fewer), and 74 → 24 writes (67.6% fewer)**. Twelve same-generation warm reads loaded the snapshot once instead of twelve times. The local handler median fell from 22.93 ms to 0.66 ms; this is local decode/processing evidence, not a production latency claim. Two production smoke requests are insufficient for a latency percentage, and no production load test was run.

Cache reuse depends on a surviving warm instance and matching generation. Cold requests still load the payload; source timestamps, stale status, errors, authorization, budget admission and expiration remain current. The smoke data retained its existing stale timestamps; no collection was forced to make it fresh. Future scheduled price, email and daily Admin executions were not accelerated or newly observed by this release. Additional optional optimizations remain deferred.

## Reservations and evidence

Before rollout, the paid ledger reserved **$1.026342322**. The retained deployment hold added **$0.50**; the two ordinary smoke requests added **$0.001122090**, leaving **$1.527464412 reserved** and **$2.972535588 of application reservation headroom** at the end of verification. The rollout hold covers deployment, Hosting, bounded smoke and rollback; preflight operator reads remain covered by the existing fixed reserve. These amounts are conservative application estimates, **not actual Google charges**. Actual charges remain unknown, and this release did not create a billing export or change billing configuration.

Local receipts (not committed cloud credentials):

- `.local/paid-cache-oct13-preflight.json` and `.local/paid-cache-oct13-plan.json`
- `.local/private-release-paid-cache-oct13-inspect.json`
- `.local/private-release-paid-cache-oct13-apply.json`
- `.local/paid-cache-oct13-hosting.json`
- `.local/paid-cache-oct13-smoke.json`
- `.local/market-image-2Hp1YN/receipt.json`

For another authorized release, build and locally verify a new image, prepare evidence with a new release ID, run the existing release script without `--apply`, and apply only after its guards pass. A failed preflight is a blocker; never reuse activation, change the pilot dates, clear a stop or reset counters to admit a release.
