import { useEffect, useMemo, useState } from "react";
import { Gem } from "lucide-react";
import { isFresh } from "../../shared/market";
import {
  flipLot,
  flipLots,
  flipPeriods,
  flipVersion,
  recoveryDays,
  supportedQuotes,
  type FlipBoard,
  type FlipPeriod,
  type FlipPriceChange,
  type FlipRow,
} from "../../shared/flips";
import {
  automatonSupply,
  compressedCrop,
  economyUpdate as update,
  grassMechanics,
  previewDay,
  releaseDay,
  type MarketEffect,
} from "../../shared/flip-updates";
import { DEFAULT_BAZAAR_TAX } from "../../shared/companion/fees";
import {
  HISTORY_DAY_MS,
  historyDayLabel as date,
  historyDayStart,
} from "../../shared/daily-price-history";
import { PAID_PILOT_INTERVAL } from "../../shared/paid-pilot";
import { trendLiquidity } from "../../shared/trending";
import { formatEstDateTime } from "../time";
import { exact } from "./components";
import { marketRequest } from "./api";
import { loadDailyHistory, type DailyHistory } from "./daily-price-history";
import PriceHistoryPlot from "./PriceHistoryPlot";
import { MarketCard, MarketGrid } from "./MarketCards";
import { visiblePoll } from "./polling";
import { useVisibleNow } from "./use-visible-now";

const readable = (id: string) =>
  id
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
const price = (value: number | null) =>
  value === null ? "No NPC sale" : exact(value) + " coins";
