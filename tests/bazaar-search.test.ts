import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { normalizeBazaar } from "../shared/companion/bazaar";
import {
  fixtureTime,
  fixtureEnd,
  paidRuntimeFixture,
  snapshotFixture,
} from "./support/paid-runtime-fixture";

const item = (id = "BOOSTER_COOKIE", at = fixtureTime) =>
  normalizeBazaar(
    id,
    {
      buy_summary: [
        { pricePerUnit: 110, amount: 7, orders: 2 },
        { pricePerUnit: 112, amount: 11, orders: 3 },
      ],
      sell_summary: [{ pricePerUnit: 100, amount: 13, orders: 4 }],
      quick_status: { buyVolume: 999999, sellVolume: 888888 },
    },
    at,
    at,
  );
const usage = {
  mode: "normal",
  pollMs: 3600000,
  expiresAt: fixtureEnd,
  trialId: "search-test",
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(fixtureTime);
  vi.stubEnv("VITE_MARKET_OPERATING_MODE", "paid-budget");
  vi.stubEnv("VITE_MARKET_UPDATES_PAUSED", "false");
  vi.stubEnv("VITE_MARKET_TRIAL_ID", "search-test");
  vi.stubEnv("VITE_MARKET_TRIAL_END", new Date(fixtureEnd).toISOString());
  vi.stubEnv("VITE_MARKET_API_URL", "");
  vi.stubGlobal("location", { origin: "http://127.0.0.1:5173", search: "" });
  vi.stubGlobal("caches", undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

it("searches every catalog ID locally, including names and punctuation, without a request", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { default: rows } =
    await import("../src/companion/bazaar-catalog.json");
  const { searchHoldingItems } =
    await import("../src/companion/holding-catalog");
  for (const [id] of rows) expect(searchHoldingItems(id)[0]?.id).toBe(id);
  expect(searchHoldingItems("booster cookie")[0].id).toBe("BOOSTER_COOKIE");
  expect(searchHoldingItems("not-a-real-item-xyz")).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
});

it("makes one selected-item GET, coalesces concurrent selections, and reuses until the hourly read boundary", async () => {
  const fetcher = vi.fn(async (_url: string) =>
    Response.json({ bazaar: [item("BOOSTER_COOKIE", Date.now())], usage }),
  );
  vi.stubGlobal("fetch", fetcher);
  const { selectedBazaarDetail } =
    await import("../src/companion/bazaar-search-data");
  const results = await Promise.all(
    Array.from({ length: 10 }, () => selectedBazaarDetail("BOOSTER_COOKIE")),
  );
  expect(results[0].item?.id).toBe("BOOSTER_COOKIE");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe(
    "http://127.0.0.1:5173/api/companion/portfolio-prices?assets=bz_BOOSTER_COOKIE",
  );
  vi.setSystemTime(Date.parse("2026-10-13T22:01:59Z"));
  await selectedBazaarDetail("BOOSTER_COOKIE");
  expect(fetcher).toHaveBeenCalledOnce();
  vi.setSystemTime(Date.parse("2026-10-13T22:02:00Z"));
  await selectedBazaarDetail("BOOSTER_COOKIE");
  expect(fetcher).toHaveBeenCalledTimes(2);
  vi.setSystemTime(fixtureEnd);
  await selectedBazaarDetail("BOOSTER_COOKIE");
  await selectedBazaarDetail("ENCHANTED_DIAMOND_BLOCK");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("refreshes selected books at each quarter-hour read boundary and shares each response", async () => {
  const fetcher = vi.fn(async () => Response.json({ bazaar: [item("BOOSTER_COOKIE", Date.now())],
    usage: { ...usage, pollMs: 900_000 } }));
  vi.stubGlobal("fetch", fetcher);
  const { selectedBazaarDetail } = await import("../src/companion/bazaar-search-data");
  await selectedBazaarDetail("BOOSTER_COOKIE");
  for (const [index, minute] of [17, 32, 47].entries()) {
    vi.setSystemTime(Date.parse(`2026-10-13T21:${minute}:00Z`) - 1);
    await selectedBazaarDetail("BOOSTER_COOKIE");
    expect(fetcher).toHaveBeenCalledTimes(index + 1);
    vi.setSystemTime(Date.now() + 1);
    await Promise.all([selectedBazaarDetail("BOOSTER_COOKIE"), selectedBazaarDetail("BOOSTER_COOKIE")]);
    expect(fetcher).toHaveBeenCalledTimes(index + 2);
  }
});

it("rejects removed API entries before any market or cache request", async () => {
  const fetcher = vi.fn();
  const openCache = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("caches", { open: openCache });
  const { selectedBazaarDetail } =
    await import("../src/companion/bazaar-search-data");
  for (const id of ["BAZAAR_COOKIE", "ENCHANTMENT_AIMING_1", "ENCHANTMENT_FEATHER_FALLING_20"]) {
    expect((await selectedBazaarDetail(id)).error).toContain("not in the local Bazaar catalog");
  }
  expect(fetcher).not.toHaveBeenCalled();
  expect(openCache).not.toHaveBeenCalled();
});

it("cancels a pending hourly read, retains its last sample and permits recovery in that window", async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (fetcher.mock.calls.length === 2) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    }
    return Response.json({ bazaar: [item("BOOSTER_COOKIE", Date.now())], usage });
  });
  vi.stubGlobal("fetch", fetcher);
  const { selectedBazaarDetail } = await import("../src/companion/bazaar-search-data");
  await selectedBazaarDetail("BOOSTER_COOKIE");
  vi.setSystemTime(fixtureTime + 3600000);
  const controller = new AbortController();
  const pending = selectedBazaarDetail("BOOSTER_COOKIE", controller.signal);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  controller.abort();
  const result = await pending;
  expect(result.item?.upstreamAt).toBe(fixtureTime);
  expect(result.stale).toBe(true);
  expect(result.error).toContain("interrupted");
  await selectedBazaarDetail("BOOSTER_COOKIE");
  expect(fetcher).toHaveBeenCalledTimes(3);
  vi.setSystemTime(fixtureTime + 7200000);
  expect((await selectedBazaarDetail("BOOSTER_COOKIE")).item?.upstreamAt).toBe(Date.now());
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("does not start a network read when hidden during an asynchronous cache lookup", async () => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal("caches", { open: async () => { await wait; return { keys: async () => [] }; } });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { selectedBazaarDetail } = await import("../src/companion/bazaar-search-data");
  const controller = new AbortController();
  const pending = selectedBazaarDetail("BOOSTER_COOKIE", controller.signal);
  controller.abort();
  release();
  expect((await pending).error).toContain("interrupted");
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  "bazaar",
  "portfolio-prices?assets=bz_BOOSTER_COOKIE%2Cbz_ENCHANTED_DIAMOND_BLOCK",
  "book?itemId=BOOSTER_COOKIE",
])("reuses downloaded %s without a selected-item GET", async (path) => {
  const cookie = item();
  const body =
    path === "bazaar"
      ? { items: [cookie] }
      : path.startsWith("book")
        ? {
            book: { buy: cookie.asks, sell: cookie.bids },
            timestamp: cookie.upstreamAt,
            observedAt: cookie.observedAt,
          }
        : { bazaar: [cookie] };
  const fetcher = vi.fn(async () => Response.json({ ...body, usage }));
  vi.stubGlobal("fetch", fetcher);
  const { marketRequest } = await import("../src/companion/api");
  await marketRequest(path);
  const { selectedBazaarDetail } =
    await import("../src/companion/bazaar-search-data");
  expect((await selectedBazaarDetail("BOOSTER_COOKIE")).item?.asks).toEqual(
    cookie.asks,
  );
  expect(fetcher).toHaveBeenCalledOnce();
});

