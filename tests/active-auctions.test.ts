import { expect, it, vi } from "vitest";
import {
  valueActiveListings,
  activeOpportunity,
  activePage,
} from "../shared/companion/active-auctions";
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

it("averages other exact active asks without weighting the candidate or duplicating IDs", () => {
  const own = listing("own", 100),
    peer = listing("a", 200);
  const value = valueActiveListings(
    own,
    [own, peer, peer, listing("b", 400)],
    now,
  );
  expect(value.estimate).toBe(300);
  expect(value.count).toBe(2);
  expect(value.basis).toBe("active-listings");
  expect(value.sales).toEqual([]);
  expect(
    activeOpportunity(own, [own, peer, listing("b", 400)], now).profit,
  ).toBeLessThan(200);
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
it("shows no average for a lone listing and flags wide asks instead of silently trimming the average", () => {
  const own = listing("own", 100);
  expect(valueActiveListings(own, [own], now).estimate).toBeNull();
  const value = valueActiveListings(
    own,
    [listing("a", 100), listing("b", 200), listing("c", 9000)],
    now,
  );
  expect(value.estimate).toBe(3100);
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
it("applies identical active averages in detail and filtered pages with existing fee and enchantment filters", async () => {
  const own = listing("own", 100),
    all = [own, listing("a", 300), listing("b", 500)];
  const store = new SqliteCache(":memory:"),
    c = new MarketCollector(store);
  const fees = {
    mayor: "Normal",
    multiplier: 1,
    checkedAt: now,
    explanation: "Standard",
  };
  await store.commit(
    "auctions",
    null,
    JSON.stringify({
      version: "1",
      upstreamAt: now,
      observedAt: now,
      data: { listings: all, fees },
    }),
  );
  const page = await c.list({
    query: "TEST",
    showInsufficient: true,
    minProfit: -1000000,
    minRoi: -1000000,
  });
  expect(
    page.items.find((o) => o.listing.id === "own")?.valuation.estimate,
  ).toBe((await c.detail("own"))?.valuation.estimate);
  expect(
    activePage(all, { excludedEnchant: "sharpness", enchantLevel: 5 }, 0, now)
      .total,
  ).toBe(0);
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
  expect((await c.list({})).health.saleCount).toBe(0);
  await store.close();
});
