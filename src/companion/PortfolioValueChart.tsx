import { useEffect, useId, useState } from "react";
import { TrendingUp } from "lucide-react";
import type { portfolioTotals } from "../../shared/companion/portfolio";
import { compact, exact } from "./components";
import {
  appendValueSnapshot,
  emptyValueHistory,
  parseValueHistory,
  portfolioValueHistoryKey,
  portfolioValueSnapshot,
  visibleValuePoints,
} from "./portfolio-value-history";
import "./portfolio-value-chart.css";

const periods = [
  { label: "1D", duration: 86_400_000 },
  { label: "1W", duration: 7 * 86_400_000 },
  { label: "1M", duration: 30 * 86_400_000 },
  { label: "All", duration: null },
];
const timeLabel = (at: number, day: boolean) =>
  new Date(at).toLocaleString(
    undefined,
    day
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric" },
  );
const pointLabel = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function PortfolioValueChart({
  uid,
  portfolioId,
  totals,
  loading,
  fixture,
}: {
  uid: string;
  portfolioId: string;
  totals: ReturnType<typeof portfolioTotals>;
  loading: boolean;
  fixture: boolean;
}) {
  const storageKey = portfolioValueHistoryKey(uid, portfolioId);
  const [history, setHistory] = useState(() => {
    try {
      return parseValueHistory(localStorage.getItem(storageKey));
    } catch {
      return emptyValueHistory();
    }
  });
  const [savedOnDevice, setSavedOnDevice] = useState(true);
  const [period, setPeriod] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const gradientId = `portfolio-value-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const snapshot = !loading && !fixture ? portfolioValueSnapshot(totals) : null;
  const signature = snapshot?.signature;
  useEffect(() => {
    if (snapshot)
      setHistory((previous) => appendValueSnapshot(previous, snapshot));
  }, [signature]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(history));
      setSavedOnDevice(true);
    } catch {
      setSavedOnDevice(false);
    }
  }, [history, storageKey]);
  useEffect(() => setActive(null), [period, history]);

  const points = visibleValuePoints(history.points, periods[period].duration);
  const focusedIndex = Math.min(active ?? points.length - 1, points.length - 1);
  const focused = points[focusedIndex];
  const first = points[0],
    last = points.at(-1);
  const intraday =
    period === 0 || (!!first && !!last && last.at - first.at < 86_400_000);
  const max = Math.max(0, ...points.map((point) => point.value));
  const min = points.length
    ? Math.min(...points.map((point) => point.value))
    : 0;
  const padding = Math.max((max - min) * 0.18, max * 0.015, 1);
  const low = Math.max(0, min - padding),
    high = max + padding;
  const x = (at: number) =>
    first && last && first.at !== last.at
      ? 12 + ((at - first.at) / (last.at - first.at)) * 976
      : 500;
  const y = (value: number) => 242 - ((value - low) / (high - low)) * 224;
  const line = points
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${x(point.at).toFixed(2)},${y(point.value).toFixed(2)}`,
    )
    .join(" ");
  const area =
    points.length > 1
      ? `${line} L${x(last!.at)},242 L${x(first.at)},242 Z`
      : "";
  const change =
    first && last && points.length > 1 ? last.value - first.value : null;
  const changePercent =
    change !== null && first.value > 0 ? (change / first.value) * 100 : null;
  const currentValue = active === null ? totals.value : focused?.value;
  const status = loading
    ? "Loading prices"
    : fixture
      ? "Demo prices"
      : totals.missing
        ? "Incomplete prices"
        : totals.stale
          ? "Last-known prices"
          : totals.value === null
            ? "Awaiting prices"
            : "Estimated value";
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

  return (
    <section
      className="portfolio-value-chart"
      aria-labelledby={`${gradientId}-title`}
    >
      <div className="value-chart-heading">
        <h2 id={`${gradientId}-title`}>
          <TrendingUp size={19} aria-hidden="true" /> Portfolio value
        </h2>
        <div
          className="value-chart-periods"
          role="group"
          aria-label="Portfolio value period"
        >
          {periods.map((option, index) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={index === period}
              onClick={() => setPeriod(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="value-chart-readout">
        <div>
          <strong>
            {loading ? "—" : exact(currentValue)} <small>coins</small>
          </strong>
          <span>
            {active !== null && focused
              ? `${pointLabel(focused.at)}${focused.stale ? " · Last-known prices" : ""}`
              : status}
          </span>
        </div>
        {change !== null && (
          <span
            className={`value-chart-change ${change < 0 ? "negative" : "positive"}`}
          >
            {change > 0 ? "+" : ""}
            {compact(change)} coins
            {changePercent !== null
              ? ` (${changePercent > 0 ? "+" : ""}${changePercent.toFixed(2)}%)`
              : ""}
            <small>Value change · includes holding edits</small>
          </span>
        )}
      </div>
      {points.length ? (
        <>
          <div className="value-chart-canvas">
            <div className="value-chart-axis" aria-hidden="true">
              <span>{compact(high)}</span>
              <span>{compact((high + low) / 2)}</span>
              <span>{compact(low)}</span>
            </div>
            <div
              className="value-chart-plot"
              onPointerMove={selectPoint}
              onPointerDown={selectPoint}
              onPointerLeave={() => setActive(null)}
            >
              <svg
                viewBox="0 0 1000 260"
                preserveAspectRatio="none"
                role="img"
                aria-label={`Portfolio value: ${points.length} recorded snapshots, from ${exact(first.value)} to ${exact(last!.value)} coins.`}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#68e7b0" stopOpacity=".25" />
                    <stop offset="100%" stopColor="#68e7b0" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[18, 130, 242].map((height) => (
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
                {area && <path d={area} fill={`url(#${gradientId})`} />}
                {points.length > 1 && (
                  <path
                    d={line}
                    fill="none"
                    stroke="#7cf4bb"
                    strokeWidth="2.5"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {focused && (
                  <>
                    <line
                      x1={x(focused.at)}
                      x2={x(focused.at)}
                      y1="10"
                      y2="250"
                      stroke="#7ce3bb66"
                      strokeDasharray="4 5"
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                )}
              </svg>
              {focused && (
                <span
                  className="value-chart-dot"
                  aria-hidden="true"
                  style={{
                    left: `${x(focused.at) / 10}%`,
                    top: `${y(focused.value) / 2.6}%`,
                  }}
                />
              )}
              <input
                className="value-chart-explorer"
                type="range"
                aria-label="Explore portfolio value history"
                aria-valuetext={
                  focused
                    ? `${pointLabel(focused.at)}: ${exact(focused.value)} coins${focused.stale ? ", last-known prices" : ""}`
                    : undefined
                }
                min="0"
                max={Math.max(0, points.length - 1)}
                value={Math.max(0, focusedIndex)}
                onChange={(event) => setActive(Number(event.target.value))}
                onBlur={() => setActive(null)}
              />
            </div>
          </div>
          <div className="value-chart-times" aria-hidden="true">
            <span>{timeLabel(first.at, intraday)}</span>
            {points.length > 2 && (
              <span>
                {timeLabel(points[Math.floor(points.length / 2)].at, intraday)}
              </span>
            )}
            {points.length > 1 && <span>{timeLabel(last!.at, intraday)}</span>}
          </div>
        </>
      ) : (
        <div className="value-chart-empty">
          <TrendingUp size={30} aria-hidden="true" />
          <p>
            {loading
              ? "Loading your portfolio value…"
              : !totals.rows.length
                ? "Add holdings to start your value chart."
                : fixture
                  ? "Demo prices are not saved to your history."
                  : totals.missing
                    ? "The chart starts when all holdings have a usable price."
                    : "No snapshots in this period. Try All."}
          </p>
        </div>
      )}
      <div className="value-chart-footnote">
        <span>
          <i aria-hidden="true" />{" "}
          {points.length === 1
            ? "First snapshot saved. New prices add to the chart."
            : "Recorded portfolio estimates"}
        </span>
        <span>
          {savedOnDevice
            ? "History on this device · up to 90 days"
            : "History available for this tab only"}
        </span>
      </div>
    </section>
  );
}
