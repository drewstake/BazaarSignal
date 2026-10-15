import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { normalizeBazaar } from "../shared/companion/bazaar";

const origin = "http://127.0.0.1:5173";
const path = "/api/companion/portfolio-prices?assets=bz_BOOSTER_COOKIE";
const stamp = Date.parse("2026-10-12T22:00:00Z");
const cookie = normalizeBazaar(
  "BOOSTER_COOKIE",
  {
    buy_summary: [{ amount: 12, pricePerUnit: 110, orders: 3 }],
    sell_summary: [{ amount: 8, pricePerUnit: 100, orders: 2 }],
  },
  stamp,
  stamp,
);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-14T22:00:00Z"));
  vi.stubEnv("DEV", true);
  vi.stubEnv("PROD", false);
  vi.stubEnv("VITE_LOCAL_MARKET_PREVIEW", "true");
  vi.stubEnv("VITE_MARKET_UPDATES_PAUSED", "true");
  vi.stubEnv("VITE_MARKET_API_URL", "");
  vi.stubGlobal("location", { origin, search: "" });
  vi.stubGlobal("caches", undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("reads a single saved local item while paused, retains timestamps, and reuses the result", async () => {
  const fetcher = vi.fn(async () => Response.json({ bazaar: [cookie] }));
  vi.stubGlobal("fetch", fetcher);
  const { selectedBazaarDetail, searchDetailStale } =
    await import("../src/companion/bazaar-search-data");
  const { pollingDirective } = await import("../src/companion/polling");
  const result = await selectedBazaarDetail("BOOSTER_COOKIE");
  expect(result).toMatchObject({
    localSnapshot: true,
    item: { upstreamAt: stamp, observedAt: stamp },
  });
  expect(searchDetailStale(result)).toBe(true);
  expect(fetcher).toHaveBeenCalledWith(
    origin + path,
    expect.objectContaining({ redirect: "error", credentials: "omit" }),
  );
  await selectedBazaarDetail("BOOSTER_COOKIE");
  await selectedBazaarDetail("BOOSTER_COOKIE");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(pollingDirective().mode).toBe("paused");
});

it.each([
  [false, true, "true", origin + path],
  [true, false, "false", origin + path],
  [true, false, "true", "https://market.example" + path],
  [true, false, "true", "http://localhost:9999" + path],
  [true, false, "true", origin + "/api/companion/bazaar"],
  [
    true,
    false,
    "true",
    origin +
      "/api/companion/portfolio-prices?assets=bz_BOOSTER_COOKIE,bz_DIAMOND",
  ],
  [true, false, "true", origin + path + "&refresh=1"],
])(
  "does not permit preview reads outside the local single-item boundary (%s, %s, %s, %s)",
  async (dev, prod, flag, url) => {
    vi.stubEnv("DEV", dev);
    vi.stubEnv("PROD", prod);
    vi.stubEnv("VITE_LOCAL_MARKET_PREVIEW", flag);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { cachedMarketRequest } =
      await import("../src/companion/request-cache");
    await expect(cachedMarketRequest(url)).rejects.toThrow("paused");
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it("empty local snapshots are explicit and repeated selections do not retry", async () => {
  const fetcher = vi.fn(async () => Response.json({ bazaar: [] }));
  vi.stubGlobal("fetch", fetcher);
  const { selectedBazaarDetail } =
    await import("../src/companion/bazaar-search-data");
  expect(await selectedBazaarDetail("BOOSTER_COOKIE")).toMatchObject({
    localSnapshot: true,
    error: "This item is missing from the saved local snapshot.",
  });
  await selectedBazaarDetail("BOOSTER_COOKIE");
  expect(fetcher).toHaveBeenCalledOnce();
});
