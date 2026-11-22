import { useEffect, useId, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import PriceHistoryPlot from "./PriceHistoryPlot";
import { fixtureMode, marketUrl } from "./api";
import type { SearchMarketDetail } from "./bazaar-search-data";
import {
  bazaarPriceHistoryKey,
  bazaarPricePoint,
  mergePricePoints,
  parsePriceHistory,
  serializePriceHistory,
  PRICE_HISTORY_DAY,
  PRICE_HISTORY_DAYS,
  type BazaarPricePoint,
} from "./bazaar-price-history";
import "./bazaar-price-chart.css";
import {
  historyDay,
  historyDayStart,
} from "../../shared/daily-price-history";
import {
  loadDailyHistory,
  HistoryPaused,
  type DailyHistory,
  type ChartPricePoint,
} from "./daily-price-history";

const observedPeriods = [
  { label: "1D", days: 1 },
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "All", days: PRICE_HISTORY_DAYS },
];
const dailyPeriods = [
  { label: "1M", days: 30 },
  { label: "1Y", days: 365 },
  { label: "All", days: Infinity },
];
export default function BazaarPriceChart({
  itemId,
  detail,
  now,
}: {
  itemId: string;
  detail: SearchMarketDetail;
  now: number;
}) {
  const titleId = useId();
  const storageKey = bazaarPriceHistoryKey(marketUrl("bazaar"), itemId);
  const [history, setHistory] = useState<BazaarPricePoint[]>(() => {
    if (fixtureMode) return [];
    try {
      return parsePriceHistory(localStorage.getItem(storageKey));
    } catch {
      return [];
    }
  });
  const [saved, setSaved] = useState(true);
  const [daily, setDaily] = useState(!fixtureMode);
  const [archive, setArchive] = useState<DailyHistory | null>(null);
  const [archiveStatus, setArchiveStatus] = useState("Loading daily history…");
  const [period, setPeriod] = useState(fixtureMode ? 0 : 1);
  const completedDay = historyDay(now);
  useEffect(() => {
    if (fixtureMode) return;
    let cancelled = false;
    setArchive(null);
    setArchiveStatus("Loading daily history…");
    void loadDailyHistory(itemId)
      .then((data) => {
        if (!cancelled) {
          setArchive(data);
          setArchiveStatus(
            "No completed daily prices recorded for this item yet.",
          );
        }
      })
      .catch((error) => {
        if (!cancelled)
          setArchiveStatus(
            error instanceof HistoryPaused ? error.message : "Daily archive unavailable. Device observations are still available.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, completedDay]);

  useEffect(() => {
    const point = bazaarPricePoint(detail.item);
    // Demo samples can be explored but never read or write real history.
    if (fixtureMode) {
      setHistory(point ? [point] : []);
      return;
    }
    let stored: BazaarPricePoint[] = [];
    try {
      stored = parsePriceHistory(localStorage.getItem(storageKey));
    } catch {
      setSaved(false);
    }
    setHistory((previous) =>
      mergePricePoints(previous, [...stored, ...(point ? [point] : [])]),
    );
  }, [detail, storageKey]);

  useEffect(() => {
    if (fixtureMode || !history.length) return;
    try {
      // Merge just before writing so navigating and another tab's observations
      // do not replace the saved series with this component's older copy.
      const points = mergePricePoints(
        parsePriceHistory(localStorage.getItem(storageKey)),
        history,
      );
      const serialized = serializePriceHistory(points);
      if (localStorage.getItem(storageKey) !== serialized)
        localStorage.setItem(storageKey, serialized);
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [history, storageKey]);

  useEffect(() => {
    if (fixtureMode) return;
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey)
        setHistory((previous) =>
          mergePricePoints(previous, parsePriceHistory(event.newValue)),
        );
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [storageKey]);

  const periods = daily ? dailyPeriods : observedPeriods;
  const selectedPeriod = periods[Math.min(period, periods.length - 1)];
  const cutoff =
    (daily ? historyDayStart(completedDay) : now) -
    selectedPeriod.days * PRICE_HISTORY_DAY;
  const displayed: ChartPricePoint[] = daily
    ? (archive?.points ?? [])
    : history;
  const firstVisible = displayed.findIndex((point) => point.at > cutoff);
  const points = useMemo<ChartPricePoint[]>(
    () => displayed.slice(firstVisible < 0 ? displayed.length : firstVisible),
    [displayed, firstVisible],
  );
  const start = daily && Number.isFinite(cutoff) ? cutoff + PRICE_HISTORY_DAY / 2 : points[0]?.at;
  const end = daily ? historyDayStart(completedDay) - PRICE_HISTORY_DAY / 2 : points.at(-1)?.at;

  return (
    <section className="bazaar-price-chart" aria-labelledby={titleId}>
      <div className="item-chart-heading">
        <h2 id={titleId}>
          <TrendingUp size={17} aria-hidden="true" />
          Price history
        </h2>
        <div
          className="item-chart-periods"
          role="group"
          aria-label="Price history period"
        >
          {periods.map((option, index) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={period === index}
              onClick={() => setPeriod(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {!fixtureMode && (
        <div
          className="item-chart-periods item-chart-modes"
          role="group"
          aria-label="History type"
        >
          <button
            type="button"
            aria-pressed={daily}
            title="Daily closing prices in EST"
            onClick={() => {
              setDaily(true);
              setPeriod(1);
            }}
          >
            Daily closes
          </button>
          <button
            type="button"
            aria-pressed={!daily}
            onClick={() => {
              setDaily(false);
              setPeriod(0);
            }}
          >
            Device observations
          </button>
        </div>
      )}
      {daily && archive?.collector.lastError && (
        <p className="item-chart-caption" role="status">{archive.collector.lastError.message}</p>
      )}
      {points.length ? (
        <PriceHistoryPlot points={points} daily={daily} start={start} end={end} />
      ) : (
        <div className="item-chart-empty">
          <TrendingUp size={25} aria-hidden="true" />
          <p>
            {daily
              ? displayed.length
                ? "No recorded daily prices in this period. Try All."
                : archiveStatus
              : history.length
                ? "No saved prices in this period. Try All."
                : "Price history starts with the first available price snapshot."}
          </p>
        </div>
      )}
      {!daily && (
        <div className="item-chart-notes">
          <p>
            {fixtureMode
              ? "Demo snapshot · Not saved"
              : history.length === 1
                ? "First price point. New price snapshots build the chart."
                : points.length === 1
                  ? "One saved price point in this period."
                  : "Saved price snapshots · Gaps mark unrecorded prices"}
          </p>
          <p>
            {fixtureMode
              ? "Demo prices are separate from your history."
              : saved
                ? "History on this device · Up to 90 days"
                : "Storage unavailable · History until you leave this item"}
          </p>
          {!fixtureMode && !history.length && <p>Device history starts when you view an item.</p>}
        </div>
      )}
    </section>
  );
}
