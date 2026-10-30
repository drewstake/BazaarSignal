# Offline Bazaar search catalog

The header and Add holding searches use `src/companion/bazaar-catalog.json`.
Rebuild it without network access with `node scripts/build-bazaar-catalog.mjs`.
The builder uses the saved artwork inventory and applies the exact IDs in
`docs/bazaar-search-exclusions.json`. The browser receives only item IDs/names,
not the audit manifest, prices, or market order books.

The October 14, 2026 review excludes 331 raw API entries, leaving 1,866 searchable
items. The already-downloaded Bazaar snapshot from October 13 at 01:28:02.786 UTC
had no orders and zero prices, volumes, order counts, and reported seven-day
activity for these entries. Examples include `BAZAAR_COOKIE`, the old
`AMALGAMATED_CRIMSONITE` ID, obsolete hay IDs, and unused enchantment levels.
These are exclusions from the trading search, not a claim that every excluded
item is nonexistent in the game. An API product ID alone does not prove that an
item can currently be traded on the Bazaar; a zero-activity snapshot also cannot
prove that an item will never become tradeable.

The exclusions are fixed, not recalculated when the app opens or market data
expires. Real entries with empty books but recorded activity stay searchable
(for example, `ENCHANTMENT_ULTIMATE_JERRY_1`). Enchantments, essences, shards,
and rabbits do not need an entry in the separate item-resource catalog.
Missing, stale, or temporarily empty market data never hides an included item.

When maintaining this list, review evidence from an existing saved snapshot or
in-game Bazaar before excluding more IDs or restoring an ID. A reactivated item
needs its exclusion removed and the catalog rebuilt. Do not infer that all
levels in an enchantment family are invalid. Rebuilding does not fetch anything
or start the collector.

Existing saved holdings retain their IDs/names and remain editable; this only
changes eligibility for new search selections. Search typing still makes no
backend calls. A valid selection uses the existing per-item cache and scheduled
read windows, subject to server backoff, expiry and budget controls. See
[current freshness behavior](price-history.md#cached-prices-and-order-books).
