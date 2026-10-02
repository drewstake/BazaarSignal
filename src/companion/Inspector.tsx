import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, X } from "lucide-react";
import type {
  AuctionOpportunity,
  BazaarFilters,
  BazaarItem,
} from "../../shared/companion/types";
import { bazaarTrade, quoteBazaar, strategyLabels } from "../../shared/companion/bazaar";
import { SampleTime } from '../SampleTime';
import {
  artGlow,
  SkyIcon,
  Coin,
  compact,
  EmptyState,
  EnchantmentList,
  exact,
  ItemArt,
  PriceComparison,
  Quantity,
  RarityRibbon,
  titleCase,
} from "./components";
import { checkAuction, fixtureMode } from "./api";
export function InspectorShell({
  children,
  open,
  onClose,
}: {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  const [mobile, setMobile] = useState(
      () => matchMedia("(max-width: 1100px)").matches,
    ),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const q = matchMedia("(max-width: 1100px)"),
      change = () => setMobile(q.matches);
    q.addEventListener("change", change);
    return () => q.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (mobile && dialog.current) {
      if (open && !dialog.current.open) dialog.current.showModal();
      if (!open && dialog.current.open) dialog.current.close();
    }
  }, [mobile, open]);
  const content = (
    <>
      <div className="inspector-heading">
        <h2>Item Details</h2>
        <span className="paper-pin" aria-hidden="true" />
        {mobile && (
          <button aria-label="Close item details" onClick={onClose}>
            <X size={22} />
          </button>
        )}
      </div>
      {children}
    </>
  );
  return mobile ? (
    <dialog
      className="inspector inspector-sheet"
      ref={dialog}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label="Item details"
    >
      {content}
    </dialog>
  ) : (
    <aside className="inspector" aria-label="Item details">
      {content}
    </aside>
  );
}
function InspectorItem({
  id,
  name,
  rarity,
  detail,
  saved,
  save,
}: {
  id: string;
  name: string;
  rarity: string;
  detail: ReactNode;
  saved: boolean;
  save: () => void;
}) {
  return (
    <div className="inspector-item">
      <span className="inspector-icon" style={artGlow(id)}>
        <ItemArt id={id} />
      </span>
      <div>
        <h3>{name}</h3>
        <RarityRibbon rarity={rarity} />
        <p>{detail}</p>
      </div>
      <button
        className={`inspector-star save-icon ${saved ? "is-saved" : ""}`}
        onClick={save}
        aria-label={`${saved ? "Remove" : "Save"} ${name}`}
        aria-pressed={saved}
      >
        <SkyIcon name="favorite-star" size={34} />
      </button>
    </div>
  );
}
export function BazaarInspector({
  item,
  filters,
  set,
  saved,
  save,
}: {
  item: BazaarItem;
  filters: BazaarFilters;
  set: (p: Partial<BazaarFilters>) => void;
  saved: boolean;
  save: () => void;
}) {
  const q = quoteBazaar(item, filters), trade = bazaarTrade(item, filters);
  return (
    <>
      <InspectorItem
        id={item.id}
        name={item.name}
        rarity={item.rarity}
        detail={`${titleCase(item.category)} · Bazaar item`}
        saved={saved}
        save={save}
      />
      <div className="inspector-controls">
        <Quantity
          value={filters.quantity}
          onChange={(quantity) => set({ quantity })}
        />
        <label className="field inspector-strategy">
          <span>Strategy</span>
          <select
            value={filters.strategy}
            onChange={(e) =>
              set({ strategy: e.target.value as BazaarFilters["strategy"] })
            }
          >
            {Object.entries(strategyLabels).map(([id, label]) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="data-time"><SampleTime timestamp={item.upstreamAt} compact /></p>
      {!q && <div className="inspector-block">
        <h4>Price per item <span>(sampled)</span></h4>
        <dl className="price-table">
          <div><dt>Buy</dt><dd><Coin value={trade.buy?.unit} full /></dd></div>
          <div><dt>Sell before tax</dt><dd><Coin value={trade.sale?.unit} full /></dd></div>
        </dl>
      </div>}
      {q ? (
        <>
          <p className="wait-note">{q.waits}</p>
          <div className="inspector-block">
            <h4>
              Totals for {q.quantity} {q.quantity === 1 ? "item" : "items"}
            </h4>
            <PriceComparison
              buy={q.acquisition}
              sell={q.grossSale}
              profit={q.profit}
              roi={q.roi}
              full
              sampled={!q.fresh}
            />
          </div>
          <p className="estimate-fees">Includes {filters.taxPercent * (item.feeContext?.multiplier ?? 1)}% sale tax{q.executionCost > 0 ? ` and ${exact(q.executionCost)} coins in additional costs` : ""}. {!q.fresh && "Historical estimate; check in-game prices. "}Fills and profit are not guaranteed.</p>
          {q.concerns.some(c => !c.startsWith("Last sampled estimate")) && (
            <ul className="concerns">
              {q.concerns.filter(c => !c.startsWith("Last sampled estimate")).map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          {q.capital > filters.budget && (
            <p className="notice warning">This quantity exceeds your budget.</p>
          )}
        </>
      ) : (
        <p className="notice warning">
          Profit unavailable: the full quantity needs valid prices on both sides and fee evidence from the same collection period.
        </p>
      )}
      <button className="button green watch-button" onClick={save}>
        <SkyIcon name="favorite-heart" size={30} className="watch-heart" />
        {saved ? "Remove from Watchlist" : "Add to Watchlist"}
      </button>
      <a
        className="inspector-alert"
        href={`#item=${encodeURIComponent(item.id)}&alert=1`}
      >
        <SkyIcon name="alert-bell" size={22} />
        Set a price alert
      </a>
      {q && (
        <>
          <details className="inspector-section">
            <summary>
              <h4>Fees & calculation</h4>
            </summary>
            <dl>
              <div>
                <dt>Buy / item</dt>
                <dd>
                  <Coin value={q.acquisitionUnit} full />
                </dd>
              </div>
              <div>
                <dt>Sell / item</dt>
                <dd>
                  <Coin value={q.exitUnit} full />
                </dd>
              </div>
              <div>
                <dt>Sale tax ({filters.taxPercent * (item.feeContext?.multiplier ?? 1)}%)</dt>
                <dd>−{exact(q.tax)}</dd>
              </div>
              <div>
                <dt>Additional costs</dt>
                <dd>−{exact(q.executionCost)}</dd>
              </div>
              <div>
                <dt>Net sale proceeds</dt>
                <dd>{exact(q.netSale)}</dd>
              </div>
              <div>
                <dt>Required capital</dt>
                <dd>{exact(q.capital)}</dd>
              </div>
              <div>
                <dt>Profit / unit</dt>
                <dd>{exact(q.unitProfit)}</dd>
              </div>
              <div>
                <dt>Slippage included</dt>
                <dd>{exact(q.slippage)}</dd>
              </div>
            </dl>
            <p>
              {item.feeContext ? `Fee evidence sampled ${new Date(item.feeContext.checkedAt).toLocaleString()}. ${item.feeContext.explanation.replace('Current mayor', 'Sampled mayor')}` :
                "Fixture assumption: standard taxes with your selected Bazaar Flipper tier."}{" "}
              Passive prices join the best bid/ask without outbidding.
            </p>
          </details>
          <details className="inspector-section">
            <summary>
              <h4>
                Liquidity & order book{" "}
                <span className={`liquidity ${q.liquidity}`}>
                  {titleCase(q.liquidity)}
                </span>
              </h4>
            </summary>
            <dl>
              <div><dt>Highest buy order / item</dt><dd><Coin value={item.bids[0]?.pricePerUnit} full /></dd></div>
              <div><dt>Lowest sell offer / item</dt><dd><Coin value={item.asks[0]?.pricePerUnit} full /></dd></div>
              <div>
                <dt>Instant-buy activity</dt>
                <dd>{compact(item.instantBuyActivity7d)}</dd>
              </div>
              <div>
                <dt>Instant-sell activity</dt>
                <dd>{compact(item.instantSellActivity7d)}</dd>
              </div>
              <div>
                <dt>Your share of weaker side</dt>
                <dd>
                  {q.activityShare === null
                    ? "Unknown"
                    : `${q.activityShare.toFixed(4)}%`}
                </dd>
              </div>
              <div>
                <dt>Visible asks / bids</dt>
                <dd>
                  {compact(item.asks.reduce((n, l) => n + l.amount, 0))} /{" "}
                  {compact(item.bids.reduce((n, l) => n + l.amount, 0))}
                </dd>
              </div>
              <div>
                <dt>Open buy-order units</dt>
                <dd>{compact(item.openBuyQuantity)}</dd>
              </div>
              <div>
                <dt>Open sell-offer units</dt>
                <dd>{compact(item.openSellQuantity)}</dd>
              </div>
              <div>
                <dt>Buy orders / sell offers</dt>
                <dd>
                  {exact(item.buyOrderCount)} / {exact(item.sellOfferCount)}
                </dd>
              </div>
            </dl>
            <p>
              Activity: reported 7-day units + sampled state. Exact short-window
              trades and fill time are unavailable. Outstanding orders are
              competition, not completed trades.
            </p>
            <p>
              Strong: 100K+ activity each side and ≤0.1% share. Balanced: 1K+
              and ≤1% share, with depth covering quantity. Neither guarantees a
              fill.
            </p>
          </details>
        </>
      )}
      <details className="inspector-section">
        <summary>Sample timestamps</summary>
        <p><SampleTime timestamp={item.upstreamAt} observedAt={item.observedAt} /></p>
      </details>
    </>
  );
}
export function AuctionInspector({
  opportunity: o,
  saved,
  save,
  duration,
}: {
  opportunity: AuctionOpportunity;
  saved: boolean;
  save: () => void;
  duration: number;
}) {
  const [check, setCheck] = useState<{
      status: string;
      command: string | null;
      source: string;
      checkedAt: number;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  const v = o.listing.variant,
    val = o.valuation;
  useEffect(() => {
    setCheck(null);
    setCopied(false);
    setError("");
  }, [o.listing.id]);
  async function recheck() {
    setBusy(true);
    setError("");
    try {
      setCheck(await checkAuction(o.listing.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Availability check failed");
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    setBusy(true);
    setError("");
    try {
      const latest = await checkAuction(o.listing.id);
      setCheck(latest);
      if (!latest.command)
        throw new Error(`Listing ${latest.status}; command withheld.`);
      await navigator.clipboard.writeText(latest.command);
      setCopied(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Copy failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <InspectorItem
        id={v.itemId}
        name={v.name}
        rarity={v.rarity}
        detail={`${v.quantity} item · ${titleCase(v.category)} · BIN listing`}
        saved={saved}
        save={save}
      />
      <span className={`confidence ${val.confidence}`}>
        {titleCase(val.confidence)} confidence · {val.count} matching listings
      </span>
      <div className="inspector-block">
        <h4>
          Buy <span className="arrow">→</span> AH Average
        </h4>
        <PriceComparison
          buy={o.listing.price}
          askingPrice
          sell={val.estimate}
          profit={o.profit}
          roi={o.roi}
          full
        />
      </div>
      <div className="inspector-section">
        <h4>The comparison evidence</h4>
        <dl>
          <div>
            <dt>Asking-price range (25th–75th)</dt>
            <dd>
              {compact(val.low)} – {compact(val.high)}
            </dd>
          </div>
          <div>
            <dt>Median asking price</dt>
            <dd>{exact(val.median)}</dd>
          </div>
          <div>
            <dt>Current AH average</dt>
            <dd>{exact(val.estimate)}</dd>
          </div>
          <div>
            <dt>Dispersion (IQR / median)</dt>
            <dd>
              {val.dispersion === null
                ? "—"
                : `${(val.dispersion * 100).toFixed(1)}%`}
            </dd>
          </div>
          <div>
            <dt>Matching active listings</dt>
            <dd>{val.count}</dd>
          </div>
        </dl>
        <p>
          Snapshot {new Date(val.windowStart).toLocaleTimeString()} · active BIN
          asking prices.
        </p>
        {val.reasons.map((r) => (
          <p key={r}>{r}</p>
        ))}
        <details>
          <summary>Comparable active listings</summary>
          {(val.listings ?? []).length ? (
            <table>
              <caption>Exact configuration matches</caption>
              <thead>
                <tr>
                  <th>Ends</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {(val.listings ?? []).map((s) => (
                  <tr key={s.id}>
                    <td>{new Date(s.end).toLocaleString()}</td>
                    <td>{exact(s.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No matching active listings.</p>
          )}
        </details>
      </div>
      <div className="inspector-section">
        <h4>Exact enchantments</h4>
        <EnchantmentList enchants={v.enchantments} />
        <h4>Upgrades & configuration</h4>
        <dl className="modifiers">
          {Object.entries(v.modifiers).map(([k, value]) => (
            <div key={k}>
              <dt>{titleCase(k)}</dt>
              <dd>
                {typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value)}
              </dd>
            </div>
          ))}
        </dl>
        <p>
          Comparison differences: none for exact matches. Scarce exact matches
          lead to insufficient evidence; clean and upgraded items are never
          pooled.
        </p>
        <small className="fingerprint">Fingerprint {v.fingerprint}</small>
      </div>
      {o.flags.length > 0 && (
        <ul className="concerns">
          {o.flags.map((flag) => (
            <li key={flag}>{flag}</li>
          ))}
        </ul>
      )}
      <div className="inspector-section">
        <h4>Resale fees · {duration} hours</h4>
        <dl>
          <div>
            <dt>BIN listing fee</dt>
            <dd>{exact(o.fees?.listing)}</dd>
          </div>
          <div>
            <dt>Duration fee</dt>
            <dd>{exact(o.fees?.duration)}</dd>
          </div>
          <div>
            <dt>Collection tax</dt>
            <dd>{exact(o.fees?.claim)}</dd>
          </div>
          <div>
            <dt>Required capital incl. listing</dt>
            <dd>{exact(o.capital)}</dd>
          </div>
        </dl>
        <p>
          {o.feeContext?.explanation ??
            "Fixture assumption: standard fee schedule."}{" "}
          Fees include one listing attempt. Re-listing adds costs.
        </p>
      </div>
      <div className="availability">
        <p>
          Listing age{" "}
          {Math.max(0, Math.floor((Date.now() - o.listing.start) / 60000))} min
          ·{" "}
          {check
            ? check.status
            : o.listing.status === "active"
              ? "not rechecked"
              : o.listing.status}
        </p>
        <button className="button blue" onClick={recheck} disabled={busy}>
          {busy ? "Checking…" : "Recheck availability"}
        </button>
        {check && (
          <p>
            Checked {new Date(check.checkedAt).toLocaleTimeString()} ·{" "}
            {check.source}. Cached status can change in-game.
          </p>
        )}
        {check?.command && (
          <button className="button green" disabled={busy} onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
            {copied
              ? "Command copied"
              : fixtureMode
                ? "Copy fixture command"
                : "Copy auction command"}
          </button>
        )}
        {error && (
          <p className="notice warning" role="alert">
            {error}
          </p>
        )}
      </div>
      <button className="button green watch-button" onClick={save}>
        <SkyIcon name="favorite-heart" size={30} className="watch-heart" />
        {saved ? "Remove from Watchlist" : "Add to Watchlist"}
      </button>
      <p className="data-time">
        Snapshot {new Date(o.listing.upstreamAt).toLocaleTimeString()}
      </p>
    </>
  );
}
export function BlankInspector() {
  return (
    <EmptyState title="Select an item">
      Open a result for prices, fees and liquidity.
    </EmptyState>
  );
}
