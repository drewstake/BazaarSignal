import { describe, expect, it } from "vitest";
import { legacyHolding, portfolioTotals } from "../shared/companion/portfolio";
import { normalizeBazaar } from "../shared/companion/bazaar";
import {
  appendValueSnapshot,
  emptyValueHistory,
  HISTORY_LIMIT,
  parseValueHistory,
  portfolioValueHistoryKey,
  portfolioValueSnapshot,
  visibleValuePoints,
} from "../src/companion/portfolio-value-history";

const now = 1791100000000;
const day = 86_400_000;
const holding = legacyHolding({
  itemId: "BOOSTER_COOKIE",
  name: "Booster Cookie",
  quantity: 10,
  costBasis: 1000,
  createdAt: now - 10000,
  updatedAt: now - 10000,
  revision: 1,
});
const price = (bid = 110, at = now - 1000) =>
  normalizeBazaar(
    "BOOSTER_COOKIE",
    {
      sell_summary: [{ pricePerUnit: bid, amount: 100, orders: 1 }],
      buy_summary: [{ pricePerUnit: 200, amount: 100, orders: 1 }],
    },
    at,
    at,
  );
const snapshot = portfolioValueSnapshot(
  portfolioTotals([holding], [price()], [], now),
)!;

describe("recorded portfolio value history", () => {
  it("uses owned quantities and actual reference prices, including last-known estimates", () => {
    expect(snapshot.value).toBe(1100);
    expect(snapshot.sampledAt).toBe(now - 1000);
    expect(snapshot.stale).toBe(false);
    const old = portfolioValueSnapshot(
      portfolioTotals([holding], [price()], [], now + day, true),
    );
    expect(old?.value).toBe(1100);
    expect(old?.stale).toBe(true);
    expect(old?.sampledAt).toBe(now - 1000);
  });
  it("does not turn missing assets into a historical loss or record an empty portfolio", () => {
    const unpriced = {
      ...holding,
      id: "bz_DIAMOND",
      itemId: "DIAMOND",
      name: "Diamond",
    };
    expect(
      portfolioValueSnapshot(
        portfolioTotals([holding, unpriced], [price()], [], now),
      ),
    ).toBeNull();
    expect(
      portfolioValueSnapshot(portfolioTotals([holding], [], [], now)),
    ).toBeNull();
    expect(portfolioValueSnapshot(portfolioTotals([], [], [], now))).toBeNull();
  });
  it("deduplicates timer ticks, aging prices and reloads without losing real flat-price samples", () => {
    const first = appendValueSnapshot(emptyValueHistory(), snapshot, now);
    expect(appendValueSnapshot(first, snapshot, now + 10000)).toBe(first);
    const aged = portfolioValueSnapshot(
      portfolioTotals([holding], [price()], [], now + day, true),
    )!;
    expect(appendValueSnapshot(first, aged, now + day)).toBe(first);
    const fresh = portfolioValueSnapshot(
      portfolioTotals([holding], [price(110, now + 10000)], [], now + 10010),
    )!;
    expect(
      appendValueSnapshot(first, fresh, now + 10010).points.map(
        (point) => point.value,
      ),
    ).toEqual([1100, 1100]);
    expect(
      appendValueSnapshot(
        parseValueHistory(JSON.stringify(first), now),
        snapshot,
        now + 10000,
      ).points,
    ).toHaveLength(1);
  });
  it("records purchases using new quantities and does not rewrite older values", () => {
    const first = appendValueSnapshot(emptyValueHistory(), snapshot, now);
    const purchase = portfolioValueSnapshot(
      portfolioTotals(
        [{ ...holding, quantity: 12, costBasis: 1200, revision: 2 }],
        [price()],
        [],
        now + 1000,
      ),
    )!;
    expect(
      appendValueSnapshot(first, purchase, now + 1000).points.map(
        (point) => point.value,
      ),
    ).toEqual([1100, 1320]);
  });
  it("keeps user and portfolio histories separate", () => {
    expect(portfolioValueHistoryKey("a", "portfolio")).not.toBe(
      portfolioValueHistoryKey("b", "portfolio"),
    );
    expect(portfolioValueHistoryKey("a", "portfolio")).not.toBe(
      portfolioValueHistoryKey("a", "another"),
    );
    expect(portfolioValueHistoryKey("a:b", "c")).not.toBe(
      portfolioValueHistoryKey("a", "b:c"),
    );
  });
  it("recovers from corrupt storage and rejects invalid or future values", () => {
    expect(parseValueHistory("broken", now)).toEqual(emptyValueHistory());
    expect(
      parseValueHistory('{"version":2,"signature":"x","points":[]}', now),
    ).toEqual(emptyValueHistory());
    const valid = { at: now, value: 1100, sampledAt: now - 1000, stale: false };
    const raw = JSON.stringify({
      version: 1,
      signature: "x",
      points: [
        valid,
        { ...valid, at: now + day },
        { ...valid, at: now - 1, value: -1 },
        { ...valid, at: now - 2, sampledAt: now + day },
      ],
    });
    expect(parseValueHistory(raw, now).points).toEqual([valid]);
    expect(
      appendValueSnapshot(
        emptyValueHistory(),
        { ...snapshot, sampledAt: NaN },
        now,
      ).points,
    ).toEqual([]);
  });
  it("bounds saved history and filters actual points for time ranges", () => {
    const recent = Array.from({ length: HISTORY_LIMIT + 3 }, (_, index) => ({
      at: now - index * 1000,
      value: 1100,
      sampledAt: now - index * 1000,
      stale: false,
    }));
    const history = parseValueHistory(
      JSON.stringify({
        version: 1,
        signature: "x",
        points: [
          ...recent,
          { ...recent[0], at: now - 91 * day, sampledAt: now - 91 * day },
        ],
      }),
      now,
    );
    expect(history.points).toHaveLength(HISTORY_LIMIT);
    expect(history.points.at(-1)?.at).toBe(now);
    const points = [1, 5, 20, 80].map((days) => ({
      at: now - days * day + 1,
      value: 1100,
      sampledAt: now - days * day,
      stale: false,
    }));
    expect(visibleValuePoints(points, day, now)).toHaveLength(1);
    expect(visibleValuePoints(points, 7 * day, now)).toHaveLength(2);
    expect(visibleValuePoints(points, 30 * day, now)).toHaveLength(3);
    expect(visibleValuePoints(points, null, now)).toHaveLength(4);
  });
});
