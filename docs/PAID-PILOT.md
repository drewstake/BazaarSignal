# October $5 paid pilot

Activated October 13, 2026, approximately 5:32 p.m. Eastern, on the existing billed collector project. No new hosting provider, paid subscription, billing account, database or Scheduler job was created.

## Active behavior

- Bazaar collection: the existing private Scheduler target runs hourly, with no Scheduler retries. The first run succeeded: two upstream HTTP 200 responses, 16 Firestore reads, nine writes and 3.377 seconds of handler work. Catalog was already current. Normal collector retries remain bounded by nine upstream attempts per admitted run.
- Browser prices: cached, hourly updates. Signed-in production verification displayed the existing Booster Cookie holding and its estimated value. Old samples remain labeled stale after three minutes; stale samples cannot trigger mail.
- Portfolio email: Apps Script deployment version 16, the same web URL, sender and authentication. `scheduledPaidMinuteTick` is installed and has completed successfully; the clock permits evaluation only around :02 each hour. Existing opt-ins, thresholds, quota checks, deduplication, freshness and the 70-minute runtime guard remain. Retired legacy email remains paused.
- The owner's Email delivery setting is On, but the live Notifications page currently has **zero configured alerts**. No threshold was invented, no user holding or alert was changed, and no test email was sent. An actual threshold-triggered delivery has not been observed in this trial.
- October 13, approximately 5:57 p.m. Eastern: deployed the owner's requested sell-offer valuation update to Hosting and Apps Script version 17 on the same deployment URL. Unit prices, estimated values, P&L, returns and newly saved alerts use the lowest sell offer (best ask), before fees. Existing bid alerts retain their saved source on pause/resume and evaluation. Immediate liquidation still walks buy bids. The ask-based chart starts a separate series without deleting the former bid history. No collector deployment, schedule, billing or budget changes were needed. All 452 unit tests and frontend/Apps Script typechecks passed. Live verification showed a cached Booster Cookie ask of 13,526,899.4 coins and value of 3,868,693,228.4 for 286 items, correctly labeled stale. Proof: `.local/sell-offer-live-portfolio.png`; script deployment proof: `.local/sell-offer-script-deployed.png`; rollback source: `.local/sell-offer-before-Backend.gs`.
- Auction collection, auction valuation and auction alerts were removed from the existing source. Paying for infrastructure does not restore them.

## Budget and expiration

The target is $5/month, with an application stop at $4.50 in **reservations**, not measured dollars. A separate `marketCache/paid-budget-october` document starts with a $1 fixed reserve for deployment, retained storage, operator reads, delayed historical billing and shutdown overhead. Each admitted operation adds a conservative gross-cost reservation using current on-demand prices without subtracting free allowances. Failed and ambiguous work retains its entire hold. Response transfer is reserved before sending, with $0.25/GiB allowed. Firestore/Storage and Cloud Run share us-central1; their internal transfer is free under the documented locality rules.

The first collection adds about $0.00280 to reservations; this is not its actual charge. A full 31-day model with 744 collector invocations and 2,000 compact API requests, before additional response bytes and accounting overhead, is below $4.50 including the fixed $1. Actual admission stops early if the request mix, transfer or contention uses the remaining reserve. Maximum instances are one per service, minimum instances zero; request-based CPU billing and startup boost disabled.

This is a small private-use trial, not a guaranteed $5 invoice cap. Google billing is delayed; public traffic can incur platform/startup costs outside application admission. Retained resources continue to exist after shutdown. Google budget alerts are not a hard spending cap. The previous owner dashboard remains a historical free-tier report; the website labels it as such and actual spending remains Unknown.

The fixed end remains **November 1, 2026, 07:00 UTC** (2:00 a.m. Eastern, after the DST change). There is no automatic renewal or counter reset. On paid-budget exhaustion or a fatal runtime failure, the application records the paid stop, pauses Scheduler and removes public invocation from the cache API. The original `free-20261001` ledger, all counters, measurement history, owner-stop record and deployment receipts remain unchanged. The paid ledger links the original hash `ccffd2bc86b26e55bb53f3a22fcc1abfbb5597a4c137db6a9d78c390e6f28413`.

## Verification and receipts

October 13, approximately 20:13 EDT: the [performance release](PAID-PERFORMANCE-DEPLOYMENT.md) deployed paid browser presence removal and warm snapshot reuse to API revision `marketapi-00021-bsg` and Hosting version `9bbfa97966992233`. The collector stayed on `refreshmarket-00018-jdq`; Apps Script version 19, hourly price/email schedules and daily Admin collection were preserved. The active release path used `paid-budget-october`, retained a new $0.50 rollout reservation, and preserved the original expiry and every prior counter. After two successful ordinary production price reads, reservations were $1.527464412; actual Google charges remain unknown. The entries below describe the initial activation, not the current API revision.

449 unit tests passed before deployment; 36 focused tests passed after the extra paid-release validation and client cache changes. Root, cloud and Apps Script typechecks passed. The local image boots both paid handlers with outbound networking blocked. Live checks confirm successful collection, enabled hourly Scheduler, completed paid accounting, unchanged legacy ledger, real cache responses, signed-in portfolio value, and the sender's single new trigger with 0% errors.

- Image: `sha256:6f7f944fb267cb0cdb465eac177242e05c5d75fe5ef38aa2acd26615f78dbb8a`; local upload 12,964,303 bytes; no Cloud Build.
- Cloud revisions: `marketapi-00020-m4m`, `refreshmarket-00018-jdq`.
- Private release: `.local/private-release-paid-pilot-oct13-apply.json`.
- Activation: `.local/paid-activation-1791927141430-apply.json`.
- Initial run evidence: `.local/paid-observation-1791927165195.json`.
- Apps Script rollback sources: `.local/paid-before-{Backend,Entrypoints}.gs`; prior deployment version 15.
- A first Hosting smoke check caught omitted public Firebase settings. The site was rebuilt with its existing reserved-endpoint configuration and republished; authenticated production verification then passed. `scripts/build-paid-site.mjs` makes the fixed paid build reproducible and refuses incomplete Firebase configuration.

Read current pilot state with `node scripts/read-paid-pilot.cjs`. Build the paid frontend with `node scripts/build-paid-site.mjs`; ordinary builds remain paused by default. Do not rerun activation: the separate ledger is create-only, and the old period must never be replaced to clear a budget stop.

Sources checked October 13: [Cloud Run pricing](https://cloud.google.com/run/pricing), [Firestore pricing](https://cloud.google.com/firestore/pricing), [Storage pricing](https://cloud.google.com/storage/pricing), [Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing), [budget behavior](https://docs.cloud.google.com/billing/docs/how-to/budgets), [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).
