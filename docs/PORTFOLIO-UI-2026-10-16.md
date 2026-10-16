# Portfolio and alert controls — October 16, 2026

Holdings now show edit, notification and delete icons directly in the table.
Editing, notification settings and deletion confirmation open in dialogs that
preserve the page position. The edit dialog includes additional purchases.
Redundant holding identity and expanded valuation details have been removed.

Notification forms use shorter explanations and preview the per-unit target
price as a percentage changes. Settings lists alerts in compact rows and opens
the same editor directly; the redundant Open holding action has been removed.

Portfolios can record buying power, including zero. The shared schema, private
Firestore rules and notification backend accept this optional field while
retaining existing ownership and revision checks. The add-holding form and
search use a more compact layout.

This commit also records the existing Firestore write-bandwidth repair:
serialized paid-ledger writes, explicit throttle handling and the market-cache
index exemption. A fresh market-functions build matches the source hash of the
already deployed image `sha256:246181d358064fdc3be189bff4d02b284224f8171003ad94797ec3b04bd2baa5`.
Read-only checks confirmed API revision `marketapi-00026-lds` and collector
revision `refreshmarket-00022-5xs`; no additional market-service rollout is needed.

## Validation

- Standard suite: 576 passed, one skipped.
- Firestore rules and backend emulator suites: 31 passed.
- Desktop/mobile browser coverage: 34 passed initially; four checks for two
  removed quantity labels passed on a focused rerun after switching assertions
  to the table cells. All 38 scenarios passed across the two runs.
- Paid production frontend, Apps Script, collector and market-functions builds
  passed. Vite reports its existing non-fatal large-chunk warning.
- `git diff --check` passed.

Deployment results are recorded below after verification.
