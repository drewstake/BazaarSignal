import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, X } from "lucide-react";
import type {
  AuctionOpportunity,
  BazaarFilters,
  BazaarItem,
  Listing,
} from "../../shared/companion/types";
import {
  bazaarTrade,
  quoteBazaar,
  strategyLabels,
} from "../../shared/companion/bazaar";
import { auctionComparison } from "../../shared/companion/auction-comparison";
import { activeOpportunity } from "../../shared/companion/active-auctions";
import { SampleTime } from "../SampleTime";
import { BazaarOrderBook } from "./OrderBook";
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
  overlay = false,
}: {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  overlay?: boolean;
}) {
  const [mobile, setMobile] = useState(
      () => matchMedia("(max-width: 1100px)").matches,
    ),
    dialog = useRef<HTMLDialogElement>(null);
  const useDialog = mobile || overlay;
  useEffect(() => {
    const q = matchMedia("(max-width: 1100px)"),
      change = () => setMobile(q.matches);
    q.addEventListener("change", change);
    return () => q.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (useDialog && dialog.current) {
      if (open && !dialog.current.open) dialog.current.showModal();
      if (!open && dialog.current.open) dialog.current.close();
    }
  }, [useDialog, open]);
  const content = (
    <>
      <div className="inspector-heading">
        <h2>Item Details</h2>
        <span className="paper-pin" aria-hidden="true" />
        {useDialog && (
          <button aria-label="Close item details" onClick={onClose}>
            <X size={22} />
          </button>
        )}
      </div>
      {children}
    </>
  );
  return useDialog ? (
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
  const q = quoteBazaar(item, filters),
    trade = bazaarTrade(item, filters);
  const visibleConcerns =
    q?.concerns.filter(
      (c) =>
        !c.startsWith("Last sampled estimate") &&
        !c.startsWith("Price moved more than 15%"),
    ) ?? [];
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
      <p className="data-time">
        <SampleTime timestamp={item.upstreamAt} compact />
      </p>
      {!q && (
        <div className="inspector-block">
          <h4>
            Price per item <span>(sampled)</span>
          </h4>
          <dl className="price-table">
            <div>
              <dt>Buy</dt>
              <dd>
                <Coin value={trade.buy?.unit} full />
              </dd>
            </div>
            <div>
              <dt>Sell before tax</dt>
              <dd>
                <Coin value={trade.sale?.unit} full />
              </dd>
            </div>
          </dl>
        </div>
      )}
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
          <p className="estimate-fees">
            Includes {filters.taxPercent * (item.feeContext?.multiplier ?? 1)}%
            sale tax
            {q.executionCost > 0
              ? ` and ${exact(q.executionCost)} coins in additional costs`
              : ""}
            . {!q.fresh && "Historical estimate; check in-game prices. "}Fills
            and profit are not guaranteed.
          </p>
          {visibleConcerns.length > 0 && (
            <ul className="concerns">
              {visibleConcerns.map((c) => (
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
          Profit unavailable: the full quantity needs valid prices on both sides
          and fee evidence from the same collection period.
        </p>
      )}
      <BazaarOrderBook key={item.id} item={item} />
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
                <dt>
                  Sale tax (
                  {filters.taxPercent * (item.feeContext?.multiplier ?? 1)}%)
                </dt>
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
              {item.feeContext
                ? `Fee evidence sampled ${new Date(item.feeContext.checkedAt).toLocaleString()}. ${item.feeContext.explanation.replace("Current mayor", "Sampled mayor")}`
                : "Fixture assumption: standard taxes with your selected Bazaar Flipper tier."}{" "}
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
              <div>
                <dt>Highest buy order / item</dt>
                <dd>
                  <Coin value={item.bids[0]?.pricePerUnit} full />
                </dd>
              </div>
              <div>
                <dt>Lowest sell offer / item</dt>
                <dd>
                  <Coin value={item.asks[0]?.pricePerUnit} full />
                </dd>
              </div>
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
        <p>
          <SampleTime
            timestamp={item.upstreamAt}
            observedAt={item.observedAt}
          />
        </p>
      </details>
    </>
  );
}
export function AuctionGroupInspector({
  opportunity,
  duration,
  now,
  isSaved,
  save,
  copySeller,
  sellerLabel,
  copyBusy,
}: {
  opportunity: AuctionOpportunity;
  duration: number;
  now: number;
  isSaved: (id: string) => boolean;
  save: (listing: Listing) => void;
  copySeller: (o: AuctionOpportunity) => void;
  sellerLabel: (o: AuctionOpportunity) => string;
  copyBusy: boolean;
}) {
  const [selected, setSelected] = useState(opportunity.listing.id);
  const [descending, setDescending] = useState(false);
  const group = opportunity.group;
  const listings = group?.matchingListings ?? [opportunity.listing];
  const listing = listings.find((l) => l.id === selected) ?? listings[0];
  const o = group
    ? activeOpportunity(
        listing,
        group.comparisonPool,
        now,
        duration,
        opportunity.feeContext,
      )
    : opportunity;
  return (
    <>
      {group && (
        <section
          className="auction-group inspector-section"
          aria-label="Matching auctions"
        >
          <h3>{opportunity.listing.variant.name}</h3>
          <p>
            {listings.length} matching auctions ·{" "}
            {new Set(listings.map((l) => l.variant.fingerprint)).size}{" "}
            configurations
          </p>
          <label className="field">
            <span>Sort matching auctions</span>
            <select
              value={descending ? "desc" : "asc"}
              onChange={(e) => setDescending(e.target.value === "desc")}
            >
              <option value="asc">Price: low to high</option>
              <option value="desc">Price: high to low</option>
            </select>
          </label>
          <p>
            Purchase filters apply here. The selected listing’s evidence
            includes all exact matches in the cached snapshot, including asks
            outside your budget.
          </p>
          <div
            className="auction-group-list"
            tabIndex={0}
            aria-label="All matching listings"
          >
            {[...listings]
              .sort(
                (a, b) =>
                  (descending ? b.price - a.price : a.price - b.price) ||
                  a.id.localeCompare(b.id),
              )
              .map((l) => {
                const status =
                  l.status !== "active"
                    ? l.status
                    : l.end <= now
                      ? "expired"
                      : now - l.upstreamAt > 180000
                        ? "stale"
                        : "active in snapshot";
                return (
                  <article
                    key={l.id}
                    className="auction-listing-row"
                    data-listing-id={l.id}
                  >
                    <button
                      className="auction-listing-select"
                      aria-pressed={l.id === o.listing.id}
                      onClick={() => setSelected(l.id)}
                      aria-label={`Select auction ${l.id}`}
                    >
                      <strong>
                        <Coin value={l.price} full /> · {l.variant.quantity} ×{" "}
                        {titleCase(l.variant.rarity)}
                      </strong>
                      <span>
                        Seller: {l.sellerName ?? l.seller ?? "unavailable"}
                      </span>
                      <span>
                        Enchantments:{" "}
                        {Object.entries(l.variant.enchantments)
                          .map(([k, v]) => `${titleCase(k)} ${v}`)
                          .join(", ") || "none"}
                      </span>
                      <span>
                        Upgrades:{" "}
                        {Object.entries(l.variant.modifiers)
                          .filter(([k]) => k !== "headTextures")
                          .map(
                            ([k, v]) =>
                              `${titleCase(k)}: ${typeof v === "object" ? JSON.stringify(v) : v}`,
                          )
                          .join(" · ") || "none"}
                      </span>
                      <span className="fingerprint">
                        Configuration {l.variant.fingerprint}
                      </span>
                      <span>
                        <SampleTime timestamp={l.upstreamAt} compact /> ·{" "}
                        {status}
                      </span>
                    </button>
                    <button
                      className={`save-icon ${isSaved(l.id) ? "is-saved" : ""}`}
                      onClick={() => save(l)}
                      aria-label={`${isSaved(l.id) ? "Remove" : "Save"} auction ${l.id}`}
                      aria-pressed={isSaved(l.id)}
                    >
                      <SkyIcon name="favorite-star" size={26} />
                    </button>
                  </article>
                );
              })}
          </div>
        </section>
      )}
      <AuctionInspector
        key={o.listing.id}
        opportunity={o}
        duration={duration}
        saved={isSaved(o.listing.id)}
        save={() => save(o.listing)}
      />
      {o.listing.status === "active" && (
        <button
          className="button blue watch-button"
          onClick={() => copySeller(o)}
          disabled={copyBusy}
          aria-label={`Copy seller command for selected ${o.listing.variant.name}`}
        >
          {sellerLabel(o)}
        </button>
      )}
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
  const comparison = auctionComparison(o, duration);
  const v = o.listing.variant,
    val = comparison.valuation;
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
        {comparison.sampled && " in snapshot"}
      </span>
      <div className="inspector-block">
        <h4>
          Buy <span className="arrow">→</span> Conservative resale estimate
        </h4>
        <PriceComparison
          buy={o.listing.price}
          askingPrice
          sampled={comparison.sampled}
          sell={val.estimate}
          profit={comparison.profit}
          roi={comparison.roi}
          full
        />
        {comparison.sampled && (
          <p>
            <SampleTime timestamp={o.listing.upstreamAt} compact /> · Historical
            asking prices and snapshot fees. Check in-game prices and
            availability before trading.
          </p>
        )}
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
            <dt>Arithmetic AH average (context only)</dt>
            <dd>{exact(val.arithmeticMean)}</dd>
          </div>
          <div>
            <dt>Known comparison sellers</dt>
            <dd>{val.sellerCount ?? "—"}</dd>
          </div>
          <div>
            <dt>Excluded upper outliers</dt>
            <dd>{val.excludedCount}</dd>
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
            <dt>
              {comparison.sampled
                ? "Matching listings in snapshot"
                : "Matching active listings"}
            </dt>
            <dd>{val.count}</dd>
          </div>
        </dl>
        <p>
          Snapshot {new Date(val.windowStart).toLocaleString()} · sampled BIN
          asking prices.
        </p>
        {val.reasons.map((r) => (
          <p key={r}>{r}</p>
        ))}
        <details>
          <summary>
            {comparison.sampled
              ? "Comparable listings in snapshot"
              : "Comparable active listings"}
          </summary>
          {(val.listings ?? []).length ? (
            <div
              className="auction-evidence-scroll"
              tabIndex={0}
              aria-label="All comparison evidence"
            >
              <table>
                <caption>Exact configuration matches</caption>
                <thead>
                  <tr>
                    <th>Ends</th>
                    <th>Price</th>
                    <th>Seller / evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {(val.listings ?? []).map((s) => (
                    <tr key={s.id}>
                      <td>{new Date(s.end).toLocaleString()}</td>
                      <td>{exact(s.price)}</td>
                      <td>
                        {s.sellerName ?? s.seller ?? "Seller unavailable"}
                        <br />
                        {s.excluded ?? "Included"}
                        <small className="fingerprint">{s.id}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
          Comparison differences: none for exact matches. Few exact matches
          reduce confidence; no matches means no estimate. Clean and upgraded
          items are never pooled.
        </p>
        <small className="fingerprint">Fingerprint {v.fingerprint}</small>
      </div>
      {comparison.flags.length > 0 && (
        <ul className="concerns">
          {comparison.flags.map((flag) => (
            <li key={flag}>{flag}</li>
          ))}
        </ul>
      )}
      <div className="inspector-section">
        <h4>
          {comparison.sampled ? "Sampled resale fees" : "Resale fees"} ·{" "}
          {duration} hours
        </h4>
        <dl>
          <div>
            <dt>BIN listing fee</dt>
            <dd>{exact(comparison.fees?.listing)}</dd>
          </div>
          <div>
            <dt>Duration fee</dt>
            <dd>{exact(comparison.fees?.duration)}</dd>
          </div>
          <div>
            <dt>Collection tax</dt>
            <dd>{exact(comparison.fees?.claim)}</dd>
          </div>
          <div>
            <dt>Required capital incl. listing</dt>
            <dd>{exact(comparison.capital)}</dd>
          </div>
        </dl>
        <p>
          {o.feeContext
            ? `Fee evidence sampled ${new Date(o.feeContext.checkedAt).toLocaleString()}. ${o.feeContext.explanation.replace("Current mayor", "Sampled mayor")}`
            : "Snapshot fee evidence unavailable; after-fee gap withheld."}{" "}
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
