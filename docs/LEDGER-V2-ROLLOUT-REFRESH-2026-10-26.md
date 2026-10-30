# Ledger v2 rollout refresh — October 26, 2026

**The release remains blocked.** The fixed rollback gate is available, but production has no matching v2 reservation to recover. A new release would retain **191,100 CPU seconds against the unchanged 180,000-second admission limit**. The old ledger reader is also close to its response-size limit: **2,627 bytes remained at 20:08 UTC / 16:08 EDT**. Resolve initial release admission promptly; do not reinterpret this rollout as a rollback, refund reservations, or substitute measured usage for retained counters.

This refresh adds read-only evidence and a new, disabled [rollout draft](../.local/ledger-v2-rollout-refresh-oct26/draft/plan.json). It supersedes the October 23 headroom numbers, not the preserved release packet or earlier plans. No deployment, production write, schedule/property/access change, collection invocation, script execution or email send was performed. Existing scheduled activity continued independently.

## Fresh state and immediate risk

Management reads ran **20:04:46–20:08:23 UTC**; Apps Script owner/editor observations followed at **20:13–20:15 UTC**. These are timestamped snapshots, not a live lock or execution approval.

| Area | Refreshed evidence | Consequence |
| --- | --- | --- |
| API and collector | `marketapi-00029-nxg` and `refreshmarket-00026-gmt`, both serving 100% of traffic on the original v1 image. API is public; collector has authenticated invocation paths. | Both services still need the coordinated v2 transition. |
| Cloud schedules | Collector enabled at `*/15 * * * *` UTC; daily close enabled at `59 4 * * *` UTC. Last attempts: October 26, 20:00:12 and 04:59:03 UTC, with no status error. | Cadence is unchanged. No job was manually invoked. |
| Paid ledger | v1, 120,862 raw JSON bytes, 1,163 admissions, zero external v2 receipts, 2,837 admissions available. Stable paired reads; legacy ledger unchanged. | There is no v2 migration or retained recovery proof to roll back today. |
| Billing | Latest retained Google report: **$0**, published 19:50:35 UTC, received 20:00:14 UTC. Internal reservations: **$8.268515562**. No recorded billing error or stop. | Reservations are not actual spending. Delayed reported cost does not override migration meter limits. |
| Worker and Hosting | Saved/deployed worker source unchanged, version 23; Hosting version `f1d67549bb434abf`, complete 111-file inventory. | Prepared packet still matches its expected starting state. |
| Observed activity | Last 24 hours ending 20:00 UTC: 51 API request log entries, all HTTP 200, 61,691 total response bytes, maximum 1,461. Latest collector control has no error. | No outage was established by this sample; no application endpoint was called to obtain it. |

Sources: [management summary](../.local/ledger-v2-rollout-refresh-oct26/live/summary.json), [raw management evidence](../.local/ledger-v2-rollout-refresh-oct26/live/evidence.json), [supplemental evidence](../.local/ledger-v2-rollout-refresh-oct26/supplement.json), [derived assessment](../.local/ledger-v2-rollout-refresh-oct26/assessment.json).

**The reader-size risk is confirmed; its exhaustion time is a forecast.** A bounded read of the paid document returned **128,445 bytes**, versus the deployed single-document reader limit of **131,072 bytes**. JSON escaping makes this larger than the 120,862-byte ledger value. The preserved OCI image matches the live service digest; its manifest, layers and bundled source were hash-verified locally. The paid document is not one of the reader's larger snapshot exceptions. No archived application code was executed.

Admissions from the previous 24 hours account for approximately 15,965 bytes of wire-format growth. At that pace, 2,627 bytes is about **3.95 hours from the 20:08 measurement**, approximately October 27, 00:05 UTC / October 26, 20:05 EDT. Traffic, record lengths and other ledger changes can move this earlier or later. This is not a guaranteed failure time or a safe waiting period. Crossing the reader bound can prevent paid API/collector work even with admissions and reported spending remaining. Evidence: [wire measurement](../.local/ledger-v2-rollout-refresh-oct26/ledger-wire-measurement.json), [deployed reader provenance](../.local/ledger-v2-rollout-refresh-oct26/deployed-reader-evidence.json).

## Gates, demand and spending

