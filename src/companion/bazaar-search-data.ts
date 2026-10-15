import { isFresh, isValidSample } from "../../shared/market";
import {
  MARKET_HOUR,
  MARKET_READ_OFFSET,
  marketReadSlot,
} from "../../shared/market-schedule";
import type { Level } from "../../shared/model";
import { fixtureMode, marketRequest, marketUrl } from "./api";
import { holdingCatalogItem } from "./holding-catalog";
import { pollingDirective } from "./polling";
import { localPreviewMarketRead } from "./local-market-preview";
import { savedBazaarBook, type SavedBazaarBook } from "./request-cache";

export interface SearchMarketDetail {
  item?: SavedBazaarBook;
  error?: string | null;
  stale?: boolean;
  fixture?: boolean;
  localSnapshot?: boolean;
}
// Retain at most one selection per local catalog item in the current window,
// including failures/empty replies. Existing persistent cache limits stay intact.
// No timers, retries, presence leases, refresh parameters or network polling.
const selections = new Map<
  string,
  { slot: number; result: Promise<SearchMarketDetail> }
>();

export async function selectedBazaarDetail(
  itemId: string,
  signal?: AbortSignal,
): Promise<SearchMarketDetail> {
  if (!holdingCatalogItem(itemId))
    return { error: "This item is not in the local Bazaar catalog." };
  if (fixtureMode)
    return {
      item: (await import("./fixtures"))
        .bazaarFixtures()
        .find((item) => item.id === itemId),
      fixture: true,
    };
  const path = `portfolio-prices?assets=${encodeURIComponent(`bz_${itemId}`)}`;
  const localSnapshot = localPreviewMarketRead(marketUrl(path));
  const saved = await savedBazaarBook(marketUrl("bazaar"), itemId);
  const policy = pollingDirective();
  const interval = Math.max(MARKET_HOUR, policy.pollMs);
  const slot = marketReadSlot(Date.now(), interval);
  for (const [id, entry] of selections)
    if (entry.slot !== slot) selections.delete(id);
  const restricted =
    policy.mode === "paused" || (policy.retryAt ?? 0) > Date.now();
  const sameRelease = !policy.trialId || saved?.trialId === policy.trialId;
  if (
    saved &&
    (restricted ||
      (sameRelease &&
        saved.at <= Date.now() &&
        marketReadSlot(saved.at, interval) === slot))
  ) {
    const detail = {
      item: saved.item,
      stale: saved.stale,
      localSnapshot,
      error:
        restricted && !localSnapshot
          ? (policy.reason ?? "Market updates are paused.")
          : saved.error,
    };
    selections.set(itemId, { slot, result: Promise.resolve(detail) });
    return detail;
  }
  const existing = selections.get(itemId);
  if (restricted && !localSnapshot) {
    const retained = await existing?.result;
    return {
      ...retained,
      error:
        policy.reason ??
        (retained?.item
          ? "Market updates are paused."
          : "Market updates are paused. No saved data is available for this item."),
    };
  }
  if (existing?.slot === slot) return existing.result;
  const result = (async (): Promise<SearchMarketDetail> => {
    try {
      // Cache lookup may have yielded while the page was hidden or unmounted.
      signal?.throwIfAborted();
      const response = await marketRequest<{
        bazaar: SavedBazaarBook[];
        error?: string;
        stale?: boolean;
        status?: { stale?: boolean; error?: string };
      }>(path, signal);
      if (!Array.isArray(response?.bazaar)) throw new Error('The market response is invalid. Saved data may be shown.');
      const item = response.bazaar.find((item) => item.id === itemId);
      return item
        ? { item, error: response.error ?? response.status?.error,
            stale: response.stale === true || response.status?.stale === true, localSnapshot }
        : {
            error: localSnapshot
              ? "This item is missing from the saved local snapshot."
              : "No cached market data is available for this item.",
            localSnapshot,
          };
    } catch (error) {
      return {
        item: saved?.item,
        stale: true,
        localSnapshot,
        error: signal?.aborted
          ? "Market read interrupted. Waiting for the next scheduled check."
          : error instanceof Error
            ? error.message
            : "Market data is unavailable.",
      };
    }
  })();
  selections.delete(itemId);
  selections.set(itemId, { slot, result });
  return result;
}

/** Sum only returned levels; never substitute quick-status volume or extrapolate. */
export function bookSideSummary(
  levels: Level[] | undefined,
  side: "buy" | "sell",
) {
  if (
    !Array.isArray(levels) ||
    levels.length > 30 ||
    levels.some(
      (level) =>
        !level ||
        ![level.amount, level.pricePerUnit, level.orders].every(
          (n) => Number.isFinite(n) && n > 0,
        ),
    )
  )
    return null;
  const quantity = levels.reduce((sum, level) => sum + level.amount, 0);
  const orders = levels.reduce((sum, level) => sum + level.orders, 0);
  if (!Number.isFinite(quantity) || !Number.isFinite(orders)) return null;
  return {
    quantity,
    orders,
    levels: levels.length,
    price: levels.length
      ? (side === "buy" ? Math.min : Math.max)(
          ...levels.map((level) => level.pricePerUnit),
        )
      : null,
  };
}

/** Display age for an hourly snapshot, not eligibility for alerts or trades.
 * Allow the existing two-minute publication/read offset, but never hide a failed
 * read, invalid time, or a sample that was already stale when collected. */
export function searchDetailStale(
  detail: SearchMarketDetail,
  now = Date.now(),
) {
  return (
    !!detail.item &&
    (!!detail.stale ||
      !!detail.error ||
      !isValidSample(detail.item.observedAt, now) ||
      !isValidSample(detail.item.upstreamAt, now) ||
      !isFresh(detail.item.upstreamAt, detail.item.observedAt) ||
      now - detail.item.upstreamAt >= MARKET_HOUR + MARKET_READ_OFFSET)
  );
}
