import type { CloudPriceTuple, HistoryShard } from "./cloud-price-history";
import type { BazaarItem } from "../shared/companion/types";
import { executeDepth } from "../shared/companion/bazaar";
import {
  archiveLookback,
  bookEconomics,
  comparableRecoveries,
  compareFlips,
  conservativeBid,
  dipEpisodes,
  quantile,
  flipAverage,
  flipLot,
  flipPeriods,
  flipVersion,
  supportedQuotes,
  type DailyQuote,
  type Episode,
  type FlipAverage,
  type FlipBoard,
  type FlipRow,
} from "../shared/flips";
import { bazaarTax } from "../shared/companion/fees";
import {
  previewDay,
  releaseDay,
  type MarketEffect,
} from "../shared/flip-updates";
import { historyDay } from "../shared/daily-price-history";
import { trendLiquidity } from "../shared/trending";
import { isFresh } from "../shared/market";
import { liquidMarket } from "./trending";
import type { NpcChanges } from "./npc-prices";
import { affectedFlipPrices, directFlipChanges } from "./flip-price-changes";
import { fallingBids, marketEffect } from "./flip-effects";

type PeriodEvidence = {
  avg: FlipAverage;
  target: number | null;
  episodes: Episode[];
};
export type FlipBaselines = {
  version: 1;
  model: 4;
  throughDay: number;
  npcChanges: NpcChanges;
  cutoffDays: Record<string, number>;
  effects: Record<string, MarketEffect>;
  falling: string[];
  sparse: Record<string, (number | null)[]>;
  items: Record<string, (PeriodEvidence | null)[]>;
};