it("waits for a matching in-flight portfolio read and ignores caches from another backend", async () => {
  let release!: (r: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const { marketRequest } = await import("../src/companion/api");
  const { selectedBazaarDetail } =
    await import("../src/companion/bazaar-search-data");
  const portfolio = marketRequest(
    "portfolio-prices?assets=bz_BOOSTER_COOKIE%2Cbz_ENCHANTED_DIAMOND_BLOCK",
  );
  const selection = selectedBazaarDetail("BOOSTER_COOKIE");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  release(Response.json({ bazaar: [item()], usage }));
  await portfolio;
  expect((await selection).item?.id).toBe("BOOSTER_COOKIE");
  expect(fetcher).toHaveBeenCalledOnce();
  const { cachedMarketRequest, savedBazaarBook } =
    await import("../src/companion/request-cache");
  const other = cachedMarketRequest(
    "https://other.example/api/companion/bazaar",
  );
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  release(Response.json({ items: [item("ENCHANTED_DIAMOND_BLOCK")], usage }));
  await other;
  expect(
    await savedBazaarBook(
      "http://127.0.0.1:5173/api/companion/bazaar",
      "ENCHANTED_DIAMOND_BLOCK",
    ),
  ).toBeUndefined();
});

it("retains selected books through shared-cache eviction for the rest of the hourly window", async () => {
  const fetcher = vi.fn(async (url: string) => {
    const id =
      new URL(url).searchParams.get("assets")?.slice(3) ?? "BOOSTER_COOKIE";
    return Response.json({ bazaar: [item(id)], usage });
  });
  vi.stubGlobal("fetch", fetcher);
  const { marketRequest } = await import("../src/companion/api");
  await marketRequest("portfolio-prices?assets=bz_BOOSTER_COOKIE");
  const { selectedBazaarDetail } =
    await import("../src/companion/bazaar-search-data");
  await selectedBazaarDetail("BOOSTER_COOKIE");
  const { default: catalog } =
    await import("../src/companion/bazaar-catalog.json");
  for (const [id] of catalog.slice(0, 110)) await selectedBazaarDetail(id);
  const requests = fetcher.mock.calls.length;
  expect((await selectedBazaarDetail("BOOSTER_COOKIE")).item?.id).toBe(
    "BOOSTER_COOKIE",
  );
  expect(fetcher).toHaveBeenCalledTimes(requests);
  const { applyPollingDirective } = await import("../src/companion/polling");
  applyPollingDirective({ mode: "paused", pollMs: 0 });
  expect((await selectedBazaarDetail("BOOSTER_COOKIE")).item?.id).toBe("BOOSTER_COOKIE");
  expect(fetcher).toHaveBeenCalledTimes(requests);
});

it("reads existing persistent data when paused without network, including after a page reload", async () => {
  vi.stubEnv("VITE_MARKET_UPDATES_PAUSED", "true");
  const key = "http://127.0.0.1:5173/api/companion/bazaar";
  const old = {
    at: fixtureTime - 86400000,
    body: { items: [item("BOOSTER_COOKIE", fixtureTime - 86400000)] },
  };
  vi.stubGlobal("caches", {
    open: async () => ({
      keys: async () => [{ url: key }],
      match: async () => Response.json(old),
    }),
  });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { selectedBazaarDetail, searchDetailStale } =
    await import("../src/companion/bazaar-search-data");
  const result = await selectedBazaarDetail("BOOSTER_COOKIE");
  expect(result.item?.id).toBe("BOOSTER_COOKIE");
  expect(searchDetailStale(result)).toBe(true);
  expect(
    (await selectedBazaarDetail("ENCHANTED_DIAMOND_BLOCK")).error,
  ).toContain("paused");
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["empty", "offline", "budget"])(
  "does not retry a %s response on reselection",
  async (kind) => {
    const fetcher = vi.fn(async () => {
      if (kind === "offline") throw new Error("Offline");
      return Response.json(
        kind === "empty"
          ? { bazaar: [], usage }
          : {
              error: "Waiting for budget reset",
              usage: { ...usage, mode: "slow", retryAt: fixtureTime + 7200000 },
            },
        { status: kind === "budget" ? 429 : 200 },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const { selectedBazaarDetail } =
      await import("../src/companion/bazaar-search-data");
    expect((await selectedBazaarDetail("BOOSTER_COOKIE")).error).toBeTruthy();
    await selectedBazaarDetail("BOOSTER_COOKIE");
    await selectedBazaarDetail("BOOSTER_COOKIE");
    expect(fetcher).toHaveBeenCalledOnce();
    if (kind === "budget") {
      await selectedBazaarDetail("ENCHANTED_DIAMOND_BLOCK");
      expect(fetcher).toHaveBeenCalledOnce();
    }
  },
);

it("retains stale data on failure and computes depth from valid returned levels only", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ bazaar: [item()], usage }))
    .mockRejectedValue(new Error("Offline"));
  vi.stubGlobal("fetch", fetcher);
  const { selectedBazaarDetail, bookSideSummary, searchDetailStale } =
    await import("../src/companion/bazaar-search-data");
  await selectedBazaarDetail("BOOSTER_COOKIE");
  vi.setSystemTime(fixtureTime + 3600000);
  const result = await selectedBazaarDetail("BOOSTER_COOKIE");
  expect(result.error).toBe("Offline");
  expect(searchDetailStale(result)).toBe(true);
  expect(bookSideSummary(result.item?.asks, "buy")).toEqual({
    price: 110,
    quantity: 18,
    orders: 5,
    levels: 2,
  });
  expect(bookSideSummary(result.item?.bids, "sell")).toEqual({
    price: 100,
    quantity: 13,
    orders: 4,
    levels: 1,
  });
  expect(bookSideSummary([], "buy")).toEqual({
    price: null,
    quantity: 0,
    orders: 0,
    levels: 0,
  });
  expect(
    bookSideSummary([{ amount: NaN, orders: 1, pricePerUnit: 1 }], "buy"),
  ).toBeNull();
});

it("the existing selected-item route only reads the paid cache, without upstream calls or schedule changes", async () => {
  const runtime = paidRuntimeFixture(
    snapshotFixture().replaceAll("ITEM_0", "BOOSTER_COOKIE"),
  );
  const before = JSON.stringify(runtime.control.jobs);
  const result = await runtime.request(
    "/api/companion/portfolio-prices?assets=bz_BOOSTER_COOKIE",
  );
  expect(result.status).toBe(200);
  expect(result.body.bazaar.map((item: any) => item.id)).toEqual([
    "BOOSTER_COOKIE",
  ]);
  expect(result.body.bazaar[0].asks.length).toBeGreaterThan(0);
  expect(runtime.metrics.upstreamCalls).toBe(0);
  expect(JSON.stringify(runtime.control.jobs)).toBe(before);
});

it("uses 15-minute display age without relaxing trading freshness or hiding failures", async () => {
  const { searchDetailStale } = await import("../src/companion/bazaar-search-data");
  const { isFresh } = await import("../shared/market");
  const detail = { item: item() };
  const tenMinutes = fixtureTime + 10 * 60_000;
  expect(searchDetailStale(detail, tenMinutes)).toBe(false);
  expect(isFresh(fixtureTime, tenMinutes)).toBe(false);
  expect(searchDetailStale(detail, fixtureTime + 17 * 60_000 - 1)).toBe(false);
  expect(searchDetailStale(detail, fixtureTime + 17 * 60_000)).toBe(true);
  expect(searchDetailStale({ ...detail, error: "Offline" }, tenMinutes)).toBe(true);
  expect(searchDetailStale({ ...detail, stale: true }, tenMinutes)).toBe(true);
  expect(searchDetailStale({ item: { ...detail.item, observedAt: tenMinutes } }, tenMinutes)).toBe(true);
  for (const invalid of [0, NaN, Infinity, tenMinutes + 31_000]) {
    expect(searchDetailStale({ item: { ...detail.item, upstreamAt: invalid } }, tenMinutes)).toBe(true);
    expect(searchDetailStale({ item: { ...detail.item, observedAt: invalid } }, tenMinutes)).toBe(true);
  }
});
it('recovers an item within the same slot once the server retry deadline arrives', async () => {
  const deadline = fixtureTime + 60000;
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({error:'Temporarily busy',usage:{...usage,pollMs:900000,mode:'slow',retryAt:deadline}},{status:503}))
    .mockImplementation(async () => Response.json({bazaar:[item('BOOSTER_COOKIE',Date.now())],usage:{...usage,pollMs:900000}}));
  vi.stubGlobal('fetch',fetcher);
  const {selectedBazaarDetail} = await import('../src/companion/bazaar-search-data');
  expect((await selectedBazaarDetail('BOOSTER_COOKIE')).error).toBe('Temporarily busy');
  vi.setSystemTime(deadline - 1); await selectedBazaarDetail('BOOSTER_COOKIE'); expect(fetcher).toHaveBeenCalledTimes(1);
  vi.setSystemTime(deadline);
  const results = await Promise.all([selectedBazaarDetail('BOOSTER_COOKIE'),selectedBazaarDetail('BOOSTER_COOKIE')]);
  expect(results.every(r => r.item?.upstreamAt === deadline && !r.error)).toBe(true);
  await selectedBazaarDetail('BOOSTER_COOKIE'); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('a saved normal snapshot cannot erase backoff or prevent recovery of that same-slot snapshot', async () => {
  const fetcher = vi.fn(async () => Response.json({bazaar:[item('BOOSTER_COOKIE',Date.now())],usage:{...usage,pollMs:900000}}));
  vi.stubGlobal('fetch',fetcher);
  const {selectedBazaarDetail} = await import('../src/companion/bazaar-search-data');
  const {applyPollingDirective,pollingDirective} = await import('../src/companion/polling');
  await selectedBazaarDetail('BOOSTER_COOKIE');
  const deadline = fixtureTime + 60000;
  applyPollingDirective({...usage,mode:'slow',pollMs:900000,retryAt:deadline});
  vi.setSystemTime(deadline - 1);
  expect((await selectedBazaarDetail('BOOSTER_COOKIE')).item?.upstreamAt).toBe(fixtureTime);
  expect(pollingDirective().retryAt).toBe(deadline); expect(fetcher).toHaveBeenCalledTimes(1);
  vi.setSystemTime(deadline);
  expect((await selectedBazaarDetail('BOOSTER_COOKIE')).item?.upstreamAt).toBe(deadline);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(pollingDirective().retryAt).toBeUndefined();
});
it('does not loop after a failed recovery without a new server deadline', async () => {
  const deadline = fixtureTime + 60000;
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({error:'Busy',usage:{...usage,pollMs:900000,mode:'slow',retryAt:deadline}},{status:503}))
    .mockRejectedValue(Error('Offline'));
  vi.stubGlobal('fetch',fetcher);
  const {selectedBazaarDetail} = await import('../src/companion/bazaar-search-data');
  await selectedBazaarDetail('BOOSTER_COOKIE'); vi.setSystemTime(deadline);
  for (let i=0;i<5;i++) expect((await selectedBazaarDetail('BOOSTER_COOKIE')).error).toBe('Offline');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('retries an interrupted recovery when its subscriber returns, without discarding saved prices', async () => {
  const deadline = fixtureTime + 60000;
  const fetcher = vi.fn(async (_url:string, init?:RequestInit) => {
    if(fetcher.mock.calls.length===2) return new Promise<Response>((_,reject) => init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason)));
    return Response.json({bazaar:[item('BOOSTER_COOKIE',Date.now())],usage:{...usage,pollMs:900000}});
  });
  vi.stubGlobal('fetch',fetcher);
  const {selectedBazaarDetail} = await import('../src/companion/bazaar-search-data');
  const {applyPollingDirective} = await import('../src/companion/polling');
  await selectedBazaarDetail('BOOSTER_COOKIE');
  applyPollingDirective({...usage,mode:'slow',pollMs:900000,retryAt:deadline});
  vi.setSystemTime(deadline);
  const controller = new AbortController(), pending = selectedBazaarDetail('BOOSTER_COOKIE',controller.signal);
  await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2)); controller.abort();
  expect((await pending).item?.upstreamAt).toBe(fixtureTime);
  expect((await selectedBazaarDetail('BOOSTER_COOKIE')).item?.upstreamAt).toBe(Date.now());
  expect(fetcher).toHaveBeenCalledTimes(3);
});
