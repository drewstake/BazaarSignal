import { consistentSnapshot } from "../shared/companion/snapshot";
import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { auctionFees, bazaarTax } from "../shared/companion/fees";
import {
  executeDepth,
  normalizeBazaar,
} from "../shared/companion/bazaar";
import { decodeNbt } from "../collector/nbt";
import {
  normalizeListing,
  normalizeVariant,
} from "../collector/normalize";
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
  ({ ...normalizeBazaar("DIAMOND", product, now, now, {
    name: "Diamond",
    tier: "COMMON",
  }), feeContext: { mayor: "Fixture", multiplier: 1, checkedAt: now, explanation: "Test fee context" } });
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
  it("keeps bids out of active listing prices", () => {
    const active = { uuid: "a".repeat(32), auctioneer: "B".repeat(32), bin: true, starting_bid: 100, start: now - 1000, end: now + 60000, item_bytes: bytesFixture() };
    expect(normalizeListing(active, now, now, catalog)?.seller).toBe("b".repeat(32));
    expect(normalizeListing({ ...active, auctioneer: "invalid" }, now, now, catalog)?.seller).toBeUndefined();
    expect(
      normalizeListing({ uuid: "a".repeat(32), bin: false }, now, now, catalog),
    ).toBeNull();
  });
});

describe("collector consistency and gaps", () => {
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
});
