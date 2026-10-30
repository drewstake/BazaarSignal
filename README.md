# BazaarSignal

BazaarSignal helps Hypixel SkyBlock players track manually recorded Bazaar holdings, understand their acquisition costs and estimated returns, and configure price notifications. Public item search, saved order books and price history are available without signing in; private portfolios use Google sign-in.

[Open BazaarSignal](https://bazaarsignal.web.app) · [Documentation](docs/README.md) · [Local development](docs/development.md)

The website returned HTTP 200 on October 30, 2026. That verifies the hosted page, not the availability of market collection or email delivery. Features below describe this repository; dated deployment evidence lives in [history](docs/history/README.md).

## Features

- **Portfolios:** named portfolios, whole-item quantities, average purchase price or total cost basis, additional purchases with weighted costs, and available coins as buying power. Holdings are entered manually; there is no inventory sync or automatic trading.
- **Estimated returns:** Bazaar valuation uses the lowest sell offer (best ask), before fees. Unrealized gains and percentage returns use the matching acquisition basis. Missing prices produce incomplete coverage, not zero-valued holdings. Separate liquidation calculations require sufficient buy-bid depth and fee evidence.
- **Notifications:** opt-in email for upward/downward percentage crossings relative to average acquisition cost or a server-captured price. Settings support editing, pausing and deleting. Delivery requires an eligible fresh sample, verified identity, enabled preferences and an operating backend; saving a notification sends no email.
- **Public search and item pages:** a bundled catalog, shareable item links, sell offers and buy orders with up to 30 returned levels per side. Typing searches locally; selected items read the shared cache.
- **History:** daily closes from the archive, device-local item observations, and device-local portfolio value history. These are distinct datasets, not a complete trading ledger.

Auction House support is retired. New Auction House holdings, collection, valuation and alerts are unavailable. Previously saved unsupported holdings remain readable and deletable; legacy records and disable links are preserved.

## Stack and architecture

React 19 and TypeScript run in a Vite frontend on Firebase Hosting. Firebase Auth and Firestore protect private records. Google Apps Script handles authenticated notification configuration and MailApp delivery. A separate Node market API/collector serves shared cached Bazaar data and archived daily prices, with durable budget and expiration controls. Local adapters use Firestore emulation and SQLite; Vitest and Playwright cover isolated behavior. See [architecture](docs/architecture.md).

## Develop locally

Use **Node.js 24.19.0** (pinned in [.nvmrc](.nvmrc)) and npm. Signed-in development and emulator tests also require **Java 21** on PATH. Python with Pillow is needed only to regenerate artwork.

```sh
npm ci
npm ci --prefix market-functions
```

The root install includes the `functions/` workspace. `market-functions/` has its own lockfile and must be installed separately for its build.

For signed-in development, copy [.env.example](.env.example) to `.env.local` and obtain the existing BazaarSignal public Firebase client configuration from the maintainer. Then:

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. The launcher specifically requires the existing `bazaarsignal` project; a fresh clone with empty or unrelated Firebase values cannot use this mode. It uses real Google authentication with local Firestore records, shared cached market reads and cloud daily history. It starts no collector or mail sender. Stop with Ctrl+C to export local records.

For a **credential-free public preview**, run `npm run dev:preview`; sign-in is disabled and uncached price/history reads contact the existing public service. `npm run dev:preview:offline` uses saved local SQLite data instead; a fresh clone has no saved prices. `npm run dev -- --offline` still requires real Google authentication. Isolated test fixtures use a separate demo project and are not a signed-in development substitute. See [development modes and verification](docs/development.md).

## Common commands

| Command | Purpose |
| --- | --- |
| `npm test` | Isolated unit and handler tests; no cloud credentials |
| `npm run build` | Frontend and Apps Script type checks/bundles |
| `npm run build:collector` | Standalone collector type check/bundle |
| `npm run build:market-functions` | Market backend type check/bundle |
| `npm run test:rules` | Firestore emulator rules tests; Java 21 |
| `npm run test:browser` | Isolated desktop/mobile Auth + Firestore journeys; Java 21 and Chromium |
| `npx playwright test --config playwright.search.config.ts` | Public item/search/history checks with intercepted data |
| `npm run backup:local` | Back up the running local workspace |

Install test Chromium with `npx playwright install chromium`. CI runs the unit suite, all three builds and repository checks without deployment credentials. Deployment and collection commands are separate operator work; see [operations](docs/operations/README.md).

## Repository map

| Path | Contents |
| --- | --- |
| `src/`, `shared/` | Interface and shared valuation, notification and market logic |
| `server/`, `collector/` | Local adapters, cache, collection and history |
| `apps-script/`, `market-functions/` | Apps Script backend and Google market services |
| `functions/` | Retained legacy Firebase delivery backend |
| `public/` | Runtime artwork, icons, font and font license |
| `assets/artwork/` | Canonical regeneration inputs and prompts; not served |
| `scripts/`, `tests/` | Build/operations tools and verification |
| `docs/` | Setup, architecture, features, operations and historical evidence |
| `.local/` | Ignored databases, backups, reports and local archives |

## Data and service limits

Prices are sampled cached observations, not live executable quotes. Stale values retain their timestamps; missing prices stay unavailable. Read windows, server backoff, budget limits and expiry may delay or stop updates. The checked-in paid-pilot configuration expires **November 1, 2026 at 07:00 UTC**; this README does not imply it is renewed or currently running. The item-page “Hourly snapshot” display tolerance is distinct from the stricter three-minute alert/trading freshness check.

Daily closes use the last actual observation before midnight in **fixed EST (UTC−05:00)**. Missing dates remain missing data even when chart lines connect surrounding observations. Device observations retain up to 90 days / 2,160 item samples; portfolio history is local to the current device and records complete observed estimates. See [portfolio behavior](docs/features/portfolios.md) and [price history](docs/features/price-history.md).

No project license is present. Choosing one is an owner decision; the bundled font retains its [OFL license](public/assets/night-market/OFL.txt), and artwork provenance is documented [separately](assets/artwork/README.md).
