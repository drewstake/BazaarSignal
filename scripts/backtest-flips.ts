// Offline paired replay. Pass a gzipped JSON array of HistoryShard documents,
// then optional timestamped BazaarSignal book snapshots (JSON or JSON.gz).
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  flipBoard,
  screenFlipQuotes,
  summarizeFlips,
  type FlipBook,
} from "../collector/flips";
import {
  affectedFlipPrices,
  directFlipChanges,
} from "../collector/flip-price-changes";
import type { HistoryShard } from "../collector/cloud-price-history";
import {
  flipAverage,
  flipLot,
  flipPeriods,
  flipScenario,
  followUp,
  supportedQuotes,
  quantile,
  bookEconomics,
  type DailyQuote,
  type FlipPeriod,
} from "../shared/flips";
import {
  historyDay,
  historyDayLabel,
  historyDayStart,
} from "../shared/daily-price-history";
import type { BazaarItem } from "../shared/companion/types";
import { executeDepth } from "../shared/companion/bazaar";
import { liquidMarket } from "../collector/trending";
import { previewDay, releaseDay } from "../shared/flip-updates";
import seed from "../docs/measurements/cloud-price-history-deployment.json";

const [archive, ...inputs] = process.argv.slice(2);
const catalogFile = inputs.find((f) => f.startsWith("--catalog="))?.slice(10);
const files = inputs.filter((f) => !f.startsWith("--catalog="));
function load(file: string) {
  const bytes = readFileSync(file);
  return JSON.parse(
    (file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString(),
  );
}
const shards: HistoryShard[] = load(archive);
const catalog: import("../collector/npc-prices").Catalog = catalogFile
  ? load(catalogFile).data
  : {};
function snapshotChanges(day: number) {
  const changes: import("../collector/npc-prices").NpcChanges = {};
  for (const [id, item] of Object.entries(catalog)) {
    const history = item.npcHistory ?? (item.npcChange ? [item.npcChange] : []);
    for (const c of history)
      if (c.day <= day && (!changes[id] || c.day >= changes[id].day))
        changes[id] = c;
  }
  return changes;
}
const quotes = new Map<string, DailyQuote[]>(),
  byDay = new Map<number, FlipBook[]>();
for (const shard of shards)
  for (const [id, rows] of Object.entries(shard.items)) {
    const series = quotes.get(id) ?? [];
    for (const [d, , ask, bid] of rows) {
      series.push([d, ask, bid]);
      if (!supportedQuotes(ask, bid)) continue;
      const items = byDay.get(d) ?? [];
      // Quote-only sensitivity study. Depth and volume were never archived.
      items.push({
        id,
        name: id,
        entry: ask!,
        immediate: bid!,
        liquid: true,
        buyVolume: 0,
        sellVolume: 0,
      });
      byDay.set(d, items);
    }
    quotes.set(id, series);
  }
for (const q of quotes.values()) q.sort((a, b) => a[0] - b[0]);
const last = Math.max(...byDay.keys());
const first = historyDay(Date.parse(seed.seed.at)) + 1;
const minimum = 15;
const historicalLots = new Map<number, { at: number; books: FlipBook[] }>();
for (const shard of shards)
  for (const [id, observations] of Object.entries(shard.lots ?? {})) {
    for (const [day, at, entry, immediate, liquid] of observations) {
      if (
        day < first ||
        !shard.items[id]?.some((q) => q[0] === day && q[1] === at)
      )
        continue;
      const sample = historicalLots.get(day) ?? { at, books: [] };
      if (sample.at !== at) continue;
      sample.books.push({
        id,
        name: id,
        entry,
        immediate,
        liquid: !!liquid,
        buyVolume: 0,
        sellVolume: 0,
      });
      historicalLots.set(day, sample);
    }
  }
type Pick = {
  id: string;
  entry: number;
  immediate: number;
  target: number;
  discount: number;
};
type Result = {
  date: string;
  id: string;
  entry: number;
  target: number;
  outcome: string;
  observed: number;
  downside: number;
};
function metrics(results: Result[], sessions: number) {
  const measured = results.filter((r) => r.outcome !== "open");
  return {
    evaluated: sessions,
    abstained: sessions - results.length,
    picks: results.length,
    reached: measured.filter((r) => r.outcome === "hit").length,
    missed: measured.filter((r) => r.outcome === "miss").length,
    incomplete: results.length - measured.length,
    meanObservedDays: results.length
      ? results.reduce((s, r) => s + r.observed, 0) / results.length
      : null,
    medianWorstQuotedNetPct: results.length
      ? quantile(
          results.map((r) => r.downside),
          0.5,
        )
      : null,
    worstQuotedNetPct: results.length
      ? Math.min(...results.map((r) => r.downside))
      : null,
    results,
  };
}
function study(
  sessions: { at: number; books: FlipBook[]; items?: BazaarItem[] }[],
  depth = false,
) {
  const depthSeries = new Map<string, DailyQuote[]>();
  if (depth)
    for (const s of sessions)
      for (const b of s.books) {
        if (!b.entry || !b.immediate) continue;
        const series = depthSeries.get(b.id) ?? [];
        series.push([historyDay(s.at), b.entry, b.immediate]);
        depthSeries.set(b.id, series);
      }
  const rows = Object.fromEntries(
    flipPeriods.map((d) => [
      d,
      { legacy: [] as Result[], current: [] as Result[] },
    ]),
  ) as Record<FlipPeriod, { legacy: Result[]; current: Result[] }>;
  for (const { at, books, items } of sessions) {
    const day = historyDay(at);
    const catalogChanges = snapshotChanges(day);
    const summary = summarizeFlips(shards, day - 1, snapshotChanges(day - 1));
    const board = items
      ? flipBoard(items, at, summary, catalogChanges)
      : screenFlipQuotes(
          books,
          at,
          summary,
          catalogChanges,
          flipLot,
          at,
          false,
        );
    const changes = affectedFlipPrices(directFlipChanges(day, catalogChanges));
    for (const days of flipPeriods) {
      let legacy: Pick | undefined;
      for (const { id, entry, immediate, liquid } of books) {
        if (!liquid || !entry || !immediate) continue;
        const avg = flipAverage(
          quotes.get(id) ?? [],
          day - 1,
          days,
          changes[id],
        );
        const scenario = avg && flipScenario(entry, avg, minimum);
        if (
          scenario &&
          (!legacy ||
            scenario.discount > legacy.discount ||
            (scenario.discount === legacy.discount && id < legacy.id))
        )
          legacy = {
            id,
            entry,
            immediate,
            target: avg!.bid,
            discount: scenario.discount,
          };
      }
      const current = board.periods[days].find(
        (r) => r.discount !== null && r.discount >= minimum,
      );
      for (const method of ["legacy", "current"] as const) {
        const p = method === "legacy" ? legacy : current;
        if (!p || p.target === null) continue;
        const history = (depth ? depthSeries : quotes).get(p.id) ?? [];
        const f = followUp(
          history,
          day,
          p.target,
          p.entry,
          depth ? historyDay(sessions.at(-1)!.at) : last,
        );
        rows[days][method].push({
          date: historyDayLabel(day),
          id: p.id,
          entry: p.entry,
          target: p.target,
          ...f,
          downside: Math.min(
            f.downside,
            (-100 * bookEconomics(p.entry, p.immediate).loss) / p.entry,
          ),
        });
      }
    }
  }
  return Object.fromEntries(
    flipPeriods.map((d) => [
      d,
      {
        legacy: metrics(rows[d].legacy, sessions.length),
        current: metrics(rows[d].current, sessions.length),
      },
    ]),
  );
}
const snapshots = new Map<
  number,
  { at: number; items?: BazaarItem[]; books: FlipBook[] }
>(historicalLots);
for (const file of files) {
  const doc = load(file),
    items: BazaarItem[] = doc.data?.items ?? doc.items;
  const at = items[0].upstreamAt,
    day = historyDay(at);
  if (day < first || (snapshots.get(day)?.at ?? Infinity) <= at) continue;
  const books = items.map((i) => ({
    id: i.id,
    name: i.name,
    entry: executeDepth(i.asks, flipLot)?.unit,
    immediate: executeDepth(i.bids, flipLot)?.unit,
    liquid: liquidMarket(i),
    buyVolume: i.instantBuyActivity7d ?? 0,
    sellVolume: i.instantSellActivity7d ?? 0,
  }));
  snapshots.set(day, { at, items, books });
}
const sessions = [...byDay]
  .filter(
    ([d]) => d >= first && d <= last && d !== previewDay && d !== releaseDay,
  )
  .sort(([a], [b]) => a - b)
  .map(([d, books]) => ({ at: historyDayStart(d + 1) - 1, books }));
console.log(
  JSON.stringify(
    {
      from: historyDayLabel(first),
      through: historyDayLabel(last),
      lot: flipLot,
      minimum,
      holdingDays: 14,
      taxPct: 1.25,
      calendarDays: last - first + 1,
      missingQuoteDates: Array.from(
        { length: last - first + 1 },
        (_, i) => first + i,
      )
        .filter((d) => !byDay.has(d))
        .map(historyDayLabel),
      dateOnlyEventsOmitted: [previewDay, releaseDay].map(historyDayLabel),
      savedBookTimes: [...snapshots.values()].map((s) =>
        new Date(s.at).toISOString(),
      ),
      depthMatched: study(
        [...snapshots.values()].sort((a, b) => a.at - b.at),
        true,
      ),
      quoteProxy: study(sessions),
    },
    null,
    2,
  ),
);
