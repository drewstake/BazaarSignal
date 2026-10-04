import { describe, expect, it } from "vitest";
import { bazaarTax } from "../shared/companion/fees";
import {
  executeDepth,
  normalizeBazaar,
} from "../shared/companion/bazaar";
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
});
