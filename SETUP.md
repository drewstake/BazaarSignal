# Public deployment and verification

**October 4 portfolio release:** current product behavior and deployment evidence are in [PORTFOLIOS.md](docs/PORTFOLIOS.md) and [PORTFOLIO-RELEASE.md](docs/PORTFOLIO-RELEASE.md). Discovery and watchlist UI/API routes are retired. Market collection and new notification evaluation remain paused. Legacy queued mail can drain; fresh legacy price evaluation is retired. Historical instructions below must not be used to restart services or replace the current private rules.

**October 1 shared-cache deployment:** production now reads the shared current-market collector in the user-authorized Google project `bazaarsignal-510305`. The owner linked billing; the scheduled Functions, private storage and Firestore coordination are deployed. The verified Hosting preview was promoted and Apps Script version 8 reads the cache. Existing authentication, alert data, signing properties and email trigger are preserved. Follow [GOOGLE-MARKET-DEPLOYMENT.md](docs/GOOGLE-MARKET-DEPLOYMENT.md) for current configuration, measured usage and costs. Earlier release notes below are historical.

Updated September 29, 2026 (America/New_York). The user explicitly changed the product from a private single-owner app to **public browsing and verified-Google-user alerts**. Firebase billing remains disabled. No additional Google scopes are required for the public change: only the sender authorizes MailApp; visitors use ordinary Firebase Google sign-in.

## Resources

**October 1 ownership update:** `drewstake3@gmail.com` accepted Owner access to `bazaarsignal` and is the workspace deployment account for both projects. Direct project permissions for the original owner were subsequently removed at the user's request. The existing Firebase project remains under organization `344551077324`; organization-level permissions were not changed. Website URLs, authentication users, alerts and email delivery were not migrated.

