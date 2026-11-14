# Continuous market service

Deployed and activated November 7, 2026 with the owner's explicit authorization to remove the budget and restore the app. The production portfolio displays current market values without the paused banner. Original October accounting and saved holdings/notification settings remain intact.

## Billing observation

The signed-in Google Cloud Billing report was filtered to project `bazaarsignal-510305` (project number `1081657730748`). The October 1–31 charge-period report displayed $0.35 Cloud Run Functions usage and −$0.35 credits/savings, giving $0.00 net charges. Artifact Registry displayed $0.00. November 1–7 displayed $0.00 net charges. These are rounded provider report values observed November 7, not application reservations or forecasts.

[October project report](https://console.cloud.google.com/billing/012803-EA91BE-8DCD32/reports;timeRange=LAST_MONTH;projects=1081657730748?project=bazaarsignal-510305). The relative “last month” selection changes over time. A local screenshot is retained as `.local/billing-october-2026.png`.

## Running behavior

`MARKET_OPERATING_MODE=continuous` selects an explicit runtime without the October deadline, $4.50/$5 spending stop, or lifetime pilot admission cap. A new `marketCache/market-operations` ledger uses identity `continuous-v1` and `budgetPolicy: uncapped`. Its monetary limits and expiry are encoded as zero to mean disabled; Admin exposes them as “Disabled” and “None.” Usage estimates and separate deduplication receipts continue accumulating. The new record links the original paid ledger's SHA-256; it never resets or rewrites that ledger.

The existing 15-minute cadence, finite per-request resource envelopes, timeouts, maximum service instances, upstream rate limits, freshness checks, email quotas, deduplication, owner stop, and error shutdown remain. Historical paid/free-tier modes retain their original restrictions. Continuous mode does not consume the retired October spending feed. Admin links to current Google Billing and never labels unavailable cost data as zero.

## Release evidence

- Market API revision `marketapi-00033-w64` and collector revision `refreshmarket-00030-bgz` run verified image `sha256:2434b2d03e2f3128572375f0b9ea87d996af2a324fa2861c764d4fe3342e898f` in explicit continuous mode. Obsolete live/trial environment values were removed.
- Both original Cloud Scheduler jobs are enabled with unchanged targets, identities, timeouts and schedules: collection `*/15 * * * *` UTC and daily close `59 4 * * *` UTC. The API is publicly readable; the collector remains private. Instance/resource limits are unchanged.
- The original shutdown-only grants and existing sender's single-document reader grant now work without the expired October time conditions. Roles, members and resource scopes are unchanged; unrelated bindings were preserved with policy etags.
- The new operational ledger was created atomically only after both verified handlers were ready/private and the jobs paused. Historical paid SHA-256 remains `532a45a995b133822a79a5f5098daa2d2e14c9a91bd55215c7c0438fcb4668eb`; historical free-tier SHA-256 remains `ccffd2bc86b26e55bb53f3a22fcc1abfbb5597a4c137db6a9d78c390e6f28413`.
- The retired Google Budget named “BazaarSignal October 2026 net spending” ($5, October 1–November 1, scoped to the market project) was backed up, removed and verified absent. This deletes only its notification configuration, not charges or billing history. Its old Pub/Sub resources and historical app ledger were retained.
- A single immediate run of the existing collector job completed at 21:06 UTC with fresh upstream data, no error and `continuous-v1` identity. The next natural 21:15 UTC scheduled run also completed successfully, publishing prices at 21:15:12 UTC.
- Apps Script saved sources were backed up and replaced with byte-verified local bundles. Existing deployment `AKfycbzcKMazci0idgnN_tyccU8Q2ab6KRGWKm9Wo363sSwgIt946DmAcO_VU3yVSspplIat9Q` now uses **version 25**, deployed as `bazaarsignal@gmail.com`. `configureContinuousMarket` completed at 21:08:16 UTC. Exactly one existing minute trigger remains; the code admits notification checks at :02, :17, :32 and :47. No test email was sent.
- The first natural notification evaluation after activation ran at 21:17 UTC. The saved worker record reports a new successful check at **21:17:20 UTC** and `paidError: null`, replacing the October stale-evidence error. This verifies processing, not inbox delivery.
- Hosting version `fd48e10e590033b1` was released at 21:11:32 UTC with the explicit continuous build, with deployed HTML/entry assets compared to the local artifact. The local release journal records final hashes. The signed-in portfolio retained its original quantity, acquisition cost and enabled 13% alert.

The Admin page reads its saved daily report rather than collecting on page open. The October snapshot is explicitly historical until the next daily report at 12:10 UTC; obsolete budget cards no longer describe current operation. Limited sender permissions can leave individual provider measurements unavailable, with their original timestamps retained. Current Google charges remain available through the billing report link.

Local receipts and rollback material are in `.local/continuous-release-2026-11-07/`, including original cloud state, IAM changes, source backups, initialization/activation records, source/asset verification and screenshots. These local files are not committed because they include account-specific operational state. Old Hosting version `1a0556c84eed1f55`, API revision `marketapi-00032-zhg`, collector revision `refreshmarket-00029-jct` and Apps Script version 24 form the rollback baseline. Pause the schedules/worker before rollback; never reset either ledger or private records.

## Repeatable deployment procedure

1. Complete Firebase CLI sign-in and obtain fresh service revisions, IAM, schedules, ledger hashes, Hosting version, and saved/versioned Apps Script backups. Inspect existing resource-specific shutdown/Admin reader grants: the old time-limited grants may have expired. Preserve their principals and narrow resource scope when updating for continuous operation.
2. Build Hosting with `node scripts/build-continuous-site.mjs`, build Apps Script with `node scripts/build-apps-script.mjs`, and build/verify the market image with the existing image tools. Do not use old fixed-period activation scripts or change their historical checks.
3. With both schedules paused and the API private, deploy both verified market handlers with `MARKET_OPERATING_MODE=continuous`; remove obsolete live/trial expiry environment values. Preserve service accounts, instance limits, timeouts, base-image configuration, and the existing URLs.
4. Inspect then initialize with `node scripts/initialize-continuous-market.mjs <verified-image-receipt> --inspect` and `--apply`. Apply requires both verified continuous handlers to be ready and private, both schedules paused, and unchanged historical accounting. It atomically verifies old document versions and creates the new ledger only if absent. It does not resume jobs or change IAM. An existing operational ledger must never be replaced to clear a stop.
5. Restore public cache API invocation and the existing 15-minute and daily-close schedules. Verify a natural successful collection and a current cache response with identity `continuous-v1`, without a trial expiry. Keep the collector private.
6. Publish the matching Apps Script source and existing web deployment. Under the existing sender account, run `configureContinuousMarket` in the editor after the API is verified. It sends no mail, preserves opt-ins/receipts, and reuses the existing minute trigger. Publish the matching Hosting artifact; do not run the default paused build over it.
7. Verify current portfolio prices, schedule state, notification-worker execution, Admin status, original ledger hashes, and the deployed asset hashes. Do not send an invented test notification. Rollback pauses the schedules/worker, restores the saved revisions and Hosting version, and keeps both ledgers and all user records.

## Local verification

937 tests passed; one optional test skipped. Frontend, Apps Script, market backend, and standalone collector typechecks passed. Hosting, Apps Script, and market artifacts built successfully. The market image booted both handlers in continuous mode with outbound networking blocked. After the historical Admin display adjustment, the frontend typecheck/build and 25 focused Admin/continuous/mail tests passed. Live checks verified current portfolio values, public API identity, successful collection, enabled schedulers, sender identity, anonymous rejection, and unchanged historical ledger hashes. Apps Script activation and subsequent natural minute-clock executions completed successfully; a completed clock tick alone does not establish email delivery.
