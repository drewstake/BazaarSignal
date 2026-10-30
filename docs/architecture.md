# Architecture

## Browser and private records

[`src/companion/PortfolioApp.tsx`](../src/companion/PortfolioApp.tsx) provides public landing/search/item pages and lazy-loads the authenticated workspace. React components use shared TypeScript valuation, cost, notification and scheduling logic from `shared/`. The bundled catalog supports searching without network requests; valid selections retrieve only the needed cached market data.

Firebase Auth supplies verified Google identity. Firestore rules restrict portfolios, holdings and preferences to their owners. Notification settings use a trusted backend validator rather than arbitrary client writes. Session changes discard stale private responses. Firestore and backend code preserve legacy records and migration markers for retry safety.

[`apps-script/`](../apps-script/) contains the authenticated HTTP backend, portfolio notification worker, MailApp delivery and scheduled administrative reporting. Browser requests use the versioned web deployment; scheduled triggers execute saved source. These can differ, so deployment evidence must distinguish them. [`functions/`](../functions/) retains the older Firebase/SMTP delivery implementation and its independent runtime declaration; it is not the normal local launcher or current MailApp sender.

## Shared market and history

[`collector/`](../collector/) holds collection, cache, budget/admission, coordination and history logic. [`market-functions/src/index.ts`](../market-functions/src/index.ts) exposes the Google-hosted market handlers and scheduled entry points. Current market and history responses are public data; portfolio membership, quantities and acquisition costs are not part of those responses.

Browsers read the shared cache rather than polling Hypixel directly. Client caches coordinate reads across navigation and tabs, while server budgets, expiry and retry deadlines can defer them. The paid-pilot constants in [`shared/paid-pilot.ts`](../shared/paid-pilot.ts) are source configuration, not proof of a currently running schedule. Auction collection and routes are retired.

Daily price history can use local SQLite or compressed annual item shards in private Firestore. Public endpoints return only the selected item's series. Device item history and portfolio value history stay in browser storage and are independent of the daily archive.

## Local adapters and builds

[`server/`](../server/) supplies Vite-only loopback adapters for local Firestore notification validation, cached market proxying, history and administrative reports. The signed-in launcher keeps real authentication while directing private persistence to the emulator. Public preview clears auth configuration. Offline preview reads SQLite; isolated tests use demo identity or intercepted responses.

Vite emits the frontend to `dist/`; esbuild emits Apps Script and server bundles. Only `public/` assets enter the static build automatically. Canonical image inputs live in [`assets/artwork/`](../assets/artwork/). The [development guide](development.md) explains each build and backend installation boundary.
