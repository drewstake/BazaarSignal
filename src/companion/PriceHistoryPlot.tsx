import { useEffect, useMemo, useState } from "react";
import { historyDay, historyDayLabel, historySourceLabel } from "../../shared/daily-price-history";
import { formatEstDateTime, formatEstTime } from "../time";
import { exact } from "./components";
import { PRICE_HISTORY_DAY, priceLinePath } from "./bazaar-price-history";
import type { ChartPricePoint } from "./daily-price-history";
import "./bazaar-price-chart.css";

const series = [
  { side: "buy", label: "Instant buy", color: "#7bffc0" },
  { side: "sell", label: "Instant sell", color: "#66ceff" },
] as const;
const axisPrice = (value: number) => {
  const divisor =
    value >= 1e9 ? 1e9 : value >= 1e6 ? 1e6 : value >= 1e3 ? 1e3 : 1;
  return `${Number((value / divisor).toFixed(3))}${divisor === 1e9 ? "B" : divisor === 1e6 ? "M" : divisor === 1e3 ? "K" : ""}`;
};

export default function PriceHistoryPlot({ points, daily, start, end, defaultLog = false, events = [], baselineDays }: {
  points: ChartPricePoint[];
  daily: boolean;
  start?: number;
  end?: number;
  defaultLog?: boolean;
  events?: {at:number; label:string}[];
  baselineDays?: Set<number>;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [logScale, setLogScale] = useState(defaultLog);
  useEffect(() => setActive(null), [points]);
  const geometry = useMemo(() => {
    const prices = points
      .flatMap((point) => [point.buy, point.sell])
      .filter((price): price is number => price !== null);
    const min = prices.length ? Math.min(...prices) : 0;
    const max = prices.length ? Math.max(...prices) : 0;
    const transform = logScale ? Math.log : (price: number) => price;
    const inCoins = logScale ? Math.exp : (value: number) => value;
    const bottom = transform(prices.length ? min : 1);
    const top = transform(prices.length ? max : 1);
    const pad = logScale
      ? Math.max((top - bottom) * 0.15, 0.001)
      : Math.max((top - bottom) * 0.15, max * 0.0001, 0.1);
    const low = logScale ? bottom - pad : Math.max(0, bottom - pad);
    const high = top + pad;
    const x = (at: number) =>
      start != null && end != null && start !== end
        ? 16 + ((at - start) / (end - start)) * 968
        : 500;
    const y = (price: number) => 182 - ((transform(price) - low) / (high - low)) * 164;
    return {
      ticks: [high, (high + low) / 2, low].map(inCoins),
      x,
      y,
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
  }, [points, daily, start, end, logScale]);
  const { ticks, x, y, paths, markers } = geometry;
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
    <>
      <div className="item-chart-periods item-chart-scale" role="group" aria-label="Price scale">
        <button type="button" aria-pressed={!logScale} onClick={() => setLogScale(false)}>Linear</button>
        <button type="button" aria-pressed={logScale} onClick={() => setLogScale(true)}
          title="Equal vertical steps show equal percentage changes">Log</button>
      </div>
      {focused && <div className="item-chart-readout">
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
      </div>}
      {focused && <p className="item-chart-sample">{sampleLabel(focused)}</p>}
      <div className="item-chart-canvas">
        <div className="item-chart-axis" aria-hidden="true">
          {ticks.map((tick, index) => <span key={index}>{axisPrice(tick)}</span>)}
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
            {events.filter(e=>e.at>=(start??0) && e.at<=(end??Infinity)).map(e=>(
              <line key={e.label} aria-label={e.label} x1={x(e.at)} x2={x(e.at)} y1="4" y2="196"
                stroke="#f5ac63" strokeDasharray="6 4" vectorEffect="non-scaling-stroke"><title>{e.label}</title></line>
            ))}
            {baselineDays && <path aria-label="Usable baseline observations" d={points.filter(p=>p.day!==undefined && baselineDays.has(p.day))
              .map(p=>`M${x(p.at)},193v4`).join(" ")} stroke="#8ce7ba" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
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
        <span>{timeLabel(start ?? first.at)}</span>
        {(daily || points.length > 1) && (
          <span>{timeLabel(end ?? last!.at)}</span>
        )}
      </div>
    </>
  );
}
