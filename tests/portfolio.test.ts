import { describe, expect, it } from "vitest";
import {
  aggregateDemand,
  collectPortfolioDemand,
  demandJobs,
  readPortfolioDemand,
} from "../collector/portfolio-demand";
import {
  auctionVariant,
  legacyHolding,
  portfolioTotals,
  validPortfolioHolding,
  valueHolding,
  type Holding,
} from "../shared/companion/portfolio";
import { addPurchase, positionInput } from "../shared/companion/positions";
import {
  blankCrossing,
  evaluateNotification,
  validateNotification,
  type HoldingNotification,
} from "../shared/companion/notifications";
import { normalizeBazaar } from "../shared/companion/bazaar";
import { deliver, emptyState } from "../apps-script/core";
import {
  queueCrossings,
  runPortfolioNotifications,
} from "../apps-script/portfolio-backend";
const now = Date.now();
const holding: Holding = legacyHolding({
  itemId: "BOOSTER_COOKIE",
  name: "Booster Cookie",
  quantity: 10,
  costBasis: 1000,
  createdAt: now - 10000,
  updatedAt: now - 10000,
  revision: 1,
});
const bazaar = (bid = 110, stamp = now - 1000, amount = 100) => ({
  ...normalizeBazaar(
    holding.itemId,
    {
      sell_summary: [{ pricePerUnit: bid, amount, orders: 1 }],
      buy_summary: [{ pricePerUnit: 10000, amount: 100, orders: 1 }],
    },
    stamp,
    stamp,
  ),
  feeContext: {
    mayor: "Test",
    multiplier: 1,
    checkedAt: stamp,
    explanation: "test only",
  },
});
const notification: HoldingNotification = {
  id: "default__bz_BOOSTER_COOKIE",
  holdingId: holding.id,
  holdingName: holding.name,
  portfolioId: "default",
  baseline: "acquisition",
  up: 10,
  down: 10,
  capturedAt: null,
  capturedPrice: null,
  source: "bazaar-bid-v1",
  createdAt: now,
  updatedAt: now,
  enabled: true,
  deleted: false,
  revision: 1,
};
const value = (price: number, stamp: number) =>
  valueHolding(holding, [bazaar(price, stamp)], [], stamp + 10);
const auction: Holding = {
  ...holding,
  kind: "auction",
  itemId: "NECRON_HANDLE",
  name: "Necron Handle",
  configuration: JSON.stringify({
    rarity: "LEGENDARY",
    enchantments: {},
    modifiers: {},
  }),
  stackSize: 1,
  id: "",
};
auction.id = auctionVariant(
  auction.itemId,
  auction.name,
  1,
  auction.configuration,
).fingerprint;
const listings = (prices = [100, 110, 120], stamp = now - 1000) =>
  prices.map((price, i) => ({
    id: `listing-${i}`,
    seller: `seller-${i}`,
    price,
    variant: auctionVariant(
      auction.itemId,
      auction.name,
      1,
      auction.configuration,
    ),
    start: stamp - 10000,
    end: now + 3600000,
    upstreamAt: stamp,
    observedAt: stamp,
    status: "active",
  }));
