# Cloud rollout checks — October 23, 2026

The available read-only checks are complete. **The immediate release holds and a conditional admission forecast fit, but this is not rollout authorization or proof of exclusive maintenance.** Authenticated write paths remain, and the migration tool's retained-CPU gate can prevent a later rollback even while measured usage and reported spending remain low.

Evidence was collected **14:11:58–14:26:30 UTC / 10:11:58–10:26:30 EDT**. This supplements the [production-adapter report](LEDGER-V2-PRODUCTION-ADAPTER-2026-10-23.md) and [Apps Script checks](LEDGER-V2-APPS-SCRIPT-CHECKS-2026-10-23.md). All counts are observations at their stated times; the existing schedules continue independently.

| Check | Result | Remaining condition |
| --- | --- | --- |
| Effective Cloud IAM | Project ancestry, project/service policies, custom and predefined role definitions, deny policies, service-account policies/keys and known workload resources inspected. | Inventory is bounded to the resources below; broad authenticated capabilities remain. |
| Authenticated writers | Direct invocation, direct data writes, impersonation and policy-changing paths identified. Historical activity inspected. | No exclusive-maintenance attestation or post-containment drainage proof exists. |
| Admission demand | 686 used, **3,314 available**. Proposed remaining requirement **2,700**, conditional on the current one-batch portfolio workload. | Recompute from fresh evidence; review workload growth. The draft remains unapproved and unchanged. |
| Billing/resource headroom | Latest retained Google cost notification **$0**; immediate prepared resource holds fit. | Reporting lag and response growth prevent a spending guarantee. The retained-CPU gate needs review for later rollback. |

## Effective permissions and authenticated writers

The market project is `bazaarsignal-510305`, number `1081657730748`. Both project APIs return no parent, so there is no folder/organization allow-policy chain above this project. Its deny-policy list is empty. The returned project bindings contain no groups, domains or public members; public API invocation is a separate service binding. IAM grants combine across applicable resource policies; an empty service-account policy does not cancel project-level permissions. See Google's [IAM inheritance model](https://docs.cloud.google.com/iam/docs/resource-hierarchy-access-control).

The following are **capabilities granted by the inspected policies and role definitions**, not claims that each principal is currently issuing requests. Full principal names, roles, conditions and selected permissions are in the [derived capability matrix](../.local/ledger-v2-cloud-checks-oct23/offline-analysis.json).

| Principal / class | Confirmed relevant access | Implication for containment |
| --- | --- | --- |
| `drewstake3@gmail.com` | Project Owner: Firestore entity writes, authenticated Run invocation, service/project IAM changes, service updates, Scheduler run/update and service-account attachment/key creation. | Operator sessions, scripts and manual jobs must be included in the maintenance freeze. |
| `market-reader` and `market-collector` service accounts | Project `datastore.user` grants entity create/update/delete to both. Collector also has explicit collector invocation. Both can pause Scheduler jobs until November 1, 08:00 UTC. | “Reader” is a name, not a read-only boundary. Pausing Scheduler alone leaves direct database writers. |
| Default compute account, App Engine default account and `1081657730748@cloudservices.gserviceaccount.com` | Project Editor grants entity writes, Run invocation, service updates, Scheduler run/update, service-account attachment and key creation. | Removing `allUsers` does not remove their inherited invocation or write grants. |
| `firebase-adminsdk-fbsvc` | Entity writes plus project-level Service Account Token Creator, including access-token and ID-token creation. | Direct writes and impersonated calls remain possible. |
| Cloud Functions and Cloud Run service agents | `run.routes.invoke`, token creation and service-account attachment in their inspected project roles; Functions also has service-update permission. | These are additional inherited invocation/impersonation paths. They are managed agents, not evidence of an extra user-operated application. |
| Cloud Build, Scheduler and Pub/Sub service agents | Access-token/ID-token permissions in their project roles. Legacy Cloud Build account can create builds. | Include their initiating jobs/builds in the writer review. No token was minted or impersonation exercised for this task. |
| Firebase Rules, Firebase management and Firebase Extensions service agents | Respectively: entity writes, project IAM changes, and service IAM changes/service-account attachment. | A review of only `roles/run.invoker` would miss these write/control paths. |
| Apps Script owner `bazaarsignal@gmail.com` | Market project's custom status-reader role grants only `datastore.entities.get`, expiring November 1, 07:00 UTC. | No direct market-ledger write grant was found for this user. Its worker can still call the currently public API; separate private-project email/portfolio work remains covered by the Apps Script checkpoint. |

