import type {
  AuctionFilters,
  AuctionOpportunity,
  BazaarItem,
  CollectorHealth,
} from "../../shared/companion/types";
import { cachedMarketRequest } from "./request-cache";
import type { PollDirective } from "./polling";

export const fixtureMode =
  import.meta.env.DEV &&
  new URLSearchParams(location.search).get("fixtures") === "1";
const base = (import.meta.env.VITE_MARKET_API_URL ?? "").replace(/\/$/, "");
export interface CacheStatus {
  upstreamAt: number;
  observedAt: number;
  nextAt: number;
  stale: boolean;
  error: string | null;
  refreshing: boolean;
  automatic: boolean;
  intervalMs: number;
  usage?: PollDirective;
}
export interface CacheResult {
  version?: string;
  status?: CacheStatus;
}
export async function marketRequest<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  if (!base && !import.meta.env.DEV)
    throw new Error(
      "The shared market collector is not connected. Market data updates automatically once the shared service is configured.",
    );
  return cachedMarketRequest<T>(
    new URL(`${base}/api/companion/${path}`, location.origin).href,
    signal,
  );
}
export async function getBazaar(signal?: AbortSignal) {
  if (fixtureMode)
    return {
      items: (await import("./fixtures")).bazaarFixtures(),
      error: null,
    };
  return marketRequest<
    { items: BazaarItem[]; error: string | null } & CacheResult
  >("bazaar", signal);
}
export async function getAuctions(
  filters: AuctionFilters,
  page: number,
  signal?: AbortSignal,
) {
  if (fixtureMode)
    return (await import("./fixtures")).auctionFixtures(filters, page);
  const result = await marketRequest<
    CacheResult & {
      items: AuctionOpportunity[];
      total: number;
      page: number;
      health: CollectorHealth;
    }
  >(
    // The response shape and meaning changed. A distinct, stable cache key avoids
    // replaying hourly cached per-auction arithmetic averages under the new UI.
    `auctions?filters=${encodeURIComponent(JSON.stringify(filters))}&page=${page}&format=grouped-conservative-v1`,
    signal,
  );
  if (
    !Array.isArray(result.items) ||
    result.items.some(
      (o) =>
        !o.group ||
        !Array.isArray(o.group.matchingListings) ||
        !o.group.matchingListings.length ||
        !Array.isArray(o.group.comparisonPool) ||
        o.valuation.arithmeticMean === undefined,
    )
  ) {
    throw new Error(
      "Auction service is using an older comparison format. Updated grouped comparisons are required.",
    );
  }
  return result;
}
export async function checkAuction(id: string) {
  if (fixtureMode)
    return {
      status: "active",
      command: `/viewauction ${id}`,
      source: "explicit fixture",
      checkedAt: Date.now(),
    };
  return marketRequest<{
    status: string;
    command: string | null;
    source: string;
    checkedAt: number;
  }>(`auctions/${id}/check`);
}
export async function getAuctionCommand(id: string) {
  if (fixtureMode) return { command: "/ah DemoSeller", seller: "DemoSeller" };
  return marketRequest<{ command: string; seller: string }>(
    `auctions/${id}/command`,
  );
}
export async function getAuctionDetail(id: string, duration = 24) {
  const result = await marketRequest<AuctionOpportunity>(
    `auctions/${id}?duration=${duration}`,
  );
  if (
    result.valuation.basis === "active-listings" &&
    result.valuation.arithmeticMean === undefined
  ) {
    throw new Error(
      "Auction service is using an older comparison format. Conservative estimate unavailable.",
    );
  }
  return result;
}
