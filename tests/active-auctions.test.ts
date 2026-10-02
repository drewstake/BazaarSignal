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
import { auctionComparison } from "../shared/companion/auction-comparison";
import { auctionOpportunity } from "../shared/companion/auctions";
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

it("conservatively compares other exact active asks without weighting the candidate or duplicating IDs", () => {
  const own = listing("own", 100),
    peer = listing("a", 200);
  const value = valueActiveListings(
    own,
    [own, peer, peer, listing("b", 400)],
    now,
  );
  expect(value.estimate).toBe(200);
  expect(value.arithmeticMean).toBe(300);
  expect(value.count).toBe(2);
  expect(value.basis).toBe("active-listings");
  expect(value.sales).toEqual([]);
  expect(
    activeOpportunity(own, [own, peer, listing("b", 400)], now, 24, {
      mayor: "Test",
      multiplier: 1,
      checkedAt: now,
      explanation: "Test",
    }).profit,
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
it("applies identical conservative estimates in detail and filtered pages with existing fee and enchantment filters", async () => {
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
it("retains exact snapshot estimates through hourly gaps while live values and commands stay unavailable", async () => {
  const all = [
    listing("a".repeat(32), 1000000),
    listing("b".repeat(32), 3000000),
    listing("c".repeat(32), 5000000),
  ];
  const fees = {
    mayor: "Normal",
    multiplier: 1,
    checkedAt: now,
    explanation: "Standard",
  };
  const later = now + 30 * 60000;
  const o = activeOpportunity(all[0], all, later, 24, fees);
  expect(o.valuation.estimate).toBeNull();
  expect(o.profit).toBeNull();
  expect(o.listing.status).toBe("expired");
  const displayed = auctionComparison(o, 24, later);
  expect(displayed.sampled).toBe(true);
  expect(displayed.valuation.estimate).toBe(3000000);
  expect(displayed.valuation.count).toBe(2);
  expect(displayed.profit).toBe(
    activeOpportunity(all[0], all, now, 24, fees).profit,
  );
  expect(displayed.listing.status).toBe("expired");
  const repriced = auctionOpportunity(
    o.listing,
    [],
    [],
    later,
    48,
    false,
    o.valuation,
    fees,
    o.sampledValuation,
  );
  expect(auctionComparison(repriced, 48, later).fees!.duration).toBeGreaterThan(
    displayed.fees!.duration,
  );
  const store = new SqliteCache(":memory:");
  vi.spyOn(Date, "now").mockReturnValue(later);
  const collector = new MarketCollector(store);
  try {
    await store.commit(
      "auctions",
      null,
      JSON.stringify({
        version: "sample",
        upstreamAt: now,
        observedAt: now,
        data: { listings: all, fees },
      }),
    );
    expect((await collector.recheck(all[0].id)).command).toBeNull();
    const page = await collector.list({
      query: "TEST",
      minProfit: -1000000,
      minRoi: -1000000,
    });
    const fromPage = page.items.find((x) => x.listing.id === all[0].id)!;
    expect(auctionComparison(fromPage, 24, later).valuation.estimate).toBe(
      displayed.valuation.estimate,
    );
    expect(
      auctionComparison((await collector.detail(all[0].id))!, 24, later)
        .valuation.estimate,
    ).toBe(displayed.valuation.estimate);
  } finally {
    vi.restoreAllMocks();
    await store.close();
  }
});

it("withholds sampled fees without compatible evidence and never manufactures missing or invalid comparisons", () => {
  const all = [listing("own", 1000000), listing("peer", 3000000)];
  const later = now + 30 * 60000;
  const fees = {
    mayor: "Normal",
    multiplier: 1,
    checkedAt: now,
    explanation: "Standard",
  };
  for (const fee of [
    undefined,
    { ...fees, multiplier: null },
    { ...fees, multiplier: NaN },
    { ...fees, checkedAt: now - 600001 },
    { ...fees, checkedAt: later + 30001 },
  ]) {
    const display = auctionComparison(
      activeOpportunity(all[0], all, later, 24, fee),
      24,
      later,
    );
    expect(display.valuation.estimate).toBe(3000000);
    expect(display.profit).toBeNull();
    expect(display.fees).toBeNull();
  }
  for (const candidate of [
    { ...all[0], variant: { ...variant, complete: false } },
    { ...all[0], observedAt: now + 180001 },
    { ...all[0], upstreamAt: later + 30001 },
    { ...all[0], observedAt: 0 },
    { ...all[0], status: "sold" as const },
  ])
    expect(
      auctionComparison(
        activeOpportunity(candidate, all, later, 24, fees),
        24,
        later,
      ).valuation.estimate,
    ).toBeNull();
  const invalidPeers = [
    all[0],
    listing("sold", 4000000, { status: "sold" }),
    listing("ended", 4000000, { end: now }),
    listing("other", 4000000, {
      variant: { ...variant, fingerprint: "different" },
    }),
    listing("old-snapshot", 4000000, { upstreamAt: now - 1000 }),
  ];
  expect(
    auctionComparison(
      activeOpportunity(all[0], invalidPeers, later, 24, fees),
      24,
      later,
    ).valuation.estimate,
  ).toBeNull();
  const legacy = activeOpportunity(all[0], all, later, 24, fees);
  delete legacy.sampledValuation;
  expect(auctionComparison(legacy, 24, later).valuation.estimate).toBeNull();
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

it("groups by canonical ID across the complete snapshot after candidate filtering, with unique pagination and no lost or repeated auctions", () => {
  const all = Array.from({ length: 15 }, (_, item) =>
    Array.from({ length: 19 }, (_, i) =>
      listing(`${item}-${i}`, 1000000 + i * 1000, {
        variant: {
          ...variant,
          itemId: `ITEM_${item}`,
          name: i % 2 ? "Different display name" : "Shared display name",
          fingerprint: `item-${item}`,
        },
      }),
    ),
  ).flat();
  all.push(all[0]);
  const input = { minProfit: -1e9, minRoi: -1e9, sort: "capital" as const };
  const groups = [0, 1, 2].flatMap(
    (page) => activePage(all, input, page, now).items,
  );
  expect(groups).toHaveLength(15);
  expect(new Set(groups.map((g) => g.listing.variant.itemId)).size).toBe(15);
  const ids = groups.flatMap((g) => g.group!.matchingListings.map((l) => l.id));
  expect(ids).toHaveLength(285);
  expect(new Set(ids).size).toBe(285);
  expect(groups.every((g) => g.group!.matchingListings.length === 19)).toBe(
    true,
  );
  const filtered = activePage(
    all,
    { ...input, query: "ITEM_14", budget: 1003000 },
    9,
    now,
  );
  expect(filtered.total).toBe(1);
  expect(filtered.page).toBe(0);
  expect(filtered.items[0].group!.matchingListings).toHaveLength(4);
  expect(filtered.items[0].group!.comparisonPool).toHaveLength(19);
  expect(filtered.items[0].valuation.rawCount).toBe(18);
  expect(activePage(all, { ...input, budget: 1 }, 0, now).total).toBe(0);
});

it("keeps rarities, enchantments, upgrades and stack sizes separate inside the same item card", () => {
  const variants = [
    variant,
    { ...variant, fingerprint: "ench", enchantments: { sharpness: 6 } },
    { ...variant, fingerprint: "upgrade", modifiers: { upgrade_level: 5 } },
    { ...variant, fingerprint: "rarity", rarity: "LEGENDARY" },
    { ...variant, fingerprint: "stack", quantity: 64 },
  ];
  const all = variants.flatMap((v, i) => [
    listing(`${i}-buy`, 1000000, { variant: v }),
    listing(`${i}-peer`, 2000000 + i * 100000, { variant: v }),
  ]);
  const page = activePage(all, { minProfit: -1e9, minRoi: -1e9 }, 0, now);
  expect(page.total).toBe(1);
  expect(page.items[0].group!.matchingListings).toHaveLength(10);
  variants.forEach((v, i) => {
    const o = activeOpportunity(all[i * 2], all, now);
    expect(o.valuation.estimate).toBe(2000000 + i * 100000);
    expect(o.valuation.rawCount).toBe(1);
  });
  const filtered = activePage(
    all,
    {
      requiredEnchant: "sharpness",
      enchantLevel: 6,
      minProfit: -1e9,
      minRoi: -1e9,
    },
    0,
    now,
  );
  expect(filtered.items[0].group!.matchingListings.map((l) => l.id)).toEqual([
    "1-buy",
    "1-peer",
  ]);
  expect(filtered.items[0].group!.comparisonPool).toHaveLength(10);
});

it("ranks supported opportunities ahead of sparse, seller-concentrated, dispersed and outlier-driven gaps", () => {
  const group = (id: string, prices: number[], seller?: string) =>
    prices.map((p, i) =>
      listing(`${id}-${i}`, p, {
        seller: seller ?? `${id}-seller-${i}`,
        variant: { ...variant, itemId: id, fingerprint: id },
      }),
    );
  const all = [
    ...group("SUPPORTED", [1e6, 1.1e6, 1.11e6, 1.12e6, 1.13e6, 1.14e6]),
    ...group("SPARSE", [1e6, 5e6]),
    ...group("CONCENTRATED", [1e6, 5e6, 5.1e6, 5.2e6, 5.3e6], "one-seller"),
    ...group("DISPERSED", [1e6, 5e6, 10e6, 15e6, 20e6]),
    ...group("OUTLIER", [1e6, 5e6, 5.1e6, 5.2e6, 5.3e6, 5.4e6, 1e12]),
    ...group("LONE", [1e6]),
  ];
  const fees = {
    mayor: "Test",
    multiplier: 1,
    checkedAt: now,
    explanation: "Test",
  };
  const page = activePage(all, {}, 0, now, fees);
  expect(page.items[0].listing.variant.itemId).toBe("SUPPORTED");
  expect(page.items[0].valuation.confidence).toBe("medium");
  expect(
    page.items.find((o) => o.listing.variant.itemId === "OUTLIER")!.valuation
      .excludedCount,
  ).toBe(1);
  expect(
    page.items.find((o) => o.listing.variant.itemId === "LONE")!.valuation
      .estimate,
  ).toBeNull();
  for (const item of page.items.slice(1))
    expect(item.valuation.confidence).not.toBe("high");
  expect(
    activePage(all, { sort: "profit" }, 0, now, fees).items[0].listing.variant
      .itemId,
  ).not.toBe("SUPPORTED");
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

it("requires verified snapshot fees even for fresh asks and rejects unsafe multipliers", () => {
  const all = [listing("buy", 1e6), listing("peer", 2e6)];
  for (const fee of [
    undefined,
    ...[0, 11, NaN, Infinity].map((multiplier) => ({
      mayor: "Test",
      multiplier,
      checkedAt: now,
      explanation: "Test",
    })),
    {
      mayor: "Test",
      multiplier: 1,
      checkedAt: now + 30001,
      explanation: "Future",
    },
  ]) {
    const o = activeOpportunity(all[0], all, now, 24, fee);
    expect(o.valuation.estimate).toBe(2e6);
    expect(o.profit).toBeNull();
    expect(o.fees).toBeNull();
  }
});

it("read-only grouping, details, filters and pagination never invoke market collection or mutate the snapshot", async () => {
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
  await collector.list({});
  await collector.list({ query: "TEST", budget: 1e6 }, 1);
  await collector.detail(all[5].id);
  expect(await store.read("auctions")).toBe(snapshot);
  expect(fetcher).not.toHaveBeenCalled();
  await store.close();
});

it("replays the Candy Artifact snapshot: excludes the 15.432B ask and replaces 3391% arithmetic ROI with a 5.20% hypothetical gap", async () => {
  const { readFileSync } = await import("node:fs");
  const snapshot = JSON.parse(
    readFileSync("tests/fixtures/candy-auctions.json", "utf8"),
  );
  const all: Listing[] = snapshot.data.listings;
  const own = [...all].sort((a, b) => a.price - b.price)[0];
  const o = activeOpportunity(own, all, own.observedAt, 24, snapshot.data.fees);
  expect(o.valuation.rawCount).toBe(43);
  expect(o.valuation.count).toBe(42);
  expect(o.valuation.excludedCount).toBe(1);
  expect(o.valuation.listings!.find((l) => l.excluded)?.price).toBe(
    15432000000,
  );
  expect(o.valuation.arithmeticMean).toBeCloseTo(360473261.0697674, 4);
  expect(o.valuation.low).toBe(1425000);
  expect(o.valuation.estimate).toBe(1300000);
  expect(o.fees).toEqual({
    listing: 13000,
    duration: 350,
    claim: 13000,
    total: 26350,
  });
  expect(o.profit).toBe(63650);
  expect(o.roi).toBeCloseTo(5.202926390648629, 8);
  expect(o.valuation.confidence).toBe("low");
  const groups = activePage(
    all,
    {
      budget: 2e10,
      minProfit: -1e12,
      minRoi: -1e9,
      minComps: 0,
      confidence: "insufficient",
      maxAgeMinutes: 1e6,
    },
    0,
    snapshot.observedAt,
    snapshot.data.fees,
  );
  expect(groups.total).toBe(1);
  expect(groups.items[0].group!.matchingListings).toHaveLength(49);
  expect(
    new Set(groups.items[0].group!.matchingListings.map((l) => l.id)).size,
  ).toBe(49);
});
