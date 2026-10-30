# Market refresh cadence — October 21, 2026

The paid market interval is 15 minutes. Cloud Scheduler collects at :00, :15,
:30 and :45 UTC each hour. The API advertises a 900,000 ms interval. Visible
portfolio and selected-item views check saved prices at :02, :17, :32 and :47,
and the existing Apps Script minute trigger evaluates configured alerts in the
same windows. Daily price archives and the daily Admin report keep their own
schedules.

The shared paid interval governs collector admission, API directives, browser
polling and alert windows. Selected-item caching no longer imposes an hourly
minimum. Duplicate collection and alert attempts remain suppressed within each
quarter-hour slot. An already completed hourly :02 mail check is retained during
migration. Price freshness, user opt-ins, existing spend controls, counters and
the November 1, 07:00 UTC expiration remain intact.

Deployment preparation uses the existing paid release workflow with both market
services selected. The cadence command changes only the existing Scheduler
job's schedule, after verifying both new service images, the API interval, the
active budget and the exact previous Scheduler configuration. It verifies the
daily archive schedule is unchanged. The release retains the usual $0.50
internal rollout reservation; this is not an actual Google charge.

Validation: 621 unit tests passed and one existing opt-in benchmark was skipped.
Desktop and mobile emulator tests verify automatic recovery from a temporary
503 followed by a price change at the next quarter-hour window. Frontend,
collector and Apps Script typechecks/builds passed. The packaged market image
passed startup checks with outbound connections blocked.

The frontend release preserves the currently deployed responsive alert cards
from Hosting version `fe3389dd2f092e73`. Its source snapshot and exclusions are
recorded in `.local/cadence-oct21-source.json`. Apps Script version 21 and its
downloaded source are retained for rollback. Service rollback revisions and
configuration are retained in the normal release receipt.

Live verification completed at 00:38 Eastern on October 21 (04:38 UTC):

- Collector revision `refreshmarket-00026-gmt` and API revision
  `marketapi-00029-nxg` serve image
  `sha256:079b0a4c917c5a9de9193b0b9435e33b223a8d5b11fb2079051e7b6391bc40c0`.
- Scheduler is ENABLED with `*/15 * * * *`, no retries, and the same private
  target and identity. Its next scheduled run is 04:45 UTC. This verification
  confirmed configuration and did not force a collection or wait for that run.
- Two ordinary price reads returned HTTP 200 and advertised `pollMs` and
  `bazaarMs` of 900,000. Existing samples retained their actual source times.
- Hosting version `f1d67549bb434abf` is live. HTML, five JavaScript bundles and
  two stylesheets all matched the tested build by SHA-256.
- The existing Apps Script deployment now serves version 23, uploaded and
  deployed as `bazaarsignal@gmail.com`. The anonymous diagnostic reached the
  expected authentication rejection, confirming the configured sender check.
  Version 22 was an unused duplicate of the old source after the first CLI push
  skipped a manifest prompt; the successful upload was versioned as 23. The
  manifest, scopes, endpoint and existing trigger were retained. No test mail
  or manual alert evaluation was sent.
- The daily price archive remains `59 4 * * *`. Paid accounting and prior
  deployment holds were preserved. The Google spending feed was valid; the
  unchanged $4.50 spending stop and original expiry still apply.

Receipts are retained under `.local/cadence-oct21-*`, including the preflight,
plan, cadence inspection/application, Hosting deployment and hash verification.
The cloud rollout is `.local/private-release-cadence-oct21-apply.json`.

The first natural quarter-hour run was confirmed at 00:46:44 Eastern on October
21. Scheduler attempted the 00:45 run at **00:45:01.193**, and the paid ledger
admitted its scheduled event at **00:45:05.150** and marked it finished. The
newly published Bazaar snapshot carries source time **00:45:02.791** and
collection observation time **00:45:07.504**. These are recorded source and
collection timestamps, not a separately measured storage-commit time.

Published snapshots increased from **167 to 168**. Lifetime refresh failures
remained six, with zero consecutive failures and no current error or budget stop.
Scheduler remained ENABLED with `*/15 * * * *`; its next run was recorded as
**01:00:00.827 Eastern**, confirming the next quarter-hour opportunity. No run
was manually triggered. The baseline and compact result are retained in
`.local/cadence-oct21-next-run-before.json` and
`.local/cadence-oct21-next-run-after.json`; full read-only observation is
`.local/paid-observation-1792558005322.json`.

Email evaluation was independently verified from live worker and delivery state
at 00:48–00:49 Eastern. The worker started its natural :47 check at
**00:47:13.994**, completed successfully at **00:47:19.242**, and recorded no
error. The active subscriber's delivery ledger was updated at **00:47:17.998**;
its one tracked alert had evaluated the new **00:45:02.791** source sample and
was no longer awaiting an initial observation. There were no queued messages.
The deployed version remains 23, with evaluation windows at :02, :17, :32 and
:47 and per-quarter-hour duplicate protection. This confirms an actual alert
evaluation, not only the worker's schedule configuration. No test email or
manual worker execution was performed. Compact evidence is retained in
`.local/cadence-oct21-email-worker-observation.json` and
`.local/cadence-oct21-email-evaluation-observation.json`.

## Unreleased reliability fixes — October 22

These changes are local implementation and isolated-test results; they do not
change the deployed services, schedules, allowance, expiry, or email delivery.

- New paid admissions use bounded private receipt documents, atomically committed
  with the accounting ledger. Existing inline admissions stay intact. The total
  admission count includes both formats and retains the 4,000-request ceiling.
  The reader accepts larger existing ledgers without raising unrelated document
  limits. No reservations are refunded, and ambiguous commits retain their holds.
- Alert passes walk five-account pages, wrap within the same pass, and stop after
  100 attempted accounts or the existing runtime limit. Partial passes retain
  their cursor. Account failures and incomplete passes no longer advance the
  successful-evaluation timestamp. Empty subscribers become inactive.
- Item pages use the 15-minute paid interval, retain stricter server directives,
  and honor one-minute recovery deadlines even when an error or older snapshot
  is cached in the same slot. Hidden-page recovery can resume without a retry
  loop. Snapshot status now says “Scheduled snapshot.”

### Ledger compatibility for a future authorized release

The first new admission atomically upgrades the ledger to version 2. Both API and
collector runtimes must support version 2 before receipt-writing traffic or jobs
resume. A future release must quiesce both request traffic and scheduled execution
through that transition; the existing active-update command alone is not a safe
migration procedure. This work has not performed that transition. Do not roll
back either service to a version-1-only reader after migration: it deliberately
fails closed instead of ignoring separate receipts. Keep all receipts and legacy
admissions for the fixed pilot; no cleanup or renewal is introduced.

Regression coverage includes 4,000 maximum-length invocation IDs, a legacy ledger
larger than 128 KiB, duplicate and ambiguous commits, realistic subscriber cursor
queries, partial/error passes, and desktop/mobile quarter-hour and 503 recovery.
