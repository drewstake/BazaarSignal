# Operating the existing application

These are entry points for maintainers of the existing deployment, not fresh-project provisioning instructions. Source code and old receipts do not establish current cloud state. Do not treat an old paused/free-tier/paid-pilot report as a request to restart or renew services.

## Before a release or recovery

1. Identify the intended change and obtain authorization for cloud writes, deployment, email or collection. Local tests/builds do not require those actions.
2. Read the latest relevant [release/incident record](../history/README.md), then inspect current service revisions, saved Apps Script source and versioned web deployment, schedules, ledger format, budget reservations and expiry. Historical IDs and timestamps are evidence, not defaults to copy.
3. Preserve private records, signing material, receipts, migration markers, retained usage and rollback artifacts. Never reset a ledger or extend a deadline to make an old procedure pass.
4. Run the [local verification commands](../development.md), prepare a concrete release and compatible rollback, and use the existing scope-aware admission tools. Uploading Apps Script saved source can affect triggers before its HTTP deployment is versioned.
5. Verify only the authorized surface. Distinguish local test results, published artifact identity, observed natural scheduled runs, and actual delivery evidence in the release record.

The checked-in paid-pilot deadline is **2026-11-01 07:00 UTC** in `shared/paid-pilot.ts`. Read-window and collection schedules, reservations and budget controls remain unchanged by repository cleanup. The application stop is not a provider billing cap. Current billing/service status requires fresh observation; cost models and dated deployment receipts belong in history.

## Useful boundaries

| Area | Entry points / guidance |
| --- | --- |
| Local private-data backup | `npm run backup:local`; [development](../development.md) |
| Notification authorization and delivery | [Sender procedure](notifications.md) |
| Market data/history | [History utility boundaries](../features/price-history.md#operator-utilities) |
| Catalog regeneration | [Saved inventory and exclusions](../features/BAZAAR-CATALOG.md) |
| Artwork regeneration | [Canonical inputs](../../assets/artwork/README.md) |
| Market release tooling | `scripts/deployment-accounting.mjs`, `scripts/verify-market-image.mjs`, `scripts/ledger-v2-production.mjs`; consult the relevant dated rollout record before use |

Commands named `deploy:*`, `activate-*`, `configure-*`, `pause-*`, `recover-*`, `trial:launch`, `collector` or `history:collect` may operate services or collect data. They are not onboarding steps. Guarded legacy scripts may intentionally refuse obsolete releases; do not remove their guards as cleanup.

Keep environment files and credentials local. Public Firebase client values are not service credentials; Google tokens, signing keys, sender credentials and private backups must never be included in frontend bundles. Production configuration is deliberately separate from documentation placeholders.
