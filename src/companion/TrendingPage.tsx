import { useEffect, useState } from "react";
import { PAID_PILOT_INTERVAL } from "../../shared/paid-pilot";
import { trendHours, trendLiquidity, type TrendBoard, type TrendHours } from "../../shared/trending";
import { formatEstDateTime } from "../time";
import { marketRequest } from "./api";
import { exact } from "./components";
import { TrendingUp } from "lucide-react";
import FlipSection from "./FlipPage";
import { MarketCard, MarketGrid } from "./MarketCards";
import { visiblePoll } from "./polling";
import { useVisibleNow } from "./use-visible-now";
import "./trending.css";

const pct = new Intl.NumberFormat("en-US", { signDisplay: "exceptZero", maximumFractionDigits: 2 });
const change = (n: number) => n !== 0 && Math.abs(n) < 0.01
  ? (n > 0 ? "+<0.01%" : "−<0.01%") : pct.format(n) + "%";

export default function TrendingPage() {
  const [hours, setHours] = useState<TrendHours>(1);
  const [board, setBoard] = useState<TrendBoard | null | undefined>(undefined);
  const [error, setError] = useState("");
  const now = useVisibleNow(30_000);
  useEffect(() => {
    const previous = document.title;
    document.title = "Trending | BazaarSignal";
    const stop = visiblePoll(async signal => {
      try {
        const data = await marketRequest<{ board: TrendBoard | null; error?: string }>("trending", signal);
        if (!signal.aborted) {
          if (data.board && data.board.version !== 2) throw new Error("Waiting for updated liquidity rankings.");
          setBoard(data.board);
          setError(data.error ?? "");
        }
      } catch (e) {
        if (!signal.aborted || signal.reason?.name === "TimeoutError")
          setError(e instanceof Error ? e.message : "Trending prices are unavailable.");
      }
    }, PAID_PILOT_INTERVAL);
    return () => { stop(); document.title = previous; };
  }, []);
  const period = board?.windows.find(w => w.hours === hours);
  return (
    <section className="trend-page" aria-labelledby="trend-title">
      <header className="trend-mast">
        <h1 id="trend-title">Trending</h1>
        {board && <p className="trend-meta">
          {now - board.at > PAID_PILOT_INTERVAL + 120_000 ? "Last available snapshot" : "Snapshot"} · {formatEstDateTime(board.at)}
          {" · "}{exact(board.items)} items
        </p>}
      </header>
      <section aria-labelledby="gainers-title" className="trend-section">
      <header className="trend-head">
        <h2 id="gainers-title"><TrendingUp aria-hidden="true" /> Sell-offer gainers</h2>
        <div className="trend-periods" role="group" aria-label="Comparison period">
          {trendHours.map(h => <button key={h} aria-pressed={h === hours} onClick={() => setHours(h)}>{h}h</button>)}
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      {!board ? !error && <p className="trend-empty" role="status">{board === undefined ? "Loading market prices…" : "Waiting for the first market snapshot."}</p>
        : !period?.baselineAt ? <p className="trend-empty" role="status">Waiting for a matching snapshot from {hours} {hours === 1 ? "hour" : "hours"} earlier. Prices are sampled every 15 minutes.</p>
        : <>
          <p className="trend-meta">{exact(period.gainers)} {period.gainers === 1 ? "gainer" : "gainers"}
            {" · "}Compared with {formatEstDateTime(period.baselineAt)}</p>
          {period.rows.length ? <MarketGrid key={hours} rows={period.rows} label={`${hours}h sell offer gainers`} renderCard={row =>
            <MarketCard id={row.id} name={row.name} metric={change(row.offerChange)} label="Sell offer change">
              <dl className="pick-facts">
                <div><dt>Sell offer</dt><dd>{exact(row.offerBefore)} → {exact(row.offer)}</dd></div>
                <div><dt>Buy order change</dt><dd className={row.bidChange < 0 ? "pick-down" : row.bidChange > 0 ? "pick-up" : undefined}>{change(row.bidChange)}</dd></div>
                <div><dt>7d buy / sell volume</dt><dd>{exact(row.buyActivity7d)} / {exact(row.sellActivity7d)}</dd></div>
              </dl>
            </MarketCard>} /> : <p className="trend-empty">No gainers met the liquidity criteria for this period.</p>}
        </>}
      <details className="trend-criteria"><summary>How items qualify</summary>
        <p>Both sides need at least {trendLiquidity.weeklyUnitsPerSide} units of reported 7-day activity.
          Each side also needs {trendLiquidity.unitsPerSide} items across at least {trendLiquidity.ordersPerSide} orders
          within {trendLiquidity.nearPricePct}% of its best current price. The highest buy order must be below
          the lowest sell offer and within {trendLiquidity.maxSpreadPct}% of it at both comparison times.</p>
      </details>
      </section>
      <FlipSection />
    </section>
  );
}