The new draft uses release ID `ledger-v2-oct26`, `operation: "rollout"`, and the unchanged October 23 packet. Its plan digest is `8d0efc45632c8a64c83b021a52209eb1c9e48a13f999a5fa6e0e5bfd5d02bf97`. Execution remains disabled, [approval](../.local/ledger-v2-rollout-refresh-oct26/draft/approval.json) is false, and the [owner checkpoint](../.local/ledger-v2-rollout-refresh-oct26/draft/owner.json) remains unverified. Its short evidence window must be refreshed before any future use.

| Meter | Retained before | Prepared new hold | After hold | Unchanged limit | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| CPU seconds | 181,100 | 10,000 | **191,100** | 180,000 | **Fails by 11,100** |
| Memory GiB-seconds | 181,100 | 10,000 | 191,100 | 360,000 | Fits |
| Artifact bytes | 835,258,735 | 83,550,182 | 918,808,917 | 1,073,741,824 | Fits |
| Log bytes | 269,746,176 | 16,777,216 | 286,523,392 | 53,687,091,200 | Fits |

The current coordinator was run **offline against this saved snapshot** and rejected it with `Rollout meter headroom exceeded`. Calling the retained-proof validator with the same snapshot and a rollback operation rejected it with `Missing or mismatched retained rollback CPU allowance`. These are expected safety results, not a successful rehearsal of production eligibility.

The forecast now proposes **1,800 remaining admissions**, compared with 2,837 available. From 20:04:46 UTC through the fixed November 1, 07:00 UTC expiry, it includes 523 collector slots, six daily-close slots, 523 portfolio batch requests, 557 discretionary API requests and 100 contingency admissions: 1,709, rounded upward to 1,800. The discretionary allowance doubles all 51 recent daily API admissions, conservatively retaining overlap with existing worker traffic. A private-project count-only read found one active portfolio subscriber at 20:06:12 UTC; no subscriber records were fetched.

This leaves 1,037 beyond the rounded proposal. Two portfolio batches per pass would require 2,232 unrounded admissions; three 2,755; four 3,278, which exceeds current capacity. Public traffic, subscriber growth and retries are not capped by this forecast. Recompute from fresh evidence and current workload before approving a window.

The Cloud budget remains **$5 USD**, scoped to this market project and the October custom period, including credits, with the expected billing topic. The application stop remains **$4.50 reported cost**, and expiry remains November 1, 07:00 UTC. The billing account is open and links only the market project; the separate private project has billing disabled. Monitoring reports approximately **8,910.86 allocated CPU seconds** and **8,909.26 GiB-seconds** from October 1, 07:00 through October 26, 20:00 UTC. These operational metrics are neither an invoice nor authority to lower retained reservations. The proposed $0.50 rollout reservation would also be an internal hold, not a confirmed charge. Reporting delay prevents a spending guarantee.

## Writers and Apps Script checkpoint

Project and service IAM bindings match October 23. Current custom and predefined role definitions were re-read. Predefined roles have changed: notably the Run service agent gained additional Artifact Registry mutation permissions and `cloudbuild.workerpools.use`; Editor/Owner gained several unrelated product permissions. Unchanged bindings therefore do not mean every effective permission is unchanged. Exact permission differences and a writer-capability matrix are in the [assessment](../.local/ledger-v2-rollout-refresh-oct26/assessment.json).

The important initiating paths remain: owner and Editor principals; runtime identities with `datastore.user`; Firebase Admin SDK direct writes and token creation; service-agent invocation/impersonation; and IAM-changing grants. The `marketTrialApiStop` role still allows `run.services.setIamPolicy`: its name does not make it enforceably shutdown-only. Removing public API invocation and pausing Scheduler alone cannot prove all writers stopped. Review every authenticated caller, direct writer, credential path and operator workflow before an exclusive maintenance attestation.

The project has no returned parent and no project deny policy. Five customer service accounts have no returned user-managed keys or account-specific bindings; no workload identity pools were returned. Inventory found the expected two Run services, no Run jobs in `us-central1`, only the expected functions in the all-region listing, no Build triggers in global/`us-central1`, and no Eventarc triggers in `us-central1`. Cloud Asset and Compute APIs remain disabled; they were not enabled. This bounded inventory is not a proof that all external authenticated workflows are idle. Admin Activity since October 23, 14:00 UTC and Data Access queries returned no entries; Data Access auditing is not configured, so absence of logs is not proof of absence of writes.

