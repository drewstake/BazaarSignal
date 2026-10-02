# Google Functions deployment

> **Current release, October 2, 2026:** the user authorized live deployment and clarified that free-tier usage is a target rather than a strict $0 guarantee. The reviewed release uses hourly collection, daily cleanup, hourly browser caching, one maximum instance per service, and a fixed November 1 expiry. See [current settings, limits and evidence](FREE-TIER-LIVE-DEPLOYMENT.md). The remainder describes the earlier rollout; its minute cadence, instance counts and Apps Script version are historical.

Prepared October 1, 2026 for the user-created project **bazaarsignal-510305** (1081657730748), owned by `drewstake3@gmail.com`. The existing Firebase website/auth/users remain in **bazaarsignal**. Do not replace frontend Firebase configuration with the new project ID.

## Status

Billing was linked by the owner and verified on October 1. The Firestore database, private bucket, dedicated runtime identities, public `marketApi`, and private scheduled `refreshMarket` are deployed in `us-central1`. Artifact Registry automatically removes deployment images after one day. The API origin is `https://marketapi-k5a64sgi2q-uc.a.run.app`. The verified `free-preview` Hosting channel was promoted to **https://bazaarsignal.web.app** and Apps Script version 8 is live.

On October 1, `drewstake3@gmail.com` accepted Owner access to the existing **bazaarsignal** Firebase project. Both projects can now be managed with that Gmail account, which is the deployment CLI default for this workspace. Select `--account drewstake3@gmail.com --project bazaarsignal-510305` for the collector and `--account drewstake3@gmail.com --project bazaarsignal` for the website. At the user's subsequent request, direct project permissions for `drew@theinnovativeowl.com` were removed, leaving Gmail as the sole direct Owner. The Firebase project still belongs to organization `344551077324`; organization-level permissions are separate and were not changed. This access change did not migrate resources, billing, users, or alerts.

## Architecture

- `marketApi`: public cache-only HTTPS function, zero minimum instances, at most two instances, concurrency 20, 1 GiB and one CPU, 60-second timeout. It never calls Hypixel.
- `refreshMarket`: private scheduled function, one-minute Cloud Scheduler cadence, zero minimum instances, one maximum instance, concurrency one, 1 GiB and one CPU, 180-second timeout. Scheduler retries are disabled; subsequent scheduled executions use the persisted backoff and budget.
- Firestore `marketCache`: request ledger, leases, seller names, and snapshot pointers. Every claim/charge/publication uses server-checked compare-and-swap: an atomic batch with a control-document update-time precondition (or create-if-absent). Losing callers reread state without holding pessimistic read locks. All browser Firestore access is denied; large string fields have indexing disabled.
- Private Standard Cloud Storage bucket in `us-central1`: gzip-compressed current snapshots. Upload an immutable candidate, then atomically publish its pointer with the conditional control update. Stale owners cannot publish over a new owner. No partial blobs become visible.
- Superseded/failed candidates get a ten-minute read/staging grace, then scheduled cleanup deletes only unreferenced objects. Current snapshots are kept during failures, regardless of age. No bucket-wide age deletion rule, completed-sales history, public bucket access, or service-account keys.
- Separate runtime identities: collector has object administration on this bucket; API has object read access. Both have Firestore access for their respective shared coordination and seller-name operations. Authentication/alert/email identities stay in their existing project.

The scheduler checks every minute; it does not fetch a complete market every minute. Existing budgets and due times remain authoritative (120/5 minutes, at least 20% reserve; Bazaar minimum 60 seconds; auctions planned from actual page count). Minute scheduling can round the previous 145-second auction plan up to roughly three minutes or longer under contention, jitter, and budget pressure. Stale comparisons are still withheld at 180 seconds; the UI must report actual source timestamps. There is no 15-second full auction fetch.

Live verification found inconsistent pages near upstream minute rollovers. When auctions are due and the budget can fit them, the Google invocation waits at most 12 seconds to start outside that boundary, using the observed source timestamp/cadence. This server-side wait is billed invocation time. Budget deferrals calculate when enough requests have expired to fit the entire snapshot, rather than repeatedly retrying after the first slot expires.

After an error, a scheduled invocation may wait until the persisted retry time and attempt one additional tick, only when that wait is at most 30 seconds. All lease, cooldown and budget checks still apply. No background work continues after the invocation returns.

## Prepare and deploy after billing is linked

```powershell
# Inspect only; does not link billing or create resources.
node scripts/prepare-google-market.cjs

# Explicit resource setup. Refuses disabled billing and only targets the new project.
node scripts/prepare-google-market.cjs --apply
npm ci --prefix market-functions
npm run build:market-functions
npx firebase deploy --config firebase.market.json --only firestore:rules,firestore:indexes,functions:market-cache --project bazaarsignal-510305 --account drewstake3@gmail.com
```

The separate `firebase.market.json` excludes the old `functions/` history/alert implementation and all Hosting resources. Never deploy the legacy functions package to activate this cache. The setup script is additive/idempotent, preserves existing IAM bindings, and never links or reopens a billing account. Verify the new project's billing connection in the Google Console first.

After deployment, confirm that `refreshMarket` is private, only Cloud Scheduler can invoke it, and the bucket is private. Wait for naturally scheduled complete Bazaar and auction snapshots; inspect the deployed `marketApi` URL with `/api/companion/status`. Compare source freshness, error state, request counts and actual durations. Exercise cached list/filter/page/check/seller actions and confirm they add no Hypixel requests. Check memory use under concurrent reads before increasing instance limits.

