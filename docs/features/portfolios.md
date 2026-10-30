# Portfolios, estimates and notifications

This describes the current code. [Historical portfolio release notes](../history/PORTFOLIOS.md) preserve previous validation and deployment claims.

## Holdings and acquisition costs

Verified Google users create named portfolios and manually record Bazaar holdings. A stable item ID identifies one holding within a portfolio; the same asset may appear in other portfolios. Quantities are whole counts. Average acquisition price and total acquisition cost are alternate inputs; additional purchases combine quantity and cost transactionally. Revision checks reject stale edits. Available coins can be recorded separately as buying power.

There is no automatic inventory import or trade execution. Legacy Positions migrate with atomic per-item markers, keeping originals and preventing duplicate imports. Deleted records use tombstones for retry safety; deletion is not a claim that all historical data is erased. Previously saved Auction House assets remain readable and deletable but cannot be purchased, edited, priced or monitored.

## Value and returns

The Bazaar reference is the lowest sell offer (best ask). Indicative value is quantity × reference before fees; unrealized gain is value minus acquisition basis, and return is gain / basis when a valid basis is available. This ask-based value is not guaranteed sale proceeds. Full-quantity liquidation calculations separately walk buy bids and require compatible fee evidence and enough depth.

Totals retain all acquisition costs but calculate gains from priced holdings and their matching costs. Missing prices do not become zero, and incomplete coverage is explicit. Stale observations retain timestamps and are last-known estimates. Portfolio value history records complete observed estimates on the current device for up to 90 days; purchases and edits can change the chart, so it is not a time-weighted investment-performance series.

Implementation: [`portfolio.ts`](../../shared/companion/portfolio.ts), [`positions.ts`](../../shared/companion/positions.ts), [`portfolio-store.ts`](../../src/companion/portfolio-store.ts), [`portfolio-value-history.ts`](../../src/companion/portfolio-value-history.ts).

## Percentage notifications

Users opt in to email and choose upward/downward thresholds relative to average acquisition cost or a server-captured eligible sample. Creation/configuration sends no message. The first eligible observation primes crossing state; a later crossing can queue delivery. Staying outside does not repeatedly notify; returning inside rearms that direction. New settings use best ask; preserved old bid-based settings keep their basis until explicitly edited.

Missing, stale or fixture prices cannot trigger notifications. Parent records, settings revisions, verified identity, preferences and quotas are checked before delivery. Pause/edit/delete cancel unsent work; in-flight email cannot be recalled. Backend availability, budget and expiry gates may stop evaluation. MailApp acceptance is not inbox receipt, and an ambiguous crash before receipt persistence can cause a duplicate retry.

Private settings and deliveries are not exposed in public market responses. Existing legacy disable links remain supported; fresh legacy standalone price evaluation is retired. See the [sender procedure](../operations/notifications.md) and [`portfolio-backend.ts`](../../apps-script/portfolio-backend.ts).