**Confirmed permission mismatch:** `marketTrialApiStop` is described as “shutdown-only”, but its actual permissions are `run.services.getIamPolicy` and `run.services.setIamPolicy`. Both runtime accounts receive it on `marketapi` until November 1, 08:00 UTC. It permits policy changes, including granting access; the condition limits time, not the direction of the change. The scheduler-stop role really is limited to `jobs.get` and `jobs.pause`. Do not treat these two roles as equivalent containment safeguards.

`marketapi` still grants `roles/run.invoker` to `allUsers`. `refreshmarket` grants it directly only to the collector account, but the inherited authenticated invocation grants above also apply. Invoker IAM checking is enabled. **Removing public access is necessary for the existing migration procedure but does not establish that every authenticated caller or direct writer has stopped.** A later authorized rollout needs a reviewed writer roster, a freeze on their initiating workflows, and fresh completion evidence after containment; it must not mark `authenticatedCallersStopped` true from service IAM alone.

Five customer service accounts were listed. None was disabled; each returned no user-managed keys and no service-account-specific IAM bindings. No workload identity pools were returned. These results do not establish that there are no existing sessions, externally held OAuth credentials, or service-account credentials attached to running workloads. Google's [impersonation documentation](https://docs.cloud.google.com/iam/docs/service-account-impersonation) explains why keyless identities still matter.

Resource inventory found the two expected Run services and no Run jobs in `us-central1`; the all-region Functions listing returned only the two expected functions. Scheduler has the two expected jobs. Global and `us-central1` Build trigger lists and the `us-central1` Eventarc trigger list were empty. The sole Pub/Sub subscription is the existing billing pull subscription, with no push endpoint. Its collector subscriber grant and the budget service's topic publisher grant were inspected. The market bucket grants the collector object administration and the reader object viewing, with inherited project-owner/editor access.

**Inventory limits:** Cloud Asset searches returned `403 SERVICE_DISABLED`; Compute inventory also returned `SERVICE_DISABLED`. App Engine returned application-not-found. No APIs were enabled. This was not a globally exhaustive inventory of standalone Run/Eventarc/Build resources in every region, private-project IAM, or programs on external machines. Direct reads cover the known market resources; they do not justify an assertion that unknown writers are impossible.

## Observed activity versus possible activity

A complete, unpaginated seven-day Admin Activity query returned 38 audit entries, dated October 19–21. Principals were the owner and `market-reader`. Entries include owner service/job updates, eight historical `RunJob` entries, and reader Scheduler pauses/API policy changes. These are **historical audit entries, not actions performed in this check**, and are not necessarily counts of distinct operations because operation logging can produce multiple entries.

The same window's Data Access query returned no entries; the project policy has no Data Access audit configuration. That empty result cannot establish absence of Firestore writes or authenticated invocations. No logging configuration was changed.

Run request logs for **October 21, 14:00 through October 23, 14:00 UTC** returned 105 entries with no next page:

| Route | Status | Requests | Total logged response bytes |
| --- | --- | ---: | ---: |
| `/api/companion/portfolio-prices` | 200 | 99 | 118,706 |
| `/api/companion/portfolio-prices` | 500 | 5 | 0 reported |
| `/api/price-history` | 200 | 1 | 3,688 |

The 500 causes were not established by these request logs. User-agent categories indicated 98 Apps Script and seven browser requests; those categories are not authenticated identity evidence. URLs/query strings, addresses, raw user agents and request payloads were discarded. These small successful responses are useful current-workload measurements, not a bound on future response sizes or billable network usage.

## Admission demand through the fixed expiry

At **14:11:58 UTC**, the ledger was v1, 72,199 bytes, with 686 inline admissions and zero external receipts. It was stable across paired reads and retained the expected legacy hash. There are **3,314 of 4,000 admissions remaining** through **November 1, 07:00 UTC**. No admissions, holds or receipts were cleared.

| Observed window ending at the snapshot | Collector | Daily history | API | Total |
| --- | ---: | ---: | ---: | ---: |
| Last 24 hours | 96 | 1 | 51 | 148 |
| Last 48 hours | 192 | 2 | 101 | 295 |

