export const HISTORY_DAY_MS = 86_400_000;
export const HISTORY_OFFSET_MS = 5 * 3_600_000; // The app uses fixed EST, including summer.
export const historyDay = (at: number) =>
  Math.floor((at - HISTORY_OFFSET_MS) / HISTORY_DAY_MS);
export const historyDayStart = (day: number) =>
  day * HISTORY_DAY_MS + HISTORY_OFFSET_MS;
export const historyDayLabel = (day: number) =>
  new Date(day * HISTORY_DAY_MS).toISOString().slice(0, 10);
export type HistorySource = "skytrack" | "bazaar-calc" | "bazaarsignal";
export type DailyPrice = {
  item: string;
  day: number;
  at: number;
  buy: number | null;
  sell: number | null;
  source: HistorySource;
  reference: string;
};
export const validHistoryItem = (item: unknown): item is string =>
  typeof item === "string" && /^[A-Z0-9_:-]{1,100}$/.test(item);
export const historyPrice = (price: unknown): number | null =>
  typeof price === "number" && Number.isFinite(price) && price > 0
    ? price
    : null;
export const historySourceLabel = (source: HistorySource) =>
  source === "skytrack"
    ? "Skytrack"
    : source === "bazaar-calc"
      ? "Bazaar Calc"
      : "BazaarSignal";
