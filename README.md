# BazaarSignal

The [October 4 infrastructure preparation](docs/FREE-TIER-PREPARATION.md) adds local, disabled-by-default capacity planning, atomic scope-aware reservations, visible-portfolio demand and smaller cached price responses. Shared headroom is incomplete, so production activation remains blocked; no deployment or billing/permission change was made.

A private SkyBlock portfolio tracker for manually recorded Bazaar items and exact Auction House asset variants. Create named portfolios, record acquisition costs and additional purchases, inspect estimated value and unrealized returns, and choose holding-based percentage notifications.

The interface uses a night-market theme with lantern-lit scenery, mint accents, pixel headings and live portfolio, notification and account components. Portfolio value history records complete observed estimates on the current device, with day/week/month/all views and up to 90 days of retained snapshots. Purchases and holding edits affect the value chart; unavailable prices never create a false drop. See [the night-market release](docs/NIGHT-MARKET-RELEASE.md).

**Market collection and new notification evaluation remain paused.** The October 4 portfolio release preserves the existing authentication, private records and original UI. The existing cloud collection schedule is paused, and both collection and evaluation also have code gates. Billing and IAM are unchanged; retained cloud resources may still have costs. See [the release evidence](docs/PORTFOLIO-RELEASE.md) and [existing zero-cost audit](docs/ZERO-COST-AUDIT.md).

- Portfolios is the landing page. Stable links use `#view=portfolios&portfolio=<id>`, `#view=notifications`, `#view=account`, and owner-only `#view=usage`. Old discovery, watchlist, positions and standalone-alert routes redirect to Portfolios. Existing `#disable=<capability>` links still require explicit confirmation.
- Holdings remain editable without prices. Quantity is always a whole number; coin inputs accept commas and case-insensitive k/m/b. Auction quantities count identical stacks, with acquisition price per stack. Asset configuration is immutable; record materially different variants separately.
- Legacy Positions copy to **My portfolio** using an atomic per-item migration marker. Originals remain intact. Retries do not duplicate holdings, and deletion does not resurrect imports.
- Bazaar estimates use normalized instant-sell bids before fees and slippage. Full-quantity after-tax estimates require complete visible depth and compatible fee evidence. Auction estimates use the lowest exact-variant asking price from at least three matching listings, never completed sales or guaranteed proceeds.
- Holding notifications support upward/downward percentage crossings against average acquisition price or a fresh server-captured sample. Configuration sends no mail. Evaluation is disabled pending a separately authorized release. Email preferences default off.

See [portfolio behavior, migration, security and release notes](docs/PORTFOLIOS.md) for the complete contract and release prerequisites. Historical market/deployment notes describe previous releases and are not instructions to restart services.

## Local development and verification

Use Node.js 24 and `npm ci`. Configure the existing BazaarSignal public Firebase client values in `.env.local`. `npm run dev` (or `npm run dev:local`) starts the app at **http://127.0.0.1:5173** with real Google sign-in and a separate local Firestore database. Java 21 is required; the launcher also finds the existing JRE under `.local/java21/`. Portfolios, holdings and notification settings are editable locally without deploying cloud rules. The launcher imports saved data from `.local/local-workspace-data` and exports it on orderly shutdown; stop with Ctrl+C to preserve changes. No collector, notification evaluator or email sender starts.

The owner-only local Usage & Costs page refreshes read-only cloud measurements using the existing local Firebase CLI owner login. A local SQLite cache shares a durable 30-minute measurement limit across tabs, restarts and the diagnostic script; failures keep their slot and the previous report's original timestamps. Opening the page or pressing Refresh checks this cache; no background job runs. Refresh never starts collection, notifications or email, writes cloud records, enables services, or changes billing/permissions. Missing cost records and shared-account headroom remain unknown. `.local/usage-dashboard-measured.json` supplies the initial saved report when available. Production records remain separate. `npm run dev:ui` starts Vite alone for test harnesses or a separately configured backend; it does not supply local persistence. `?fixtures=1` is development-only, clearly labeled, and cannot trigger notifications.

- `npm test`: valuation, percentage notifications, private backend boundaries, quotas, caches, allowances and shared collection tests.
- `npm run test:local`: notification mutations against an already-running local workspace, using disposable records and the actual backend validator. Leaves existing local portfolios intact.
- `npm run backup:local`: back up the running local database; recovers completed exports after Windows directory-rename failures.
- `npm run test:rules`: Firestore emulator ownership/schema, migration and concurrent-transaction tests. Requires Java 21; the existing local JRE is under `.local/java21/`.
- `npm run test:browser`: isolated Auth/Firestore emulator desktop and mobile journeys, including owner Usage & Costs. Never sends mail or contacts a market service.
- `npm run build`: production frontend and Apps Script bundle/type checks.
- `npm run build:collector` and `npm run build:market-functions`: local-only infrastructure builds.

The test harnesses use separate Auth/Firestore ports 9098/8081 and can run while the local workspace stays open on 5173/8080. Run the two test harnesses sequentially because they share their test ports.

The legacy discovery UI, watchlist, opportunity inspectors, filter/ranking controls, standalone alert forms and public UI-kit gallery have been removed. Shared market normalization, comparison, fees, caching, authentication and legacy delivery primitives remain where needed for portfolio valuation or safe record retirement. No package dependency became wholly unused: Firebase and React serve the app; hashes, compression and Redis still serve shared infrastructure.