Fresh Apps Script observations:

| Check | Result |
| --- | --- |
| Properties, 20:13:41 UTC | 18 properties; paid mode; `MARKET_UPDATES_PAUSED=false`; unchanged expiry and start values. App URL matches; Firebase key is present and signing-key format passes. Mail slot is 1992272 (20:00 UTC); portfolio cursor is now nonempty. Values of keys, recipient, cursor, delivery receipts and Admin snapshot were withheld from saved evidence. |
| Owner trigger, 20:14:31 UTC | One `scheduledPaidMinuteTick`, saved **Head**, Time-driven / Minutes timer / **Every minute**. Daily failure notifications; displayed error rate 0.16%. Details dialog was canceled without saving. The unique trigger ID was not exposed. |
| Access | Drive metadata still lists `bazaarsignal@gmail.com` as owner and `drewstake3@gmail.com` as writer, with no returned domain/anyone project-sharing grant. Web deployment 23 still permits anonymous invocation and executes as the deploying user. Project editing and web invocation are distinct permissions. |
| Active executions, 20:15:30 UTC | Owner view showed **zero** Running, Paused, Unknown or Delayed executions across all functions/deployments in its last-seven-days window, with real-time display enabled. This can change on the next tick. |
| Process API | The management process-list GET still returns 403. Existing credentials were not expanded. The October 23 diagnosis identified the missing `script.processes` OAuth scope; the owner UI supplies a read-only alternative. |

Evidence: [redacted properties](../.local/ledger-v2-rollout-refresh-oct26/properties-redacted.json), [trigger details](../.local/ledger-v2-rollout-refresh-oct26/trigger-details.txt), [active executions](../.local/ledger-v2-rollout-refresh-oct26/executions-active.txt), [UI summary](../.local/ledger-v2-rollout-refresh-oct26/ui-summary.json), [sharing metadata](../.local/ledger-v2-rollout-refresh-oct26/access.json). The UI was inspected with the computer-use skill and the existing signed-in sessions. No authentication or property change was needed.

These observations close the stale UI checks, **not the maintenance checkpoint**. The property hash excludes only the pause field and will change with normal activity. Do not copy today's zero execution count into a future drain proof. Trigger identity, fresh post-containment execution evidence, authenticated-writer coordination and Cloud Run request completion still need verification. Platform “Completed” status does not establish successful alert evaluation or email delivery. The older daily Admin branch also needs its own completion/window check because the mail pause flag does not gate it.

## Recommended order and coordinated transition

The first three steps are prerequisites. Everything involving production below is a **future, separately authorized action**, not an instruction executed by this refresh.

1. **Resolve initial release admission while the v1 size margin remains.** The existing tools cannot admit the new 10,000-second hold with current retained CPU. Review and test a legitimate initial-release/recovery policy before changing this draft. Preserve retained amounts, the $5/$4.50 controls, expiry and fail-closed behavior. Neither $0 reported cost, low measured CPU, an old unrelated deployment hold nor the new rollback-only flag establishes eligibility. If service containment becomes necessary before that work is ready, it requires a separately authorized incident action; no automatic pause was performed here.
2. **Prepare the exclusive maintenance checkpoint.** Assign the owner/operator, review the authenticated writer roster, arrange initiating-workflow freezes, capture identity-complete trigger evidence and inspect the worker's Admin window. Reobserve billing, ledger size, admissions, image/source/Hosting hashes and pending operations immediately before the window. Recompute demand, regenerate the plan, and obtain explicit approval tied to that plan and packet. Keep the current unapproved files as evidence.
3. **Contain and prove drainage before reserving or transitioning either service.** Once authorized and all gates pass, pause the worker through the owner checkpoint, pause both existing Cloud jobs without changing their configuration, remove public API invocation, and stop all reviewed authenticated writers. Require completion evidence after containment and stable accounting snapshots; a timer or service GET alone is insufficient. Preserve non-pause properties, delivery state, accounting and legacy history. The tool's minimum waits do not replace this evidence.
4. **Reserve once with the fixed tooling, then transition both services while contained.** The conditional ledger write must retain the new release hold and its `recovery` record. Verify the record binds the release ID, complete candidate/fallback artifact descriptions, original meter limits/holds and admitted CPU basis. Do not fabricate or backfill it. Deploy the verified v2-compatible image to both API and collector and verify desired/ready digests and traffic. Neither may start writing while the other remains v1-only. Then update saved worker Head, its versioned deployment and Hosting from the same reviewed packet while the worker remains paused.
5. **Accept one natural collector run before reopening.** Only after separate collection-resumption authorization, enable the original quarter-hour collector job and wait for its normal scheduled invocation. Do not manually trigger it. Require the matching ready revision, event ID, finished external receipt, ledger v2, exactly one added admission/receipt, fresh complete snapshot and accounting continuity. API remains private, worker paused and daily close paused during this check. A failed or incomplete acceptance leaves the release contained.
6. **Reopen capabilities separately.** API access, daily close and mail each require their corresponding approval. Mail additionally needs restored API access and fresh accepted data. The worker fix, item refresh/retry behavior and email-delivery behavior have isolated evidence, but their production acceptance is still pending. Nothing in this plan permits sending test emails or bypassing those gates.

