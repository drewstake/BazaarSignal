import { describe, expect, it } from "vitest";
import {
  addPurchase,
  parseCoinAmount,
  parsePositionQuantity,
  positionInput,
  quantityFromCostInput,
  positionPortfolio,
  validPosition,
  valuePosition,
  type Position,
} from "../shared/companion/positions";
import { normalizeBazaar } from "../shared/companion/bazaar";
import catalog from "../src/companion/bazaar-catalog.json";
const now = 1791100000000;
const position: Position = {
  itemId: "BOOSTER_COOKIE",
  name: "Booster Cookie",
  quantity: 287,
  costBasis: 3501400000,
  createdAt: now,
  updatedAt: now,
  revision: 1,
};
function item(price = 13000000, quantity = 500) {
  return {
    ...normalizeBazaar(
      "BOOSTER_COOKIE",
      {
        buy_summary: [{ amount: 500, orders: 1, pricePerUnit: 14000000 }],
        sell_summary: [{ amount: quantity, orders: 1, pricePerUnit: price }],
      },
      now,
      now,
    ),
    feeContext: {
      mayor: "Test",
      checkedAt: now,
      multiplier: 1,
      explanation: "Test evidence",
    },
  };
}
describe("position entry", () => {
  it.each([
    ["12.2m", 12200000],
    ["3.5B", 3500000000],
    ["1,234.56K", 1234560],
    [" 12,200,000 ", 12200000],
    ["0.1", 0.1],
    ["1k", 1000],
  ])("parses %s", (text, value) => expect(parseCoinAmount(text)).toBe(value));
  it.each([
    "",
    " ",
    "-1",
    "0",
    "NaN",
    "Infinity",
    "1e9",
    "12.2mm",
    "1,2m",
    "1,,000",
    "1,000,00",
    ".1b",
    "1.2.3",
    "2 trillion",
    "1000000000000001",
    "9".repeat(500),
  ])("rejects invalid coin input %s", (text) =>
    expect(parseCoinAmount(text)).toBeNull(),
  );
  it.each([
    "",
    "0",
    "-1",
    "1.2",
    "1.0",
    "1k",
    "NaN",
    "Infinity",
    "1e2",
    "1,00",
    "1000000001",
    "9007199254740992",
  ])("requires bounded whole quantity %s", (text) =>
    expect(parsePositionQuantity(text)).toBeNull(),
  );
  it("uses only the selected cost input and requires actual quantity", () => {
    expect(parsePositionQuantity("1,000")).toBe(1000);
    expect(positionInput("287", "12.2m", "average")).toEqual({
      quantity: 287,
      costBasis: 3501400000,
      averagePrice: 12200000,
    });
    expect(positionInput("287", "3.5014b", "total")).toEqual(
      positionInput("287", "12.2m", "average"),
    );
    expect(positionInput("", "3.5b", "total").error).toBeTruthy();
    expect(
      positionInput("1000000000", "1000000000000000", "average").error,
    ).toBeTruthy();
    expect(positionInput("1", "0.001", "total").error).toBeTruthy();
  });
  it("calculates whole quantities from average price and total spent, preserving basis", () => {
    expect(quantityFromCostInput("12.2M", "3.5014b")).toEqual({
      quantity: 287,
      costBasis: 3501400000,
      averagePrice: 12200000,
      rounded: false,
    });
    expect(quantityFromCostInput("10,000", "35K")).toEqual({
      quantity: 4,
      costBasis: 35000,
      averagePrice: 8750,
      rounded: true,
    });
    expect(quantityFromCostInput("0.1", "0.3")).toMatchObject({
      quantity: 3,
      rounded: false,
    });
    expect(quantityFromCostInput("1", "1B")).toMatchObject({
      quantity: 1000000000,
      rounded: false,
    });
    for (const [average, total] of [
      ["", "10m"],
      ["10m", ""],
      ["0", "10m"],
      ["NaN", "10m"],
      ["1m", "1,00m"],
      ["10m", "9m"],
      ["1", "1000000001"],
      ["1", "1000000000000001"],
      ["0.001", "0.001"],
    ])
      expect(quantityFromCostInput(average, total).error).toBeTruthy();
  });
  it("combines additional purchases using aggregate basis, with bounds", () => {
    const result = addPurchase(position, {
      quantity: 13,
      costBasis: 130000000,
    });
    expect(result).toEqual({ quantity: 300, costBasis: 3631400000 });
    expect(result.costBasis / result.quantity).toBeCloseTo(12104666.6667, 3);
    expect(() =>
      addPurchase(position, { quantity: 1e9, costBasis: 1 }),
    ).toThrow();
    expect(() =>
      addPurchase(position, { quantity: 1, costBasis: 1e15 }),
    ).toThrow();
    expect(() =>
      addPurchase(position, { quantity: 1.5, costBasis: 1 }),
    ).toThrow();
  });
  it("has a price-free offline Bazaar catalog, including Booster Cookie", () => {
    expect(catalog).toContainEqual(["BOOSTER_COOKIE", "Booster Cookie"]);
    expect(new Set(catalog.map((row) => row[0])).size).toBe(catalog.length);
    expect(
      catalog.every(
        (row) =>
          row.length === 2 && row.every((value) => typeof value === "string"),
      ),
    ).toBe(true);
  });
  it("accepts holdings only, with bounded schema and no derived prices", () => {
    expect(validPosition(position)).toBe(true);
    for (const patch of [
      { value: 1 },
      { itemId: "../cookie" },
      { name: "" },
      { quantity: Infinity },
      { quantity: 0 },
      { costBasis: NaN },
      { costBasis: -1 },
      { updatedAt: now - 1 },
      { revision: 0 },
    ])
      expect(validPosition({ ...position, ...patch })).toBe(false);
  });
});
describe("position valuations", () => {
  it("matches the 287-cookie acceptance fixture and taxes full visible proceeds", () => {
    const value = valuePosition(position, item(), now);
    expect(value).toMatchObject({
      referencePrice: 13000000,
      value: 3731000000,
      pnl: 229600000,
      freshness: "fresh",
    });
    expect(value.returnPercent).toBeCloseTo((229600000 / 3501400000) * 100);
    expect(value.liquidation).toMatchObject({
      value: 3684362500,
      pnl: 182962500,
      taxPercent: 1.25,
    });
  });
  it("uses highest bids and walks sell depth rather than asks", () => {
    const data = item();
    data.bids = [
      { pricePerUnit: 12000000, amount: 200, orders: 1 },
      { pricePerUnit: 13000000, amount: 100, orders: 1 },
    ];
    const result = valuePosition(position, data, now);
    expect(result.referencePrice).toBe(13000000);
    expect(result.liquidation?.gross).toBe(100 * 13000000 + 187 * 12000000);
  });
  it("shows signed losses and applies the sample fee multiplier", () => {
    const data = item(10000000);
    data.feeContext.multiplier = 4;
    const result = valuePosition(position, data, now);
    expect(result.pnl).toBe(-631400000);
    expect(result.returnPercent).toBeLessThan(0);
    expect(result.liquidation?.taxPercent).toBe(5);
    expect(result.liquidation?.value).toBe(2726500000);
  });
  it("retains stale last-known prices but refuses invalid sample times", () => {
    expect(valuePosition(position, item(), now + 86400000).freshness).toBe(
      "stale",
    );
    expect(valuePosition(position, item(), now, true).freshness).toBe("stale");
    expect(
      valuePosition(position, item(), now + 86400000).liquidation,
    ).not.toBeNull();
    for (const data of [
      { ...item(), upstreamAt: 0 },
      { ...item(), observedAt: now + 60000 },
      { ...item(), observedAt: now + 500000 },
    ])
      expect(valuePosition(position, data, now).value).toBeNull();
  });
  it("never substitutes asks, zero, malformed depth, or another item", () => {
    for (const data of [
      undefined,
      { ...item(), bids: [] },
      { ...item(), bids: undefined as never },
      { ...item(), bids: [null] as never },
      { ...item(), id: "OTHER" },
      ...[0, Infinity].map((pricePerUnit) => ({
        ...item(),
        bids: [{ amount: 500, orders: 1, pricePerUnit }],
      })),
      { ...item(), bids: [{ amount: -1, orders: 1, pricePerUnit: 13000000 }] },
    ]) {
      expect(valuePosition(position, data, now)).toMatchObject({
        referencePrice: null,
        value: null,
        pnl: null,
        liquidation: null,
      });
    }
  });
  it("withholds full liquidation for insufficient depth and unverified fee evidence", () => {
    expect(valuePosition(position, item(13000000, 286), now)).toMatchObject({
      value: 3731000000,
      liquidation: null,
      liquidationReason: expect.stringContaining("depth"),
    });
    for (const fee of [
      undefined,
      { ...item().feeContext, checkedAt: now - 600000 },
      { ...item().feeContext, checkedAt: now + 40000 },
      { ...item().feeContext, multiplier: null },
      { ...item().feeContext, multiplier: Infinity },
      { ...item().feeContext, multiplier: 0.5 },
      { ...item().feeContext, multiplier: 11 },
    ])
      expect(
        valuePosition(position, { ...item(), feeContext: fee }, now),
      ).toMatchObject({
        value: 3731000000,
        liquidation: null,
        liquidationReason: expect.stringContaining("fee evidence"),
      });
  });
  it("calculates portfolio returns from matching aggregate basis", () => {
    const second = {
      ...position,
      itemId: "DIAMOND",
      quantity: 1,
      costBasis: 100,
    };
    const secondMarket = { ...item(200), id: "DIAMOND" };
    const result = positionPortfolio(
      [position, second],
      [item(), secondMarket],
      now,
    );
    expect(result.returnPercent).toBeCloseTo(
      ((229600000 + 100) / (3501400000 + 100)) * 100,
    );
    const partial = positionPortfolio([position, second], [item()], now);
    expect(partial).toMatchObject({
      missing: 1,
      costBasis: 3501400100,
      valuedBasis: 3501400000,
      value: 3731000000,
      pnl: 229600000,
    });
    expect(partial.returnPercent).toBeCloseTo((229600000 / 3501400000) * 100);
    expect(positionPortfolio([position], [], now)).toMatchObject({
      value: null,
      pnl: null,
      returnPercent: null,
      missing: 1,
    });
    expect(positionPortfolio([position], [item()], now + 86400000).stale).toBe(
      true,
    );
  });
});
