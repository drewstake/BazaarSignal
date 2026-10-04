import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { MarketCollector, message } from "./engine";
import { parseSampledMarket } from "../apps-script/core";

export type MarketResponder = (req: IncomingMessage, res: ServerResponse, status: number, body?: unknown) => Promise<void>;
export const retiredMarketRoute = (path: string) => path === '/api/companion/player-names' || /^\/api\/companion\/auctions(?:\/|$)/.test(path);
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
      if (retiredMarketRoute(url.pathname)) {
        await respond(req,res,410,{error:"Auction discovery has retired. Use portfolio valuation references."});return;
      }
      if (url.searchParams.has("force") || url.searchParams.has("refresh")) {
        await respond(req,res,400,{
            error:
              "Market data updates automatically. Refresh parameters are unsupported.",
          });
        return;
      }
      if (url.pathname === "/api/companion/bazaar")
        body = await collector.bazaar();
      else if (url.pathname === '/api/companion/portfolio-auctions' || url.pathname === '/api/companion/portfolio-prices') {
        const assets=[...new Set((url.searchParams.get('assets')??'').split(',').filter(Boolean))].sort();
        if(assets.length>100||assets.some(id=>!/^v1_[a-f0-9]{64}$|^bz_[A-Za-z0-9_:-]{1,100}$/.test(id)))throw new Error('Invalid asset keys.');
        body=url.pathname.endsWith('portfolio-auctions')?await collector.portfolioAuctions(assets):await collector.portfolioPrices(assets);
      }
      else if (url.pathname === "/api/companion/raw-bazaar")
        body = await collector.rawBazaar();
      else if (url.pathname === "/api/companion/book") {
        const raw = await collector.rawBazaar();
        const snapshot = parseSampledMarket(raw, collector.now(), raw.names);
        const id = url.searchParams.get("itemId") ?? "";
        if (!Object.hasOwn(snapshot.books, id))
          throw new Error("Item unavailable");
        const status = await collector.status("bazaar");
        body = { book: snapshot.books[id], timestamp: snapshot.timestamp, observedAt: status.observedAt, status };
      } else if (
        url.pathname === "/api/market" ||
        url.pathname === "/api/companion/snapshot"
      ) {
        const raw = await collector.rawBazaar(),
          snapshot = parseSampledMarket(raw, collector.now(), raw.names);
        const status = await collector.status("bazaar");
        body = {
          prices: snapshot.prices,
          books: url.pathname === "/api/market" ? snapshot.books : {},
          status: {
            lastUpdated: snapshot.timestamp,
            lastSuccess: status.observedAt,
            lastAttempt: status.observedAt,
            stale: status.stale,
            nextAt: status.nextAt,
            error: status.error,
          },
        };
      } else if (url.pathname === "/api/companion/auctions") {
        await respond(req,res,410,{error:'Auction discovery has retired. Use portfolio valuation references.'});return;
      } else if (url.pathname === "/api/companion/status")
        body = {
          auctions: await collector.status(),
          bazaar: await collector.status("bazaar"),
        };
      else {
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
