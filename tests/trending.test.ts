import { expect, it } from "vitest";
import { decodeInlineSnapshot } from "../collector/inline-snapshot";
import { trendPublication, trendSampleKey } from "../collector/trending";
import { trialGoogleStore } from "../collector/trial-google";
import { PAID_PILOT_INTERVAL } from "../shared/paid-pilot";
import { paidRuntimeFixture, snapshotFixture } from "./support/paid-runtime-fixture";

it("publishes the full price ring and serves all three ranked views from the saved board", async () => {
  const start = Date.UTC(2026, 10, 17, 5);
  const f = paidRuntimeFixture(snapshotFixture("initial", start, 4), false, true);
  const store = trialGoogleStore({ ...f.f.config, inlineSmallSnapshots: true, recordTrends: true });
  async function publish(hour: number, price: number) {
    const at = start + hour * 3_600_000;
    f.setNow(at);
    const snapshot = JSON.parse(snapshotFixture(String(at), at, 4));
    const [eye, smaller, down, empty] = snapshot.data.items;
    for (const item of snapshot.data.items) {
      item.instantBuyActivity7d = 700;
      item.instantSellActivity7d = 800;
    }
    eye.asks = [{ pricePerUnit: price, amount: 10, orders: 3 }];
    eye.bids = [{ pricePerUnit: price * 0.9, amount: 10, orders: 3 }];
    smaller.asks[0].pricePerUnit = 100 + hour;
    smaller.bids = [];
    down.asks[0].pricePerUnit = 200 - hour;
    empty.asks = [];
    const before = JSON.stringify({ lease: { until: at + 10000 } });
    f.f.seed("control", before);
    expect(await store.commit("control", before, "{}", { key: "bazaar", value: JSON.stringify(snapshot) })).toBe(true);
    const api = await f.request("/api/companion/trending");
    expect(api.status).toBe(200);
    return api.body.board;
  }
  const initial = await publish(0, 100);
  expect(initial.windows.map((w: any) => w.baselineAt)).toEqual([null, null, null]);
  await publish(18, 140);
  await publish(23, 160);
  const board = await publish(24, 200);
  expect(board.items).toBe(4);
  for (const [i, previous] of [160, 140, 100].entries()) {
    const w = board.windows[i];
    expect(w.rows.map((r: any) => r.id)).toEqual(["ITEM_0"]);
    expect(w.rows[0].offerBefore).toBe(previous);
    expect(w.rows[0].offerChange).toBeCloseTo((200 / previous - 1) * 100);
    expect(w.rows[0].bidChange).toBeCloseTo((200 / previous - 1) * 100);
    expect(w.rows[0]).toMatchObject({buyActivity7d: 700, sellActivity7d: 800});
  }
  const key = trendSampleKey(Math.floor(start / PAID_PILOT_INTERVAL) + 96);
  const sample = JSON.parse(decodeInlineSnapshot("trend-sample", f.f.read(key)!));
  expect(sample.quotes).toContainEqual(["ITEM_3", null, 103]);
  // The modulo addresses still exist, but now refer to the previous rotation.
  const late = await publish(24 + 97 / 4, 250);
  expect(late.windows.every((w: any) => w.baselineAt === null)).toBe(true);
  expect(f.metrics.upstreamCalls).toBe(0);
  expect(f.metrics.shutdowns).toBe(0);
});

it("removes thin books before ranking, including high activity with distant orders", async () => {
  const base = Date.UTC(2026, 10, 17, 5);
  const market = JSON.parse(snapshotFixture("base", base, 65));
  for (const item of market.data.items) {
    item.instantBuyActivity7d = 700;
    item.instantSellActivity7d = 700;
    item.asks = [{ pricePerUnit: 100, amount: 10, orders: 3 }];
    item.bids = [{ pricePerUnit: 96, amount: 10, orders: 3 }];
  }
  market.data.items[0].bids = [];
  market.data.items[1].bids[0].pricePerUnit = 5;
  const [baseline] = await trendPublication(market, async () => []);
  market.observedAt = market.upstreamAt = base + 3600000;
  for (const [index,item] of market.data.items.entries()) {
    item.asks[0].pricePerUnit = index === 64 ? 102 : 110;
    item.bids = [{pricePerUnit: 95, amount: 10, orders: 3}];
    if (index > 8 && index < 64) item.instantBuyActivity7d = 10;
  }
  const items = market.data.items;
  items[2].bids = [];
  items[3].instantSellActivity7d = null;
  items[4].instantBuyActivity7d = 699;
  items[5].bids[0].pricePerUnit = 1;
  items[6].asks = [{pricePerUnit: 110, amount: 1, orders: 1}, {pricePerUnit: 125, amount: 500, orders: 20}];
  items[7].bids[0].amount = 9;
  items[8].bids[0].orders = 2;
  const [sample, board] = await trendPublication(market, async () => [baseline.value]);
  expect(JSON.parse(decodeInlineSnapshot("trend-sample", sample.value)).quotes).toHaveLength(65);
  const w = JSON.parse(decodeInlineSnapshot("trending",board.value)).windows[0];
  expect(w.gainers).toBe(1);
  expect(w.rows[0].id).toBe("ITEM_64");
  expect(w.rows[0].bidChange).toBeLessThan(0);
});
