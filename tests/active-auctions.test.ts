import { expect, it, vi } from "vitest";
vi.mock('../shared/market-features',()=>({AUCTION_COLLECTION_ENABLED:true}));
import { valueActiveListings } from "../shared/companion/active-auctions";
import { SqliteCache } from "../collector/cache-store";
import { MarketCollector } from "../collector/engine";
import { normalizeVariant } from "../collector/normalize";
import type { Listing } from "../shared/companion/types";
const now = Date.now();
const variant = normalizeVariant(
  {
    i: [
      {
        Count: 1,
        tag: {
          ExtraAttributes: { id: "TEST", enchantments: { sharpness: 5 } },
        },
      },
    ],
  },
  { TEST: { name: "TEST", tier: "RARE", category: "SWORD" } },
);
const listing = (
  id: string,
  price: number,
  patch: Partial<Listing> = {},
): Listing => ({
  id,
  price,
  variant,
  status: "active",
  start: now - 10000,
  end: now + 600000,
  upstreamAt: now,
  observedAt: now,
  seller: id,
  ...patch,
});
it("excludes expired, sold, stale, future, invalid and mismatched configurations", () => {
  const own = listing("own", 100),
    different = { ...variant, fingerprint: "other" };
  const peers = [
    listing("a", 200),
    listing("expired", 800, { end: now }),
    listing("sold", 800, { status: "sold" }),
    listing("stale", 800, { upstreamAt: now - 180001 }),
    listing("future", 800, { upstreamAt: now + 30001 }),
    listing("bad", NaN),
    listing("other", 800, { variant: different }),
  ];
  expect(valueActiveListings(own, peers, now).estimate).toBe(200);
  expect(
    valueActiveListings(
      { ...own, variant: { ...variant, complete: false } },
      peers,
      now,
    ).estimate,
  ).toBeNull();
  expect(
    valueActiveListings({ ...own, upstreamAt: now - 180001 }, peers, now)
      .estimate,
  ).toBeNull();
});
it("withholds a lone estimate and flags sparse wide asks while explicitly excluding supported upper outliers", () => {
  const own = listing("own", 100);
  expect(valueActiveListings(own, [own], now).estimate).toBeNull();
  const value = valueActiveListings(
    own,
    [listing("a", 100), listing("b", 200), listing("c", 9000)],
    now,
  );
  expect(value.estimate).toBe(100);
  expect(value.arithmeticMean).toBe(3100);
  expect(value.confidence).toBe("low");
  expect(value.reasons.join(" ")).toContain("inflate");
  const outlier = valueActiveListings(
    own,
    [
      ...Array.from({ length: 16 }, (_, i) => listing(`peer-${i}`, 100)),
      listing("outlier", 100000),
    ],
    now,
  );
  expect(outlier.dispersion).toBe(0);
  expect(outlier.confidence).toBe("low");
  expect(outlier.reasons.join(" ")).toContain("inflate");
});

it("scheduler never requests completed sales", async () => {
  const fetcher = vi.fn(
    async (url: string | URL | Request) =>
      new Response(
        JSON.stringify(
          String(url).includes("resources")
            ? { success: true, items: [] }
            : String(url).includes("bazaar")
              ? { success: true, lastUpdated: Date.now(), products: {} }
              : {
                  success: true,
                  page: 0,
                  totalPages: 1,
                  totalAuctions: 0,
                  lastUpdated: Date.now(),
                  auctions: [],
                },
        ),
      ),
  );
  const store = new SqliteCache(":memory:"),
    c = new MarketCollector(store, undefined, fetcher);
  await c.tick();
  expect(
    fetcher.mock.calls.some(([path]) =>
      String(path).includes("auctions_ended"),
    ),
  ).toBe(false);
  expect((await c.portfolioAuctions([])).listings).toEqual([]);
  await store.close();
});

it("never removes a low competing ask to manufacture a margin and retains all outlier evidence", () => {
  const own = listing("buy", 1000000);
  const peers = [
    listing("cheap", 1),
    ...Array.from({ length: 20 }, (_, i) => listing(`peer-${i}`, 2000000)),
    listing("troll", 1e12),
  ];
  const v = valueActiveListings(own, peers, now);
  expect(v.estimate).toBe(1);
  expect(v.excludedCount).toBe(1);
  expect(v.listings).toHaveLength(22);
  expect(v.listings!.find((l) => l.id === "cheap")!.excluded).toBeUndefined();
  expect(v.listings!.find((l) => l.id === "troll")!.excluded).toContain(
    "Upper outlier",
  );
});

it("read-only portfolio price evidence never invoke market collection or mutate the snapshot", async () => {
  const store = new SqliteCache(":memory:"),
    fetcher = vi.fn();
  const collector = new MarketCollector(store, undefined, fetcher);
  const all = Array.from({ length: 20 }, (_, i) =>
    listing(i.toString(16).padStart(32, "0"), 1e6 + i),
  );
  const snapshot = JSON.stringify({
    version: "read-only",
    upstreamAt: now,
    observedAt: now,
    data: {
      listings: all,
      fees: {
        mayor: "Test",
        multiplier: 1,
        checkedAt: now,
        explanation: "Test",
      },
    },
  });
  await store.commit("auctions", null, snapshot);
  await collector.portfolioAuctions([variant.fingerprint]);
  await collector.portfolioPrices([variant.fingerprint]);
  expect(await store.read("auctions")).toBe(snapshot);
  expect(fetcher).not.toHaveBeenCalled();
  await store.close();
});
