# BazaarSignal

The new Sky Island Market companion adds public Bazaar strategies, exact-configuration BIN valuation, a shared historical collector, private watchlists, and saved filters. Start with `npm run dev`; see [docs/MARKET.md](docs/MARKET.md) for pricing assumptions, collector setup, costs, tests, and deployment. **This companion release is implemented locally and has not been deployed.** Existing production details below describe the prior price-alert release.

Public SkyBlock Bazaar prices and private email alerts at https://bazaarsignal.web.app.

Anyone can search items, inspect details/order books and calculate full-quantity estimates without signing in. Sign in with a verified Google account to create a buy-below or sell-above alert. Emails go to that account's verified address. Each user's alert records remain private. The confirmation email has a secure disable link; opening it does nothing until **Disable alert** is selected. An alert completes after one qualifying target event.

The existing price and alert workflows remain available alongside the new React market board. Firebase remains on **Spark** with Hosting, Google Authentication and Firestore. Apps Script polls alerts approximately every five minutes and sends through MailApp as `bazaarsignal@gmail.com`. Continuous auction history requires the separate collector described above; no billing upgrade or paid service has been enabled.

The original owner `drew@theinnovativeowl.com` remains the project administrator, but no longer has exclusive app access. The public-access change was explicitly requested after the original private deployment. The sender and every Firebase user are separate identities. `drewstake3@gmail.com` remains the explicitly authorized delivery-test recipient.

See [SETUP.md](SETUP.md) for deployment, verification, quotas, migration and recovery. See [GMAIL_SETUP.md](GMAIL_SETUP.md) for sender authorization and the untouched encrypted app password.

## Access and data isolation

- `snapshot` and `book` return only public Hypixel data and aggregate monitoring information. They never include alerts, recipient emails or disable hashes.
- `account` and `create` validate every Firebase ID token through Google's `accounts:lookup`, then check project, issuer, expiry, revocation, enabled account, Google provider, verified email and matching claims. The UID and recipient come exclusively from that validated identity.
- Each user has a server-only `backendUsers/<uid>` ledger. The only new client-readable document is `users/<uid>/status/main`, a sanitized projection readable solely by that same verified Google user. All client writes and reads of private ledgers, tokens, receipts, admission counts and control records remain denied.
- Existing `owners/<uid>` records retain their original restrictive rules. Public access does not make the old owner's data public.
- Browser requests are readable HTTPS CORS simple POSTs with `text/plain`; ID tokens travel only in protected-operation bodies. No JSONP, opaque-success fallback, Google access tokens in the frontend, or credentials in URLs are used. An exact origin allowlist is an additional routing check, not identity proof.
- The unauthenticated disable operation requires a 256-bit HMAC capability and explicit `confirm: true`. Protected records store only its SHA-256 hash; the raw link is reconstructed for email and never persisted in the outbox. Capabilities differ between users even if their request IDs match. URL fragments and `Referrer-Policy: no-referrer` reduce link leakage.

## Prices, limits and delivery

Instant buys fill `buy_summary` from cheapest asks upward; instant sales fill `sell_summary` from highest bids downward and deduct the configured tax. The entire quantity must fill from visible depth. Buy comparisons include equality at/below the target; sell comparisons include equality at/above the after-tax target. Malformed data, insufficient liquidity, snapshots older than three minutes and timestamps over 30 seconds in the future cannot trigger alerts.

Each account can have 20 active alerts and 100 stored alerts, including completed/disabled records retained for idempotency. New creation is limited to 5/hour and 20/rolling day per account, plus 40/rolling day shared across the site. These limits keep a free public service from accepting unlimited email work. Duplicate retries do not consume another slot. Other services and accounts can still exhaust Google's shared free quotas; there is no paid fallback.

The consumer MailApp allowance is currently 100 recipients/day for the sender, shared by all users and counting both confirmations and target emails. Every send checks remaining quota. Exhausted quota defers queued messages for one hour without consuming attempts. The scheduled worker processes active users in a rotating order with a soft execution budget. Heavy load, exhausted runtime or upstream failures can delay a user's checks beyond five minutes; the signed-in status shows that user's actual progress.

Creation atomically persists the user's alert, one confirmation event, capability lookup, sanitized projection and global admission count. A repeated request ID returns the same result; changed settings are rejected. Script-wide locking and Firestore update-time preconditions protect transitions. The target waits for confirmation acceptance and has one event ID. Successful deliveries are not intentionally resent.

Before MailApp sends, the delivery claim is persisted. A user-scoped Script Properties receipt protects a successful send if the next Firestore save fails; it is removed only after durable sent status is saved. Failure retry delays are 1, 5, 15 and 60 minutes, with at most five attempts; actual execution waits for the next worker tick. Interrupted sends have a ten-minute lease. MailApp has no transactional send/idempotency key: a crash after acceptance but before any persisted receipt can still cause a duplicate on retry. Acceptance does not guarantee inbox receipt.

Disabling is idempotent and cancels unsent work for that alert. An email already in flight may arrive. Five-minute polling can miss brief price movements; all Minecraft trades remain manual.

## Development

### UI kit collection

Run `npm run dev` and open `/ui-kits.html` to compare three interactive design directions: **Signal** (dark trading desk), **Ledger** (light editorial market), and **Ember** (warm deal discovery). Each includes Overview, Bazaar flips, Auction deals, Watchlist, and a UI library with colors, typography, controls, status states, and CSS token export. Direct links accept `?kit=signal|ledger|ember&view=overview|bazaar|auctions|watchlist|components`.

The gallery is a separate entry point in `src/ui-kits/`. It uses illustrative fixtures, isolated browser storage for the demo watchlist, and local interactions. Its adjustable 1.25% example sale fee is a design assumption, not a current Hypixel fee schedule. It does not query market APIs, create production alerts, send email, or execute trades. Shared UI components live in `components.tsx`, theme tokens and responsive layouts in `kits.css`, and fixtures in `data.ts`.

`npm run build` includes the gallery at `dist/ui-kits.html`. After building, `npm run test:ui-kits` checks desktop/mobile navigation, filters, calculator validation, saving, token downloads, and layout. Preview screenshots are written to `.local/ui-kits/`.

### Application development

Workspace: `C:\Users\drews\Development\BazaarSignal`. Use Node.js 22.12+. `npm ci`, then `npm run dev`. The ignored `.env.local` contains public Firebase values and the public Apps Script URL, never service credentials. Production requires `VITE_BACKEND_READY=true` and all Firebase client values. Development `VITE_APP_MODE=local` uses browser-only live-price simulation; `?demo=1` uses fixtures. Production with Firebase configured ignores that local override.

- `npm run build`: frontend and Apps Script type checks/bundles.
- `npm test`: 54 unit/handler tests, including account isolation, migration, quotas, idempotency and pricing.
- `npm run test:rules`: 11 emulator/security/backend checks; requires Java 21.
- `npm run test:browser`: 6 existing desktop/mobile flow checks.
- `npm run test:public-browser`: 2 production-build desktop/mobile anonymous-access checks with mocked public API responses; run after build.

`functions/` is historical regression/local simulation code and is not deployed. `firebase.json` configures only Hosting/Firestore for deployment. Follow the preview-first release process in SETUP.md.
