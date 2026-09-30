import type { Plugin } from "vite";
import { isFresh, parseBook } from "../shared/market";
import type { Book, ProductPrice, MarketStatus } from "../shared/model";

export interface LiveSnapshot {
  prices: ProductPrice[];
  books: Record<string, Book>;
  status: MarketStatus;
}
// Fixed public endpoints only. No API key, arbitrary proxy URL, or client secrets.
export function liveMarketPlugin(): Plugin {
  let cache: LiveSnapshot | null = null;
  let pending: Promise<LiveSnapshot> | null = null;
  let lastAttempt = 0;
  let lastError: string | null = null;
  let names: Record<string, string> = {};
  let namesUpdated = 0;
  async function json(url: string) {
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok)
      throw new Error(`Hypixel returned HTTP ${response.status}.`);
    const data = await response.json();
    if (data.success !== true)
      throw new Error("Hypixel could not provide market data.");
    return data;
  }
  async function refresh(): Promise<LiveSnapshot> {
    lastAttempt = Date.now();
    const market = await json("https://api.hypixel.net/v2/skyblock/bazaar");
    if (
      !isFresh(market.lastUpdated) ||
      !market.products ||
      typeof market.products !== "object" ||
      Array.isArray(market.products)
    )
      throw new Error("Hypixel market data is stale or malformed.");
    if (Date.now() - namesUpdated > 86_400_000) {
      try {
        const catalog = await json(
          "https://api.hypixel.net/v2/resources/skyblock/items",
        );
        if (!Array.isArray(catalog.items))
          throw new Error("Invalid item catalog.");
        names = Object.fromEntries(
          catalog.items
            .filter(
              (x: { id?: unknown; name?: unknown }) =>
                typeof x.id === "string" && typeof x.name === "string",
            )
            .map((x: { id: string; name: string }) => [x.id, x.name]),
        );
        namesUpdated = Date.now();
      } catch {
        /* Item IDs remain usable if the optional name lookup is unavailable. */
      }
    }
    const books: Record<string, Book> = {},
      prices: ProductPrice[] = [];
    for (const [id, raw] of Object.entries(market.products)) {
      try {
        const book = parseBook(raw);
        books[id] = book;
        const volume = (raw as { quick_status?: { buyMovingWeek?: number } })
          .quick_status?.buyMovingWeek;
        prices.push({
          id,
          name:
            names[id] ??
            id
              .toLowerCase()
              .replaceAll("_", " ")
              .replace(/\b\w/g, (c) => c.toUpperCase()),
          buy: book.buy[0]?.pricePerUnit ?? null,
          sell: book.sell[0]?.pricePerUnit ?? null,
          volume:
            typeof volume === "number" && Number.isFinite(volume) ? volume : 0,
        });
      } catch {
        /* Invalid products are never used in estimates or triggers. */
      }
    }
    if (!prices.length)
      throw new Error("No valid Bazaar prices are available.");
    prices.sort((a, b) => a.name.localeCompare(b.name));
    cache = {
      prices,
      books,
      status: {
        lastUpdated: market.lastUpdated,
        lastSuccess: Date.now(),
        lastAttempt,
        error: null,
      },
    };
    lastError = null;
    return cache;
  }
  return {
    name: "bazaar-live-market",
    configureServer(server) {
      server.middlewares.use("/api/market", async (req, res, next) => {
        if (req.url !== "/" && req.url !== "") return next();
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "GET required." }));
          return;
        }
        try {
          // One upstream request per minute, shared across browser tabs and retries.
          if (!pending && Date.now() - lastAttempt >= 60_000)
            pending = refresh()
              .catch((e) => {
                lastError =
                  e instanceof Error ? e.message : "Market request failed.";
                throw e;
              })
              .finally(() => {
                pending = null;
              });
          if (pending) await pending;
          if (lastError || !cache)
            throw new Error(lastError ?? "Market data is unavailable.");
          res.end(JSON.stringify(cache));
        } catch (e) {
          res.statusCode = 503;
          res.end(
            JSON.stringify({
              error: e instanceof Error ? e.message : "Market request failed.",
            }),
          );
        }
      });
    },
  };
}
