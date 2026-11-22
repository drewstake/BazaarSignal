import { expect, it } from "vitest";
import {
  bookEconomics,
  comparableRecoveries,
  dipEpisodes,
  flipAverage,
  flipScenario,
  followUp,
  type DailyQuote,
} from "../shared/flips";
import { archiveQuotes, flipBoard, summarizeFlips } from "../collector/flips";
import { historyDayStart } from "../shared/daily-price-history";
import { previewDay, releaseDay } from "../shared/flip-updates";
import { snapshotFixture } from "./support/paid-runtime-fixture";
import type { HistoryShard } from "../collector/cloud-price-history";
import { knownNpcChanges, updateCatalog } from "../collector/npc-prices";
import { marketEffect } from "../collector/flip-effects";
import {
  affectedFlipPrices,
  directFlipChanges,
} from "../collector/flip-price-changes";

const day = releaseDay;
const quote = (day: number, a = 100, b = 96): DailyQuote => [day, a, b];
function shard(items: Record<string, DailyQuote[]>): HistoryShard {
  return {
    version: 1,
    year: 2026,
    items: Object.fromEntries(
      Object.entries(items).map(([id, qs]) => [
        id,
        qs.map(([d, a, b]) => [d, historyDayStart(d), a, b, "bazaarsignal"]),
      ]),
    ),
  };
}
const steady = Array.from({ length: 151 }, (_, i) => quote(day - 150 + i));
// Three separate sell-offs with the prior price restored the next day.
const temporary = steady.map(([d]) =>
  [day - 87, day - 59, day - 21].includes(d) ? quote(d, 75, 72) : quote(d),
);
function item(id: string, ask = 75, bid = 72) {
  const i = JSON.parse(snapshotFixture("flips", historyDayStart(day + 1), 1))
    .data.items[0];
  return {
    ...i,
    id,
    name: id,
    asks: [{ amount: 100, orders: 5, pricePerUnit: ask }],
    bids: [{ amount: 100, orders: 5, pricePerUnit: bid }],
    instantSellActivity7d: 5000,
    instantBuyActivity7d: 5000,
  };
}
it("requires full days, two sides, 60% coverage, recent quotes and an after-tax exit", () => {
  const avg = flipAverage([...steady, quote(day + 1, 1, 0.9)], day, 90)!;
  expect(avg).toEqual({ offer: 100, bid: 96, median: 100, days: 90 });
  expect(flipScenario(75, avg, 20)?.upside).toBeCloseTo(19.8);
  expect(flipScenario(75, avg, 30)).toBeNull();
  expect(flipAverage(steady.slice(-53), day, 90)).toBeNull();
  expect(flipAverage(steady.slice(0, -3), day, 7)).toBeNull();
  expect(flipAverage([quote(day, 1e8, 100)], day, 7)).toBeNull();
});
it("joins archive shards and ranks an unrelated temporary dip after the farming update", () => {
  const shards = [
    shard({ OTHER: temporary.slice(0, 72) }),
    shard({ OTHER: temporary.slice(72), FARMING_NEW: steady }),
  ];
  const summary = summarizeFlips(shards, day);
  const board = flipBoard(
    [item("OTHER"), item("FARMING_NEW", 45, 43)],
    historyDayStart(day + 1),
    summary,
  );
  expect(archiveQuotes(shards, day).get("OTHER")).toHaveLength(151);
  for (const d of [7, 30, 90] as const) {
    expect(board.periods[d].map((r) => r.id)).toEqual(["OTHER"]);
    expect(board.periods[d][0]).toMatchObject({
      target: 96,
      entry: 75,
      immediate: 72,
      evidence: { hits: 3, misses: 0, incomplete: 0 },
    });
    expect(board.watchlist[d][0]).toMatchObject({
      id: "FARMING_NEW",
      discount: expect.closeTo(55),
      upside: null,
    });
  }
  expect(() => flipBoard([], historyDayStart(day + 4), summary)).toThrow(
    "awaiting",
  );
  expect(() =>
    flipBoard([], historyDayStart(day + 1), {
      ...summary,
      model: undefined,
    } as any),
  ).toThrow("awaiting");
  expect(
    flipBoard(
      [item("OTHER")],
      historyDayStart(day + 1),
      summary,
      {},
      10,
      historyDayStart(day + 1) + 18 * 60000,
    ).periods[7],
  ).toEqual([]);
});
it("walks both sides of the selected lot and withholds upside for low volume or a wide spread", () => {
  const sample = item("X");
  sample.asks = [
    { amount: 1, orders: 1, pricePerUnit: 70 },
    { amount: 90, orders: 3, pricePerUnit: 72 },
  ];
  sample.bids = [
    { amount: 3, orders: 3, pricePerUnit: 69 },
    { amount: 80, orders: 3, pricePerUnit: 68 },
  ];
  const summary = summarizeFlips([shard({ X: temporary })], day);
  const board = flipBoard([sample], historyDayStart(day + 1), summary);
  const row = [...board.periods[7], ...board.watchlist[7]][0];
  expect(row).toMatchObject(bookEconomics(71.8, 68.3));
  expect(
    flipBoard([sample], historyDayStart(day + 1), summary, {}, 1).periods[7][0]
      .entry,
  ).toBe(70);
  sample.instantSellActivity7d = 699;
  expect(
    flipBoard([sample], historyDayStart(day + 1), summary).periods[7],
  ).toEqual([]);
  expect(
    flipBoard([item("X", 75, 55)], historyDayStart(day + 1), summary)
      .watchlist[7][0].reasons,
  ).toContain("Wide spread");
});
it("records independent comparable episodes and censors missing or unfinished follow-up", () => {
  const dips = dipEpisodes(temporary, day, 7);
  expect(comparableRecoveries(dips, 25, 33)).toMatchObject({
    hits: 3,
    misses: 0,
    incomplete: 0,
  });
  expect(comparableRecoveries(dips, 55, 110)).toEqual({
    hits: 0,
    misses: 0,
    incomplete: 0,
  });
  expect(dipEpisodes(temporary, day, 7, day - 10)).toEqual([]);
  const qs = Array.from({ length: 28 }, (_, i) =>
    i < 7 ? quote(i) : quote(i, 75, 72),
  );
  expect(dipEpisodes(qs, 21, 7)).toEqual([[7, 25, expect.any(Number), "miss"]]);
  expect(dipEpisodes(qs, 20, 7)[0][3]).toBe("open");
  expect(
    followUp(
      qs.filter((q) => q[0] !== 11),
      7,
      96,
      75,
      21,
    ).outcome,
  ).toBe("open");
  expect(
    followUp([...qs.slice(0, 12), quote(14, 100, 96)], 7, 96, 75, 14).outcome,
  ).toBe("hit");
});
it.each([
  "ENCHANTED_MELON",
  "ENCHANTED_MELON_BLOCK",
  "COMPOST",
  "ENCHANTED_COMPOST",
  "SYNTHETIC_HEART",
  "CONTROL_SWITCH",
  "ELECTRON_TRANSMITTER",
  "FTX_3070",
  "ROBOTRON_REFLECTOR",
  "SUPERLITE_MOTOR",
])(
  "excludes all pre-release prices and recoveries for %s even with an older summary",
  (id) => {
    const future = Array.from({ length: 6 }, (_, i) =>
      quote(day + i + 1, 50, 48),
    );
    const source = shard({ [id]: [...temporary, ...future] });
    for (const through of [day - 1, day, day + 4]) {
      const summary = summarizeFlips([source], through);
      const b = flipBoard(
        [item(id, 30, 29)],
        historyDayStart(through + 1),
        summary,
      );
      expect(b.changedItems[0].ready).toEqual([]);
      expect(b.periods[90]).toEqual([]);
      expect(b.watchlist[90].every((r) => r.upside === null)).toBe(true);
    }
    const s = summarizeFlips([source], day + 5);
    expect(s.items[id][2]).toMatchObject({
      avg: { offer: 50, bid: 48, days: 5 },
      target: 48,
      episodes: [],
    });
    const changed = flipBoard([item(id)], historyDayStart(day + 6), s)
      .changedItems[0];
    if (id.includes("COMPOST")) {
      expect(changed.change).toMatchObject({
        ingredientId: "BOX_OF_SEEDS",
        before: 76800,
        after: 25600,
      });
      expect(changed.change.path).toEqual(
        id === "COMPOST"
          ? ["BOX_OF_SEEDS", "COMPOST"]
          : ["BOX_OF_SEEDS", "COMPOST", id],
      );
    }
    const newer = { day: day + 6, before: 50, after: 25 };
    expect(
      flipBoard([item(id)], historyDayStart(day + 6), s, {
        [changed.change.ingredientId ?? id]: newer,
      }).changedItems[0].ready,
    ).toEqual([]);
  },
);
it("dates the visitor/reforge mechanism from observed quotes and retains weak or market-wide evidence", () => {
  const pre = Array.from({ length: 14 }, (_, i) => quote(previewDay - 14 + i));
  const lows = [1, 2, 10, 14, 19].map((offset) =>
    quote(previewDay + offset, 60, 58),
  );
  const controls = [...pre, ...lows.map(([d]) => quote(d))];
  const histories = new Map([
    ["OVERGROWN_GRASS", [...pre, ...lows]],
    ["ENCHANTED_COAL", controls],
  ]);
  const effect = (d: number) => marketEffect("OVERGROWN_GRASS", histories, d);
  expect(effect(previewDay - 1)).toBeUndefined();
  expect(effect(previewDay + 2)?.cutoff).toBeUndefined();
  expect(effect(previewDay + 10)).toMatchObject({
    kind: "demand",
    onset: previewDay + 1,
    confirmedOn: previewDay + 10,
    cutoff: previewDay + 1,
  });
  histories.set("ENCHANTED_COAL", [...pre, ...lows]);
  expect(effect(releaseDay)?.cutoff).toBeUndefined();
  histories.set("OTHER", [...pre, ...lows]);
  expect(marketEffect("OTHER", histories, releaseDay)?.kind).toBe("unknown");
  expect(marketEffect("FARMING_OTHER", histories, releaseDay)).toBeUndefined();
});
it("keeps API snapshot changes in order and applies the newest dependency even when it overlaps a direct event", () => {
  const x = { id: "COMPOST", name: "Compost" };
  const first = updateCatalog([{ ...x, npc_sell_price: 20 }], {}, day);
  const removed = updateCatalog([x], first, day + 1);
  const raised = updateCatalog(
    [{ ...x, npc_sell_price: 25 }],
    removed,
    day + 2,
  );
  expect(raised.COMPOST.npcHistory).toEqual([
    { day: day + 1, before: 20, after: null },
    { day: day + 2, before: null, after: 25 },
  ]);
  expect(knownNpcChanges(day - 1)).toEqual({});
  expect(
    affectedFlipPrices(
      directFlipChanges(day + 3, {
        COMPOST: raised.COMPOST.npcChange!,
        BOX_OF_SEEDS: { day: day + 3, before: 10, after: 5 },
      }),
    ).COMPOST,
  ).toMatchObject({ day: day + 3, ingredientId: "BOX_OF_SEEDS" });
});