Use the function's dedicated Cloud Run HTTPS origin (`serviceConfig.uri` in the deployed function metadata), which serves `/api/companion/...` directly. Set **only** `VITE_MARKET_API_URL` in the frontend environment. Apps Script defaults to this deployed public origin; its optional `MARKET_API_URL` Script Property overrides the default for other deployments. No Script Properties were changed during rollout. Existing Firebase keys/project/auth domain, Script signing key, deployment URL, trigger and user records stay unchanged. Build and verify a Hosting preview, then deploy the existing Apps Script version and promote the preview using the existing rollout procedure. Do not use a `cloudfunctions.net/marketApi` URL containing a path.

Do not promote the new frontend or Apps Script before the shared endpoint works. Until then, the existing live site remains unchanged. Stop the old local live collector before moving the shared Hypixel allowance to the new production ledger; wait out its budget window/cooldown first. Mock/emulator collectors do not contact Hypixel.

## Cost and operational limits

This is billing-enabled infrastructure, not a guarantee of zero cost. One schedule per minute is about 43,200 scheduled invocations per 30 days; browser API requests are additional. Cloud Run compute/memory, outbound traffic, Firestore operations, object storage operations, builds and artifacts have separate allowances. Two million free requests do not make these other meters unlimited. Read-side metadata caching (two seconds), decoded snapshots and result-page caching reduce repeated storage operations without coordinating refreshes in memory.

The chosen instance limits bound concurrency, not a total dollar bill. Before promotion, inspect account-wide free-tier consumption and estimate costs using actual cloud durations and serving traffic. Budget notifications alone do not stop charges. Keep no minimum instances, preserve the durable budget ledger, and never delete it as a configuration workaround. Policy changes must wait for all workers to stop and the larger old/new budget window to drain; the existing SQLite/Redis `configure:market` command does not edit the Google store.

## Verification

114 unit/handler checks and 20 Firestore/security/backend checks passed. The five Google-adapter checks use the real Firestore emulator and injected blob storage: 100 independent coordinators elect one refresh owner; uploaded payload/pointer publication is atomic; stale CAS, expired ownership and failed uploads preserve the prior snapshot; cleanup preserves current and staging objects; 100 collectors plus 1,200 user reads perform one upstream fixture collection. Concurrent cold readers share one decoded snapshot allocation. Native Node gzip decoding enforces a two-megabyte decompression limit and rejects corrupt gzip data. Website, Apps Script, standalone collector and Functions builds pass.

## October 1 cloud verification

- The first complete 43-page auction snapshot took 31.714 seconds to fetch and normalize; its whole scheduled invocation took 36.418 seconds including other feeds/publication/cleanup. The selected auction interval was 145 seconds, rounded by minute scheduling. Bazaar minimum is 60 seconds; election data five minutes; item catalog one day.
- 100 concurrent live API requests covering status, searches and pagination all succeeded in 13.087 seconds. The persisted Hypixel total was **137 before and 137 after**. Availability came from the complete cached snapshot; `force=1` returned HTTP 400.
- The final conditional-batch revision completed its next 43-page auction snapshot in **19.560 seconds**. A second 100-request live test completed in **9.675 seconds**, with the upstream total **199 before and 199 after**. Both feeds reported fresh data and no error. The 36-second compute example below is a conservative planning example from the first deployment, not the final revision's measured auction duration.
- After the final scheduling adjustment, the automatic 06:25 UTC generation published all **43 pages in 16.795 seconds**, with **46 requests in the rolling five-minute window**, no errors, and both feeds fresh. The shared lifetime counter was 319, including all rollout attempts and probes. These observations are a deployment sample, not a long-term latency guarantee.
- A real mixed-page rollover was rejected, and the previous complete snapshot remained readable with stale comparisons withheld. Deployment attempts, probes and interrupted collections remained charged in the durable ledger; no budget was cleared. The routine 96/5-minute allocation correctly deferred collection until capacity returned.
- Public API IAM grants only invocation. Collector invocation is restricted to its scheduler/runtime identity. The snapshot bucket is private and the API identity has object-read access only.
- Apps Script version 8 uses the shared public origin by default, with the existing URL, properties and trigger preserved. Live order-book reads succeeded and unauthenticated account reads were rejected. No live test emails or user-alert mutations were performed.
- Desktop (1440px) and mobile (390px) previews displayed current data without horizontal overflow. Searches, fresh/stale display, listing availability and seller-name resolution were verified. Production retained the existing signed-in session, loaded the user's active/completed alerts with current prices, and opened/cancelled the target editor without changing the alert. Browser clipboard access was unavailable in the background test tab; the app retains its manual-copy fallback and automated clipboard tests.

The older pessimistic Firestore transaction implementation exhibited lock contention under the 100-instance emulator test. Conditional atomic batches removed those read locks; the complete emulator suite passed before final rollout. Native Node decompression and shared decoded reads reduce collector/API CPU and memory work.

Cost planning must include elapsed compute time, not just the 43,200 monthly scheduled requests. For example, 36 seconds every three minutes is 518,400 vCPU-seconds per 30 days at one CPU, before other invocations or browser traffic. That exceeds the 180,000 vCPU-second request-based free allowance even though request count is low. At the published us-central1 CPU/memory rates and an otherwise unused allowance, that example is about $8.52 in compute alone; actual final-revision durations, retries, other account usage, database/storage operations and network traffic change the bill. [Google Cloud Run pricing](https://cloud.google.com/run/pricing).
