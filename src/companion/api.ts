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
  return cachedMarketRequest<T>(new URL(`${base}/api/companion/${path}`, location.origin).href, signal);
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
  return marketRequest<
    CacheResult & {
      items: AuctionOpportunity[];
      total: number;
      page: number;
      health: CollectorHealth;
    }
  >(
    `auctions?filters=${encodeURIComponent(JSON.stringify(filters))}&page=${page}`,
    signal,
  );
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
  return marketRequest<AuctionOpportunity>(
    `auctions/${id}?duration=${duration}`,
  );
}
