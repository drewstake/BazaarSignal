# Application audit deployment — October 15, 2026

The user separately requested commit, push and deployment after the [local application audit](APP-AUDIT-2026-10-15.md). Commit `5d17efe` contains the tested application changes and the preserved earlier workspace work. It was pushed to `origin/main` and deployed to [BazaarSignal](https://bazaarsignal.web.app). This report is a subsequent documentation-only commit.

## Released versions and rollback references

| Component | Released version | Prior version retained for rollback |
| --- | --- | --- |
| Firebase Hosting, project `bazaarsignal` | `sites/bazaarsignal/versions/3b7c75c254b43a38` | `sites/bazaarsignal/versions/c3812c013a73b35a` |
| Cloud Run market API, project `bazaarsignal-510305`, `us-central1` | `marketapi-00022-sk6` | `marketapi-00021-bsg` |
| Existing Apps Script web deployment | Version **20** | Version **19** |

The API release updated only its immutable image. The scheduled collector remains `refreshmarket-00018-jdq`. Both services retain their prior IAM policies. Firestore rules already matched the tested local rules exactly, so no rules deployment was necessary. Apps Script retains its deployment URL, execution account, access setting, entrypoints, triggers and script properties.

The Apps Script editor source was read back and compared exactly with the locally built bundle before updating the existing deployment to version 20. Only the audited portfolio-read reuse and unchanged-ledger-write changes were applied. No setup function, manual notification evaluation, test email or forced Admin collection was run.

Rollback references identify retained versions, not permission to reset safeguards. Any rollback must preserve the current paid identity, ledger, expiry, admission limits and schedules, and use the existing guarded release process. Do not restore an older budget ledger or erase rollout reservations.

## Verification

- Pre-release verification passed **548 unit tests**, **30 Firestore rules tests**, **38 public browser cases** and **36 private browser cases**, plus the separately enabled runtime benchmark. Six relevant public cases passed again after the lossless image URL changes. Site, collector and market-functions builds passed.
- The release image passed five offline handler/mode checks with outbound networking blocked and zero network requests. The paid site was rebuilt using the existing public Firebase configuration and fixed paid-pilot settings.
- The bounded production smoke script made **19 requests** against a cap of 26. Its two ordinary selected-price GETs returned the same saved generation, both complete 30-level book sides, `error: null`, gzip encoding and 3,991 decoded bytes each. They respected the hourly policy and fixed expiration. No upstream collection occurred during that script's observation window.
- Hosted HTML and both JavaScript chunks matched the local paid build by hash. All three lossless WebP assets were available. The deployed paid entry is 445,223 bytes; the audit's 444,662-byte figure uses its isolated benchmark configuration.
- Two read-only Rules API calls confirmed the active ruleset matched local rules. Four final pilot observation calls confirmed the legacy stopped ledger was intact, the hourly scheduler remained enabled, and the paid ledger was not stopped.
- Live browser checks passed for the public direct item link, both complete book sides, existing real authenticated-session restoration, saved portfolio and chart, Settings and owner-only Admin. Admin loaded its saved daily report with explicit measurement timestamps. No private records or notification settings were edited.
- The existing hourly scheduler ran naturally at `2026-10-15T07:00:02.738913Z`; the final observation showed a successful new Bazaar sample with zero failures and no error. This was not a forced collection. Normal live browser traffic occurred in addition to the two scripted price GETs.

These checks establish release identity and working production paths. They are not a production load test or a comparable before/after production latency benchmark. Fresh popup sign-in, actual email delivery and provider billing savings were not exercised or established.

## Budget and preserved behavior

The release kept paid identity `paid-202610`, the **$5 monthly target**, **$4.50 application reservation stop**, **$1 fixed reserve**, and expiration **November 1, 2026 at 07:00 UTC / 2:00 AM fixed EST**. Hourly collection remains scheduled at minute 0; visible browser refresh remains at minute 2; daily Admin reporting remains at 12:10 UTC / 7:10 AM fixed EST. No lifetime, schedule or budget was extended or reset.

The guarded deployment added its required **$0.50 nonrefundable rollout reservation**. The two scripted price reads added **$0.00112209** in estimated reservations. At `2026-10-15T07:03:01.861Z`, the ledger held **$2.118655748**, leaving approximately **$2.381344252** before the application stop. That observation includes other ordinary traffic and the scheduled run; it is not an isolated deployment charge. These are conservative application estimates, not actual Google charges or a provider invoice cap.

The disclosed large-portfolio tradeoff is active: an uncached read can make `ceil(distinct assets / 100)` sequential selected-price GETs. At most 100 assets still use one batch; reusable cached results can avoid requests. Every batch retains budget, expiry, pause and backoff checks. Typing and item navigation never initiate upstream collection. Original PNG assets remain preserved, adding about 4.13 MB of retained build storage while the active WebP transfers are smaller.

## Artifact identities and evidence

| Artifact | SHA-256 |
| --- | --- |
| API image | `1381874c33c032f388008425773539c5737e291a8f4e9b08d81581fd818177f1` |
| Paid entry `/assets/app-B8UwKIqa.js` | `cd5b8d55e06515b9fdddf63208a2c97f77ba0c234c225e2cad484735c2267ce3` |
| Workspace `/assets/Workspace-DIpPnNfF.js` | `0ed1ab652a19d71ccf948122a03e570e860dabcba461ef6dde8c08a57fec8465` |
| Apps Script backend source read back from editor | `5e51bfe9c6ad4a73f5673b038e926d8999e22222297d20b098c7d8006b5395c7` |
| Firestore rules, normalized | `73e7910eae65a68e2228c7f93c82c8d99ce0d1f828e6ba2821d682e359e8434a` |

Sanitized release evidence is retained alongside the [audit measurements](measurements/app-audit-2026-10-15): `release-smoke.json`, `release-apps-script.json`, `release-rules.json` and `release-final-observation.json`. Local operational receipts remain ignored under `.local/audit-oct15-*` and `.local/private-release-audit-oct15-*`; full private observation logs were not added to Git. Local screenshots retain the deployed item view and Apps Script's successful version-20 confirmation.
