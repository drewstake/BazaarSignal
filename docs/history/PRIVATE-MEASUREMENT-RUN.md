# Private capped measurement — October 12, 2026

> Historical record. Dates, deployment versions, service status, costs and approvals below apply only to the recorded work. They are not current setup instructions or authorization to operate services. See the [documentation index](../README.md).


## Completed initial Bazaar collection — October 13, 2026, 12:30 a.m. Eastern

**One private Bazaar collection completed and stopped. Scheduler remains `PAUSED`, both services remain private, and every prior counter, reservation, allowance date and owner-stop record is preserved.** No further deployment was needed. The successful grant is `measure-1791865811570`, terminal `complete` at 04:30:45.086 UTC, before its fixed 04:39:40.094 UTC deadline. Its reservations remain held in full. The later 04:35:25 UTC inspection found no active grants, no collector lease, unchanged collection control and paused Scheduler.

Private receipt: `.local/private-measurement-success-receipt.json`. Exact execution: `.local/measure-1791865811570-execute.json`. Final cloud observations: `.local/measurement-evidence-success-final.json`. Earlier sections below are retained history.

### What ran and what was observed

The owner-created Cloud Shell ID token was accepted. The first authenticated attempt (`measure-1791865532868`) reached the handler but stopped with HTTP 500 before any upstream request: the existing shared policy allowed two retries, while the public measurement path required zero. That failed grant and its entire budget remain recorded. A guarded configuration transition changed only `maxRetries` from 2 to 0 and incremented the control revision. Both the control document and the byte-identical stopped allowance were fenced in one atomic Firestore batch; requests, totals, job due times and auction history were retained. After the separately budgeted successful grant completed, another guarded batch restored `maxRetries` to 2 without overwriting the newly collected usage.

| Actual measurement | Successful collection |
|---|---:|
| Bazaar products | 2,201 |
| Public upstream requests / responses | 3 / 3 HTTP 200; no retries |
| Collection handler time | 5.156 seconds |
| HTTP request latency, including accounting | 6.115 seconds |
| Process CPU | 3.49 seconds; not billed CPU |
| Process peak RSS | 328,294,400 bytes; not billed GiB-seconds |
| Collection Firestore operations | 18 reads, 14 writes |
| Separate handler admission/completion operations | 2 reads, 2 writes |
| Legacy Storage reads | 1; 1,016,366 compressed bytes |
| Upstream response bytes | 8,455,003 |
| Published Bazaar document field | 905,278 encoded bytes; 678,898 compressed bytes |
| New deployments / Cloud Build | 0 / 0 |

Catalog, election and Bazaar snapshots were published inline. Auctions, cleanup, email, portfolio evaluation, browser activity and recurring collection did not run. The shared lifetime upstream-request total increased from 2,042 to 2,045; auction state is byte-equivalent to its prior value. This follow-up made 162 instrumented evidence/control calls, plus six operator document attempts, two HTTP invocations and the separately recorded handler work/accounting operations. Browser/OAuth/metadata overhead is not individually measured; conservative holds remain.

The download UI initially selected the Cloud Shell home folder. The accidental local archive was deleted without opening; file-picker selection then downloaded only the requested token. The token was never copied into logs, receipts or the ledger, and its downloaded local copy was removed after use.

### Provider reports, reservations and another run

Cloud Monitoring provisionally reports **11.19094 CPU-seconds, 11.19094 GiB-seconds, 11.34004 billable instance-seconds, three platform requests and 1,378,953 gross network bytes** for `refreshmarket-00017-g9f` since deployment. Samples extend through 04:34–04:35 UTC. These totals include deployment/startup, the earlier 401 and both authenticated attempts. They are not an isolated marginal bill or a settlement. The billing CSV remains dated and provisional; the historical $0.000001 Artifact Registry transfer charge remains acknowledged. No zero-cost claim or reservation refund follows these measurements.

