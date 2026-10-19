import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { HistoryStore } from "../collector/history-store";
import { validHistoryItem } from "../shared/daily-price-history";
import { PAID_MARKET_ORIGIN, PAID_PILOT_END } from "../shared/paid-pilot";

/** Local browser proxy to the budgeted cloud reader. No archive writes or refreshes. */
export function cloudPriceHistoryHandler(
  network: typeof fetch = fetch,
  now = Date.now,
) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/price-history") return next();
    const reply = (status: number, body: unknown) =>
      res
        .writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": status === 200 ? "private, max-age=300" : "no-store",
          "X-Content-Type-Options": "nosniff",
        })
        .end(JSON.stringify(body));
    const host = req.headers.host ?? "";
    if (
      !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host) ||
      (req.headers.origin && req.headers.origin !== `http://${host}`) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return reply(403, { error: "Local requests only" });
    if (
      req.method !== "GET" ||
      [...url.searchParams].length !== 1 ||
      !validHistoryItem(url.searchParams.get("item"))
    )
      return reply(400, { error: "One item ID required" });
    if (now() >= PAID_PILOT_END)
      return reply(503, { error: "Current cloud allowance expired" });
    try {
      const response = await network(
        `${PAID_MARKET_ORIGIN}/api/price-history?item=${encodeURIComponent(url.searchParams.get("item")!)}`,
        {
          redirect: "error",
          credentials: "omit",
          signal: AbortSignal.timeout(15_000),
        },
      );
      const text = await response.text();
      if (text.length > 1024 ** 2)
        throw Error("History exceeds response bound");
      reply(response.status, JSON.parse(text));
    } catch {
      reply(503, { error: "Cloud daily history unavailable" });
    }
  };
}

/** Selected-item reads only. This handler cannot fetch or import anything. */
export function priceHistoryHandler(
  store: HistoryStore,
  collecting: boolean,
  now = Date.now,
) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/price-history") return next();
    const error = (code: number, message: string) =>
      res
        .writeHead(code, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        })
        .end(JSON.stringify({ error: message }));
    const host = req.headers.host ?? "";
    if (
      !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host) ||
      (req.headers.origin && req.headers.origin !== `http://${host}`) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return error(403, "Local requests only");
    if (req.method !== "GET") return error(405, "GET required");
    const item = url.searchParams.get("item");
    if (!validHistoryItem(item) || [...url.searchParams].length !== 1)
      return error(400, "One item ID required");
    try {
      const rows = store.prices(item, now());
      const body = Buffer.from(
        JSON.stringify({
          version: 1,
          item,
          timezone: "EST",
          points: rows.map((r) => [r.day, r.at, r.buy, r.sell, r.source]),
          collector: {
            enabled: collecting,
            lastSuccess: JSON.parse(store.state("last-success") ?? "null"),
            lastError: JSON.parse(store.state("last-error") ?? "null"),
          },
        }),
      );
      if (body.length > 1024 ** 2)
        return error(503, "History exceeds response limit");
      const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
      const headers = {
        "Cache-Control": "private, max-age=300",
        ETag: etag,
        Vary: "Accept-Encoding",
        "X-Content-Type-Options": "nosniff",
      };
      if (req.headers["if-none-match"] === etag)
        return res.writeHead(304, headers).end();
      const gzip =
        body.length > 1024 &&
        /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
      const payload = gzip ? gzipSync(body) : body;
      res
        .writeHead(200, {
          ...headers,
          "Content-Type": "application/json",
          "Content-Length": payload.length,
          ...(gzip ? { "Content-Encoding": "gzip" } : {}),
        })
        .end(payload);
    } catch {
      error(503, "Daily history is temporarily unavailable");
    }
  };
}
