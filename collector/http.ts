import type { IncomingMessage, ServerResponse } from "node:http";
import { MarketCollector, message } from "./engine";
import { FirestoreHistory, LocalHistory } from "./store";

export function createCollector() {
  const scope = (process.env.COLLECTOR_ITEM_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (process.env.COLLECTOR_STORE === "firestore" && !scope.length)
    throw new Error(
      "Set a bounded COLLECTOR_ITEM_IDS scope before enabling Firestore collection on Spark.",
    );
  return new MarketCollector(
    process.env.COLLECTOR_STORE === "firestore"
      ? new FirestoreHistory()
      : new LocalHistory(),
    undefined,
    scope,
  );
}
export function marketHandler(collector: MarketCollector) {
  const pages = new Map<string, { until: number; body: unknown }>();
  let checkWindow = Date.now(),
    checks = 0;
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next?: () => void,
  ) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/companion/"))
      return next ? next() : void res.writeHead(404).end();
    const origin = req.headers.origin;
    const allowed = (
      process.env.COLLECTOR_ALLOWED_ORIGINS ??
      "http://127.0.0.1:5173,http://localhost:5173"
    ).split(",");
    if (origin && allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET") {
      res.writeHead(405).end(JSON.stringify({ error: "GET required" }));
      return;
    }
    try {
      if ((req.url?.length ?? 0) > 10000) throw new Error("Query too long");
      let body: unknown;
      if (url.pathname === "/api/companion/bazaar") {
        try {
          await collector.refreshBazaar();
          body = { items: collector.bazaar, error: null };
        } catch (e) {
          if (!collector.bazaar.length) throw e;
          body = { items: collector.bazaar, error: message(e) };
        }
        if (!collector.bazaar.length)
          throw new Error(
            "Bazaar unavailable; waiting for the next shared refresh.",
          );
      } else if (url.pathname === "/api/companion/auctions") {
        collector.start();
        const filters = JSON.parse(url.searchParams.get("filters") ?? "{}");
        const page = Number(url.searchParams.get("page") ?? 0);
        if (!Number.isSafeInteger(page) || page < 0 || page > 10000)
          throw new Error("Invalid page");
        const key = JSON.stringify([filters, page]),
          cached = pages.get(key);
        if (cached && cached.until > Date.now()) body = cached.body;
        else {
          body = collector.list(filters, page);
          if (pages.size >= 200) pages.delete(pages.keys().next().value!);
          pages.set(key, { until: Date.now() + 10000, body });
        }
      } else if (url.pathname === "/api/companion/status")
        body = collector.health;
      else if (
        /^\/api\/companion\/auctions\/[a-f0-9]{32}(\/check)?$/i.test(
          url.pathname,
        )
      ) {
        const id = url.pathname.split("/")[4];
        if (url.pathname.endsWith("/check")) {
          if (Date.now() - checkWindow >= 60000) {
            checkWindow = Date.now();
            checks = 0;
          }
          if (++checks > 30)
            throw new Error(
              "Availability check limit reached. Retry in a minute.",
            );
        }
        body = url.pathname.endsWith("/check")
          ? await collector.recheck(id)
          : collector.detail(id);
        if (!body) {
          res
            .writeHead(404)
            .end(
              JSON.stringify({
                error: "Listing unavailable from this collector.",
              }),
            );
          return;
        }
      } else {
        res
          .writeHead(404)
          .end(JSON.stringify({ error: "Unknown market route" }));
        return;
      }
      res.setHeader(
        "Cache-Control",
        url.pathname.endsWith("/check") ? "no-store" : "public, max-age=10",
      );
      res.end(JSON.stringify(body));
    } catch (e) {
      res.writeHead(503).end(JSON.stringify({ error: message(e) }));
    }
  };
}
