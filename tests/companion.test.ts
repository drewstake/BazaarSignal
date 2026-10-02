import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { auctionFees, bazaarTax } from "../shared/companion/fees";
import {
  defaultBazaarFilters,
  executeDepth,
  filterBazaar,
  normalizeBazaar,
  quoteBazaar,
} from "../shared/companion/bazaar";
import {
  auctionOpportunity,
  configurationFlags,
  defaultAuctionFilters,
  matchesAuction,
  valueVariant,
} from "../shared/companion/auctions";
import { decodeNbt } from "../collector/nbt";
import {
  normalizeListing,
  normalizeSale,
  normalizeVariant,
} from "../collector/normalize";
import {
  consistentSnapshot,
  MarketCollector,
  recordCoverage,
} from "../collector/legacy-history-engine";
import type { HistoryStore } from "../collector/store";
import type { ItemVariant, Listing, Sale } from "../shared/companion/types";
import { feeContextFromElection } from "../collector/fee-context";
const now = Date.now();
const product = {
  buy_summary: [
    { amount: 2, pricePerUnit: 110, orders: 1 },
    { amount: 10, pricePerUnit: 120, orders: 2 },
  ],
  sell_summary: [
    { amount: 4, pricePerUnit: 90, orders: 3 },
    { amount: 10, pricePerUnit: 80, orders: 4 },
  ],
  quick_status: {
    buyVolume: 100,
    sellVolume: 200,
    buyOrders: 8,
    sellOrders: 9,
    buyMovingWeek: 100000,
    sellMovingWeek: 200000,
  },
};
const item = () =>
  normalizeBazaar("DIAMOND", product, now, now, {
    name: "Diamond",
    tier: "COMMON",
  });
const f = {
  ...defaultBazaarFilters,
  quantity: 3,
  minDepth: 0,
  minBothActivity: 0,
};
const catalog = {
  TEST_SWORD: { name: "Test Sword", tier: "EPIC", category: "SWORD" },
};
const nbt = (extra: Record<string, unknown> = {}) => ({
  i: [
    {
      Count: 1,
      tag: {
        display: { Name: "Test Sword" },
        ExtraAttributes: {
          id: "TEST_SWORD",
          enchantments: { sharpness: 6 },
          ...extra,
        },
      },
    },
  ],
});
const variant = (extra: Record<string, unknown> = {}) =>
  normalizeVariant(nbt(extra), catalog);
