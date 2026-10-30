# Apps Script read-only preflight findings — October 23, 2026

> Historical record. Dates, deployment versions, service status, costs and approvals below apply only to the recorded work. They are not current setup instructions or authorization to operate services. See the [documentation index](../README.md).


The previously missing Apps Script property, trigger, access and execution checks were completed through existing credentials and signed-in editor sessions. The process-list 403 has a confirmed cause. **This is observation evidence, not rollout authorization or a post-containment drainage checkpoint.**

Inspection took place approximately **13:53–14:03 UTC / 09:53–10:03 EDT**. Exact timestamps for the API diagnosis, properties and active-execution observation are retained below. This updates the Apps Script unknowns in the [production-adapter report](LEDGER-V2-PRODUCTION-ADAPTER-2026-10-23.md); its other rollout prerequisites remain applicable.

## Confirmed live state

| Check | Result | Evidence |
| --- | --- | --- |
| Script properties | 18 properties inspected at **13:58:19.749 UTC**. `MARKET_OPERATING_MODE=paid-budget`, `MARKET_UPDATES_PAUSED=false`, expiry `2026-11-01T07:00:00.000Z`. Trial/pilot start both `2026-10-13T21:34:03.876Z`. | Redacted properties (local evidence: `.local/ledger-v2-readonly-checks-oct23/properties-redacted.json`) |
| Required settings | `APP_URL` exactly matches the production site; Firebase API key is present; token signing key satisfies the existing 64-character hexadecimal check. Values of keys, test recipient/request, delivery receipts and Admin snapshot were withheld. This checks presence/format, not credential functionality. | Safe validation (local evidence: `.local/ledger-v2-readonly-checks-oct23/property-validation.json`) |
| Delivery continuity | `PAID_LAST_MAIL_SLOT=1991959`, corresponding to the 13:45 UTC interval; `PORTFOLIO_CURSOR` empty. Two legacy `sent:*` properties exist, and no `portfolio-sent:*` properties were present in this inventory. This does not establish the contents of Firestore delivery records. | Redacted properties and validation |
| Trigger inventory | Both editor and owner views show **one** trigger. Owner is `sender@example.com`; handler `scheduledPaidMinuteTick`; deployment **Head**; time-driven **Every minute**. Failure notifications are daily. The details dialog was canceled without saving. | Editor inventory (local evidence: `.local/ledger-v2-readonly-checks-oct23/triggers-editor.txt`), UI findings (local evidence: `.local/ledger-v2-readonly-checks-oct23/ui-summary.json`) |
| Project access | Drive permission metadata lists `sender@example.com` as owner and `operator@example.com` as writer. No domain or anyone permission appears in the returned project permission list. Both signed-in accounts could inspect the project; the owner could inspect trigger details. | Access metadata (local evidence: `.local/ledger-v2-readonly-checks-oct23/access.json`) |
| Web deployment access | One active deployment, **version 23**, executing as **sender@example.com**, with **Anyone** access. REST reports `ANYONE_ANONYMOUS` and `USER_DEPLOYING`. These are invocation settings, separate from project editing permissions. Existing deployment ID is unchanged. | API diagnosis (local evidence: `.local/ledger-v2-readonly-checks-oct23/api-diagnosis.json`), deployment viewer (local evidence: `.local/ledger-v2-readonly-checks-oct23/deployment-access.txt`) |
| Active executions | At **14:00:25.765 UTC / 10:00:25 EDT**, the owner's project execution view showed **0 results** for **Running, Paused, Unknown or Delayed**, across functions and deployments, in its last-seven-days window. Real-time display was enabled. | Execution snapshot (local evidence: `.local/ledger-v2-readonly-checks-oct23/executions-active.txt`) |
| Recent execution history | The captured 09:10–09:59 EDT page contains 50 completed minute ticks. Eligible alert ticks at 09:17, 09:32 and 09:47 show 3.232, 9.699 and 4.343 seconds respectively. “Completed” is an Apps Script execution status, not proof that all subscribers were evaluated or messages delivered. | Recent execution page (local evidence: `.local/ledger-v2-readonly-checks-oct23/executions-recent.txt`) |
| General settings | Eastern/New York timezone, V8 enabled, default Apps Script GCP project; “Log uncaught exceptions to Cloud logs” unchecked. | UI findings |

The deployed source agrees with the minute trigger: `paidPilotAlertWindow` admits times 90–150 seconds into each 15-minute interval, centered on **:02, :17, :32 and :47**. The collection interval and worker clock are intentionally different. The recent minute ticks occur around second 12. Source references: [shared cadence](../../shared/paid-pilot.ts), [worker entry point](../../apps-script/backend.ts), and the previously downloaded deployed bundle (local evidence: `.local/cadence-oct21-script-verify/Backend.js`). The API project metadata still reports the October 21 source update.

