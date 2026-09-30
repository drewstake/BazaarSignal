import type {
  AuctionFilters,
  AuctionOpportunity,
  BazaarItem,
  CollectorHealth,
} from "../../shared/companion/types";
import { requestBackend } from "../backend";
export const fixtureMode =
  import.meta.env.DEV &&
  new URLSearchParams(location.search).get("fixtures") === "1";
const base = (import.meta.env.VITE_MARKET_API_URL ?? "").replace(/\/$/, "");
export async function marketRequest<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  if (!base && !import.meta.env.DEV)
    throw new Error(
      "The shared market collector is not connected. Existing public prices and price alerts remain available.",
    );
  const response = await fetch(`${base}/api/companion/${path}`, {
    signal: signal ?? AbortSignal.timeout(45000),
    credentials: "omit",
  });
  const raw = await response.json();
  if (!response.ok) throw new Error(raw.error ?? "Market service unavailable");
  return raw as T;
}
export async function getBazaar(signal?: AbortSignal) {
  if (fixtureMode)
    return {
      items: (await import("./fixtures")).bazaarFixtures(),
      error: null,
    };
  if (!base && !import.meta.env.DEV)
    return requestBackend<{ items: BazaarItem[]; error: string | null }>({
      action: "companion",
    });
  return marketRequest<{ items: BazaarItem[]; error: string | null }>(
    "bazaar",
    signal,
  );
}
export async function getAuctions(
  filters: AuctionFilters,
  page: number,
  signal?: AbortSignal,
) {
  if (fixtureMode)
    return (await import("./fixtures")).auctionFixtures(filters, page);
  return marketRequest<{
    items: AuctionOpportunity[];
    total: number;
    page: number;
    health: CollectorHealth;
  }>(
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
