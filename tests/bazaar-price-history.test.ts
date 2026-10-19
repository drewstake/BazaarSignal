import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SavedBazaarBook } from "../src/companion/request-cache";

const now = Date.parse("2026-10-18T18:00:00Z");
let history: typeof import("../src/companion/bazaar-price-history");
const book = (at = now): SavedBazaarBook => ({
  id: "BOOSTER_COOKIE",
  upstreamAt: at,
  observedAt: at,
  asks: [
    { pricePerUnit: 112, amount: 3, orders: 1 },
    { pricePerUnit: 110, amount: 7, orders: 2 },
  ],
  bids: [
    { pricePerUnit: 98, amount: 3, orders: 1 },
    { pricePerUnit: 100, amount: 7, orders: 2 },
  ],
});
beforeEach(async () => {
  vi.stubGlobal("location", { origin: "http://localhost", search: "" });
  history = await import("../src/companion/bazaar-price-history");
});
afterEach(() => vi.unstubAllGlobals());

it("records best ask and bid at the original sample time, including an older cached book", () => {
  expect(history.bazaarPricePoint(book(now - 7_200_000), now)).toEqual({
    at: now - 7_200_000,
    buy: 110,
    sell: 100,
  });
  expect(history.bazaarPricePoint(book(now + 60_000), now)).toBeNull();
  expect(
    history.bazaarPricePoint({ ...book(), observedAt: now + 60_000 }, now),
  ).toBeNull();
  expect(
    history.bazaarPricePoint({ ...book(now - 600_000), observedAt: now }, now),
  ).toBeNull();
});

it("does not turn empty or invalid sides into zero prices", () => {
  expect(history.bazaarPricePoint({ ...book(), asks: [] }, now)).toEqual({
    at: now,
    buy: null,
    sell: 100,
  });
  expect(
    history.bazaarPricePoint(
      { ...book(), bids: [{ amount: 0, orders: 1, pricePerUnit: 100 }] },
      now,
    ),
  ).toEqual({ at: now, buy: 110, sell: null });
  expect(
    history.bazaarPricePoint({ ...book(), asks: [], bids: [] }, now),
  ).toBeNull();
});

it("deduplicates reopened snapshots while retaining new flat-price samples and observations from another tab", () => {
  const point = { at: now, buy: 110, sell: 100 };
  const earlier = { ...point, at: now - 3_600_000 };
  expect(history.mergePricePoints([point], [earlier, point], now)).toEqual([
    earlier,
    point,
  ]);
  const changed = { ...point, buy: 111 };
  expect(history.mergePricePoints([earlier, point], [changed], now)).toEqual([
    earlier,
    changed,
  ]);
});

it("rejects corrupt storage and filters future, expired, malformed and nonpositive samples", () => {
  for (const raw of [
    null,
    "oops",
    "null",
    "{}",
    JSON.stringify({ version: 3, points: [] }),
  ])
    expect(history.parsePriceHistory(raw, now)).toEqual([]);
  const valid = { at: now, buy: 110, sell: null };
  const points = [
    valid,
    null,
    { ...valid, buy: 0 },
    { ...valid, at: now + 60_000 },
    { ...valid, at: now - 91 * 86_400_000 },
    { at: now - 1, sell: 100 },
    { at: now - 2, buy: null, sell: null },
  ];
  expect(
    history.parsePriceHistory(JSON.stringify({ version: 1, points }), now),
  ).toEqual([valid]);
  expect(history.parsePriceHistory(" ".repeat(400_001), now)).toEqual([]);
});

it("migrates legacy observations into compact storage without losing precision or unavailable sides", () => {
  const points = [
    { at: now - 3_600_000, buy: 0.12345678901234568, sell: null },
    { at: now, buy: null, sell: 14000000.12345679 },
  ];
  const legacy = JSON.stringify({ version: 1, points });
  const compact = history.serializePriceHistory(
    history.parsePriceHistory(legacy, now),
  );
  expect(JSON.parse(compact).version).toBe(2);
  expect(compact.length).toBeLessThan(legacy.length);
  expect(history.parsePriceHistory(compact, now)).toEqual(points);
});

it("validates compact records before keeping them", () => {
  const records = [
    [now, 110, null],
    [now - 1, "110", 100],
    [now - 2, 0, 100],
    [now - 3, null, null],
    [now + 60_000, 110, 100],
    [now - 91 * 86_400_000, 110, 100],
    [now - 4, 110],
    [now - 5, 110, 100, "extra"],
    { at: now - 6, buy: 110, sell: 100 },
    null,
  ];
  expect(
    history.parsePriceHistory(
      JSON.stringify({ version: 2, points: records }),
      now,
    ),
  ).toEqual([{ at: now, buy: 110, sell: null }]);
});

it("bounds retained observations and separates item and source histories", () => {
  const points = Array.from({ length: 3000 }, (_, index) => ({
    at: now - index * 60_000,
    buy: 110,
    sell: 100,
  }));
  const retained = history.mergePricePoints([], points, now);
  expect(retained).toHaveLength(history.PRICE_HISTORY_LIMIT);
  expect(retained.at(-1)?.at).toBe(now);
  expect(history.bazaarPriceHistoryKey("offline", "COOKIE")).not.toBe(
    history.bazaarPriceHistoryKey("live", "COOKIE"),
  );
  expect(history.bazaarPriceHistoryKey("live", "COOKIE")).not.toBe(
    history.bazaarPriceHistoryKey("live", "DIAMOND"),
  );
});

it("breaks lines across missing sides and missed hours instead of implying a continuous record", () => {
  const points = [
    { at: 0, buy: 110, sell: 100 },
    { at: 3_600_000, buy: null, sell: 101 },
    { at: 7_200_000, buy: 112, sell: 102 },
    { at: 18_000_000, buy: 115, sell: 103 },
  ];
  const x = (at: number) => at / 3_600_000;
  const y = (price: number) => price;
  expect(history.priceLinePath(points, "buy", x, y)).toBe(
    "M0.00,110.00 M2.00,112.00 M5.00,115.00",
  );
  expect(history.priceLinePath(points, "sell", x, y)).toBe(
    "M0.00,100.00 L1.00,101.00 L2.00,102.00 M5.00,103.00",
  );
});