it("shows a sustained unexplained decline even after the next baseline has caught up", () => {
  const sequence = Array.from({ length: 10 }, (_, i) => quote(day - 16 + i));
  for (const [i, ask] of [94, 88, 82, 76, 70, 70, 70].entries())
    sequence.push(quote(day - 6 + i, ask, ask * 0.96));
  const summary = summarizeFlips([shard({ UNKNOWN_DROP: sequence })], day);
  const board = flipBoard(
    [item("UNKNOWN_DROP", 71, 69)],
    historyDayStart(day + 1),
    summary,
  );
  expect(board.breaks).toContainEqual(
    expect.objectContaining({
      id: "UNKNOWN_DROP",
      effect: expect.objectContaining({ kind: "unknown", onset: day - 3 }),
    }),
  );
  expect(board.periods[7]).toEqual([]);
});

it("keeps incomplete episodes out of the resolved recovery score", () => {
  const points = temporary.map((q) =>
    q[0] >= day - 1 ? quote(q[0], 75, 72) : q,
  );
  const board = flipBoard(
    [item("X")],
    historyDayStart(day + 1),
    summarizeFlips([shard({ X: points })], day),
  );
  const row = [...board.periods[90], ...board.watchlist[90]][0];
  expect(row.evidence).toMatchObject({ hits: 3, misses: 0, incomplete: 1 });
  expect(row.evidence.episodes?.at(-1)).toEqual([
    day - 1,
    expect.any(Number),
    expect.any(Number),
    "open",
  ]);
  expect(row.score).toBe(3 / 5);
});
