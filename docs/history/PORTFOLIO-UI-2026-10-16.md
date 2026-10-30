# Portfolio and alert controls — October 16, 2026

> Historical record. Dates, deployment versions, service status, costs and approvals below apply only to the recorded work. They are not current setup instructions or authorization to operate services. See the [documentation index](../README.md).


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

## Deployment

**October 18 correction:** the live notification endpoint subsequently failed
its configured-sender check. The [sender repair](NOTIFICATION-SENDER-REPAIR-2026-10-18.md)
reapplied version 21 from the sender account and verified the live protected
endpoint. That verification supersedes the execution-account assertion below.

Application commit `eb36f32` was pushed to `origin/main` and released to
[BazaarSignal](https://bazaarsignal.web.app).

- Firebase Hosting: `sites/bazaarsignal/versions/de20669586539b89`.
  Prior version retained: `sites/bazaarsignal/versions/677f1312832ce690`.
- Private Firestore rules:
  `projects/bazaarsignal/rulesets/e9a6f800-ec32-49d7-bbc0-845121fe963f`.
  Rules and indexes deployed successfully; live rules match the local source,
  and the market-cache value index exemption was verified.
- Existing Apps Script web deployment: version **21**, previously **20**.
  Saved source was read back and matched the local bundle. The deployment URL,
  execution account and access setting remain the same. Google required renewal
  of the existing, unchanged manifest permissions. The only source change in
  this bundle is acceptance and validation of optional portfolio buying power.
- Market API and collector already contain this commit's market code, as
  verified above. Their images, schedules, policies and budget ledgers were not
  changed by this release.

Live HTML, entry JavaScript/CSS and Workspace JavaScript/CSS match the paid
production build by SHA-256. The signed-out production page rendered normally.
Private mutation journeys were tested against emulators; production validation
did not create test holdings, send mail or run a manual collection.

Ignored local receipts are retained as `.local/ui-oct16-before.json`,
`.local/ui-oct16-verified.json`, `.local/ui-oct16-apps-script.json` and
`.local/ui-oct16-apps-script.png`. The prior Apps Script source and rules are also
retained locally for rollback reference.