Four unfinished API admissions from October 16/19 remain retained. Their age is not proof they are active executions, and is not permission to refund them. The complete daily breakdown and timestamps are in the offline analysis.

A bounded, read-only Firestore aggregate at **14:26:29.887 UTC** found **one active portfolio subscriber** in `bazaarsignal`. It returned a count only, without subscriber identities or holdings. The query was capped at 101.

The fixed alert traversal calls `portfolio-prices` for each distinct five-account page's asset bundle, reusing identical bundles within a pass. It is bounded to 100 accounts/40 seconds, but the portfolio route does **not** use `sharedMarket`'s single-slot `raw-bazaar` cache. With the current one active subscriber, one portfolio bundle per eligible interval is a reasonable forecast. It must not be generalized to arbitrary subscriber growth. Sources: [portfolio batching](../apps-script/portfolio-backend.ts), [paid worker](../apps-script/backend.ts), [shared market bridge](../apps-script/companion.ts).

| Proposed remaining-demand allowance | Admissions |
| --- | ---: |
| Quarter-hour collectors: October 23, 14:15 through November 1, 06:45 UTC | 835 |
| Daily histories: October 24 through November 1, 04:59 UTC | 9 |
| One portfolio price bundle each eligible quarter-hour | 835 |
| Discretionary API allowance: ceiling of 102/day × 8.70002 days | 888 |
| Retry/other contingency | 100 |
| Calculated total | **2,667** |
| Proposed `remainingAdmissionsRequired`, rounded upward | **2,700** |
| Slots beyond that proposal | **614** |

The discretionary allowance is twice **all** recent API admissions, deliberately retaining extra room rather than subtracting estimated worker traffic. It covers ordinary browser refreshes, history loads, alert mutations and retries as an aggregate assumption; it does not impose a traffic limit. Corrected item polling and restored alert evaluations can increase traffic, so projecting only the old 51 API admissions/day would be too optimistic.

**Sensitivity:** two distinct portfolio bundles per interval add 835 calls, taking the unrounded model to **3,502**, 188 more than available. Growth beyond a single five-account page, changed bundles or public traffic therefore requires a new forecast or separately authorized product/operating limits. The public API's maximum possible demand is not guaranteed to fit.

The existing draft's null `remainingAdmissionsRequired` was **not** replaced. The 2,700 proposal is review input, not approval. A later plan must use a fresh ledger and remaining calendar; reusing 2,700 indefinitely as time passes would itself make validation unnecessarily restrictive.

## Billing and resource headroom

The market project's linked billing account is open and uses USD. Its project listing returned only `bazaarsignal-510305`. The actual budget configuration is **$5**, scoped to that project, October 1–November 1, with `INCLUDE_ALL_CREDITS`, no service filter, and the expected Pub/Sub notification topic. The separate private/Hosting project `bazaarsignal` reports billing disabled and no linked account; its quotas remain separate from the market budget.

The latest Google cost notification **retained in the ledger** reports **$0**, published **13:58:35.224 UTC**, received **14:00:49.444 UTC**. There is no recorded billing error or stop. This provides nominal reported margins of **$4.50 to the app stop** and **$5 to the budget**. It is not a live invoice lookup: notifications are estimates and can lag usage, and a Cloud Billing budget is not an enforced spending cap. See Google's [budget notification behavior](https://docs.cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications).

The distinct **$7.299050511** ledger value is retained internal reservations, including ten prior $0.50 deployment holds. It must not be described as actual spending or subtracted from the latest $0 report to invent a negative balance. No holds were refunded or reclassified.

Using the current ledger and the prepared release's unchanged allowances:

| Migration meter | Retained amount | Prepared hold | After hold | Gate limit | Headroom |
| --- | ---: | ---: | ---: | ---: | ---: |
| CPU seconds | 146,440 | 10,000 | 156,440 | 180,000 | **23,560** |
| Memory GiB-seconds | 146,440 | 10,000 | 156,440 | 360,000 | **203,560** |
| Artifact bytes | 835,258,735 | 83,550,182 | 918,808,917 | 1,073,741,824 | **154,932,907** |
| Log bytes | 225,918,976 | 16,777,216 | 242,696,192 | 53,687,091,200 | **53,444,395,008** |

All four **immediate arithmetic gates pass**. The candidate and compatible fallback share one cloud image digest; the existing packet accounts for that shared artifact. Repository metadata supplied no `sizeBytes`, and file/image lists were empty. These responses do not establish zero actual or billed storage; the retained artifact amount was preserved.

