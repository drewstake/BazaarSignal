import type { IncomingMessage, ServerResponse } from "node:http";
import { PAID_MARKET_ORIGIN, PAID_PILOT_END, PAID_PILOT_ID } from "../shared/paid-pilot";

const prefix = "/live-market";
const route = "/api/companion/portfolio-prices";

/** Development-only, public read proxy. The existing paid API still admits every
 * request against its durable budget. No credentials, refresh routes or retries.
 * Same-origin browser requests avoid an additional billable CORS preflight. */
export function sharedMarketHandler(network: typeof fetch = fetch, now = Date.now) {
  let stopped = false;
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      }).end(JSON.stringify(body));
    };
    if (!url.pathname.startsWith(prefix + "/")) {
      // Shared mode must never silently fall back to the old local market store.
      if (url.pathname.startsWith("/api/companion/") || url.pathname === "/api/market")
        return reply(404, { error: "Use the shared cached-price endpoint." });
      return next();
    }
    // Browsing another site must not spend this local preview's cloud budget.
    // Match the private local adapter's origin boundary before any paid read.
    const host = req.headers.host ?? '';
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host) ||
        (req.headers.origin && req.headers.origin !== `http://${host}`) ||
        req.headers['sec-fetch-site'] === 'cross-site')
      return reply(403, { error: 'Local requests only.' });
    if (req.method !== "GET") return reply(405, { error: "GET required." });
    const assets = (url.searchParams.get("assets") ?? "").split(",");
    if (url.pathname !== prefix + route || [...url.searchParams].length !== 1 ||
        !url.searchParams.has("assets") || assets.length > 100 ||
        assets.some(id => !/^bz_[A-Za-z0-9_:-]{1,100}$/.test(id)))
      return reply(400, { error: "Only selected Bazaar price reads are supported." });
    const pause = (error: string) => {
      stopped = true;
      return reply(503, { error, usage: { mode: "paused", pollMs: 0, reason: error } });
    };
    if (stopped || now() >= PAID_PILOT_END)
      return pause("Shared market reads are stopped or the current allowance period has ended.");
    const target = new URL(route, PAID_MARKET_ORIGIN);
    target.searchParams.set("assets", [...new Set(assets)].sort().join(","));
    try {
      const response = await network(target.href, {
        method: "GET", credentials: "omit", redirect: "error",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, PAID_PILOT_END - now()))),
      });
      const text = await response.text();
      if (Buffer.byteLength(text) > 8 * 1024 ** 2) throw new Error("Response exceeds market limit");
      const body = JSON.parse(text);
      const usage = body.usage ?? body.status?.usage;
      if (!usage || !["normal", "warning", "slow", "paused"].includes(usage.mode) ||
          !Number.isFinite(usage.pollMs) || usage.pollMs < 0 ||
          (usage.mode !== "paused" && (usage.trialId !== PAID_PILOT_ID ||
            !Number.isFinite(usage.expiresAt) || usage.expiresAt > PAID_PILOT_END || usage.expiresAt <= now())))
        return pause("Shared market usage policy is unavailable or expired.");
      if (usage.mode === "paused") stopped = true;
      reply(response.status, body);
    } catch {
      // The client retains saved data and remembers failed selections for this
      // hour. A transport failure never retries or starts upstream collection.
      reply(503, { error: "The website's cached market data is unavailable. Saved data may be shown." });
    }
  };
}