The public web endpoint's deployed code validates request shape, configured origin and Firebase identity for ordinary account operations; token-based unsubscribe is a separate path. The endpoint was not invoked or penetration-tested here. `ALLOWED_ORIGINS` retains the existing preview URL, alongside the production `APP_URL`; its name should not be interpreted as a network-level access control.

## Confirmed explanation of the 403

At **13:58:07–13:58:09 UTC**, the bounded process-list GET returned:

```text
HTTP 403 / PERMISSION_DENIED
Request had insufficient authentication scopes.
reason: ACCESS_TOKEN_SCOPE_INSUFFICIENT
service: script.googleapis.com
method: google.apps.script.management.v1.ScriptProcessService.ListScriptProcesses
```

Google token metadata identifies the existing clasp token as **sender@example.com**. Its granted scopes are `script.projects`, `script.deployments`, `userinfo.email`, `email` and `openid`; **`script.processes` is absent**. Project and deployment GETs succeeded with the same credentials. This confirms a missing caller OAuth scope, rather than evidence of missing project ownership or a worker/runtime failure. Google documents [`script.processes` as the required scope](https://developers.google.com/apps-script/api/reference/rest/v1/processes/listScriptProcesses).

No authorization was expanded. The current observer will continue receiving this 403 until a separately authorized credential grant includes that scope. The existing migration adapter can instead use a fresh, reviewed owner execution checkpoint while that API read is unavailable. Changing the worker's manifest, Firebase rules, project sharing or deployment access would not add the missing scope to this management token.

The diagnosis used three bounded Apps Script management GETs and one read-only OAuth token-metadata request. Tokens and raw credential files were not logged or saved in evidence. The management journal (local evidence: `.local/ledger-v2-readonly-checks-oct23/http-journal.json`) records only read-only calls; the token-metadata request is described in the local inspection script (local evidence: `.local/ledger-v2-readonly-checks-oct23/inspect-api.mjs`).

## Observed failures and limits of the evidence

The trigger displays a **0.18% error rate**. Filtering the last seven days for failed, canceled, disabled and timed-out executions returned **18 failed `scheduledPaidMinuteTick` runs**, all Head/time-driven: 14 reported zero seconds, three approximately 480 seconds, and one 33.158 seconds. The most recent was October 22 at 22:59:03 EDT. See the failure inventory (local evidence: `.local/ledger-v2-readonly-checks-oct23/executions-failures.txt`).

The newest zero-second failure, a 479.857-second failure, and the 33.158-second failure each displayed **“No logs are available for this execution.”** Their cause remains **unconfirmed**. The unchecked exception-logging setting is an observability gap; it does not establish why these executions failed or why each log is absent. These historical execution failures are separate from the confirmed management-token 403. No retry, replay, test execution or notification was initiated.

The old worker can catch an application error and return normally, so platform completion and the displayed error rate cannot measure alert-evaluation success. Keep the previously prepared outcome-counter fix and verify its results during a later authorized rollout; do not use this history as substitute acceptance evidence.

## Consequences for rollout

1. Preserve the existing owner, minute trigger, deployment identity, properties, cursors and receipts. The trigger executes **saved Head code**, so replacing saved source affects scheduled executions independently of updating the versioned web deployment. The prepared rollout correctly contains the worker before updating both surfaces.
2. Refresh property hashes and execution evidence during the actual maintenance window. The redacted property file includes an integrity hash over all properties except `MARKET_UPDATES_PAUSED`: SHA-256 of UTF-8 `JSON.stringify(Object.fromEntries(rows.sort((a,b) => a.name.localeCompare(b.name))))`, with each row mapped to `[name,value]` and the pause property omitted. Dynamic slots/snapshots can change naturally while the worker is enabled. The trigger's unique ID was not exposed by the inspected controls, so the recorded configuration is not an identity-complete trigger hash for automatic use.
3. After authorized containment, prove drainage again. Today's zero-result view predates containment and can become obsolete on the next minute tick. It must **not** populate `barrier.drainVerifiedAt`. The earlier daily Admin branch is not gated by the mail pause property; continue avoiding its window and verifying its completion as required by the [rollout plan](LEDGER-V2-ROLLOUT-PLAN-2026-10-22.md).

Cloud Run in-flight requests, effective inherited/custom Cloud IAM and coordination of every authenticated writer were not established by these Apps Script checks. Exclusive maintenance, admission forecasting, fresh billing/headroom and explicit execution authorization also remain required. No owner checkpoint or approval draft was marked complete.

## Preservation

All **641 pre-existing tracked/nonignored workspace files** were compared to a start-of-task SHA-256 baseline. The final preservation receipt (local evidence: `.local/ledger-v2-readonly-checks-oct23/validation.json`) records the result and release-packet hash. Only this new report and ignored local inspection evidence were added. No application or tooling source was changed, so application tests were not rerun.

No deployment, property edit, trigger save, permission change, production data write, collection invocation, script-function execution or email send was performed. Existing scheduled activity continued independently throughout the read-only inspection.
