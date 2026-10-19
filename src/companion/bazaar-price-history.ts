import { isFresh, isValidSample } from "../../shared/market";
import { bookSideSummary } from "./bazaar-search-data";
import type { SavedBazaarBook } from "./request-cache";

export type BazaarPricePoint = {
  at: number;
  buy: number | null;
  sell: number | null;
};

export const PRICE_HISTORY_DAYS = 90;
export const PRICE_HISTORY_LIMIT = 2160;
export const PRICE_HISTORY_DAY = 86_400_000;
// Scope public observations to the data source, keeping offline and live data apart.
export const bazaarPriceHistoryKey = (source: string, itemId: string) =>
  `bazaarsignal-item-prices-v1:${encodeURIComponent(source)}:${encodeURIComponent(itemId)}`;

const validPrice = (value: unknown) =>
  value === null ||
  (typeof value === "number" && Number.isFinite(value) && value > 0);

/** Keep full numeric precision while avoiding repeated field names per sample.
 * The storage key stays stable so existing version-1 observations migrate. */
export function serializePriceHistory(points: BazaarPricePoint[]): string {
  return JSON.stringify({
    version: 2,
    points: points.map(({ at, buy, sell }) => [at, buy, sell]),
  });
}

export function mergePricePoints(
  points: BazaarPricePoint[],
  incoming: BazaarPricePoint[],
  now = Date.now(),
): BazaarPricePoint[] {
  const byTime = new Map<number, BazaarPricePoint>();
  for (const point of [...points, ...incoming]) {
    if (
      !point ||
      !isValidSample(point.at, now) ||
      point.at <= now - PRICE_HISTORY_DAYS * PRICE_HISTORY_DAY ||
      !validPrice(point.buy) ||
      !validPrice(point.sell) ||
      (point.buy === null && point.sell === null)
    )
      continue;
    byTime.set(point.at, { at: point.at, buy: point.buy, sell: point.sell });
  }
  return [...byTime.values()]
    .sort((a, b) => a.at - b.at)
    .slice(-PRICE_HISTORY_LIMIT);
}

export function parsePriceHistory(
  raw: string | null,
  now = Date.now(),
): BazaarPricePoint[] {
  try {
    if (!raw || raw.length > 400_000) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.points)) return [];
    if (data.version === 1) return mergePricePoints([], data.points, now);
    if (data.version !== 2) return [];
    const points = data.points
      .filter((point: unknown) => Array.isArray(point) && point.length === 3)
      .map(([at, buy, sell]: unknown[]) => ({ at, buy, sell }));
    return mergePricePoints([], points, now);
  } catch {
    return [];
  }
}

/** Use the source time, never the page-open time. Reopening an old book must
 * not manufacture a new price or turn unavailable orders into zero prices. */
export function bazaarPricePoint(
  book: SavedBazaarBook | undefined,
  now = Date.now(),
): BazaarPricePoint | null {
  if (
    !book ||
    !isValidSample(book.upstreamAt, now) ||
    !isValidSample(book.observedAt, now) ||
    !isFresh(book.upstreamAt, book.observedAt)
  )
    return null;
  const buy = bookSideSummary(book.asks, "buy")?.price ?? null;
  const sell = bookSideSummary(book.bids, "sell")?.price ?? null;
  return buy === null && sell === null
    ? null
    : { at: book.upstreamAt, buy, sell };
}

/** Break the line at missing sides and missed hourly samples. */
export function priceLinePath(
  points: BazaarPricePoint[],
  side: "buy" | "sell",
  x: (at: number) => number,
  y: (price: number) => number,
  maxGapMs = 90 * 60_000,
) {
  let previous: BazaarPricePoint | null = null;
  return points
    .map((point) => {
      const price = point[side];
      if (price === null) {
        previous = null;
        return "";
      }
      const join = previous && point.at - previous.at <= maxGapMs;
      previous = point;
      return `${join ? "L" : "M"}${x(point.at).toFixed(2)},${y(price).toFixed(2)}`;
    })
    .filter(Boolean)
    .join(" ");
}