function changeLabel(c: FlipPriceChange) {
  const source = c.ingredientId
    ? "Ingredient · " + (c.ingredientName ?? readable(c.ingredientId))
    : "Item";
  return (
    source +
    " · " +
    price(c.before) +
    " → " +
    price(c.after) +
    " · " +
    date(c.day)
  );
}
function ChangeDetail({ id, c }: { id: string; c: FlipPriceChange }) {
  const compost = c.path?.includes("COMPOST");
  const input = c.ingredientId ?? id,
    base = compressedCrop[input]?.base ?? input;
  const proposed = update.proposed[base];
  const proposedForItem = proposed * (compressedCrop[input]?.units ?? 1);
  return (
    <>
      <span>{changeLabel(c)}</span>
      {c.path && (
        <small>
          {compost ? "Alternative Composter input" : "Production input"} ·{" "}
          {c.path
            .map((x) =>
              x === "ENCHANTED_COMPOST" ? "Compost Bundle" : readable(x),
            )
            .join(" → ")}
          .{" "}
          {c.before !== null && c.after !== null && c.after < c.before
            ? "A cheaper input can lower production cost."
            : "Input costs may change."}
        </small>
      )}
      {automatonSupply.items.includes(id) && c.day === automatonSupply.day && (
        <small>
          The release also removed the shared Automaton parts drop pool. Each
          part has a {automatonSupply.rate * 100}% base drop chance.
        </small>
      )}
      {c.day === releaseDay && proposed !== undefined && (
        <small>
          Oct 29 proposal · {price(proposed)} per {readable(base)}
          {compressedCrop[input]
            ? " (implied " +
              price(proposedForItem) +
              " per " +
              readable(input) +
              ")"
            : ""}
          . Released · {price(c.after)} per {readable(input)}.
        </small>
      )}
    </>
  );
}
function EffectDetail({ effect: e }: { effect: MarketEffect }) {
  const demand = e.kind === "demand";
  return (
    <div className="flip-effect">
      <strong>
        {demand
          ? "Possible farming demand decline"
          : "Sustained price break · cause unknown"}
      </strong>
      {demand && (
        <p>
          Lower crop payouts can reduce demand for Mossy armor. Overgrown Grass
          grants Farming Fortune and can be offered by Garden Visitors (
          {grassMechanics.supply[0].chance * 100}%). SkyMart Brochure offers the
          competing Bustling armor reforge.
        </p>
      )}
      {e.onset !== undefined ? (
        <p>
          First lower quote {date(e.onset)} after the {date(e.lastBefore!)}{" "}
          observation. Confirmed price break {date(e.confirmedOn!)}. Median bid{" "}
          {exact(e.reference!)} → {exact(e.recent!)} across {e.beforeCount}{" "}
          earlier and {e.observations} lower quotes.
        </p>
      ) : (
        <p>
          {e.observations} observations since the preview. Timing evidence is
          insufficient to reset the baseline.
        </p>
      )}
      {demand && (
        <>
          <p>
            Preview {date(previewDay)} · Release {date(releaseDay)}.{" "}
            {e.releaseWindow && (
              <>
                {e.releaseWindow.before} prior and {e.releaseWindow.after} full
                post-release quotes in the 14-day release comparison.{" "}
                {e.releaseWindow.pct === null
                  ? "Too little coverage to measure a separate release effect."
                  : "Median bid change " + exact(e.releaseWindow.pct) + "%."}
              </>
            )}{" "}
            {e.cutoff === undefined
              ? "The original baseline is retained."
              : "The baseline uses full days after the observed break."}
          </p>
          <details className="flip-peer-evidence">
            <summary>Compare related items and controls</summary>
            {e.comparisons?.length ? (
              <p>
                Same-date median bid changes ·{" "}
                {e.comparisons
                  .map(
                    (c) =>
                      (grassMechanics.controls.includes(c.id)
                        ? "Control "
                        : "Related ") +
                      readable(c.id) +
                      " " +
                      (c.pct > 0 ? "+" : "") +
                      exact(c.pct) +
                      "% (" +
                      c.before +
                      "/" +
                      c.after +
                      " days)",
                  )
                  .join(" · ")}
                . Timing supports an association. Demand and reward supply are
                unobserved.
              </p>
            ) : null}
            <p>
              <a href={update.preview}>Public preview</a> ·{" "}
              <a href={update.release}>Release notes</a> ·{" "}
              <a href={grassMechanics.source}>Visitor reward and Mossy stats</a>
            </p>
          </details>
        </>
      )}
    </div>
  );
}
type ChartItem = {
  id: string;
  name: string;
  cutoff?: number;
  hasBaseline: boolean;
  change?: FlipPriceChange;
  effect?: MarketEffect;
};
function HistoryEvidence({
  item,
  days,
  through,
}: {
  item: ChartItem;
  days: FlipPeriod;
  through: number;
}) {
  const [archive, setArchive] = useState<DailyHistory | null>(null),
    [failed, setFailed] = useState(false);
  const [full, setFull] = useState(false),
    [endDate, setEndDate] = useState("");
  useEffect(() => {
    let active = true;
    void loadDailyHistory(item.id)
      .then((h) => {
        if (active) setArchive(h);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [item.id]);
  const first = full
    ? (archive?.points[0]?.day ?? through - days + 1)
    : through - days + 1;
  const last = endDate
    ? Math.max(first, Date.parse(endDate) / HISTORY_DAY_MS)
    : through;
  const points = useMemo(
    () =>
      archive?.points.filter(
        (p) =>
          p.day! >= first &&
          p.day! <= last &&
          (p.buy !== null || p.sell !== null),
      ) ?? [],
    [archive, first, last],
  );
  const baseline = new Set(
    points
      .filter(
        (p) =>
          item.hasBaseline &&
          p.day! > Math.max(through - days, item.cutoff ?? -Infinity) &&
          supportedQuotes(p.buy, p.sell),
      )
      .map((p) => p.day!),
  );
  const events: { day: number; label: string }[] = [];
  const crop = item.change?.ingredientId ?? item.id;
  const preview =
    item.effect?.kind === "demand" ||
    (item.change?.day === releaseDay &&
      (Object.hasOwn(update.proposed, crop) ||
        ["BOX_OF_SEEDS", "ENCHANTED_MELON", "ENCHANTED_MELON_BLOCK"].includes(
          crop,
        )));
  if (preview) events.push({ day: previewDay, label: "Preview" });
  if (item.change || item.effect?.kind === "demand")
    events.push({
      day: item.change?.day ?? releaseDay,
      label:
        item.change && item.change.day !== releaseDay ? "Change" : "Release",
    });
  if (item.effect?.onset !== undefined)
    events.push({ day: item.effect.onset, label: "First lower quote" });
  const middle = (d: number) => historyDayStart(d) + HISTORY_DAY_MS / 2;
  return archive ? (
    <section className="flip-chart" aria-label={item.name + " price history"}>
      <div className="flip-chart-heading">
        <h4>{full ? "Full archive" : days + "-day price history"}</h4>
        <label>
          <input
            type="checkbox"
            checked={full}
            onChange={(e) => setFull(e.target.checked)}
          />{" "}
          Full archive
        </label>
        <label>
          Chart end{" "}
          <input
            type="date"
            min={date(first)}
            max={date(through)}
            value={endDate || date(through)}
            onChange={(e) => {
              if (e.target.validity.valid) setEndDate(e.target.value);
            }}
          />
        </label>
      </div>
      {points.length ? (
        <PriceHistoryPlot
          points={points}
          daily
          defaultLog
          start={middle(first)}
          end={middle(last)}
          events={events.map((e) => ({
            at: middle(e.day),
            label: e.label + " " + date(e.day),
          }))}
          baselineDays={baseline}
        />
      ) : (
        <p className="trend-meta">No recorded prices in this range.</p>
      )}
      <p className="trend-meta">
        {events.map((e) => e.label + " " + date(e.day) + " · ")}Green ticks mark{" "}
        {baseline.size} visible observations used by the active average.
      </p>
    </section>
  ) : (
    <p role="status">
      {failed ? "Historical prices are unavailable." : "Loading price history…"}
    </p>
  );
}
function FlipCard({
  r,
  days,
  through,
  lot,
  stale,
}: {
  r: FlipRow;
  days: FlipPeriod;
  through: number;
  lot: number;
  stale: boolean;
}) {
  const [expanded, setExpanded] = useState(false),
    e = r.evidence;
  const count = e.hits + e.misses + e.incomplete;
  return (
    <MarketCard
      id={r.id}
      name={r.name}
      metric={r.discount === null ? "—" : exact(r.discount) + "%"}
      label={
        r.avg
          ? "Below average offer"
          : r.discount === null
            ? "Baseline unavailable"
            : "Below sparse median offer"
      }
    >
      {r.npcChange && (
        <p className="flip-npc-flag">{changeLabel(r.npcChange)}</p>
      )}
      {r.effect && <EffectDetail effect={r.effect} />}
      {!!r.reasons.length && (
        <p className="flip-npc-flag">{r.reasons.join(" · ")}</p>
      )}
      <dl className="pick-facts">
        <div>
          <dt>Buy / sell now per unit</dt>
          <dd>
            {exact(r.entry)} / {exact(r.immediate)}
          </dd>
        </div>
        <div>
          <dt>Spread · tax per unit ({DEFAULT_BAZAAR_TAX}%)</dt>
          <dd>
            {exact(r.spread)}% · {exact(r.tax)}
          </dd>
        </div>
        <div>
          <dt>Sell-back loss for {lot}</dt>
          <dd className="pick-down">{exact(r.loss * lot)} coins</dd>
        </div>
        <div>
          <dt>Break-even resale / unit</dt>
          <dd>{exact(r.breakEven)}</dd>
        </div>
        {r.avg && (
          <div>
            <dt>Average offer · usable days</dt>
            <dd>
              {exact(r.avg.offer)} · {r.avg.days}
            </dd>
          </div>
        )}
        <div>
          <dt>Recent bid target · rise needed</dt>
          <dd>
            {r.target === null
              ? "Insufficient history"
              : exact(r.target) + " · " + exact(Math.max(0, r.rise!)) + "%"}
          </dd>
        </div>
        {!stale && r.upside !== null && (
          <div>
            <dt>Net upside at target / unit</dt>
            <dd className="pick-up">+{exact(r.upside)}</dd>
          </div>
        )}
        <div>
          <dt>7d buy / sell volume</dt>
          <dd>
            {exact(r.buyVolume)} / {exact(r.sellVolume)}
          </dd>
        </div>
      </dl>
      <p className="trend-meta">
        {count} comparable {count === 1 ? "dip" : "dips"} · {recoveryDays} days
        · {e.hits} reached the bid target, {e.misses} missed, {e.incomplete}{" "}
        incomplete.
      </p>
      <button
        className="flip-evidence"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        Check past dips
      </button>
      {expanded && e.episodes?.length ? (
        <ul className="flip-episodes" aria-label="Comparable dip dates">
          {e.episodes.map(([d, drop, rise, outcome]) => (
            <li key={d}>
              <strong>{date(d)}</strong> · {exact(drop)}% dip · {exact(rise)}%
              bid rise needed ·{" "}
              {outcome === "open"
                ? "Incomplete follow-up"
                : outcome === "hit"
                  ? "Target reached"
                  : "Missed within 14 days"}
            </li>
          ))}
        </ul>
      ) : null}
      {expanded && (
        <HistoryEvidence
          item={{ ...r, hasBaseline: !!r.avg, change: r.npcChange }}
          days={days}
          through={through}
        />
      )}
    </MarketCard>
  );
}
export default function FlipSection() {
  const [board, setBoard] = useState<FlipBoard | null>(null),
    [error, setError] = useState("");
  const [days, setDays] = useState<FlipPeriod>(90),
    [discount, setDiscount] = useState(15),
    [lot, setLot] = useState(flipLot);
  const [selected, setSelected] = useState("");
  const now = useVisibleNow(30_000);
  useEffect(
    () =>
      visiblePoll(async (signal) => {
        try {
          const data = await marketRequest<{
            board: FlipBoard;
            error?: string;
          }>("flips" + (lot === flipLot ? "" : "?lot=" + lot), signal);
          if (data.board?.version !== flipVersion || data.board.lot !== lot)
            throw Error("Waiting for the update-aware flip board.");
          if (!signal.aborted) {
            setBoard(data.board);
            setError(data.error ?? "");
          }
        } catch (e) {
          if (!signal.aborted || signal.reason?.name === "TimeoutError")
            setError(
              e instanceof Error ? e.message : "Flip finder unavailable.",
            );
        }
      }, PAID_PILOT_INTERVAL),
    [lot],
  );
  const stale =
    !!error || !!board?.stale || (!!board && !isFresh(board.at, now));
  const listed = (rows: FlipRow[]) =>
    rows.filter(
      (r) => (r.discount ?? 0) >= discount || r.effect?.kind === "demand",
    );
  const rows = board && !stale ? listed(board.periods[days]) : [];
  const watch = board
    ? listed([...(stale ? board.periods[days] : []), ...board.watchlist[days]])
    : [];
  const changes =
    board?.changedItems.filter((c) => c.change.day > board.throughDay - days) ??
    [];
  const breaks =
    board?.breaks?.filter((b) => b.effect.onset! > board.throughDay - days) ??
    [];
  const render = (r: FlipRow) => (
    <FlipCard
      r={r}
      days={days}
      through={board!.throughDay}
      lot={lot}
      stale={stale}
    />
  );
  return (
    <section className="trend-section flip-page" aria-labelledby="flip-title">
      <header className="trend-head">
        <h2 id="flip-title">
          <Gem aria-hidden="true" /> Flip finder
        </h2>
        <div className="flip-controls">
          <label>
            Average over{" "}
            <select
              value={days}
              onChange={(e) => {
                setDays(Number(e.target.value) as FlipPeriod);
                setSelected("");
              }}
            >
              {flipPeriods.map((n) => (
                <option key={n} value={n}>
                  {n} days
                </option>
              ))}
            </select>
          </label>
          <label>
            Minimum discount{" "}
            <select
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value))}
            >
              {[5, 10, 15, 20, 25, 30, 40, 50].map((n) => (
                <option key={n} value={n}>
                  {n}%
                </option>
              ))}
            </select>
          </label>
          <label>
            Lot size{" "}
            <select
              value={lot}
              onChange={(e) => {
                setLot(Number(e.target.value));
                setBoard(null);
                setError("");
              }}
            >
              {flipLots.map((n) => (
                <option key={n} value={n}>
                  {n} items
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      {board ? (
        <>
          <p className="trend-meta">
            {stale ? "Last available snapshot" : "Snapshot"} ·{" "}
            {formatEstDateTime(board.at)} · Daily history through{" "}
            {date(board.throughDay)}
          </p>
          <h3>Actionable flips</h3>
          {rows.length ? (
            <MarketGrid
              key={days + "-" + discount}
              rows={rows}
              label="Actionable flips"
              renderCard={render}
            />
          ) : (
            <p className="trend-empty">
              {stale
                ? "Waiting for fresh order books."
                : "No flip meets the entry, exit and recovery checks at this discount."}
            </p>
          )}
          {changes.length > 0 && (
            <details className="flip-changes">
              <summary>NPC sell price changes ({changes.length})</summary>
              <p>
                Only full days after the latest change count.{" "}
                <a href={update.preview}>Oct 29 preview</a> ·{" "}
                <a href={update.candidate}>Nov 10 revision</a> ·{" "}
                <a href={update.release}>Release notes</a> ·{" "}
                <a href={update.snapshotDiff}>Archived item values</a> ·{" "}
                <a href={update.itemApi}>Item API</a>
              </p>
              <ul>
                {changes.map(({ id, name, change, cutoff, ready }) => (
                  <li key={id}>
                    <strong>{name}</strong>
                    <ChangeDetail id={id} c={change} />
                    <small>
                      {ready.includes(days)
                        ? "Using post-update average"
                        : "Waiting for post-update history"}
                    </small>
                    <button
                      className="flip-evidence"
                      aria-expanded={selected === id}
                      onClick={() => setSelected(selected === id ? "" : id)}
                    >
                      Check past dips
                    </button>
                    {selected === id && (
                      <HistoryEvidence
                        item={{
                          id,
                          name,
                          change,
                          cutoff: cutoff ?? change.day,
                          hasBaseline: ready.includes(days),
                        }}
                        days={days}
                        through={board.throughDay}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {breaks.length > 0 && (
            <details className="flip-changes flip-breaks">
              <summary>
                Price breaks with unknown cause ({breaks.length})
              </summary>
              <ul>
                {breaks.map(({ id, name, effect, ready }) => (
                  <li key={id}>
                    <strong>{name}</strong>
                    <span>
                      {date(effect.onset!)} · median bid{" "}
                      {exact(effect.reference!)} → {exact(effect.recent!)}
                    </span>
                    <small>
                      {effect.beforeCount} earlier quotes ·{" "}
                      {effect.observations} lower quotes ·{" "}
                      {ready.includes(days)
                        ? "Using the new baseline"
                        : "Waiting for more history"}
                    </small>
                    <button
                      className="flip-evidence"
                      aria-expanded={selected === "break-" + id}
                      onClick={() =>
                        setSelected(
                          selected === "break-" + id ? "" : "break-" + id,
                        )
                      }
                    >
                      Check past dips
                    </button>
                    {selected === "break-" + id && (
                      <HistoryEvidence
                        item={{
                          id,
                          name,
                          effect,
                          cutoff: effect.cutoff,
                          hasBaseline: ready.includes(days),
                        }}
                        days={days}
                        through={board.throughDay}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <h3>Watchlist</h3>
          {watch.length ? (
            <MarketGrid
              key={days + "-" + discount + "-watch"}
              rows={watch}
              label="Flip watchlist"
              renderCard={render}
            />
          ) : (
            <p>No watchlist items at this discount.</p>
          )}
        </>
      ) : (
        !error && <p role="status">Checking order books and daily prices…</p>
      )}
      <details className="trend-criteria">
        <summary>How the estimates work</summary>
        <p>
          Entry and immediate exit use the available orders for the selected
          lot. Each side needs {trendLiquidity.weeklyUnitsPerSide} weekly units
          and {trendLiquidity.unitsPerSide} units across{" "}
          {trendLiquidity.ordersPerSide} orders within{" "}
          {trendLiquidity.nearPricePct}% of the best quote. A lot spread above
          10% goes on watch. Actionable quotes expire after three minutes. The
          collector refreshes every 15 minutes.
        </p>
        <p>
          The average requires five usable days, 60% coverage and a quote in the
          last three days. The exit is the lower quartile of usable bids in the
          most recent 14 days of the active window. Net upside deducts the{" "}
          {DEFAULT_BAZAAR_TAX}% selling tax.
        </p>
        <p>
          The search checks 150 days for independent dips with a similar
          discount and required bid rise (within five percentage points or 25%
          of each measure, whichever is larger). Each episode gets a target from
          earlier days. A new episode needs a return to the prior target and a
          separate 14-day holding period.
        </p>
        <p>
          At least three resolved episodes, 75% resolved follow-up and
          two-thirds reaching target are required. Rows sort by hits divided by
          resolved comparable episodes plus two, then net return at target and
          spread. This is a ranking score. Daily quotes record prices.
          Historical order fills are unavailable.
        </p>
      </details>
    </section>
  );
}
