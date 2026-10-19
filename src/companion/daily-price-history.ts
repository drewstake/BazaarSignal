import {
  historyDay,
  historyDayStart,
  type HistorySource,
} from "../../shared/daily-price-history";
import type { BazaarPricePoint } from "./bazaar-price-history";

export type ChartPricePoint = BazaarPricePoint & {
  day?: number;
  sampleAt?: number;
  source?: HistorySource;
};
export type DailyHistory = {
  points: ChartPricePoint[];
  collector: {
    enabled: boolean;
    location?: "cloud" | "local";
    expiresAt?: number;
    lastSuccess: { at: number; items: number } | null;
    lastError: { at: number; message: string } | null;
  };
};
const cache = new Map<
  string,
  { expires: number; promise: Promise<DailyHistory> }
>();
/** Share one bounded read across StrictMode mounts and navigation. Period changes
 * never read storage again. Keep failures briefly too, avoiding immediate retries. */
export function loadDailyHistory(
  item: string,
  now = Date.now(),
): Promise<DailyHistory> {
  const key = `${item}:${historyDay(now)}`;
  const prior = cache.get(key);
  if (prior && prior.expires > now) return prior.promise;
  const endpoint = import.meta.env.VITE_PRICE_HISTORY_URL || "/api/price-history";
  const promise = fetch(`${endpoint}?item=${encodeURIComponent(item)}`, {
    signal: AbortSignal.timeout(15_000),
  }).then(async (response) => {
    if (!response.ok) throw new Error("Daily archive unavailable");
    const text = await response.text();
    if (text.length > 1024 ** 2) throw new Error("History response too large");
    return parseDailyHistory(JSON.parse(text), item);
  });
  cache.delete(key);
  cache.set(key, { expires: now + 300_000, promise });
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  return promise;
}
export function parseDailyHistory(
  input: any,
  item: string,
  now = Date.now(),
): DailyHistory {
  if (
    input?.version !== 1 ||
    input.item !== item ||
    input.timezone !== "EST" ||
    !Array.isArray(input.points) ||
    input.points.length > 10_000
  )
    throw new Error("Invalid daily history");
  let previous = -Infinity;
  const points = input.points.map((tuple: unknown): ChartPricePoint => {
    if (!Array.isArray(tuple) || tuple.length !== 5)
      throw new Error("Invalid daily price");
    const [day, at, buy, sell, source] = tuple;
    if (
      !Number.isInteger(day) ||
      day <= previous ||
      day < historyDay(Date.UTC(2020, 2, 1)) ||
      day >= historyDay(now) ||
      !Number.isSafeInteger(at) ||
      historyDay(at) !== day ||
      [buy, sell].some(
        (p) =>
          p !== null &&
          (typeof p !== "number" || !Number.isFinite(p) || p <= 0),
      ) ||
      !["skytrack", "bazaar-calc", "bazaarsignal"].includes(source)
    )
      throw new Error("Invalid daily price");
    previous = day;
    // Evenly spaced calendar days; retain the original timestamp for the tooltip.
    return {
      at: historyDayStart(day) + 12 * 3_600_000,
      day,
      sampleAt: at,
      buy,
      sell,
      source,
    };
  });
  return {
    points,
    collector: input.collector ?? {
      enabled: false,
      lastSuccess: null,
      lastError: null,
    },
  };
}
