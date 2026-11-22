import type { BazaarItem } from "../shared/companion/types";
import { PAID_PILOT_INTERVAL } from "../shared/paid-pilot";
import { trendHours, trendLimit, trendLiquidity, type TrendBoard, type TrendRow } from "../shared/trending";
import type { Snapshot } from "./engine";
import { decodeInlineSnapshot, encodeInlineSnapshot } from "./inline-snapshot";

type Quotes = [id: string, offer: number | null, bid: number | null][];
type Sample = { slot: number; at: number; quotes: Quotes };
type Market = Snapshot<{ items: BazaarItem[]; raw: { products: Record<string, unknown> } }>;

import { supportedQuotes } from "../shared/flips";

function hasDepth(levels: BazaarItem["asks"], side: "ask" | "bid") {
  const best = levels[0].pricePerUnit;
  const limit = best * (1 + (side === "ask" ? 1 : -1) * trendLiquidity.nearPricePct / 100);
  let units = 0, orders = 0;
  for (const level of levels) {
    if (side === "ask" ? level.pricePerUnit > limit : level.pricePerUnit < limit) break;
    units += level.amount;
    orders += level.orders;
    if (units >= trendLiquidity.unitsPerSide && orders >= trendLiquidity.ordersPerSide) return true;
  }
  return false;
}

export function liquidMarket(item: BazaarItem) {
  return supportedQuotes(item.asks[0]?.pricePerUnit ?? null, item.bids[0]?.pricePerUnit ?? null) &&
    (item.instantBuyActivity7d ?? 0) >= trendLiquidity.weeklyUnitsPerSide &&
    (item.instantSellActivity7d ?? 0) >= trendLiquidity.weeklyUnitsPerSide &&
    hasDepth(item.asks, "ask") && hasDepth(item.bids, "bid");
}

// Keep both endpoints of a 24-hour comparison. Slot stamps distinguish an
// overwritten position from a missed collection in the current rotation.
export const trendSampleKey = (slot: number) => "trend-slot-" + (slot % 97);

export async function trendPublication(market: Market, read: (keys: string[]) => Promise<(string | undefined)[]>) {
  const slot = Math.floor(market.observedAt / PAID_PILOT_INTERVAL);
  const items = new Map(market.data.items.map(item => [item.id, item]));
  const quotes: Quotes = Object.keys(market.data.raw.products).map(id => {
    const item = items.get(id);
    return [id, item?.asks[0]?.pricePerUnit ?? null, item?.bids[0]?.pricePerUnit ?? null];
  });
  const sample: Sample = { slot, at: market.upstreamAt, quotes };
  const baselines = await read(trendHours.map(hours => trendSampleKey(slot - hours * 4)));
  const board: TrendBoard = { version: 2, at: sample.at, items: quotes.length, windows: [] };
  const liquid = market.data.items.filter(liquidMarket);
  for (const [index, hours] of trendHours.entries()) {
    const packed = baselines[index];
    const prior: Sample | null = packed ? JSON.parse(decodeInlineSnapshot("trend-sample", packed)) : null;
    const window = { hours, baselineAt: null as number | null, gainers: 0, rows: [] as TrendRow[] };
    board.windows.push(window);
    if (!prior || prior.slot !== slot - hours * 4 ||
        Math.abs(sample.at - prior.at - hours * 3_600_000) > 5 * 60_000) continue;
    window.baselineAt = prior.at;
    const previous = new Map(prior.quotes.map(([id, offer, bid]) => [id, { offer, bid }]));
    for (const item of liquid) {
      const old = previous.get(item.id);
      const offer = item.asks[0].pricePerUnit, bid = item.bids[0].pricePerUnit;
      if (!old?.offer || !old.bid || offer <= old.offer || !supportedQuotes(old.offer, old.bid)) continue;
      window.rows.push({ id: item.id, name: item.name, offerBefore: old.offer, offer,
        offerChange: (offer / old.offer - 1) * 100,
        bidChange: (bid / old.bid - 1) * 100,
        buyActivity7d: item.instantBuyActivity7d!, sellActivity7d: item.instantSellActivity7d! });
    }
    window.rows.sort((a, b) => b.offerChange - a.offerChange || a.id.localeCompare(b.id));
    window.gainers = window.rows.length;
    window.rows = window.rows.slice(0, trendLimit);
  }
  return [
    { key: trendSampleKey(slot), value: encodeInlineSnapshot("trend-sample", JSON.stringify(sample)) },
    { key: "trending", value: encodeInlineSnapshot("trending", JSON.stringify(board)) },
  ];
}
