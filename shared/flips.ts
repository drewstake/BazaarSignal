import { trendLiquidity } from "./trending";
import { bazaarTax, DEFAULT_BAZAAR_TAX } from "./companion/fees";
import type { MarketEffect } from "./flip-updates";

export const flipPeriods = [7, 30, 90] as const;
export type FlipPeriod = (typeof flipPeriods)[number];
export const flipLot = 10;
export const flipLots = [1, 10, 64];
export const recoveryDays = 14;
export const evidenceDays = 150;
export const archiveLookback = evidenceDays + 90;
export const flipVersion = 4;
export type DailyQuote = [
  day: number,
  offer: number | null,
  bid: number | null,
];
export type NpcPriceChange = {
  day: number;
  before: number | null;
  after: number | null;
};
export type FlipPriceChange = NpcPriceChange & {
  ingredientId?: string;
  ingredientName?: string;
  path?: string[];
};
export type ChangedFlipItem = {
  id: string;
  name: string;
  change: FlipPriceChange;
  cutoff?: number;
  ready: FlipPeriod[];
};
export type FlipAverage = {
  offer: number;
  bid: number;
  median: number;
  days: number;
};
export type RecoveryCounts = {
  hits: number;
  misses: number;
  incomplete: number;
};
export type Episode = [
  day: number,
  discount: number,
  bidRise: number,
  outcome: "hit" | "miss" | "open",
];
export type FlipRow = {
  id: string;
  name: string;
  entry: number;
  immediate: number;
  spread: number;
  tax: number;
  breakEven: number;
  loss: number;
  buyVolume: number;
  sellVolume: number;
  target: number | null;
  rise: number | null;
  discount: number | null;
  upside: number | null;
  avg: FlipAverage | null;
  evidence: RecoveryCounts & { episodes?: Episode[] };
  reasons: string[];
  npcChange?: FlipPriceChange;
  effect?: MarketEffect;
  cutoff?: number;
  score: number;
};
export type FlipBoard = {
  version: 4;
  at: number;
  throughDay: number;
  lot: number;
  stale: boolean;
  periods: Record<FlipPeriod, FlipRow[]>;
  watchlist: Record<FlipPeriod, FlipRow[]>;
  changedItems: ChangedFlipItem[];
  breaks: {
    id: string;
    name: string;
    effect: MarketEffect;
    ready: FlipPeriod[];
  }[];
};

export function supportedQuotes(offer: number | null, bid: number | null) {
  return (
    offer !== null &&
    bid !== null &&
    Number.isFinite(offer) &&
    Number.isFinite(bid) &&
    bid > 0 &&
    bid < offer &&
    bid >= offer * (1 - trendLiquidity.maxSpreadPct / 100)
  );
}
export function quantile(values: number[], fraction: number) {
  const sorted = values.slice().sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  return (
    sorted[Math.floor(index)] +
    (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index % 1)
  );
}
type Cutoff = { day: number };
export function flipAverage(
  points: DailyQuote[],
  through: number,
  days: FlipPeriod,
  change?: Cutoff,
): FlipAverage | null {
  const after = Math.max(through - days, change?.day ?? -Infinity);
  const quotes = points.filter(
    ([day, ask, bid]) =>
      day > after && day <= through && supportedQuotes(ask, bid),
  );
  if (
    quotes.length < Math.max(5, Math.ceil((through - after) * 0.6)) ||
    quotes.at(-1)![0] < through - 2
  )
    return null;
  return {
    offer: quotes.reduce((sum, q) => sum + q[1]!, 0) / quotes.length,
    bid: quotes.reduce((sum, q) => sum + q[2]!, 0) / quotes.length,
    median: quantile(
      quotes.map((q) => q[1]!),
      0.5,
    ),
    days: quotes.length,
  };
}

// Used by the original discount strategy in the paired replay.
export function flipScenario(entry: number, avg: FlipAverage, minimum: number) {
  const discount = (1 - entry / avg.offer) * 100;
  const upside = avg.bid - bazaarTax(avg.bid) - entry;
  return discount >= minimum && entry < avg.median && upside > 0
    ? { discount, upside }
    : null;
}

