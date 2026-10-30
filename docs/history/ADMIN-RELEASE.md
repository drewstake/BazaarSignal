# Portfolio, Settings and Admin release — October 13, 2026

> Historical record. Dates, deployment versions, service status, costs and approvals below apply only to the recorded work. They are not current setup instructions or authorization to operate services. See the [documentation index](../README.md).


Released to https://bazaarsignal.web.app using the existing Firebase Hosting and Firestore rules workflow. The original Admin release used Apps Script version 18; the daily-clock revision uses **version 19**, deployed October 13 around 19:27 EDT at the same URL. Collector services, hourly schedules and paid-pilot expiration/budget gates were not redeployed or reset.

## Interface and authorization

- Portfolio omits redundant helper paragraphs and repeated stale/last-known labels. Source timestamps and freshness remain inside each holding's **Valuation details**. Genuine unavailable prices and errors remain visible. Best sell offer (lowest ask), estimated value, unrealized P&L and return still use the same before-fees basis. Internal stale-price notification protections are unchanged.
- Settings contains the existing account, email preference and holding-alert controls. `#view=account` and `#view=notifications` redirect to the corresponding Settings section. Existing unsubscribe capabilities still require explicit confirmation. `#view=usage` redirects to Admin.
- Admin and its historical report require a verified owner identity on the server, before any private report reads. Firestore rules separately restrict direct report reads to the owner with verified Google identity and deny client writes. Hiding the navigation tab is not the authorization boundary.
- The October 4 free-tier report is retained in an explicitly dated historical disclosure. Its paused state and allowance percentages do not describe the paid pilot.

## Production measurements

Measurements verified on October 13, 2026, approximately 18:27 EDT:

| Measurement | Authoritative source and result |
| --- | --- |
| Operating mode | Paid ledger and current collector control: active paid pilot |
| Expiration | Paid ledger and both deployed Cloud Run service environments agree on `2026-11-01T07:00:00.000Z` (November 1, 02:00 EST) |
| Schedule | Existing Cloud Scheduler job enabled, `0 * * * *` |
| Latest successful price check | Collector completion October 13, 17:32 EDT |
| Reserved cost | $1.012334059, including the existing $1 fixed reserve; this is not an invoice |
| Budget | $5 target; application admission stops at $4.50 reserved |
| Estimated remaining headroom | $3.487665941 against the application stop; actual unspent money remains unknown |
| Accounts | 2 current Firebase Authentication accounts; 2 created in the last 30 UTC days; aggregate daily creation counts only |
| Hosting traffic | 206,747,943 bytes (197.2 MiB), September 13 through October 12 complete UTC days; includes assets/repeated requests and is not visitors/page views |
| Email worker | Last attempt October 13, 18:02 EDT. Earlier code did not record an explicit successful-check timestamp, so success is accurately unavailable until a subsequent scheduled completion |

The email worker now records attempt/success/error telemetry in its existing control writes. This adds no schedule, extra mail, or extra database writes. Release verification did not send an email or change saved alerts, accounts, holdings or email preferences.

## Refresh bounds and missing connections

**October 13 daily-clock revision:** Admin now collects on the existing server minute trigger only, in the 12:10–12:11 UTC window, once per day. This is 08:10 EDT / 07:10 EST. There is no Refresh button or HTTP collection action. Opening Admin reads the saved report, even when overdue. Market collection and alert evaluation remain hourly.

The clock claims a persistent daily attempt slot before any network work and reserves the report update with a conditional Firestore write. Duplicate triggers and failed admissions keep that day's slot. No retries or page visits can start another source scan. Existing pilot expiration still stops scheduled collection. Each attempt uses fixed bounded reads; no pagination or raw logs are collected.

The published snapshot is also kept in private Apps Script properties, avoiding database reads on repeated page requests. The browser shares one in-memory report request per signed-in user through the next daily boundary, with no background polling or persistent browser storage. Authorization is still verified for server requests. Ordinary page/authentication traffic still exists; this change prevents visitors from triggering measurements, not all HTTP resource consumption.

The existing Apps Script sender has a custom, read-only `datastore.entities.get` grant on the collector project, conditionally expiring with the pilot. It cannot list/query/write collector documents or access billing, account inventories or platform administration through that grant. Existing OAuth scopes remain unchanged. Account, platform and Hosting aggregates currently retain their previously published operator snapshots because the scheduled reader lacks those source connections. The UI identifies unsupported sources and displays their original measurement times. The daily clock attempts each bounded source once; failures do not become invented values.

The former operator refresh command is now a saved-report diagnostic only. Manual publish/repair options are rejected before any network request:

```powershell
node node_modules/esbuild/bin/esbuild scripts/refresh-admin-report.ts --bundle --platform=node --format=esm --packages=external --outfile=.local/refresh-admin-report.mjs
node .local/refresh-admin-report.mjs
```

This reads only the published report. It does not collect source measurements, write cloud records, send email, change user records, or alter schedules.

- **Actual Google charges:** no configured readable Cloud Billing cost export is connected. The dashboard links to Google Billing and the official export setup guide. Reservations and usage counters are never substituted for charges, and missing values are never zero-filled. No billing export or paid service was enabled by this release.
- **Popular pages, referrers, country/region:** no aggregate analytics source is connected. The dashboard marks these unavailable. Hash-based app tabs cannot be inferred from Hosting asset traffic. No visitor identifiers, raw referrers, IP addresses or new location collection were added.
- **User trends:** counts describe currently registered accounts and exclude deleted accounts; they are not active-user statistics. The bounded source refuses incomplete/paginated results rather than showing partial counts as complete.

## Verification

Daily-clock revision: 467 unit tests and six targeted desktop/mobile browser tests passed. Tests cover 100 repeated reads without source calls, failed and duplicate clock attempts, HTTP rejection of force/collection actions, daily-boundary caching, status aging and expiration. Production version 19 displays the next scheduled update as October 14, 08:10 EDT and preserves the existing October 13, 19:09 report timestamp when opened. Its first new daily collection is pending the next clock window; no out-of-schedule collection was run for deployment verification. Screenshot: `.local/admin-daily-live.jpg`.

Original release verification:

- 461 unit tests passed, including ask-price valuation, stale-price alert guards, Admin authorization, measurement failures, budget admissions and cache bounds.
- 30 Firestore emulator/integration tests passed, including direct report authorization and protected private records.
- 24 browser tests passed across desktop/mobile, including Portfolio CRUD/calculations, Settings preferences and alerts, unsubscribe confirmation, legacy routes, owner/non-owner Admin, measurement failure states and narrow-screen overflow.
- Frontend and Apps Script type checks/builds passed. Live unauthenticated and forged-identity Admin/history requests returned authorization errors without report data.
- Signed-in production verification confirmed real Admin aggregates, operational refresh, the dated historical report, legacy Settings redirects, and unchanged holding values. Freshness was visible only after opening Valuation details.
- The hourly scheduler remained enabled, paid reservations were never reset (normal guarded requests continue to reserve cost), and the legacy stopped free-tier ledger retained its original hash.

Production screenshots are saved in `.local/admin-live-desktop.jpg`, `.local/admin-live-mobile.jpg`, `.local/portfolio-live-desktop.jpg`, `.local/settings-live-desktop.jpg`, and `.local/settings-live-mobile.jpg`. Live Settings/Admin layouts also passed a 390-pixel overflow check. Emulator desktop/mobile screenshots and test traces are separate local verification artifacts.
