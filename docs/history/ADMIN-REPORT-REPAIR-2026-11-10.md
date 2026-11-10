# Admin reporting repair — November 10, 2026

The owner reported that Admin still displayed the October 4 free-tier resource
table. That table was a frozen owner archive, with an October heading and a
session-long browser cache. The current daily Admin report was running, but its
scheduler, account, and traffic readers lacked working source access.

The November 7 production release contained continuous-operation changes absent
from this Windows checkout and GitHub main. The owner said that source was probably
on their MacBook. The release therefore patched retained production artifacts
instead of deploying this checkout's older application.

## Published result

- Firebase Hosting version `6ed60e8c27741a38`, released at 21:38:41 UTC.
- Apps Script version **27**, including reporting OAuth scope, explicit API quota
  attribution, independent daily resource collection, and a guarded authorization
  recovery. The owner completed Google's authorization prompt.
- The live signed-in Admin page showed **Resource usage · November 2026**, measured
  November 10 at **4:43 PM EST**, with the next update November 11 at **7:10 AM EST**.
- Eighteen of 27 resource rows had provider measurements, with no permission
  failures. Nine remained unavailable: six sources returned no period samples,
  Artifact Registry omitted a usable storage total, and two Apps Script account
  quotas are not exposed. Missing data is not reported as zero.
- The main Admin snapshot was refreshed from actual source reads, with all five
  source groups successful. Users and hosting traffic now carry November timestamps.

The original `reports/usage` archive is preserved. Current resources are stored
separately at `reports/resources`. Monthly and daily counters follow Pacific calendar
boundaries; provider timestamps remain visible. Visible Admin pages reread saved
reports after the daily boundary, without initiating provider collection.

The reporter initially ran before consent completed and retained its failed daily
slot. A first explicit authorization recovery exposed the additional quota-project
problem. The corrected recovery used the existing billing-enabled market project
for Monitoring quota, retained both failed attempt markers, and published the
successful report. No billing link or API was enabled. The ordinary updater remains
bounded to one attempt per daily slot.

## Verification and preservation

Forty-nine targeted unit tests and the frontend/Apps Script/collector type checks
passed. Desktop and mobile checks against the patched production component verified
the November heading, 27 rows, project/period labels, daily rereads, no page exceptions,
and no horizontal overflow. All eight uploaded HTML/JavaScript/CSS files matched the
reviewed artifacts. The real signed-in owner page was verified after publication.
The existing backend passed its sender/configuration and anonymous-rejection smoke
check; no test email was sent.

Saved and deployed Apps Script source match the final patch. Market API revision
`marketapi-00033-w64`, collector revision `refreshmarket-00030-bgz`, their service
templates/traffic, and both enabled collection schedules were unchanged. Source
temporarily reverted to its previous version while Google authorization was pending,
then the reporting patch was restored. No market ledger or spending control changed.

Receipts, original source, snapshots, test artifacts, and final verification are in
`.local/admin-report-2026-11-10/`. See [resource reporting operations](../operations/resource-reporting.md).
Reconcile the MacBook source before a full future deployment; the checked-in patch
preparation utility intentionally preserves the newer production release.