export function conservativeBid(
  points: DailyQuote[],
  through: number,
  days: FlipPeriod,
  cutoff = -Infinity,
) {
  const quotes = points.filter(
    ([d, a, b]) =>
      d > Math.max(through - Math.min(days, 14), cutoff) &&
      d <= through &&
      supportedQuotes(a, b),
  );
  if (quotes.length < 5 || quotes.at(-1)![0] < through - 2) return null;
  return quantile(
    quotes.map((q) => q[2]!),
    0.25,
  );
}

// A miss needs all 14 daily observations. Early hits are observable even when
// the rest of the holding window is missing. Censor downside at the first hit.
export function followUp(
  points: DailyQuote[],
  day: number,
  target: number,
  entry: number,
  through: number,
) {
  let observed = 0,
    downside = 0;
  for (const [date, ask, bid] of points) {
    if (
      date <= day ||
      date > day + recoveryDays ||
      date > through ||
      !supportedQuotes(ask, bid)
    )
      continue;
    observed++;
    downside = Math.min(downside, ((bid! - bazaarTax(bid!)) / entry - 1) * 100);
    if (bid! >= target) return { outcome: "hit" as const, observed, downside };
  }
  return {
    outcome: observed === recoveryDays ? ("miss" as const) : ("open" as const),
    observed,
    downside,
  };
}
export function dipEpisodes(
  points: DailyQuote[],
  through: number,
  days: FlipPeriod,
  cutoff = -Infinity,
): Episode[] {
  const quotes = points.filter(
    (q) => q[0] > cutoff && q[0] <= through && supportedQuotes(q[1], q[2]),
  );
  const episodes: Episode[] = [];
  let nextDay = -Infinity,
    priorTarget = 0;
  for (let i = 0; i < quotes.length; i++) {
    const [day, ask, bid] = quotes[i];
    if (bid! >= priorTarget) priorTarget = 0;
    if (day <= through - evidenceDays || day < nextDay || priorTarget) continue;
    const prior = quotes.slice(Math.max(0, i - days), i);
    const avg = flipAverage(prior, day - 1, days, { day: cutoff });
    if (!avg || ask! >= avg.median || ask! > 0.95 * avg.offer) continue;
    const target = conservativeBid(prior, day - 1, days, cutoff);
    if (!target || target - bazaarTax(target) <= ask!) continue;
    const outcome = followUp(
      quotes.slice(i + 1, i + 1 + recoveryDays),
      day,
      target,
      ask!,
      through,
    ).outcome;
    episodes.push([
      day,
      (1 - ask! / avg.offer) * 100,
      (target / bid! - 1) * 100,
      outcome,
    ]);
    nextDay = day + recoveryDays + 1;
    priorTarget = target;
  }
  return episodes;
}
export function comparableRecoveries(
  episodes: Episode[],
  discount: number,
  rise: number,
): RecoveryCounts & { episodes?: Episode[] } {
  const matched: Episode[] = [];
  let hits = 0,
    misses = 0,
    incomplete = 0;
  for (const episode of episodes) {
    const [, dip, climb, outcome] = episode;
    if (
      Math.abs(dip - discount) > Math.max(5, discount * 0.25) ||
      Math.abs(climb - rise) > Math.max(5, rise * 0.25)
    )
      continue;
    matched.push(episode);
    if (outcome === "hit") hits++;
    else if (outcome === "miss") misses++;
    else incomplete++;
  }
  return {
    hits,
    misses,
    incomplete,
    ...(matched.length && { episodes: matched }),
  };
}
export function bookEconomics(entry: number, immediate: number) {
  const tax = bazaarTax(immediate);
  return {
    entry,
    immediate,
    tax,
    spread: (1 - immediate / entry) * 100,
    breakEven: entry / (1 - DEFAULT_BAZAAR_TAX / 100),
    loss: entry - immediate + tax,
  };
}
export function compareFlips(a: FlipRow, b: FlipRow) {
  return (
    b.score - a.score ||
    (b.upside ?? 0) / b.entry - (a.upside ?? 0) / a.entry ||
    a.spread - b.spread ||
    a.id.localeCompare(b.id)
  );
}