describe("portfolio holdings and valuations", () => {
  it("reuses whole quantities, case-insensitive amount parsing and weighted purchase math", () => {
    const first = positionInput("287", "12.2M", "average"),
      second = positionInput("13", "130,000,000", "total");
    expect(first).toMatchObject({ costBasis: 3501400000 });
    expect(first.error).toBeUndefined();
    expect(second.error).toBeUndefined();
    expect(addPurchase(first as any, second as any)).toEqual({
      quantity: 300,
      costBasis: 3631400000,
    });
    for (const q of ["1.1", "1k", "0", "-2"])
      expect(positionInput(q, "10m", "total").error).toBeTruthy();
    expect(validPortfolioHolding({ ...holding, secret: "invalid" })).toBe(
      false,
    );
  });
  it("uses the highest sell bid, never the ask, and only full-depth compatible-tax liquidation", () => {
    const v = valueHolding(holding, [bazaar()], [], now);
    expect(v.referencePrice).toBe(110);
    expect(v.value).toBe(1100);
    expect(v.liquidation?.value).toBe(1086.25);
    expect(
      valueHolding(holding, [bazaar(110, now - 1000, 5)], [], now).liquidation,
    ).toBeNull();
    expect(
      valueHolding(holding, [{ ...bazaar(), feeContext: undefined }], [], now)
        .liquidation,
    ).toBeNull();
    expect(
      valueHolding(holding, [{ ...bazaar(), bids: [] }], [], now).value,
    ).toBeNull();
  });
  it("keeps stale indicative estimates and excludes missing basis from aggregate returns", () => {
    const missing = {
      ...holding,
      id: "bz_DIAMOND",
      itemId: "DIAMOND",
      costBasis: 9000,
    };
    const total = portfolioTotals(
      [holding, missing],
      [bazaar(110, now - 600000)],
      [],
      now,
    );
    expect(total).toMatchObject({
      value: 1100,
      costBasis: 10000,
      valuedBasis: 1000,
      pnl: 100,
      returnPercent: 10,
      missing: 1,
      stale: true,
    });
    expect(portfolioTotals([holding], [], [], now).pnl).toBeNull();
  });
});
describe("percentage notifications", () => {
  it("primes, crosses once, deduplicates, rearms and handles both directions", () => {
    let state = blankCrossing(),
      stamp = now - 10000;
    const check = (price: number) => {
      stamp += 100;
      const r = evaluateNotification(
        notification,
        holding,
        value(price, stamp),
        state,
        stamp + 10,
      );
      state = r.state;
      return r;
    };
    expect(check(112).events).toEqual([]);
    expect(check(120).events).toEqual([]);
    expect(check(105).events).toEqual([]);
    const first = check(110);
    expect(first.events).toHaveLength(1);
    expect(first.events[0].direction).toBe("up");
    expect(
      evaluateNotification(
        notification,
        holding,
        value(110, stamp),
        state,
        stamp + 10,
      ).events,
    ).toEqual([]);
    expect(check(115).events).toEqual([]);
    expect(check(100).events).toEqual([]);
    expect(check(89).events[0].direction).toBe("down");
    expect(check(80).events).toEqual([]);
    expect(check(100).events).toEqual([]);
    expect(check(110).events[0].id).not.toBe(first.events[0].id);
  });
  it("never fires from stale, fixture, paused, missing or changed-source samples", () => {
    const start = evaluateNotification(
      notification,
      holding,
      value(100, now - 10000),
      blankCrossing(),
      now,
    ).state;
    const high = value(120, now - 1000);
    for (const [v, options] of [
      [{ ...high, freshness: "stale" }, {}],
      [high, { fixture: true }],
      [{ ...high, referencePrice: null }, {}],
      [{ ...high, source: "other" }, {}],
      [high, { emailEnabled: false }],
      [high, { portfolioDeleted: true }],
    ] as const)
      expect(
        evaluateNotification(notification, holding, v, start, now, options)
          .events,
      ).toEqual([]);
    expect(
      evaluateNotification(
        { ...notification, enabled: false },
        holding,
        high,
        start,
        now,
      ).events,
    ).toEqual([]);
    const gap = evaluateNotification(
      notification,
      holding,
      { ...high, freshness: "stale" },
      start,
      now,
    ).state;
    expect(
      evaluateNotification(notification, holding, high, gap, now).events,
    ).toEqual([]);
  });
  it("re-primes weighted acquisition baselines, while captured prices stay fixed", () => {
    const start = evaluateNotification(
      notification,
      holding,
      value(100, now - 10000),
      blankCrossing(),
      now,
    ).state;
    const bought = {
      ...holding,
      ...addPurchase(holding, { quantity: 10, costBasis: 800 }),
      revision: 2,
    };
    expect(
      evaluateNotification(
        notification,
        bought,
        value(120, now - 1000),
        start,
        now,
      ).events,
    ).toEqual([]);
    const sample = {
      ...notification,
      baseline: "sample" as const,
      capturedPrice: 100,
      capturedAt: now - 20000,
    };
    expect(
      evaluateNotification(sample, bought, value(120, now - 1000), start, now)
        .events[0].baseline,
    ).toBe(100);
    expect(
      evaluateNotification(
        { ...sample, revision: 2 },
        bought,
        value(120, now - 500),
        start,
        now,
      ).events,
    ).toEqual([]);
  });
  it("validates percentages and gates the production worker before I/O", () => {
    for (const input of [
      { baseline: "invalid", up: 10, down: null },
      { baseline: "sample", up: null, down: null },
      { baseline: "acquisition", up: 0, down: 10 },
      { baseline: "sample", up: null, down: 100 },
    ])
      expect(() => validateNotification(input as any)).toThrow();
    expect(runPortfolioNotifications(now)).toEqual({ paused: true });
  });
  it("persists one crossing event through the existing quota, receipt and bounded-retry delivery protocol", () => {
    const ledger = { state: emptyState("alice"), crossings: {} },
      portfolio = {
        id: "default",
        name: "Test",
        createdAt: now,
        updatedAt: now,
        revision: 1,
        deleted: false,
      };
    queueCrossings(
      ledger,
      notification,
      holding,
      portfolio,
      { bazaar: [bazaar(100, now - 2000)], listings: [] },
      now,
      true,
    );
    queueCrossings(
      ledger,
      notification,
      holding,
      portfolio,
      { bazaar: [bazaar(115, now - 1000)], listings: [] },
      now,
      true,
    );
    queueCrossings(
      ledger,
      notification,
      holding,
      portfolio,
      { bazaar: [bazaar(115, now - 1000)], listings: [] },
      now,
      true,
    );
    expect(ledger.state.mail).toHaveLength(1);
    let sends = 0,
      saves = 0,
      quota = 0;
    const receipts = new Map<string, number>();
    const io = {
      now: () => now,
      quota: () => quota,
      save: () => {
        saves++;
      },
      send: () => {
        sends++;
        expect(saves).toBeGreaterThan(0);
      },
      receipt: (id: string) => receipts.get(id) ?? null,
      remember: (id: string, at: number) => {
        receipts.set(id, at);
      },
      forget: (id: string) => {
        receipts.delete(id);
      },
      budgetExpired: () => false,
    };
    deliver(ledger.state, io);
    expect(sends).toBe(0);
    expect(ledger.state.mail[0].attempts).toBe(0);
    quota = 1;
    ledger.state.mail[0].nextAttempt = now;
    deliver(ledger.state, io);
    deliver(ledger.state, io);
    expect(sends).toBe(1);
    expect(ledger.state.mail[0].status).toBe("sent");
  });
});
describe("shared portfolio demand", () => {
  it("reserves allowance before each bounded private scan and never publishes partial pages", async () => {
    let reserved = 0,
      pages = 0,
      parentReads = 0;
    const d = await readPortfolioDemand(
      {
        reserveReads: async (n) => {
          reserved += n;
        },
        page: async () => {
          expect(reserved).toBeGreaterThan(0);
          pages++;
          return {
            rows: [
              { path: "users/a/portfolios/p/holdings/h", holding },
              { path: "users/b/portfolios/p/holdings/h", holding },
            ],
            next: null,
          };
        },
        portfolio: async () => {
          parentReads++;
          return { deleted: false };
        },
      },
      now,
    );
    expect(d.bazaar).toEqual(["BOOSTER_COOKIE"]);
    expect(pages).toBe(1);
    expect(parentReads).toBe(2);
    expect(reserved).toBe(102);
    let reads = 0;
    await expect(
      readPortfolioDemand(
        {
          reserveReads: async () => {
            throw new Error("Allowance exhausted");
          },
          page: async () => {
            reads++;
            return { rows: [], next: null };
          },
          portfolio: async () => null,
        },
        now,
      ),
    ).rejects.toThrow("Allowance exhausted");
    expect(reads).toBe(0);
  });
  it("deduplicates public asset keys across private accounts and omits private facts", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      holding: { ...holding, quantity: i + 1 },
      portfolioDeleted: false,
    }));
    const d = aggregateDemand(rows, now);
    expect(d.bazaar).toEqual(["BOOSTER_COOKIE"]);
    expect(demandJobs(d, now)).toEqual(["catalog", "election", "bazaar"]);
    expect(JSON.stringify(d)).not.toMatch(/quantity|costBasis|portfolioId|uid/);
    expect(
      aggregateDemand([{ holding, portfolioDeleted: true }], now).bazaar,
    ).toEqual([]);
    expect(() => demandJobs({ ...d, sampledAt: now - 3600001 }, now)).toThrow();
  });
  it("is paused by default and excludes auction demand when Bazaar collection is enabled", async () => {
    let jobs: string[] = [];
    const collector = {
      now: () => now,
      tick: async (keys: string[]) => {
        jobs = keys;
      },
    } as any;
    const d = aggregateDemand(
      [
        { holding, portfolioDeleted: false },
        { holding: auction, portfolioDeleted: false },
      ],
      now,
    );
    expect(await collectPortfolioDemand(collector, d)).toMatchObject({
      paused: true,
    });
    expect(jobs).toEqual([]);
    expect(d.auctions).toBeUndefined();
    await collectPortfolioDemand(collector, d, true);
    expect(jobs).toEqual(["catalog", "election", "bazaar"]);
    // Even a previously aggregated report cannot turn auction collection back on.
    expect(demandJobs({...d,bazaar:[],auctions:[auction.id]},now)).toEqual([]);
    const auctionOnly=aggregateDemand([{holding:auction,portfolioDeleted:false}],now);
    expect(demandJobs(auctionOnly,now)).toEqual([]);
  });
});

it('preserves legacy holdings but never values them from old auction evidence',()=>{
  expect(validPortfolioHolding(auction)).toBe(true);
  expect(valueHolding(auction, [], listings(), now)).toMatchObject({value:null,referencePrice:null,sampledAt:null,freshness:'unavailable',source:'unsupported-asset'});
  expect(portfolioTotals([holding,auction],[bazaar()],listings(),now).missing).toBe(1);
});

it('legacy auction evidence cannot create notifications or mail',()=>{
  const ledger={state:emptyState('owner'),crossings:{}};
  const n={...notification,holdingId:auction.id,source:'auction-exact-lowest-ask-v1'};
  queueCrossings(ledger,n,auction,{id:'default',name:'Saved',createdAt:now,updatedAt:now,revision:1,deleted:false},
    {bazaar:[],listings:listings()},now,true);
  expect(ledger.state.mail).toEqual([]);expect(ledger.crossings).toEqual({});
});
