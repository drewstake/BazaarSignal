import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { sharedMarketHandler } from "../server/shared-market";
import { PAID_MARKET_ORIGIN, PAID_PILOT_END, PAID_PILOT_ID } from "../shared/paid-pilot";
import { normalizeBazaar } from "../shared/companion/bazaar";
// @ts-expect-error directly executable launcher configuration
import { localMarketEnvironment } from "../scripts/local-market-config.mjs";

const now = Date.parse("2026-10-14T15:03:00Z");
const usage = { mode: "normal", pollMs: 3600000, trialId: PAID_PILOT_ID, expiresAt: PAID_PILOT_END };
const path = "/live-market/api/companion/portfolio-prices?assets=bz_BOOSTER_COOKIE";
const origin = "http://127.0.0.1:5173";
const cookie = normalizeBazaar("BOOSTER_COOKIE", {
  buy_summary: [{ pricePerUnit: 110, amount: 7, orders: 2 }],
  sell_summary: [{ pricePerUnit: 100, amount: 13, orders: 4 }],
}, now, now);
const body = { bazaar: [cookie], listings: [], usage };
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules();
});

async function withProxy(network: typeof fetch, work: (base: string) => Promise<void>, clock = () => now) {
  const handler = sharedMarketHandler(network, clock);
  const server = createServer((req, res) => void handler(req, res, () => res.writeHead(404).end()));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await work(`http://127.0.0.1:${(server.address() as { port: number }).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}

it("forwards one compact cached-price GET with original samples/policy and no credentials or conditional preflight", async () => {
  const network = vi.fn(async () => Response.json(body));
  await withProxy(network, async base => {
    expect(network).not.toHaveBeenCalled();
    const r = await fetch(base + path, { headers: { Authorization: "private", Cookie: "private", "If-None-Match": "old" } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(body);
    expect(network).toHaveBeenCalledOnce();
    expect(network).toHaveBeenCalledWith(PAID_MARKET_ORIGIN + path.replace("/live-market", ""), expect.objectContaining({
      method: "GET", credentials: "omit", redirect: "error", headers: { Accept: "application/json" },
    }));
  });
});
it('rejects cross-site requests before they can spend the local preview budget', async () => {
  const network = vi.fn(async () => Response.json(body));
  await withProxy(network, async base => {
    for (const headers of [{ Origin: 'https://another.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      expect((await fetch(base + path, { headers })).status).toBe(403);
    }
    expect(network).not.toHaveBeenCalled();
    expect((await fetch(base + path, { headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200);
    expect(network).toHaveBeenCalledOnce();
  });
});

it.each([
  ["GET", "/live-market/api/companion/bazaar"],
  ["GET", "/live-market/api/companion/raw-bazaar"],
  ["GET", path + "&refresh=1"],
  ["GET", path + "&force=1"],
  ["GET", path + "&assets=bz_DIAMOND"],
  ["GET", "/live-market/api/companion/portfolio-prices?assets="],
  ["GET", "/live-market/api/companion/portfolio-prices?assets=v1_abc"],
  ["GET", "/live-market/api/companion/portfolio-prices?assets=" + Array(101).fill("bz_DIAMOND").join(",")],
  ["POST", path], ["OPTIONS", path], ["GET", "/api/companion/portfolio-prices?assets=bz_DIAMOND"],
])("rejects unsupported %s %s before contacting Google", async (method, target) => {
  const network = vi.fn();
  await withProxy(network, async base => {
    expect((await fetch(base + target, { method })).status).toBeGreaterThanOrEqual(400);
    expect(network).not.toHaveBeenCalled();
  });
});

it("retains the portfolio batch route without a full-market request", async () => {
  const network = vi.fn(async () => Response.json(body));
  await withProxy(network, async base => {
    await fetch(base + path + ",bz_DIAMOND,bz_BOOSTER_COOKIE");
    expect(network).toHaveBeenCalledOnce();
    expect(network.mock.calls[0][0]).toBe(PAID_MARKET_ORIGIN + "/api/companion/portfolio-prices?assets=bz_BOOSTER_COOKIE%2Cbz_DIAMOND");
  });
});

it("passes through the budget stop and refuses later local requests, even after a browser reload", async () => {
  const paused = { error: "Budget stopped", usage: { mode: "paused", pollMs: 0 } };
  const network = vi.fn(async () => Response.json(paused, { status: 503 }));
  await withProxy(network, async base => {
    expect(await (await fetch(base + path)).json()).toEqual(paused);
    expect((await fetch(base + path)).status).toBe(503);
    expect((await fetch(base + path.replace("BOOSTER_COOKIE", "DIAMOND"))).status).toBe(503);
    expect(network).toHaveBeenCalledOnce();
  });
});

it("never sends an expired release request or retries a transport failure", async () => {
  const network = vi.fn(async () => { throw new Error("offline"); });
  await withProxy(network, async base => {
    expect((await fetch(base + path)).status).toBe(503);
    expect(network).not.toHaveBeenCalled();
  }, () => PAID_PILOT_END);
  await withProxy(network, async base => {
    expect((await fetch(base + path)).status).toBe(503);
    expect(network).toHaveBeenCalledOnce();
  });
});

it("does not accept missing policy or a new release that extends the existing allowance", async () => {
  for (const payload of [{ bazaar: [cookie] }, { ...body, usage: { ...usage, expiresAt: PAID_PILOT_END + 1 } }]) {
    const network = vi.fn(async () => Response.json(payload));
    await withProxy(network, async base => {
      expect((await (await fetch(base + path)).json()).usage.mode).toBe("paused");
      await fetch(base + path);
      expect(network).toHaveBeenCalledOnce();
    });
  }
});

it("local launchers share the fixed release and keep collection disabled, with an offline option", () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  expect(localMarketEnvironment()).toMatchObject({ LOCAL_SHARED_MARKET: "true", LOCAL_CLOUD_HISTORY: "true", LOCAL_DAILY_HISTORY: "false", VITE_LOCAL_MARKET_PREVIEW: "false",
    VITE_MARKET_API_URL: "/live-market", MARKET_SCHEDULER_DISABLED: "1", VITE_MARKET_TRIAL_ID: PAID_PILOT_ID,
    VITE_MARKET_TRIAL_END: new Date(PAID_PILOT_END).toISOString(), VITE_MARKET_UPDATES_PAUSED: "false" });
  expect(localMarketEnvironment(true)).toMatchObject({ LOCAL_SHARED_MARKET: "false", LOCAL_CLOUD_HISTORY: "false", LOCAL_DAILY_HISTORY: "false", VITE_PRICE_HISTORY_URL: "", VITE_LOCAL_MARKET_PREVIEW: "true",
    VITE_MARKET_API_URL: "", VITE_MARKET_UPDATES_PAUSED: "true", MARKET_SCHEDULER_DISABLED: "1" });
  vi.setSystemTime(PAID_PILOT_END);
  expect(localMarketEnvironment().VITE_MARKET_UPDATES_PAUSED).toBe("true");
});

it("shared browser reads reuse portfolio books and isolate SQLite caches, hourly rollover and expiry", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  for (const [key, value] of Object.entries(localMarketEnvironment())) if (key.startsWith("VITE_")) vi.stubEnv(key, value as string);
  vi.stubGlobal("location", { origin, search: "" });
  vi.stubGlobal("caches", undefined);
  const network = vi.fn(async () => Response.json(body)); vi.stubGlobal("fetch", network);
  const { cachedMarketRequest, savedBazaarBook } = await import("../src/companion/request-cache");
  const { selectedBazaarDetail } = await import("../src/companion/bazaar-search-data");
  await cachedMarketRequest(origin + "/api/companion/portfolio-prices?assets=bz_BOOSTER_COOKIE");
  expect(await savedBazaarBook(origin + "/live-market/api/companion/bazaar", "BOOSTER_COOKIE")).toBeUndefined();
  await cachedMarketRequest(origin + path + "%2Cbz_DIAMOND");
  expect((await selectedBazaarDetail("BOOSTER_COOKIE")).item?.upstreamAt).toBe(now);
  expect(network).toHaveBeenCalledTimes(2);
  vi.setSystemTime(Date.parse("2026-10-14T16:01:59Z"));
  await selectedBazaarDetail("BOOSTER_COOKIE");
  expect(network).toHaveBeenCalledTimes(2);
  vi.setSystemTime(Date.parse("2026-10-14T16:02:00Z"));
  await selectedBazaarDetail("BOOSTER_COOKIE");
  expect(network).toHaveBeenCalledTimes(3);
  expect(network.mock.calls[2][0]).toBe(origin + path);
  await selectedBazaarDetail("BOOSTER_COOKIE");
  expect(network).toHaveBeenCalledTimes(3);
  vi.setSystemTime(PAID_PILOT_END);
  await selectedBazaarDetail("BOOSTER_COOKIE"); await selectedBazaarDetail("DIAMOND");
  expect(network).toHaveBeenCalledTimes(3);
});