The ledger retains **10,140 CPU/GiB-seconds, 276 Run requests, 4,696 daily reads and 1,904 daily writes**, including all three measurement grants. All deployment reservations, uncertainty, old daily-bucket identity, `free-20261001` period and November 1 07:00 UTC expiration remain. Each of the two new grants retained its full 600 CPU/GiB-seconds, five Run requests, 900 reads, 376 writes and nine upstream attempts. Full meter-level holds and remaining protected headroom are in the receipt.

Another bounded run **fits numerically without deployment**, including a new evidence refresh and policy transition. Future scope/metric inspections now enforce a **1 MiB per-response ceiling**, above the largest captured compact JSON (~101 KiB), and fail closed on larger replies. Every previous 8 MiB diagnostic reservation remains untouched. After another run and these future diagnostic caps, the projection retains about **81,576 CPU-seconds, 27,871 daily reads, 11,604 daily writes and 781,828,372 Firestore-transfer bytes** of protected headroom. A further run requires fresh passing evidence, an exclusive invocation window and a valid owner token; no ongoing collection is enabled. The Bazaar document is close to its existing size cap and future growth may fail closed.

The local operator now rejects an incompatible shared policy **before installing a grant**. For a future run: reserve both policy transitions in the plan, inspect the control state, prepare and validate a fresh plan, apply `configure-measurement-policy --apply`, invoke once, then use `--restore` after terminal completion. Each transition requires no active grant or lease and an unchanged owner stop. An uncertain commit is never retried automatically. Build these local scripts with esbuild; the deployed collector bundle is unchanged.

Validation: **442 tests passed**, then **53 focused tests passed** after the added pre-arm policy check. Root, market and strict operator typechecks passed; all diagnostic scripts passed syntax checks. Tests cover policy incompatibility, atomic document fencing, preserved counters/due times, refusal during active work and restoration after additional usage. Existing uncommitted work is preserved; the eight original untracked accounting files still match their backups.

## Evidence resolved and execution attempted — October 13, 2026 UTC

**Capacity passed; the collector-only deployment succeeded; private invocation was rejected by Cloud Run with HTTP 401. No Bazaar collection ran.** The remaining blocker is an accepted private-invocation identity token, not missing capacity evidence. The unused grant was closed with a conflict-safe update, all reservations retained, and the original owner stop and period unchanged. Scheduler remains `PAUSED`; both services remain private.

The complete record is `.local/private-measurement-resolution-receipt.json`. It includes hashes of the raw inspections, billing export, preflight, deployment, invocation, closure attempts, final state and remaining reservations. The original receipts below remain historical evidence and have not been overwritten.

### Evidence and implementation corrections

The existing billing session supplied a fresh all-project, all-service, all-SKU, all-location export. Its quantities are unchanged: 1,683.7 CPU/GiB-seconds and 0.02 GiB-month of artifact storage. It remains rounded and provisional. The historical unrounded Artifact Registry transfer charge is still $0.000001; a displayed $0.00 is not proof of zero cost.

Bounded cloud reads established one currently billed project, the two private Run services and no Run jobs, one paused Scheduler job across all 31 supported Scheduler locations, a free-tier-eligible Firestore database with nine documents, no TTL fields, all retained object versions, and only the standard Logging buckets/sinks. Daily Storage maxima now return complete history. Firestore response-size distributions bound the observed transfer; omitted distribution means are bounded by populated finite buckets, never replaced by invented zero usage. Earlier rejected field queries and incomplete history are retained in their original receipts.

