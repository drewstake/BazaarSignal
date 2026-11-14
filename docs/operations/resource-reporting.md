# Current resource reporting

The Admin resource table reads `owners/{ownerUid}/reports/resources` through the
owner-authenticated `admin-history` compatibility action. The October free-tier
archive remains untouched at `reports/usage`; it is not a current operating report.

`apps-script/resource-report.ts` runs from the existing minute trigger. A durable
daily attempt slot is claimed before source requests. Delayed triggers catch up,
duplicate invocations do no network work, and failed attempts retain their slot.
The reporting day begins at 12:10 UTC (7:10 AM fixed EST). Reporting does not depend
on market activation, a pilot deadline, or visits to the dashboard.

Monthly counters use Pacific calendar months; daily Firestore counters use Pacific
days; capacity uses the latest provider samples. Queries cover complete clock hours
and bounded pages. Missing or incomplete samples stay unavailable, and no prior-month
total is copied into a new month. Google does not expose aggregate Apps Script URL
Fetch or trigger-runtime consumption. Resource counters are not billing charges.

The existing sender needs the manifest's Google Cloud OAuth scope and the narrow
project read roles described by `scripts/configure-resource-reader.cjs`. Run without
`--apply` to inspect. Changed OAuth scopes require authorization by the sender before
its trigger can use them. No collector, budget, scheduler, or email configuration is
changed by that reader setup.

API calls explicitly identify a quota project. Cloud Monitoring uses the existing
billing-enabled `bazaarsignal-510305` quota project, including when reading the Spark
project's metrics; other APIs use the resource project. The reader needs
`serviceusage.services.use` for quota attribution. No billing link or API activation
is created. A guarded, one-time authorization recovery can replace the failed initial
report without clearing the daily attempt record.

## November 10 source mismatch

The Windows checkout and GitHub main were older than the November 7 production
release. The owner indicated that the newer source was probably on their MacBook.
That source was reconciled on November 14 from the owner's pushed
`feature/continuous-market-service` branch (`4334818`), retaining the later
resource-reporting fixes. The timeout repair deployed only the market backend;
Hosting and Apps Script remain on their November 10 releases.

`scripts/prepare-admin-report-patch.mjs` prepares a narrowly checked patch against
retained production Apps Script and Admin JavaScript artifacts. It preserves the
continuous-operation release, adds the resource reporter, changes only reporting
entry points, and rejects missing or ambiguous source anchors. It does not deploy.
The original saved/deployed script, Hosting inventory, patched artifacts, measurements,
and release receipts are retained locally in `.local/admin-report-2026-11-10/`.

The frontend's in-memory resource cache expires at the daily boundary. While Admin
is visible, it rereads the saved reports after the scheduled update; overdue reads
are bounded to five-minute attempts. Reopening a resource section uses the same cache.
