# Billing feed and collection recovery — October 15, 2026

> Historical record. Dates, deployment versions, service status, costs and approvals below apply only to the recorded work. They are not current setup instructions or authorization to operate services. See the [documentation index](../README.md).


The hourly collector now validates Google billing receipt timestamps against the
runtime clock. Firestore snapshot time remains the coordination clock, but is no
longer used to reject a newly received billing message or a subsequent admission.
Google-reported net spending remains separate from conservative internal holds.
The dashboard and release checks recognize the verified billing source while
preserving the fallback reservation guard until the first valid notification.

Firestore writes retry explicit resource-exhaustion rejections at most twice,
with jittered exponential backoff. Each retry rereads state, checks the expected
document version and publication lease, and consumes the existing invocation
envelope. Inline storage capacity includes three attempted publications. Quota
exhaustion, ambiguous failures and permanent failures are not retried. Deadlines
cancel backoff. Structured logs identify billing stages and collection failures
without logging provider bodies, credentials or arbitrary exception text.

## Verification

- 570 tests passed and one skipped in the standard suite; nine Firestore emulator
  tests passed. Type checking and isolated packaged-image startup passed.
- Regression tests cover a Firestore clock 3.7 seconds behind wall time, billing
  save/acknowledgement failures, counted retries, stale/expired owners, exhausted
  reservations, invocation deadlines and persistent failure log events.
- Cloud Run collector revision `refreshmarket-00021-6sz` and API revision
  `marketapi-00025-nn8` serve image
  `sha256:b7a5b799f453cdf676c65fde5b6a014b26ff199ddfc5c24025b1bce60d3c9fea`.
- The collector saved a real Google billing notification reporting $0 net cost.
  Pub/Sub recorded four acknowledged messages and a zero backlog.
- The October 15 22:00 UTC scheduled invocation returned HTTP 200, refreshed
  election data and published a fresh Bazaar snapshot. The lifetime failure
  count remained four; the current job had no error or failures.
- The API returned HTTP 200 with a fresh ENCHANTED_DIAMOND book at 22:01 UTC.
  The hosted HTML and dashboard bundle matched a fresh local production build.
- The existing hourly schedule, service identities, budget threshold and pilot
  expiration were retained. The rollout retained a $0.50 internal reservation;
  that reservation is not a Google charge or invoice amount.

## Index correction

The `marketCache.value` exemption was reapplied and verified, but it was already
active. The earlier diagnosis incorrectly interpreted `ancestorField` alone as
proof of inherited indexes. `usesAncestorConfig` determines inheritance; false
is omitted from the JSON response. Before and after configurations were the same.
The exemption therefore cannot explain the four historical write rejections.
See Google's [field configuration reference](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.collectionGroups.fields#IndexConfig).

Full operator receipts are retained locally in `.local/billing-retry-oct15-result.json`
and its referenced deployment, monitoring and API records; they are not committed.