The measurement validator now permits dated reports only with a fresh scope review, explicit reporting-tail bounds funded in uncertainty, and every existing reservation still additive. Zero incremental use can be established for delete operations, Cloud Build, chargeable artifact transfer and extended log retention, with specific path/configuration proof and no retained cost in that dimension. Historical unknowns remain null. Other shared consumers and retained storage remain budgeted. [Scheduler bills job-days, including paused jobs](https://cloud.google.com/scheduler/pricing); the export's 12 counts are not 12 simultaneous monthly jobs. [Same-region artifact transfer is free](https://cloud.google.com/artifact-registry/pricing), and [standard log retention is exempt from extra retention charges](https://cloud.google.com/products/observability/pricing).

The owner confirmed exclusive use by this task for the attempt. [Cloud Run does not bill IAM-rejected requests](https://cloud.google.com/run/pricing). Together with the private IAM policies and paused Scheduler, this resolves the former ingress-window gap without widening permissions or fabricating browser activity.

The three [documented public Hypixel endpoints](https://api.hypixel.net/) do not expose a numerical anonymous entitlement. A dedicated one-shot mode therefore makes at most one request to each of catalog, election and Bazaar, with no retries or authenticated endpoint access, and refuses all later requests after an error. Availability/global throttling remains unknown. The full original nine-request reservation is retained. This is not a grant for recurring collection or an invented quota.

### Deployment, attempt and stop

- Only `refreshmarket` changed, to ready revision `refreshmarket-00017-g9f`, image `sha256:299a81863ad55164ac1d84c8b68ec2d327972866a8e3bfdd116bfee9e184595e`. `marketapi-00019-gl8` was left unchanged. Upload: **12,963,962 bytes**, no Cloud Build. Receipt: `.local/private-release-free-20261001-measure-oct13-apply.json`.
- Both the pre-deployment and post-deployment capacity checks passed. Preflight: `.local/measurement-plan-resolved.json`; executed plan: `.local/measurement-plan-execution-fixed.json`. The fixed deadline remained **03:59:35.615 UTC**.
- An exact-hash CAS installed `measure-1791863335301` and added all run reservations. The single invocation at **03:49:19 UTC** returned 401. The provider log states that the token could not be verified. The ledger never acquired `claimedAt`, collection observations or a Bazaar result. No upstream requests ran.
- The first closure CAS at **03:54 UTC** received a Firestore write-bandwidth error. Readback confirmed the grant remained unclaimed. After backoff, one separately recorded CAS at **03:58:08.484 UTC** successfully marked it failed. No counter decreased, quota changed, uncertain hold was refunded, or deadline extended. Final containment read confirms the closed grant, paused Scheduler and private IAM.

The follow-up performed **250 instrumented control/document API attempts**, plus the single HTTP invocation attempt. Browser-console requests and OAuth refresh overhead were not individually instrumented and remain covered by control/uncertainty budgets. The earlier attempt's 85 diagnostic requests remain recorded separately.

Deployment logs show **3.349436 seconds** from instance-start logging to the successful startup probe. This is wall time, not billed CPU. Early revision metrics explicitly report one 401 request and zero-valued compute/network samples; these are provisional observations, not a settlement of startup cost. No collection CPU, product count or collection duration was measured.

### Retained reservations and next action

The deployment adds **10,000 CPU/GiB-seconds**, **83,496,742 artifact byte-months** and **16 MiB logs** to existing deployment accounting. The failed measurement retains **600 CPU/GiB-seconds, 5 Run requests, 900 Firestore reads, 376 writes, 9 upstream attempts**, and all storage, transfer, monitoring and shutdown holds. These are estimates/ceilings, not actual consumption.

The market ledger now reserves 40 collector admissions, 266 Run requests, 8,940 CPU/GiB-seconds, 2,896 daily reads and 1,152 daily writes. All other previous fields, the October 4 daily bucket, browser counters, owner stop and November 1 07:00 UTC expiration remain. The final receipt includes every remaining reservation and all deployment settlement/uncertainty records. All eight pre-existing untracked source/test files remain byte-identical to their backups; existing tracked work was preserved.

At the passing preflight, protected headroom included **83,376.2 CPU-seconds**, **36,826,198 artifact byte-months**, **31,781 daily reads** and **12,746 daily writes**. A further identical bounded run fits the numeric projection with the later inspection holds retained and **without another deployment**. It still needs fresh scope/deadline checks and an accepted owner ID token. The operator now refuses to reserve another grant with the known-rejected Firebase token and accepts a private token file without copying the token into receipts or the ledger.

**Smallest user action:** in a Google Cloud CLI or Cloud Shell session already signed in as `operator@example.com`, run `gcloud auth print-identity-token > bazaarsignal-id-token.txt`, save/download that file locally, and provide only its path. Do not paste the token in chat. Existing owner invocation permission is already verified; no IAM change, service-account impersonation grant or repeat restart approval is needed. [Google's private developer invocation procedure](https://docs.cloud.google.com/run/docs/authenticating/developers).

After a fresh passing plan, the prepared command is `node .local/run-private-measurement.mjs <fresh-reviewed-plan> --execute --identity-token-file <private-token-path>`. Never reuse the closed grant or redeploy the unchanged collector image.

Validation: **438 tests passed**, all relevant TypeScript checks and network-blocked image smoke checks passed; **49 focused tests passed** after the final operator changes. The further-run preparer now carries forward non-legacy meter reservations from every prior measurement, including failed attempts.

## Historical first preparation — October 12, 2026, 10:28 p.m. Eastern

**Implemented and tested locally; blocked before deployment or collection.** The owner has already authorized a restart within the free tier. This result requires better evidence, not another restart approval. Production remains on the optimized October 12 image. No image was uploaded, no handler was invoked, no grant was installed, and no scheduler, IAM, OAuth scope, billing setting or existing counter was changed.

The complete private receipt is `.local/private-measurement-run-receipt.json`. The concrete plan is `.local/private-measurement-plan-reviewed.json`; its actual validator result is `.local/measure-1791858378666-inspect.json`. Keep the private evidence and deployment settlements with this checkout. Existing uncommitted work was preserved; its initial patch and untracked files were copied into `.local/measurement-original` before editing.

## Implemented run

The dedicated measurement handler accepts a single explicit operator event and requires a durable grant. Ordinary scheduled events cannot enter this path. It collects catalog/election dependencies and one initial Bazaar generation, subject to the existing cooldowns, request history and publication fencing. It does not fabricate visible demand or reset a job's due time. A skipped/throttled Bazaar attempt is recorded as failure, without another invocation.

- One collector admission, no browser admissions, at most nine physical Hypixel attempts including retries.
- A fixed absolute grant deadline, at most 15 minutes from the captured evidence; session checks and abort signals stop collection I/O after at most 60 seconds or earlier evidence expiry. The existing Run request timeout is 90 seconds, which is **not a container/process kill**. Accounting/shutdown verification has separately bounded calls and reservations. There is no sleeping cloud loop or recurring job. [Cloud Run timeout behavior](https://docs.cloud.google.com/run/docs/configuring/request-timeout).
- An exact-ledger-hash CAS installs the grant and adds reservations together. The existing `stoppedAt`, reason, allowance ID, start/end, old daily bucket, observed counters and all other fields remain. Even an old daily bucket is retained without reset. A separate `priorStop` is saved with the run.
- A durable CAS claim allows only one invocation across restarts/concurrent requests. An uncertain/crashed claim cannot replay. Completion and failures retain the entire reservation; no refund follows a small observed result. Further runs retain earlier run history and all non-legacy meter holds.
- Auctions, cleanup, email, evaluation, owner-database scans and unrelated jobs have no path through the handler. The ordinary collection/evaluation/background/email source gates stay false. Scheduler stays paused. `marketapi` remains unchanged and private.
- Successful and failed runs record physical operation counts, process CPU microseconds, process peak RSS, handler time and errors. Process CPU/RSS/time are **not provider-billed CPU, memory or monetary cost**. Startup precedes these process observations and remains reserved separately.

The changed collector can be released alone with `pausedCodeOnly`, `measurementCodeOnly` and `services: ["refreshmarket"]` in the existing private release helper. Its `MARKET_OPERATING_MODE` becomes `measurement`; only installed single-use grants permit work. Subsequent grants can use the same deployed code without redeployment. The helper rejects unchanged image redeployment. No Cloud Build is used.

Verified local image: `.local/market-image-U96srz`, digest `sha256:132294919166c5ddb1879c3d5d35a7791de4b73efffb1ee568fdc227e1305e06`. Application upload bound: **12,963,216 bytes**. Retained artifact reservation: **83,492,924 byte-month equivalents** for the full period. Startup smoke tests exercised both handlers in free-tier mode and the collector in measurement mode with outbound sockets blocked. This image is local, unuploaded and untested in Cloud Run.

## Proposed budget, not measured consumption

Existing deployment reservations and their hash-verified settlement remain additive. Runtime planning checks separate allowances, the 25% provider margin and the existing 90% application cutoff. It does not demand a sustainable monthly cadence or browser access for this one-shot run. It can exclude the independent owner/Hosting/Auth/Apps Script allowances only with explicit path non-use evidence; shared Run, Firestore, Storage, Scheduler, build, image, Logging and Monitoring allowances remain required even for zero incremental work.

| Dimension | Proposed run and controls | Additional changed-image deployment |
|---|---:|---:|
| Run requests | 5, including rejected/duplicate allowance | separately bounded control-plane release |
| CPU / GiB-seconds | 600 each, including startup/control margin | 10,000 each |
| Firestore reads / writes | 900 / 376 | retained release work must also fit evidence |
| Firestore transfer | 356 MiB, including bounded CAS replies | retained in deployment evidence |
| Firestore retained storage | 1,441,792 bytes | no counter reset |
| Storage Class A / B | 16 / 19, including inspections and legacy reads | separately retained rollout evidence |
| Monitoring series-read reservation | 40,000 | prior diagnostic reservations also retained |
| Logs | 2,228,224 bytes | 16,777,216 bytes |
| Artifact byte-months | existing retention remains required | 83,492,924 |
| Hypixel requests | 9 maximum physical attempts | 0 |

The completed diagnostics additionally retain conservative local holds of 96,000 Monitoring reads, 60 Firestore reads, 48 Storage Class A operations, 5 MiB logs and 960 MiB response-size bounds. These are ceilings, **not observed billed usage**, and have not been written over the market ledger. The plan includes them in applicable meters. Authentication transport overhead was not separately instrumented and must remain in the control/uncertainty budget.

## What actually ran and what the evidence says

Five bounded evidence inspections attempted **85 cloud control-plane/Monitoring requests**. They performed no collector invocation or upstream request. Their original receipts, including earlier diagnostic mistakes and errors, remain saved:

- `.local/measurement-state-before.json` and `.local/measurement-state-after.json`: 15 requests each.
- `.local/measurement-evidence-before.json`, `measurement-evidence-refined.json`, `measurement-evidence-final.json`: 15, 20 and 20 requests.

The final state inspection at **10:22:58 p.m. Eastern** confirms Scheduler `PAUSED`, both services private, and unchanged ready revisions `marketapi-00019-gl8` / `refreshmarket-00016-wzm`. The entire ledger still hashes to `b4346cd44a5d2a91786c27908669a8523f3eabfe9aa3695adaeb5af27798e948`. Its period remains `free-20261001`, expiring November 1 at 07:00 UTC. Monthly reservations still include 39 collector admissions, 222 browser admissions and 8,340 CPU/GiB-seconds; the old daily bucket still holds 1,996 reads and 776 writes. Every deployment settlement, uncertainty buffer and later full rollout hold is retained.

Monitoring now reports today's Firestore activity: the last inspected query reported 38 reads (latest raw sample 02:14 UTC), two writes (latest raw sample 01:44 UTC), and a 43,816-byte database-storage gauge (latest sample 02:14 UTC). These are provisional provider observations of existing activity, **not costs of this unexecuted run**. Delete series remained absent. Run CPU/memory have new raw samples through 02:17 UTC, while request and Monitoring billing series are still older.

Initial diagnostic totals used moving hour-alignment boundaries and are not comparable across queries. Alignment also creates bucket timestamps that are not original sample times. The corrected inspector uses fixed complete-hour boundaries for future totals and saves original recent samples separately. The first inspection queried an unavailable Firestore storage metric; the correct metric was then used and the final bounded query completed without pagination errors. A byte-seconds storage gauge was initially summed diagnostically; that sum is discarded, and byte-month usage remains unknown. None of these diagnostics settled or refunded a reservation.

## Exact remaining blockers and smallest next actions

| Missing evidence/capability | Smallest useful next action |
|---|---|
| Hypixel numerical entitlement and shared-window usage for the deployed credential/anonymous egress identity | Obtain an authoritative available-request bound covering nine physical calls and other use. Public endpoint documentation alone supplies no numerical anonymous allowance. Do not manufacture one from absent rate-limit headers. |
| Complete cloud allowance scope and finite bounds for the reporting tail, other consumers and retained work | Add a per-meter accounting supplement to the saved plan using account-wide SKU usage and complete inventories. Carry forward the existing settlement, every newer deployment hold and these diagnostic holds. A fresh query timestamp alone is insufficient. |
| Firestore deletes and eligible transfer; integrated Storage retention/eligible transfer; log retention and Monitoring coverage | Supply provider quantities or documented path exemptions for these particular fields. Empty series and current storage gauges cannot establish historical zero consumption. Classify Run's gross network bytes before calling them eligible Internet egress. |
| Total authorized/rejected ingress during the fixed window | Establish a bounded invocation window covering other authorized principals/writers. The operator utility itself makes one request with no retry, but a private IAM policy alone is not a numerical bound on all traffic. |

The existing user has `run.routes.invoke` and an unexpired user ID token. It lacks permission to mint the scheduler service account's ID token, which is unnecessary if the existing user-token path is accepted. User-token audience acceptance has not been tested against the handler because the capacity gate did not pass. No IAM/OAuth expansion is proposed. The single reserved request would record an authentication rejection without retrying.

The plan deliberately leaves missing values `null`, incomplete scopes false and unverified ingress blank. Filling these with guesses would be a bypass. **A further bounded cloud run is not currently supportable.** The next useful work is the specific accounting/entitlement supplement above; more identical empty-series queries, another unchanged deployment, or another restart approval will not resolve it.

## Verification and execution path

434 unit tests pass. Root, market/collector and operator TypeScript checks pass; `git diff --check` passes. Tests cover unknown/ineligible meters, deployment holds, concurrent claims, stale/changed ledger refusal, no reset/refund, late admission, throttling, deadline/lease termination, disabled features and the complete inline snapshot path.

Build the local operator tools with the existing esbuild dependency:

```powershell
node node_modules/esbuild/bin/esbuild scripts/prepare-measurement-plan.ts --bundle --platform=node --format=esm --packages=external --outfile=.local/prepare-measurement-plan.mjs
node node_modules/esbuild/bin/esbuild scripts/run-private-measurement.ts --bundle --platform=node --format=esm --packages=external --outfile=.local/run-private-measurement.mjs
```

Use new receipt names for each evidence acquisition; `read-measurement-evidence.cjs` accepts the captured state file as its second argument. Prepare a fresh absolute window and run `run-private-measurement <plan> --inspect`. Only after that passes may the changed collector image be deployed through the existing guarded release helper. Refresh post-deployment state/accounting; the preparer recognizes an already-deployed measurement image, uses zero **new** deployment cost and retains its full existing release hold. Do not extend an installed grant's deadline. Then `--execute` verifies the exact serving image, existing identity/expiry, resource limits and private containment before the grant CAS and one request. Preserve its receipt on any ambiguity; never repeat an uncertain invocation or refund its hold.

The provider rules underlying the retained checks are [Cloud Run pricing](https://cloud.google.com/run/pricing), [Firestore quotas](https://docs.cloud.google.com/firestore/quotas), [Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing) and [Hypixel API limits](https://api.hypixel.net/). These describe allowances and behavior; they do not establish this account's remaining capacity.