Cloud Monitoring allocation sums for **October 1, 07:00 through October 23, 14:00 UTC** are **6,026.86 CPU seconds** and **6,025.26 memory GiB-seconds**, using hourly aligned project totals with 299 returned points and no pagination. They are operational measurements, not bill totals. Missing points, provider billing rules, credits and other services prevent using these measurements as an invoice or silently replacing retained holds.

**Confirmed later-rollback limitation:** the coordinator checks `max(plan.meter.used, ledger.reserved[meter]) + any new hold` against the gate. The 844 remaining scheduled runs alone would retain another **84,400 CPU seconds**, taking the post-release total to **240,840**, above 180,000 even before API traffic. The rounded 2,700-admission scenario reaches **277,960 retained CPU seconds**. Thus the current tooling cannot be represented as having unconditional rollback headroom through expiry. Its runtime paid guard uses reported cost, admission count and expiry; it does not stop simply because this migration CPU meter crosses 180,000. Sources: [coordinator validation](../scripts/ledger-v2-migration.mjs), [paid envelopes and guard](../collector/paid-budget.ts).

Before relying on a later rollback, review how this migration gate should distinguish retained reservations from measured usage, and test the chosen policy in isolation. A larger gate, a refund, or a lowered meter must not be improvised during an incident. This task makes no policy or code change.

For scale, applying the candidate's own gross reservation rates to 835 collectors, nine histories and 1,856 API calls, plus the new $0.50 release hold, gives **$4.0147 of additional modeled reservations**. The API model includes 16 KiB of egress per call. If every API reply instead required the maximum permitted 8 MiB body plus overhead and its accounting extension, the same calculation is **$7.6446**. These are sensitivity calculations, **not predictions of provider charges**: free allowances/credits may reduce billing, while unreported past charges, other work, storage and provider adjustments remain uncertain. The nominal $4.50 margin therefore cannot certify the entire future period.

## Evidence, validation and next decisions

Local, ignored evidence is retained in [the inspection directory](../.local/ledger-v2-cloud-checks-oct23/). The [offline analysis](../.local/ledger-v2-cloud-checks-oct23/offline-analysis.json) contains hashes of inputs and relevant source files, the complete permission matrix, admission arithmetic, cost scenarios, request counts and audit aggregation.

The inspection made **101 bounded management reads**, receiving 2,354,064 response bytes. POST requests were read-only IAM, log or Firestore query operations. No app/worker handler was invoked, no Pub/Sub message was pulled or acknowledged, and no token impersonation, API enablement, deployment, production write, schedule change, manual collection or email was performed.

Initial service-account IAM GETs used the wrong HTTP method and returned 404; the documented empty-body POST reads succeeded. The first budget read used the Firebase CLI's quota consumer and returned `SERVICE_DISABLED`; specifying the existing market project as `x-goog-user-project` resolved it without changing configuration. A count-response parser initially treated an array's `entries` method as log entries; a corrected count-only read succeeded. Initial audit-field selection also required a corrected read. These failures were not treated as evidence of empty resources. The separate Apps Script process 403 remains the already-diagnosed missing OAuth scope; the earlier owner UI observations remain applicable only at their recorded times.

Offline checks verify schedule boundaries, all 686 admission classifications, the demand scenarios, immediate meter arithmetic, later CPU exhaustion and cost arithmetic. Release-packet integrity and pre-existing workspace hashes were rechecked separately; see [validation receipt](../.local/ledger-v2-cloud-checks-oct23/validation.json). Only this new report and ignored local inspection/analysis files were added; all 642 pre-existing tracked/nonignored files were preserved.

The next decisions before any separately authorized maintenance window are:

1. Review the authenticated writer roster and how each initiating workflow will be frozen. Only subsequent fresh containment/drain evidence can satisfy the adapter's owner checkpoint.
2. Resolve and test the retained-CPU gate's effect on later rollback. Preserve the v2-compatible fallback and all existing accounting; the old v1 image is not a post-v2 rollback target.
3. Refresh the workload, ledger and billing evidence, then finalize an admission requirement and reviewed plan. The current one-subscriber proposal is 2,700 remaining admissions. Keep execution approval, reopening, collection resumption and mail resumption separate as already designed.

No approval files, release artifacts, application code or existing draft plans were changed.