| Resource | Configuration |
| --- | --- |
| Live | https://bazaarsignal.web.app |
| Preview | https://bazaarsignal--free-preview-jnsklthd.web.app (`free-preview`, expires October 7) |
| Firebase | `bazaarsignal`, Spark, `(default)` Firestore in `us-central1` |
| Project administrator | `drewstake3@gmail.com` (sole direct Owner) |
| Historical original app user | `drew@theinnovativeowl.com`; UID `SPP408J6vxUDjtSMHn1E2LhrOum2` (app records preserved; direct project permissions removed) |
| Sender | `bazaarsignal@gmail.com` |
| Script | [BazaarSignal Free Backend](https://script.google.com/home/projects/1CXTzdNawDAnKq1vKzw5_CZJIKc3JROPCrucDRMi9XNb4XSeYncS9DlW4/edit) |
| Script ID | `1CXTzdNawDAnKq1vKzw5_CZJIKc3JROPCrucDRMi9XNb4XSeYncS9DlW4` |
| Deployment ID | `AKfycbzcKMazci0idgnN_tyccU8Q2ab6KRGWKm9Wo363sSwgIt946DmAcO_VU3yVSspplIat9Q`, version 7 |
| Deployment mode | Execute as sender; anonymous web transport; identity validation for every protected operation |
| Trigger | One time-driven `scheduledPoll`, approximately every five minutes |

The backend URL is `https://script.google.com/macros/s/` + deployment ID + `/exec`. Browser `snapshot`/`book`/`companion`/`playerNames` requests are public; `account`/`create`/`update` requests validate Firebase identity. `disable` requires the corresponding secure capability and explicit confirmation.

### September 30 verification

The subsequent active-listing change passed 95 unit/handler tests, 10 companion browser tests, four production-browser snapshot/clipboard tests, and website/backend/standalone API builds. Production browser tests reject inconsistent snapshot pages and show no invented fallback data. Real preview verification fetched 44 upstream requests in about 18 seconds; live verification passed in about 27 seconds. Both rendered actual asking-price averages, resolved a real seller and copied the verified `/ah` command. Desktop/mobile widths had no overflow or page errors, and Price Alerts still required Google sign-in. This supersedes the missing-collector state described in the earlier release verification below. No alert record, email trigger, signing key or billing setting was changed.

Website/backend builds, 89 unit/handler tests, 15 security-rule/backend emulator tests, and 6 production-build public browser tests passed. Earlier feature verification passed 18 app browser tests, 8 companion browser tests, 2 auction-copy browser tests and 2 authenticated alert emulator browser tests. Desktop/mobile screenshots were compared with the supplied Price Alerts reference. A real-preview concurrency failure exposed public Bazaar reads holding the alert mutation lock; version 6 removes that contention and a regression test verifies public reads while the worker owns its lock. Existing private mutations retain locking.

The existing deployment URL, manifest scopes, script properties, signing key, trigger and alert ledgers were preserved. No live alert was changed or test email sent by release verification. Versions 4 and 5 remain immutable script versions; an ignored local copy of version 4 is saved under `.local/release-before`.

Real preview and live smoke checks both passed at 1440px and 390px: readable public snapshot and companion responses containing 2,197 actual Bazaar products, item order books, Price Alerts sign-in gate, rejection of anonymous target updates, rendered Bazaar cards, and the explicit missing-auction-collector message. Neither viewport had browser page errors or horizontal overflow. Screenshots are saved under ignored `.local/previews/release-{preview,live}-{alerts,bazaar}-{1440,390}.png`. Live signed-in writes and email delivery were not retested against real accounts during this release; those paths were covered by emulator/handler tests and the existing delivery verification below.

### My alerts release

The My alerts tab lists the signed-in user's saved alerts across all items. Active single-price alerts support changing the target with revision checks; completed and disabled alerts remain read-only. Updates preserve the alert ID, original creation fingerprint, recipient and disable link, and do not enqueue a modification email. The new target applies on the next scheduled check. Retrying the same update after a lost response is idempotent; stale conflicting edits are rejected.

Version 4 adds the authenticated `update` endpoint and retains the existing deployment URL and worker. The website also provides recovery instructions for closed or blocked Google sign-in popups. Local verification passed: website/backend builds, 56 unit/handler tests, 8 desktop/mobile app tests and 6 production-build public browser tests. Real preview verification checks public prices, the order book, the My alerts sign-in gate on desktop/mobile, and rejection of anonymous updates. No real user alert is modified by release verification.

The verified `free-preview` channel was promoted to `live` on September 29, 2026 (America/New_York). The same real-backend checks passed on the live site at desktop and mobile widths. Authenticated edit behavior and cross-account isolation were covered by local browser/handler tests; deployment verification did not change a live user's target or send test email.

## Security and migration

The sender retains only `roles/datastore.user` for Firestore data access. Its Google OAuth token never leaves Apps Script. Firestore REST OAuth requests use IAM; client requests use [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/rules-conditions). Alert/backend client writes are denied; verified Google users may write only their own validated watchlist and filter preferences.

The new protected layout is:

- `backendUsers/<verified-uid>`: one bounded ledger per user, with an indexed active-work flag.
- `users/<same-uid>/status/main`: sanitized, self-only read projection; verified Google provider required.
- `backend/worker`: aggregate monitor, rotating cursor, shared creation admission and soft runtime budget.
- `alertLinks/<sha256-token>`: protected UID/alert lookup for confirmed disabling; no raw tokens.
- Existing `backend/state`: preserved original-owner rollback source, no longer polled after migration.

The first upgraded worker or an old owner's disable operation migrates the old ledger to the original owner's new protected document and creates hash lookups atomically. IDs, delivery status and signing inputs remain unchanged. The old document is preserved and the old owner-only read rules remain restrictive. Never deploy the old worker after migration: it does not know about new user records. Do not clear request ledgers to resolve a problem.

Script Properties retain the existing `TOKEN_KEY`, public `FIREBASE_API_KEY`, `APP_URL=https://bazaarsignal.web.app`, exact preview `ALLOWED_ORIGINS` and authorized editor-test values. Do not rotate the signing key or log/export properties. New success receipts use `sent:<uid>:<event-id>` and are removed only after Firestore sent status is durable. The original owner's older receipt names remain readable for recovery.

User identity is checked through [Firebase accounts:lookup](https://firebase.google.com/docs/reference/rest/auth#section-get-account-info) and validated token/user claims. Client-supplied UIDs, recipients or test flags cannot select another account. IDs and receipts are isolated by user, including duplicate request IDs across accounts. Disable tokens use HMAC-SHA256 over the owner UID and request ID; hashes alone are stored.

## Free capacity

Current official allowances: consumer Apps Script **100 email recipients/day**, **90 trigger-runtime minutes/day**, **20,000 URL Fetch calls/day**, and **6 minutes/execution**. Firestore free quota includes **1 GiB**, **50,000 reads/day** and **20,000 writes/day**. See [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas), [MailApp quota reporting](https://developers.google.com/apps-script/reference/mail/mail-app#getRemainingDailyQuota()) and [Firestore quotas](https://firebase.google.com/docs/firestore/quotas). These can change. Apps Script daily quotas reset 24 hours after first use, not necessarily at midnight.

Product safeguards:

- 20 active and 100 stored alerts per account.
- 5 new alerts/hour and 20/rolling day per account.
- 40 new alerts/rolling day across the whole site; two recipients normally consumed per completed alert.
- Every send rechecks Google's remaining recipient quota. When exhausted, queued messages wait at least an hour, without spending a retry attempt.
- A 45-second soft per-run budget and a 70-minute rolling runtime guard reserve margin under Google's trigger quota. Blocking Google calls can exceed the soft budget; Google's quota remains the final limit.
- Active users are processed in rotating document order, resuming at the persisted cursor. Heavy demand can delay checks. Individual progress, delays, quota exhaustion and failed email attempts are shown truthfully.

The public service is capacity-limited; it is not unlimited hosting/email. Abuse or high traffic can exhaust free quotas and temporarily interrupt service. Billing remains disabled and no paid fallback is enabled. Public price responses use a short shared market cache. The origin field is a routing allowlist, not an abuse-proof identity boundary.

## Verification

- Build passed for website and Apps Script (existing bundle-size/Vite warnings are non-blocking).
- 54 unit/handler checks passed: anonymous responses contain no private data; verified non-owner Google users accepted; forged UID/recipient ignored; cross-user records isolated; same request IDs safe across users; old links migrate; quota/admission, one-shot delivery, retries, crash receipts and overlaps covered.
- 11 Firestore/backend emulator checks passed. Verified Google users can read only their own exact sanitized status document; anonymous/unverified/non-Google/cross-user reads and all client writes remain denied.
- 6 existing desktop/mobile browser checks passed, plus 2 new production-build anonymous browsing/sign-in-gate checks. The mobile test found and verified a fix for initial Firebase auth resolution clearing public prices.
- Real preview: anonymous search, item details and full-quantity book estimates returned readable cross-origin Apps Script responses; alert creation asks for Google sign-in.
- Real regular account: `drewstake3@gmail.com` created request `17411f7e-517c-46a1-9e1c-6d532e68fb3f` through the existing Firebase session and new backend. The verified UID, personal recipient and isolated ledger were checked. The original owner's ledger was unchanged.
- Real worker: upgraded natural executions succeeded at 11:26:46 and 11:31:43 PM ET, migrated old records and executed the indexed active-user query successfully. The new personal-account confirmation and target each show sent, one attempt, to the approved address; quota fell from 96 to 94. The actual confirmation was inspected in the sender's Sent folder. Inbox receipt of these two additional messages was not separately confirmed.
- New user's email disable link: opening the actual email link did not pause the alert. Its button succeeded and disabled only the personal-account test; the original owner's records were unchanged. No active test alerts remain.
- Release: the verified `free-preview` channel was promoted to `live`; the public interface accepts browsing without login and retains the existing personal Google session for alerts. A fresh Google popup in the Codex in-app browser did not complete during automation; the existing verified session and backend identity checks were exercised successfully. Ordinary Google sign-in had already been verified in Chrome before this change; its Firebase flow is unchanged.
- Original private-release confirmation and target tests had already been received by the user, with confirmed/idempotent disabling. Quota exhaustion and failure modes are fault-injection tests, not deliberate depletion of the real sender quota.

## Deploy and recover

```powershell
npm ci
npm test
npm run test:rules  # Java 21 on PATH
npm run test:browser
npm run build
npm run test:public-browser
npx clasp push
npx clasp deploy --deploymentId AKfycbzcKMazci0idgnN_tyccU8Q2ab6KRGWKm9Wo363sSwgIt946DmAcO_VU3yVSspplIat9Q --description "Reviewed public backend update"
npx firebase deploy --only firestore:rules --project bazaarsignal
npx firebase hosting:channel:deploy free-preview --project bazaarsignal
# Verify preview, authentication/data isolation and required browser flows first.
npx firebase hosting:clone bazaarsignal:free-preview bazaarsignal:live --project bazaarsignal
```

Triggers run saved Head code immediately after clasp push; HTTP deployments are separately versioned. Coordinate those changes. Do not create a second script/trigger to bypass an error. The manifest still uses only `datastore`, `script.external_request`, `script.send_mail`, `script.scriptapp` and `userinfo.email`; private runtime authorization remains under the sender account. The encrypted SMTP app password is untouched.

Browser calls use `text/plain` simple CORS POSTs, omitted cookies and readable JSON through Google's [ContentService redirect](https://developers.google.com/apps-script/guides/content). Identity tokens are in bodies only for account/create/update. No `no-cors`, JSONP or frontend Google service tokens are used. New preview origins must be exact Apps Script allowlist entries and Firebase Auth authorized domains.

Check the footer for actual user progress; inspect Apps Script Triggers/Executions as the sender if it stalls. `diagnostics` returns only sanitized aggregate status. Restore sender authorization if revoked. Investigate terminal failures before retrying: never deliberately resend a message already marked sent. Preserve protected ledgers, token hashes and unresolved receipts during migrations.

MailApp has no transactional send/idempotency key. A crash after acceptance but before any saved receipt can still cause a duplicate on bounded retry; acceptance is not inbox receipt. Five-minute polling can miss brief prices. Disabling affects one alert and cancels unsent mail; a message already in flight may arrive. These limitations do not justify weakening authentication or enabling billing.