export function archiveQuotes(shards: HistoryShard[], through: number) {
  const histories = new Map<string, DailyQuote[]>();
  for (const shard of shards)
    for (const [id, points] of Object.entries(shard.items)) {
      const recent = points
        .filter(([d]) => d <= through && d > through - archiveLookback)
        .map(([d, , a, b]: CloudPriceTuple): DailyQuote => [d, a, b]);
      if (recent.length)
        histories.set(id, (histories.get(id) ?? []).concat(recent));
    }
  for (const points of histories.values()) points.sort((a, b) => a[0] - b[0]);
  return histories;
}
export function summarizeFlips(
  shards: HistoryShard[],
  throughDay: number,
  catalogChanges: NpcChanges = {},
): FlipBaselines {
  const npcChanges = directFlipChanges(throughDay, catalogChanges);
  const changes = affectedFlipPrices(npcChanges);
  const summary: FlipBaselines = {
    version: 1,
    model: flipVersion,
    throughDay,
    npcChanges,
    cutoffDays: {},
    effects: {},
    falling: [],
    sparse: {},
    items: {},
  };
  const histories = archiveQuotes(shards, throughDay);
  for (const [id, points] of histories) {
    const effect = marketEffect(id, histories, throughDay, changes[id]?.day);
    if (effect) summary.effects[id] = effect;
    const cutoff = Math.max(
      effect?.cutoff ?? -Infinity,
      changes[id]?.day ?? -Infinity,
    );
    if (Number.isFinite(cutoff)) summary.cutoffDays[id] = cutoff;
    if (fallingBids(points, throughDay, cutoff)) summary.falling.push(id);
    const averages = flipPeriods.map((days) => {
      const avg = flipAverage(points, throughDay, days, { day: cutoff });
      if (!avg) return null;
      return {
        avg,
        target: conservativeBid(points, throughDay, days, cutoff),
        episodes: dipEpisodes(points, throughDay, days, cutoff),
      };
    });
    if (averages.some((a) => !a)) {
      const indicative = flipPeriods.map((days, i) => {
        const asks = points
          .filter(
            ([d, a, b]) =>
              d > Math.max(throughDay - days, cutoff) && supportedQuotes(a, b),
          )
          .map((q) => q[1]!);
        return !averages[i] && asks.length >= 2 ? quantile(asks, 0.5) : null;
      });
      if (indicative.some(Boolean)) summary.sparse[id] = indicative;
    }
    if (averages.some(Boolean)) summary.items[id] = averages;
  }
  return summary;
}
export function flipBoard(
  items: BazaarItem[],
  at: number,
  baselines: FlipBaselines,
  catalogChanges: NpcChanges = {},
  lot = flipLot,
  now = at,
  marketError = false,
): FlipBoard {
  const books = items.map((item) => ({
    id: item.id,
    name: item.name,
    entry: executeDepth(item.asks, lot)?.unit,
    immediate: executeDepth(item.bids, lot)?.unit,
    liquid: liquidMarket(item),
    buyVolume: item.instantBuyActivity7d ?? 0,
    sellVolume: item.instantSellActivity7d ?? 0,
  }));
  return screenFlipQuotes(
    books,
    at,
    baselines,
    catalogChanges,
    lot,
    now,
    marketError,
  );
}
export type FlipBook = {
  id: string;
  name: string;
  entry?: number;
  immediate?: number;
  liquid: boolean;
  buyVolume: number;
  sellVolume: number;
};
export function screenFlipQuotes(
  items: FlipBook[],
  at: number,
  baselines: FlipBaselines,
  catalogChanges: NpcChanges,
  lot: number,
  now: number,
  marketError: boolean,
): FlipBoard {
  const age = historyDay(now) - baselines.throughDay;
  if (age < 1 || age > 3 || baselines.model !== flipVersion)
    throw Error("Update-aware history is awaiting the next daily archive.");
  const stale = marketError || !isFresh(at, now);
  const board: FlipBoard = {
    version: flipVersion,
    at,
    lot,
    stale,
    throughDay: baselines.throughDay,
    periods: { 7: [], 30: [], 90: [] },
    watchlist: { 7: [], 30: [], 90: [] },
    changedItems: [],
    breaks: [],
  };
  const changes = affectedFlipPrices(
    directFlipChanges(historyDay(now), baselines.npcChanges, catalogChanges),
  );
  const falling = new Set(baselines.falling);
  const names = new Map(items.map((item) => [item.id, item.name]));
  for (const item of items) {
    const id = item.id,
      averages = baselines.items[id];
    const current = changes[id];
    const change = current?.ingredientId
      ? { ...current, ingredientName: names.get(current.ingredientId) }
      : current;
    const applied = baselines.cutoffDays[id];
    const effect =
      baselines.effects[id] ??
      (id === "OVERGROWN_GRASS" &&
      historyDay(now) >= previewDay &&
      historyDay(now) <= releaseDay + 90
        ? { kind: "demand" as const, observations: 0 }
        : undefined);
    const cutoff = Math.max(applied ?? -Infinity, change?.day ?? -Infinity);
    const consistent = !change || (applied ?? -Infinity) >= change.day;
    const ready = flipPeriods.filter(
      (_, i) => consistent && averages?.[i]?.avg,
    );
    if (change && change.day > baselines.throughDay - 90)
      board.changedItems.push({ id, name: item.name, change, cutoff, ready });
    if (
      effect?.kind === "unknown" &&
      effect.onset !== undefined &&
      effect.onset > baselines.throughDay - 90 &&
      (!change || effect.onset > change.day)
    )
      board.breaks.push({ id, name: item.name, effect, ready });
    const { entry, immediate, liquid } = item;
    if (!entry || !immediate || immediate >= entry) continue;
    const economics = bookEconomics(entry, immediate);

    for (const [i, days] of flipPeriods.entries()) {
      const data = ready.includes(days) ? averages[i] : null;
      const avg = data?.avg ?? null,
        target = data?.target ?? null;
      const discount = avg ? (1 - entry / avg.offer) * 100 : null;
      const sparseRef = consistent ? baselines.sparse[id]?.[i] : null;
      const indicativeDiscount = sparseRef
        ? (1 - entry / sparseRef) * 100
        : null;
      if (
        (!avg || discount! < 5 || entry >= avg.median) &&
        effect?.kind !== "demand" &&
        (indicativeDiscount ?? 0) < 5
      )
        continue;
      const rise = target === null ? null : (target / immediate - 1) * 100;
      const evidence = comparableRecoveries(
        data?.episodes ?? [],
        discount ?? 0,
        rise ?? 0,
      );
      const reasons: string[] = [];
      if (stale) reasons.push("Market snapshot is stale");
      if (!avg || !target)
        reasons.push(
          effect?.kind === "unknown" && effect.cutoff === cutoff
            ? "Sparse history after the price break"
            : Number.isFinite(cutoff)
              ? "Waiting for post-update history"
              : "Sparse usable bid history",
        );
      if (!liquid || !supportedQuotes(entry, immediate))
        reasons.push(
          economics.spread > trendLiquidity.maxSpreadPct
            ? "Wide spread"
            : "Insufficient near-book depth or weekly activity",
        );
      else if (economics.spread > 10) reasons.push("Wide spread");
      if (effect?.kind === "demand" && effect.cutoff === undefined)
        reasons.push("Uncertain farming demand effect");
      if (falling.has(id)) reasons.push("Daily bids are still falling");
      const net = target === null ? null : target - bazaarTax(target) - entry;
      if (net !== null && net <= 0)
        reasons.push("Recent bids are below break-even");
      if (discount !== null && (discount < 5 || entry >= avg!.median))
        reasons.push("Entry is near the active baseline");
      const resolved = evidence.hits + evidence.misses,
        total = resolved + evidence.incomplete;
      if (target && (resolved < 3 || resolved < 0.75 * total))
        reasons.push("Too few comparable recoveries with follow-up");
      else if (target && evidence.hits < (2 * resolved) / 3)
        reasons.push("Too few dips reached the exit");
      const row: FlipRow = {
        id,
        name: item.name,
        ...economics,
        target,
        rise,
        discount: discount ?? indicativeDiscount,
        avg,
        evidence,
        reasons,
        score: resolved ? evidence.hits / (resolved + 2) : 0,
        upside: reasons.length ? null : net,
        buyVolume: item.buyVolume,
        sellVolume: item.sellVolume,
        npcChange: change,
        effect,
        cutoff: Number.isFinite(cutoff) ? cutoff : undefined,
      };
      (reasons.length ? board.watchlist : board.periods)[days].push(row);
    }
  }
  for (const days of flipPeriods) {
    board.periods[days].sort(compareFlips);
    // Keep actionable rows through client-side filtering; watch cards are bounded.
    const watch = board.watchlist[days];
    watch.sort(
      (a, b) =>
        Number(b.effect?.kind === "demand") -
          Number(a.effect?.kind === "demand") ||
        Number(!!b.target && b.target > b.breakEven) -
          Number(!!a.target && a.target > a.breakEven) ||
        a.reasons.length - b.reasons.length ||
        b.score - a.score ||
        (b.discount ?? 0) - (a.discount ?? 0) ||
        a.id.localeCompare(b.id),
    );
    watch.splice(60);
  }
  board.changedItems.sort(
    (a, b) => b.change.day - a.change.day || a.name.localeCompare(b.name),
  );
  board.breaks.sort(
    (a, b) => b.effect.onset! - a.effect.onset! || a.name.localeCompare(b.name),
  );
  return board;
}