const sale = (i: number, price = 1000000, v = variant()): Sale => ({
  id: `sale-${i}`,
  variant: v,
  price,
  soldAt: now - i * 10000,
  observedAt: now,
  buyer: `b${i}`,
  seller: `s${i}`,
  source: "hypixel-ended",
});
const listing = (v = variant(), price = 600000): Listing => ({
  id: "a".repeat(32),
  variant: v,
  price,
  start: now - 10000,
  end: now + 100000,
  observedAt: now,
  upstreamAt: now,
  status: "active",
});
// A separate fixture encoder builds wire-format NBT, including nested compounds,
// arrays, and long values. Parser tests do not just feed already-decoded JSON.
function stringBytes(s: string) {
  const b = Buffer.from(s),
    n = Buffer.alloc(2);
  n.writeUInt16BE(b.length);
  return Buffer.concat([n, b]);
}
function compound(fields: { type: number; name: string; value: Buffer }[]) {
  return Buffer.concat([
    ...fields.map((f) =>
      Buffer.concat([Buffer.from([f.type]), stringBytes(f.name), f.value]),
    ),
    Buffer.from([0]),
  ]);
}
function bytesFixture() {
  const item = compound([
    { type: 1, name: "Count", value: Buffer.from([1]) },
    {
      type: 10,
      name: "tag",
      value: compound([
        {
          type: 10,
          name: "ExtraAttributes",
          value: compound([
            { type: 8, name: "id", value: stringBytes("TEST_SWORD") },
            {
              type: 10,
              name: "enchantments",
              value: compound([
                {
                  type: 3,
                  name: "sharpness",
                  value: Buffer.from([0, 0, 0, 6]),
                },
              ]),
            },
          ]),
        },
      ]),
    },
  ]);
  const root = Buffer.concat([
    Buffer.from([10]),
    stringBytes(""),
    compound([
      {
        type: 9,
        name: "i",
        value: Buffer.concat([Buffer.from([10, 0, 0, 0, 1]), item]),
      },
    ]),
  ]);
  return gzipSync(root).toString("base64");
}
describe("Bazaar supported metrics and execution", () => {
  it("maps transaction sides independently of order side names", () => {
    const x = item();
    expect(x.asks[0].pricePerUnit).toBe(110);
    expect(x.bids[0].pricePerUnit).toBe(90);
    expect(x.openSellQuantity).toBe(100);
    expect(x.openBuyQuantity).toBe(200);
    expect(x.instantBuyActivity7d).toBe(100000);
    expect(x.instantSellActivity7d).toBe(200000);
    expect(x.buyOrderCount).toBe(9);
  });
  it("computes full-quantity slippage and refuses extrapolation", () => {
    expect(executeDepth(item().asks, 3)).toEqual({
      total: 340,
      unit: 340 / 3,
      slippage: (340 / 3 - 110) * 3,
    });
    expect(executeDepth(item().asks, 13)).toBeNull();
    expect(executeDepth(item().asks, 1.1)).toBeNull();
  });
  it("calculates passive trade costs, tax, capital and ROI", () => {
    const q = quoteBazaar(item(), { ...f, executionCost: 2 })!;
    expect(q.acquisition).toBe(270);
    expect(q.grossSale).toBe(330);
    expect(q.tax).toBe(4.125);
    expect(q.profit).toBe(53.875);
    expect(q.capital).toBe(272);
    expect(q.roi).toBeCloseTo((53.875 / 272) * 100);
  });
  it("never turns instant-buy/offer or order/instant losses into profitable flips", () => {
    for (const strategy of ["instant-offer", "order-instant"] as const) {
      expect(quoteBazaar(item(), { ...f, strategy })!.profit).toBeLessThan(0);
      expect(filterBazaar([item()], { ...f, strategy })).toEqual([]);
    }
  });
  it("rejects stale, future, missing activity and invalid filter numbers", () => {
    expect(
      filterBazaar([{ ...item(), upstreamAt: now - 181000 }], f, now),
    ).toEqual([]);
    expect(
      filterBazaar([{ ...item(), upstreamAt: now + 31000 }], f, now),
    ).toEqual([]);
    expect(quoteBazaar(item(), { ...f, quantity: NaN })).toBeNull();
    expect(
      filterBazaar([{ ...item(), instantSellActivity7d: null }], f, now),
    ).toEqual([]);
  });
  it("filters budget, weaker-side share and both activity sides", () => {
    expect(filterBazaar([item()], { ...f, budget: 269 }, now)).toEqual([]);
    expect(
      filterBazaar([item()], { ...f, maxActivityShare: 0.0001 }, now),
    ).toEqual([]);
    expect(
      filterBazaar([item()], { ...f, minSellActivity: 200001 }, now),
    ).toEqual([]);
    expect(filterBazaar([item()], f, now)).toHaveLength(1);
  });
  it("retains the true upstream timestamp and marks observed price movements", () => {
    const previous = item();
    const next = normalizeBazaar(
      "DIAMOND",
      {
        ...product,
        buy_summary: [{ amount: 20, pricePerUnit: 150, orders: 2 }],
      },
      now + 60000,
      now + 61000,
      undefined,
      previous,
    );
    expect(next.priceChangePct).toBeCloseTo(36.363636);
    expect(quoteBazaar(next, f, now + 61000)!.concerns.join(" ")).toContain(
      "15%",
    );
  });
});
describe("central fees", () => {
  it("applies explicit Bazaar account tiers and rejects invalid inputs", () => {
    expect(bazaarTax(1000, 1.25)).toBe(12.5);
    expect(bazaarTax(1000, 1)).toBe(10);
    expect(() => bazaarTax(1000, NaN)).toThrow();
  });
  it("applies full BIN brackets, capped collection threshold and duration", () => {
    expect(auctionFees(9999999).listing).toBe(99999.99);
    expect(auctionFees(10000000).listing).toBe(200000);
    expect(auctionFees(100000000).listing).toBe(2000000);
    expect(auctionFees(100000001).listing).toBe(2500000.025);
    expect(auctionFees(1000000).claim).toBe(0);
    expect(auctionFees(1000001).claim).toBe(1);
    expect(auctionFees(1020000).claim).toBe(10200);
    expect(auctionFees(1000, 6).duration).toBe(45);
    expect(auctionFees(1000, 24).duration).toBe(350);
    expect(auctionFees(1000, 48).duration).toBe(1200);
    expect(() => auctionFees(1000, 2)).toThrow();
  });
  it("fails closed for unmodeled mayor taxes instead of guessing modifiers", () => {
    const context = feeContextFromElection(
      {
        mayor: {
          name: "Derpy",
          perks: [{ name: "QUAD TAXES", description: "Quadruples taxes" }],
        },
      },
      now,
    );
    expect(context.multiplier).toBeNull();
    expect(filterBazaar([{ ...item(), feeContext: context }], f, now)).toEqual(
      [],
    );
    expect(
      feeContextFromElection({ mayor: { name: "Diana", perks: [] } }, now)
        .multiplier,
    ).toBe(1);
  });
});
describe("NBT and deterministic configuration fingerprints", () => {
  it("decodes base64 gzipped inventory compounds and object envelopes", () => {
    const bytes = bytesFixture();
    const expected = nbt();
    delete (expected.i[0].tag as any).display;
    expect(decodeNbt(bytes)).toEqual(expected);
    expect(decodeNbt({ type: 0, data: bytes })).toEqual(expected);
  });
  it("rejects malformed, truncated and excessively nested data", () => {
    expect(() => decodeNbt("not base64")).toThrow();
    expect(() =>
      decodeNbt(Buffer.from([10, 0, 0, 3]).toString("base64")),
    ).toThrow();
  });
  it("bounds native decompression and rejects damaged gzip data", () => {
    expect(() => decodeNbt(gzipSync(Buffer.alloc(2_000_001)).toString("base64"))).toThrow();
    const damaged = Buffer.from(bytesFixture(), "base64");
    damaged[damaged.length - 8] ^= 1;
    expect(() => decodeNbt(damaged.toString("base64"))).toThrow();
  });
  it("ignores individual identities but distinguishes every enchant and upgrade", () => {
    const a = variant({ uuid: "one", timestamp: 123 }),
      b = variant({ uuid: "two", timestamp: 456 });
    expect(a.fingerprint).toBe(b.fingerprint);
    for (const extra of [
      { enchantments: { sharpness: 7 } },
      { enchantments: { sharpness: 6, ultimate_one_for_all: 1 } },
      { rarity_upgrades: 1 },
      { modifier: "fabled" },
      { upgrade_level: 5 },
      { hot_potato_count: 15 },
      { gems: { RUBY_0: "PERFECT" } },
      { attributes: { mana_pool: 10 } },
    ])
      expect(variant(extra).fingerprint).not.toBe(a.fingerprint);
  });
  it("canonicalizes key order and pet identities while preserving pet experience", () => {
    expect(variant({ gems: { a: 1, b: 2 } }).fingerprint).toBe(
      variant({ gems: { b: 2, a: 1 } }).fingerprint,
    );
    const pet = {
      type: "SHEEP",
      tier: "LEGENDARY",
      exp: 1000,
      heldItem: "PET_ITEM_TEXTBOOK",
    };
    expect(
      variant({ petInfo: JSON.stringify({ ...pet, uuid: "a" }) }).fingerprint,
    ).toBe(
      variant({ petInfo: JSON.stringify({ ...pet, uuid: "b" }) }).fingerprint,
    );
    expect(variant({ petInfo: JSON.stringify(pet) }).fingerprint).not.toBe(
      variant({ petInfo: JSON.stringify({ ...pet, exp: 2000 }) }).fingerprint,
    );
  });
  it("quarantines unknown variants rather than silently merging them", () => {
    const v = variant({ mystery_upgrade: 7 });
    expect(v.complete).toBe(false);
    expect(v.modifiers.mystery_upgrade).toBe(7);
    expect(
      valueVariant(
        v,
        Array.from({ length: 20 }, (_, i) => sale(i, 100, v)),
        [],
        now,
      ).estimate,
    ).toBeNull();
  });
  it("requires actual completed BIN sales and keeps bids out of listing prices", () => {
    const raw = {
      auction_id: "a".repeat(32),
      buyer: "b".repeat(32),
      seller: "c".repeat(32),
      bin: true,
      price: 100,
      timestamp: now,
      item_bytes: bytesFixture(),
    };
    expect(normalizeSale(raw, now, catalog)?.price).toBe(100);
    expect(normalizeSale({ ...raw, buyer: "" }, now, catalog)).toBeNull();
    expect(normalizeSale({ ...raw, bin: false }, now, catalog)).toBeNull();
    const active = { uuid: "a".repeat(32), auctioneer: "B".repeat(32), bin: true, starting_bid: 100, start: now - 1000, end: now + 60000, item_bytes: bytesFixture() };
    expect(normalizeListing(active, now, now, catalog)?.seller).toBe("b".repeat(32));
    expect(normalizeListing({ ...active, auctioneer: "invalid" }, now, now, catalog)?.seller).toBeUndefined();
    expect(
      normalizeListing({ uuid: "a".repeat(32), bin: false }, now, now, catalog),
    ).toBeNull();
  });
});
describe("completed sale valuation", () => {
  it("deduplicates sale events and never groups items by name", () => {
    const sales = Array.from({ length: 12 }, (_, i) => sale(i));
    const other = variant({ enchantments: { sharpness: 7 } });
    expect(
      valueVariant(
        variant(),
        [...sales, ...sales, sale(100, 9000000, other)],
        [],
        now,
      ).count,
    ).toBe(12);
    expect(valueVariant(other, sales, [], now).estimate).toBeNull();
  });
  it("withholds estimates on cold start and fewer than five exact sales", () => {
    expect(valueVariant(variant(), [], [], now).confidence).toBe(
      "insufficient",
    );
    expect(valueVariant(variant(), [sale(0)], [], now).estimate).toBeNull();
  });
  it("removes extreme outliers and limits participant concentration", () => {
    const sales = Array.from({ length: 12 }, (_, i) => sale(i));
    let v = valueVariant(variant(), [...sales, sale(13, 100000000)], [], now);
    expect(v.estimate).toBe(1000000);
    expect(v.excludedCount).toBe(1);
    v = valueVariant(
      variant(),
      sales.map((s) => ({ ...s, seller: "same" })),
      [],
      now,
    );
    expect(v.count).toBe(2);
    expect(v.estimate).toBeNull();
  });
  it("caps resale to competing asks without treating asks as completed evidence", () => {
    const sales = Array.from({ length: 12 }, (_, i) => sale(i));
    const ask = { ...listing(), id: "d".repeat(32), price: 800000 };
    expect(valueVariant(variant(), sales, [ask], now).estimate).toBe(800000);
    expect(valueVariant(variant(), [], [ask], now).estimate).toBeNull();
  });
  it("reduces confidence for coverage gaps, old sales and dispersion", () => {
    const sales = Array.from({ length: 12 }, (_, i) => sale(i));
    expect(valueVariant(variant(), sales, [], now).confidence).toBe("high");
    expect(valueVariant(variant(), sales, [], now, true).confidence).toBe(
      "medium",
    );
    expect(
      valueVariant(
        variant(),
        sales.map((s) => ({ ...s, soldAt: now - 4 * 86400000 })),
        [],
        now,
      ).confidence,
    ).toBe("low");
  });
  it("subtracts listing, duration and claim fees; filters excluded enchant levels", () => {
    const o = auctionOpportunity(
      listing(),
      Array.from({ length: 12 }, (_, i) => sale(i, 1500000)),
      [],
      now,
    );
    expect(o.profit).toBe(1500000 - 600000 - 15000 - 350 - 15000);
    expect(o.capital).toBe(615350);
    expect(
      matchesAuction(
        o,
        {
          ...defaultAuctionFilters,
          excludedEnchant: "sharpness",
          enchantLevel: 6,
        },
        now,
      ),
    ).toBe(false);
    expect(
      matchesAuction(
        o,
        {
          ...defaultAuctionFilters,
          excludedEnchant: "sharpness",
          enchantLevel: 7,
        },
        now,
      ),
    ).toBe(true);
  });
  it("uses item-specific evidence rules, without a universal enchant blacklist", () => {
    const v = variant({
      enchantments: { sharpness: 6, ultimate_one_for_all: 1 },
    });
    expect(configurationFlags(v)).toEqual([]);
    expect(
      configurationFlags(v, [
        {
          id: "specific",
          itemIds: ["OTHER_SWORD"],
          enchantment: "ultimate_one_for_all",
          minLevel: 1,
          kind: "preference",
          explanation: "Observed preference",
          source: "test",
        },
      ]),
    ).toEqual([]);
  });
});
describe("collector consistency and gaps", () => {
  it("retries failed persistence without advancing the feed cursor or double-counting gaps", async () => {
    let commits = 0,
      aggregateCount = 0;
    const memory: HistoryStore = {
      mode: "local",
      load: async () => ({ sales: [], health: null }),
      commit: async (_sales, _health, values) => {
        aggregateCount = values.size;
        if (++commits === 1) throw new Error("storage unavailable");
      },
    };
    const raw = {
      auction_id: "a".repeat(32),
      buyer: "b".repeat(32),
      seller: "c".repeat(32),
      bin: true,
      price: 100,
      timestamp: now,
      item_bytes: bytesFixture(),
    };
    const c = new MarketCollector(memory, async (path) =>
      path.includes("resources")
        ? { items: [{ id: "TEST_SWORD", ...catalog.TEST_SWORD }] }
        : { lastUpdated: now, auctions: [raw] },
    );
    c.health.endedUpstreamAt = now - 120000;
    await expect(c.refreshEnded()).rejects.toThrow("storage unavailable");
    expect(c.health.endedUpstreamAt).toBe(now - 120000);
    expect(c.health.missedMs).toBe(0);
    await c.refreshEnded();
    expect(c.sales.size).toBe(1);
    expect(aggregateCount).toBe(1);
    expect(c.health.endedUpstreamAt).toBe(now);
    expect(c.health.missedMs).toBe(60000);
  });
  it("records uncovered windows and ignores repeated rolling snapshots", () => {
    expect(recordCoverage(now, now + 60000)).toBeNull();
    expect(recordCoverage(now, now + 180000)).toEqual({
      from: now,
      to: now + 120000,
    });
  });
  it("rejects mismatched pages, partial counts and duplicated listing IDs", async () => {
    const page0 = {
      success: true,
      page: 0,
      totalPages: 2,
      totalAuctions: 2,
      lastUpdated: Date.now(),
      auctions: [{ uuid: "a" }],
    };
    await expect(
      consistentSnapshot(async (path) =>
        path.endsWith("=0")
          ? page0
          : {
              ...page0,
              page: 1,
              lastUpdated: page0.lastUpdated + 1,
              auctions: [{ uuid: "b" }],
            },
      ),
    ).rejects.toThrow("changed");
    await expect(
      consistentSnapshot(async () => ({ ...page0, totalPages: 1 })),
    ).rejects.toThrow("Partial");
  });
  it("preserves prior active cache on partial failure; disappearance is not a sale", async () => {
    let fail = false;
    const memory: HistoryStore = {
      mode: "local",
      load: async () => ({ sales: [], health: null }),
      commit: async () => {},
    };
    const c = new MarketCollector(memory, async (path) => {
      if (path.includes("resources"))
        return { items: [{ id: "TEST_SWORD", ...catalog.TEST_SWORD }] };
      if (fail) throw new Error("page failed");
      return {
        page: 0,
        totalPages: 1,
        totalAuctions: 0,
        lastUpdated: Date.now(),
        auctions: [],
      };
    });
    c.listings.set(listing().id, listing());
    await c.refreshActive(true);
    expect(c.listings.get(listing().id)?.status).toBe("unavailable");
    expect(c.sales.size).toBe(0);
    fail = true;
    const previous = c.listings;
    (c as any).lastActiveAttempt = 0;
    await expect(c.refreshActive(true)).rejects.toThrow();
    expect(c.listings).toBe(previous);
  });
  it("ingests repeated completed events exactly once and reports missed feeds", async () => {
    let stamp = now;
    let commits = 0;
    const memory: HistoryStore = {
      mode: "local",
      load: async () => ({ sales: [], health: null }),
      commit: async () => {
        commits++;
      },
    };
    const raw = {
      auction_id: "a".repeat(32),
      buyer: "b".repeat(32),
      seller: "c".repeat(32),
      bin: true,
      price: 100,
      timestamp: now,
      item_bytes: bytesFixture(),
    };
    const c = new MarketCollector(memory, async (path) =>
      path.includes("resources")
        ? { items: [{ id: "TEST_SWORD", ...catalog.TEST_SWORD }] }
        : { lastUpdated: stamp, auctions: [raw] },
    );
    await c.refreshEnded();
    await c.refreshEnded();
    expect(c.sales.size).toBe(1);
    expect(commits).toBe(1);
    stamp = now + 1000;
    await c.refreshEnded();
    expect(c.sales.size).toBe(1);
  });
});
