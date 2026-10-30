# Market freshness and price history

## Cached prices and order books

Public search uses a bundled catalog. Selecting a valid item reads its saved order book; typing, copying links and exploring already-loaded levels need no additional market request. Order books contain up to 30 returned levels per side. Quantity bars compare level size, not traded-volume history. Item links use `#view=item&item=BOOSTER_COOKIE` without private portfolio parameters.

Visible item pages schedule cache checks according to the operating mode and server directives. In the checked-in paid pilot, publication windows are :02/:17/:32/:47. Hidden pages stop scheduling; returning can perform one due check without replaying missed slots. Server backoff/retry deadlines, pause, expiry and budgets take precedence. Browsers do not start upstream collection.

The item label permits one hour plus two minutes of publication allowance for “Hourly snapshot”; explicit stale flags, failed reads and invalid/older samples remain stale. Alert/trading freshness uses a stricter three-minute limit. Always read the timestamp and age rather than inferring recency from the page loading successfully. Relevant code: [`polling.ts`](../../src/companion/polling.ts), [`request-cache.ts`](../../src/companion/request-cache.ts), [`market.ts`](../../shared/market.ts).

## Daily closes

Daily history provides 1M / 1Y / All views. A day uses **fixed EST (UTC−05:00)**, including summer; the close is the last actual available observation before midnight, not an inferred midnight trade. Best ask is instant buy and best bid is instant sell, before fees. Today's data is provisional. Imported samples can precede midnight by hours. Tooltips preserve actual timestamps and sources; lines may connect recorded points across gaps without fabricating archive rows.

The archive combines BazaarSignal observations and imported Skytrack/Bazaar Calc data. The newest actual timestamp wins across sources; ties prefer BazaarSignal, then Skytrack, then Bazaar Calc. Sides stay together from a single observation. The importer records source notices, pinned revisions, checksums and receipts under `.local/history-import/`. Source listings do not guarantee usable data. No Auction House price substitutes are used.

Local storage is `.local/price-history.sqlite` by default. Cloud storage uses compressed item shards per year plus a manifest; selected-item reads return just that item's series. The implementation supports a scheduled daily capture at 23:59 fixed EST under the same budget/expiry gates. This describes the scheduler configuration, not current service availability. [Historical cloud-history evidence](../measurements/cloud-price-history-deployment.json) records an earlier deployment.

## Device observations and portfolio history

Device item observations retain up to **90 days / 2,160 samples** in browser storage, scoped to data source and item. They record observed samples, not a complete archive; demo samples are excluded. Daily history has no equivalent 365-day retention cap. If the daily archive is unavailable, order books and device history remain independent.

Portfolio history stores complete observed estimates locally, separately from item history; missing quotes do not create false drops. Its day/week/month/all views reflect holding edits as well as price movements. Clearing browser data loses local history.

## Operator utilities

`npm run history:import` downloads and merges third-party price history; `npm run history:collect` explicitly starts a local daily collector; `npm run history:backup` creates a consistent local SQLite backup. Import/collect are not required to preview or test the app and are not started by ordinary local launchers. Preserve downloaded source notices and receipts with backups. See [operations](../operations/README.md) before invoking network or scheduled work.
