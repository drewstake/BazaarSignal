import { useEffect, useId, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { formatEstDateTime, formatEstTime } from "../time";
import { fixtureMode, marketUrl } from "./api";
import type { SearchMarketDetail } from "./bazaar-search-data";
import { exact } from "./components";
import {
  bazaarPriceHistoryKey,
  bazaarPricePoint,
  mergePricePoints,
  parsePriceHistory,
  serializePriceHistory,
  priceLinePath,
  PRICE_HISTORY_DAY,
  PRICE_HISTORY_DAYS,
  type BazaarPricePoint,
} from "./bazaar-price-history";
import "./bazaar-price-chart.css";
import {
  historyDay,
  historyDayLabel,
  historyDayStart,
  historySourceLabel,
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
const series = [
  { side: "buy", label: "Instant buy", color: "#7bffc0" },
  { side: "sell", label: "Instant sell", color: "#66ceff" },
] as const;
const axisPrice = (value: number) => {
  const divisor =
    value >= 1e9 ? 1e9 : value >= 1e6 ? 1e6 : value >= 1e3 ? 1e3 : 1;
  return `${Number((value / divisor).toFixed(3))}${divisor === 1e9 ? "B" : divisor === 1e6 ? "M" : divisor === 1e3 ? "K" : ""}`;
};

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
  const [active, setActive] = useState<number | null>(null);
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
  useEffect(() => setActive(null), [period, points]);
  const geometry = useMemo(() => {
    const prices = points
      .flatMap((point) => [point.buy, point.sell])
      .filter((price): price is number => price !== null);
    const min = prices.length ? Math.min(...prices) : 0;
    const max = prices.length ? Math.max(...prices) : 0;
    const pad = Math.max((max - min) * 0.15, max * 0.0001, 0.1);
    const low = Math.max(0, min - pad),
      high = max + pad;
    const first = points[0],
      last = points.at(-1);
    // Preserve calendar spacing and empty leading/trailing days. Daily lines
    // connect known observations without generating prices for missing dates.
    const start = daily
      ? Number.isFinite(cutoff)
        ? cutoff + PRICE_HISTORY_DAY / 2
        : first?.at
      : first?.at;
    const end = daily
      ? historyDayStart(completedDay) - PRICE_HISTORY_DAY / 2
      : last?.at;
    const x = (at: number) =>
      start != null && end != null && start !== end
        ? 16 + ((at - start) / (end - start)) * 968
        : 500;
    const y = (price: number) => 182 - ((price - low) / (high - low)) * 164;
    return {
      low,
      high,
      x,
      y,
      start,
      end,
      paths: series.map(({ side }) =>
        priceLinePath(
          daily ? points.filter((point) => point[side] !== null) : points,
          side,
          x,
          y,
          daily ? Infinity : undefined,
        ),
      ),
      // Round-capped short segments draw every sample in just two SVG nodes.
      // Markers and tooltips still represent only real recorded observations.
      markers: series.map(({ side }) =>
        points
          .filter((point) => point[side] !== null)
          .map(
            (point) =>
              `M${x(point.at).toFixed(2)},${y(point[side]!).toFixed(2)}h0.01`,
          )
          .join(" "),
      ),
    };
  }, [points, daily, cutoff, completedDay]);
  const { low, high, x, y, paths, markers } = geometry;
  const focusedIndex = Math.max(
    0,
    Math.min(active ?? points.length - 1, points.length - 1),
  );
  const focused = points[focusedIndex];
  const first = points[0],
    last = points.at(-1);
  const sampleLabel = (point: ChartPricePoint) =>
    point.day !== undefined && point.source
      ? `${historyDayLabel(point.day)} · ${historySourceLabel(point.source)} · Sample ${formatEstDateTime(point.sampleAt!)}`
      : formatEstDateTime(point.at);
  const pointDescription = focused
    ? `${sampleLabel(focused)}. Instant buy: ${focused.buy === null ? "unavailable" : `${exact(focused.buy)} coins`}. Instant sell: ${focused.sell === null ? "unavailable" : `${exact(focused.sell)} coins`}.`
    : "No recorded prices";
  const selectPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!points.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const target = ((event.clientX - bounds.left) / bounds.width) * 1000;
    let nearest = 0;
    points.forEach((point, index) => {
      if (
        Math.abs(x(point.at) - target) <
        Math.abs(x(points[nearest].at) - target)
      )
        nearest = index;
    });
    setActive(nearest);
  };
  const intraday = first && last && last.at - first.at < PRICE_HISTORY_DAY;
  const timeLabel = (at: number) =>
    daily
      ? historyDayLabel(historyDay(at))
      : intraday
        ? formatEstTime(at)
        : formatEstDateTime(at);

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
      <p className="item-chart-caption">
        Coins per item · Before fees{daily && " · Daily closing prices (EST)"}
      </p>
      {daily && archive?.collector.lastError && (
        <p className="item-chart-caption" role="status">{archive.collector.lastError.message}</p>
      )}
      <div className="item-chart-readout">
        {series.map(({ side, label }) => (
          <div key={side} className={`item-chart-${side}`}>
            <span>
              <i aria-hidden="true" />
              {label}
            </span>
            <strong>
              {focused?.[side] != null
                ? `${exact(focused[side])} coins`
                : "Unavailable"}
            </strong>
          </div>
        ))}
      </div>
      <p className="item-chart-sample">
        {focused ? sampleLabel(focused) : "No sample selected"}
      </p>
      {points.length ? (
        <>
          <div className="item-chart-canvas">
            <div className="item-chart-axis" aria-hidden="true">
              <span>{axisPrice(high)}</span>
              <span>{axisPrice((high + low) / 2)}</span>
              <span>{axisPrice(low)}</span>
            </div>
            <div
              className="item-chart-plot"
              onPointerMove={selectPoint}
              onPointerDown={selectPoint}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") setActive(null);
              }}
            >
              <svg
                viewBox="0 0 1000 200"
                preserveAspectRatio="none"
                role="img"
                aria-label={`Price history: ${points.length} ${daily ? "recorded days" : `saved ${points.length === 1 ? "snapshot" : "snapshots"}`}. Instant buy and instant sell in coins per item.`}
              >
                {[18, 100, 182].map((height) => (
                  <line
                    key={height}
                    x1="0"
                    x2="1000"
                    y1={height}
                    y2={height}
                    stroke="#2a4357"
                    strokeDasharray="4 6"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {series.map(({ side, color }, index) => (
                  <path
                    key={side}
                    d={paths[index]}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    strokeDasharray={side === "sell" ? "6 3" : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {focused && (
                  <line
                    x1={x(focused.at)}
                    x2={x(focused.at)}
                    y1="8"
                    y2="192"
                    stroke="#c1d2e966"
                    strokeDasharray="3 5"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {series.map(({ side, color }, index) => (
                  <path
                    key={`${side}-points`}
                    d={markers[index]}
                    fill="none"
                    stroke={color}
                    strokeWidth="4"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
              {series.map(
                ({ side }) =>
                  focused?.[side] != null && (
                    <span
                      key={side}
                      aria-hidden="true"
                      className={`item-chart-dot item-chart-${side} is-active`}
                      style={{
                        left: `${x(focused.at) / 10}%`,
                        top: `${y(focused[side]) / 2}%`,
                      }}
                    />
                  ),
              )}
              <input
                className="item-chart-explorer"
                type="range"
                aria-label="Explore item price history"
                aria-valuetext={pointDescription}
                min="0"
                max={Math.max(0, points.length - 1)}
                value={focusedIndex}
                onChange={(event) => setActive(Number(event.target.value))}
                onBlur={() => setActive(null)}
              />
            </div>
          </div>
          <div
            className={`item-chart-times${points.length === 1 ? " is-single" : ""}`}
            aria-hidden="true"
          >
            <span>{timeLabel(geometry.start ?? first.at)}</span>
            {(daily || points.length > 1) && (
              <span>{timeLabel(geometry.end ?? last!.at)}</span>
            )}
          </div>
        </>
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
          <p>
            History begins when you view this item; earlier prices are
            unavailable.
          </p>
        </div>
      )}
    </section>
  );
}