The verified [release packet](../.local/ledger-v2-release-oct23/packet.json) remains SHA-256 `96a54c68cf688db7cf1efd79c16857212e4f94d4f3dc01d47acbc2836c6ad711`. Candidate and compatible fallback share cloud digest `sha256:f13f47ff6e4c1377a8add1dc81e85829b47e868c7ba8879df8c6e2848ae26fb0`; their worker and Hosting artifacts differ. Prepared cloud artifacts remain unverified in the serving Cloud environment.

## Rollback using the fixed gate

After a legitimately admitted reservation created by the fixed tooling, a later rollback can reuse its retained CPU allowance even if subsequent runtime reservations exceed 180,000. It cannot do so today: there is no matching hold. Historical holds without the recovery record fail closed. The [rollback-gate implementation and isolated results](LEDGER-V2-ROLLBACK-CPU-GATE-2026-10-26.md) remain the governing behavior.

For a later incident, preserve the original execution journal and reconcile outstanding operations before preparing a separate recovery window. Use fresh read-only evidence, the **same original release ID**, the unchanged packet and `--rollback` with the local draft preparer. Review current billing, expiry, admission demand, other meters and owner evidence; obtain new plan/packet-bound approval. Do not insert a changed plan into the old journal.

That rollback-only plan allows containment and the exact retained v2 fallback. It cannot create another hold, deploy the candidate, restore v1, resume collection/daily/mail or reopen the API. Recovery ends contained, with all reservations and newer delivery/accounting state preserved. Fresh billing is required within the reviewed age limit (at most 24 hours); spending stops, expiry, other meter limits and maintenance gates still apply.

The candidate and fallback share the cloud ledger implementation. Fallback can recover the differing worker/UI behavior; it cannot repair a defect common to that cloud image. Such a defect requires a reviewed forward fix under containment. The original v1 image is not a safe post-migration rollback target and is already near its reader bound.

## Validation and remaining limits

Offline validation checked the new plan against the saved live state, both expected gate failures, demand arithmetic and schedule boundaries, artifact integrity and preservation. The prior fixed-gate run passed 136 isolated tests and seven packet-bound rehearsals; those are **previous results**, not rerun production tests. No application/tooling source changed in this refresh, so the full application suite was not rerun.

The [validation receipt](../.local/ledger-v2-rollout-refresh-oct26/validation.json) records **82 bounded management reads, 3,596,845 response bytes**, plus one successful Drive metadata connector read and browser inspection. The HTTP POSTs were read operations (IAM policy retrieval, log listing, Firestore query/aggregation/batchGet), not writes. The management process-list 403 and one rejected connector-argument attempt are recorded as limitations, not empty inventories. No Pub/Sub messages were pulled or acknowledged. Sensitive property values were not saved.

All **645 pre-existing tracked/nonignored files**, the existing packet and prior drafts/rollback receipt were preserved. Only this new report and ignored local evidence/drafts were added. Remaining blockers are initial CPU admission, the urgent v1 response-size risk, exclusive writer containment/drain proof, a maintenance-time owner checkpoint, explicit execution approval and subsequent natural-run/cloud acceptance. A ready service, zero active execution snapshot or passing offline test does not remove those blockers.
