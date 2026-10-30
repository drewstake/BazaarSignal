# Development and verification

## Prerequisites and installation

Use Node.js **24.19.0**, pinned in [`.nvmrc`](../.nvmrc); `package.json` supports the 24.x line. The server uses built-in SQLite and local launchers import TypeScript directly through Node. With a version manager that supports `.nvmrc`, run `nvm install` and `nvm use`; otherwise install the pinned version explicitly.

```sh
npm ci
npm ci --prefix market-functions
```

The root npm workspace installs `functions/`. Its declared Node 22 deployment runtime is retained and may produce an engine warning under development Node 24; this cleanup does not change deployed runtimes. `market-functions/` is not a workspace: its separate installation is required for backend type checks and packaging. No dependency upgrades are needed.

Install Java 21 for Firestore emulator work and put its `bin` directory on PATH. The signed-in launcher also discovers `.local/java21/<runtime>/bin`; direct test commands do not perform that discovery. `npx playwright install chromium` installs the test browser (`--with-deps` may be needed on Linux). Optional artwork regeneration requires Python 3 and Pillow with WebP support.

## Choose a mode

| Mode | Identity and records | Market data and prerequisites |
| --- | --- | --- |
| Hosted public browsing | No sign-in for search/item pages | Existing shared service; availability is not guaranteed |
| `npm run dev` / `dev:local` | Real Google identity; Firestore emulator on 8080 | Existing BazaarSignal Firebase configuration and Java 21; public cached prices/cloud history |
| `npm run dev -- --offline` | Same real identity and local records | Saved SQLite snapshots only for market/history; Google authentication still needs network access |
| `npm run dev:preview` | Sign-in disabled; no private persistence | No Firebase values needed; cached public API/history reads may consume the existing service budget |
| `npm run dev:preview:offline` | Sign-in disabled | No credentials; saved SQLite data; a fresh clone has an empty cache |
| `npm run dev:ui` | Bare Vite, according to supplied environment | Intended for configured backends/test harnesses; not a complete local workspace |
| Emulator/browser fixtures | Disposable demo identity and records | `demo-bazaar-watch`, Auth 9098 / Firestore 8081, mocked prices; separate from real local storage |

The preview launchers deliberately clear Firebase values, disable local collection and use loopback port 5173. Both offline modes retain original sample times and never invent prices. “Offline” refers to market/history data: optional Google Fonts styles may still be requested and fall back when blocked. The development-only `?fixtures=1` flag selects illustrative fixtures where supported; it is not a complete portfolio/backend demo and cannot deliver notifications.

## Signed-in workspace

Copy [`.env.example`](../.env.example) to `.env.local`. Fill all four `VITE_FIREBASE_*` values using the **existing BazaarSignal** public client configuration obtained from the maintainer. The launcher explicitly checks for project ID `bazaarsignal`; it cannot bootstrap an arbitrary Firebase project. Authorized Google sign-in origins must already support the local origin. Never put a service-account key, OAuth token, SMTP password or signing secret into a `VITE_*` variable.

Run `npm run dev` and open `http://127.0.0.1:5173`. This combines real Firebase Auth with a local database and local notification validation. Existing cloud portfolios are not imported. The launcher overrides Apps Script transport and emulator flags, disables collection, and starts no evaluator or email sender. Acquisition-based notification edits are local; capturing a new live baseline may be unavailable in this mode.

Records import from `.local/local-workspace-data` and export on orderly shutdown. Stop with Ctrl+C; forced termination can lose changes since the last export. `npm run backup:local` backs up a running workspace. Keep that directory and local backups out of Git. Offline current prices default to `.local/current-market.sqlite`; daily history defaults to `.local/price-history.sqlite` (`MARKET_CACHE_FILE` / `PRICE_HISTORY_FILE` can override them).

## Commands and isolation

| Command | What it checks or produces |
| --- | --- |
| `npm test` | Unit/handler tests; emulator-dependent suites are excluded by `vitest.config.ts` |
| `npm run build` | Type checks, `dist/` frontend, `apps-script/build/` bundle |
| `npm run build:collector` | Collector type check and `.local/collector-runner.mjs` |
| `npm run build:market-functions` | Backend type check and `market-functions/lib/index.cjs` |
| `npm run build --workspace functions` | Optional retained legacy backend build |
| `npm run test:rules` | Firestore rules, ownership/schema and transaction checks |
| `npm run test:browser` | Isolated Auth/Firestore desktop and mobile journeys |
| `npx playwright test --config playwright.search.config.ts` | Public search/item/history with intercepted market responses |
| `npm run test:local` | Integration tests against an already-running signed-in workspace; creates disposable local records |
| `node scripts/check-repo.mjs` | Local Markdown links, runtime asset paths, source inputs and public/build hygiene |

Run emulator suites sequentially: they share 9098/8081. They can coexist with signed-in development on 5173/8080. Browser suites use separate Vite ports and synthetic or intercepted data. `npm test` is not a claim that emulator, browser or production delivery checks ran.

The [CI workflow](../.github/workflows/ci.yml) installs both package trees, runs `npm test`, all three main builds and repository checks. It uses no Firebase/Google secrets and does not deploy, collect market data or send email. Emulator and browser suites remain additional local checks.

## Generated output and assets

Use `.local/` for databases, captures, benchmarks and reports; `/output/`, root `preview-*.png`, Playwright results, bundles and emulator exports are ignored. `public/` is copied wholesale into `dist/`, so it contains runtime files only. Follow [artwork regeneration](../assets/artwork/README.md). To refresh the search catalog offline, run `node scripts/build-bazaar-catalog.mjs` and review the generated diff.

`node scripts/profile-item-chart.mjs current` and `node scripts/analyze-price-history.mjs` now write to `.local/measurements/`; retained historical measurements are never overwritten automatically. The latter requires a saved history database. For the opt-in paid workload benchmark, set `PAID_BENCH_OUTPUT` to a path under `.local/measurements/` and run its Vitest file. Historical deployment scripts and release receipts are not routine development commands.
