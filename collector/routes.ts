import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { MarketCollector, message } from "./engine";
import { parseMarket } from "../apps-script/core";

export type MarketResponder = (req: IncomingMessage, res: ServerResponse, status: number, body?: unknown) => Promise<void>;
export const respondMarket: MarketResponder = async (req,res,status,body) => {
  if(body === undefined){res.writeHead(status).end();return;}
  const json=JSON.stringify(body),etag=`"${createHash("sha256").update(json).digest("hex")}"`;
  if(status===200){
    res.setHeader("ETag",etag);
    if(req.headers["if-none-match"]===etag){res.writeHead(304).end();return;}
  }
  res.writeHead(status).end(json);
};
export function marketHandler(collector: MarketCollector, respond: MarketResponder = respondMarket) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next?: () => void,
  ) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (
      !url.pathname.startsWith("/api/companion/") &&
      url.pathname !== "/api/market"
    )
      return next ? next() : void res.writeHead(404).end();
    const origin = req.headers.origin;
    const allowed = (
      process.env.COLLECTOR_ALLOWED_ORIGINS ??
      "http://127.0.0.1:5173,http://localhost:5173"
    ).split(",");
    if (origin && allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Expose-Headers", "ETag");
      res.setHeader("Access-Control-Allow-Headers", "If-None-Match");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "86400");
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Revalidation saves transfer, but every request reaching Cloud Run can be billed.
    res.setHeader("Cache-Control", "no-cache");
    if (req.method === "OPTIONS" && origin && allowed.includes(origin)) {
      await respond(req,res,204);
      return;
    }
    if (req.method !== "GET") {
      await respond(req,res,405,{ error: "GET required" });
      return;
    }
    try {
      if ((req.url?.length ?? 0) > 10000) throw new Error("Query too long");
      let body: unknown;
      if (url.searchParams.has("force") || url.searchParams.has("refresh")) {
        await respond(req,res,400,{
            error:
              "Market data updates automatically. Refresh parameters are unsupported.",
          });
        return;
      }
      if (url.pathname === "/api/companion/bazaar")
        body = await collector.bazaar();
      else if (url.pathname === "/api/companion/raw-bazaar")
        body = await collector.rawBazaar();
      else if (url.pathname === "/api/companion/book") {
        const raw = await collector.rawBazaar();
        const snapshot = parseMarket(raw, collector.now(), raw.names);
        const id = url.searchParams.get("itemId") ?? "";
        if (!Object.hasOwn(snapshot.books, id))
          throw new Error("Item unavailable");
        body = { book: snapshot.books[id], timestamp: snapshot.timestamp };
      } else if (
        url.pathname === "/api/market" ||
        url.pathname === "/api/companion/snapshot"
      ) {
        const raw = await collector.rawBazaar(),
          snapshot = parseMarket(raw, raw.lastUpdated, raw.names);
        const status = await collector.status("bazaar");
        body = {
          prices: snapshot.prices,
          books: url.pathname === "/api/market" ? snapshot.books : {},
          status: {
            lastUpdated: snapshot.timestamp,
            lastSuccess: status.observedAt,
            lastAttempt: status.observedAt,
            error: status.stale
              ? "Market data is stale; waiting for automatic updates."
              : status.error,
          },
        };
      } else if (url.pathname === "/api/companion/auctions") {
        const page = Number(url.searchParams.get("page") ?? 0);
        if (!Number.isSafeInteger(page) || page < 0 || page > 10000)
          throw new Error("Invalid page");
        body = await collector.list(
          JSON.parse(url.searchParams.get("filters") ?? "{}"),
          page,
        );
      } else if (url.pathname === "/api/companion/status")
        body = {
          auctions: await collector.status(),
          bazaar: await collector.status("bazaar"),
        };
      else if (url.pathname === "/api/companion/player-names") {
        const ids = (url.searchParams.get("ids") ?? "").split(",");
        if (ids.length > 6 || !ids.every((id) => /^[a-f0-9]{32}$/i.test(id)))
          throw new Error("Invalid player IDs");
        const names: Record<string, string> = {};
        const lookups = await Promise.allSettled(
          ids.map(async (id) => {
            try {
              names[id] = await collector.names.resolve(id);
            } catch(error) {
              if(error instanceof Error && error.name === 'TrialStopped')throw error;
              /* Negative cache/budget applies across callers. */
            }
          }),
        );
        for(const result of lookups)if(result.status==='rejected')throw result.reason;
        body = { names };
      } else if (
        /^\/api\/companion\/auctions\/[a-f0-9]{32}(\/(check|command))?$/i.test(
          url.pathname,
        )
      ) {
        const id = url.pathname.split("/")[4];
        body = url.pathname.endsWith("/command")
          ? await collector.auctionCommand(id)
          : url.pathname.endsWith("/check")
            ? await collector.recheck(id)
            : await collector.detail(
                id,
                Number(url.searchParams.get("duration") ?? 24),
              );
        if (!body) {
          await respond(req,res,404,{
              error: "Listing unavailable from the current snapshot.",
            });
          return;
        }
      } else {
        await respond(req,res,404,{ error: "Unknown market route" });
        return;
      }
      await respond(req,res,200,body);
    } catch (e) {
      if(e instanceof Error && e.name === 'TrialStopped')throw e;
      await respond(req,res,503,{ error: message(e) });
    }
  };
}
