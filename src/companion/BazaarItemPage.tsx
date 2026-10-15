import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Copy } from "lucide-react";
import { SampleTime } from "../SampleTime";
import { exact, ItemArt } from "./components";
import { holdingCatalogItem } from "./holding-catalog";
import { itemPageUrl } from "./item-route";
import {
  bookSideSummary,
  searchDetailStale,
  selectedBazaarDetail,
  type SearchMarketDetail,
} from "./bazaar-search-data";
import { pollingDirective, visiblePoll } from "./polling";
import { MARKET_HOUR } from "../../shared/market-schedule";
import SearchOrderBook from "./SearchOrderBook";
import "./bazaar-item-page.css";
import { useVisibleNow } from './use-visible-now';

export default function BazaarItemPage({ itemId }: { itemId: string }) {
  const item = holdingCatalogItem(itemId);
  const [detail, setDetail] = useState<SearchMarketDetail | null>(null);
  const now = useVisibleNow(30_000, !!item);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">(
    "idle",
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  useEffect(() => {
    heading.current?.focus();
    const previousTitle = document.title;
    document.title = `${item?.name ?? "Item not found"} | BazaarSignal`;
    return () => {
      document.title = previousTitle;
    };
  }, [itemId]);
  useEffect(() => {
    if (!item) return;
    let active = true;
    const stopPolling = visiblePoll(async (signal) => {
      const result = await selectedBazaarDetail(item.id, signal);
      if (active) {
        setDetail(result);
      }
    }, MARKET_HOUR);
    return () => {
      active = false;
      stopPolling();
    };
  }, [itemId]);
  const buy = bookSideSummary(detail?.item?.asks, "buy");
  const sell = bookSideSummary(detail?.item?.bids, "sell");
  const noOrders = buy?.levels === 0 && sell?.levels === 0;
  const stale = detail && searchDetailStale(detail, now);
  const policy = pollingDirective();
  const paused = policy.mode === "paused" || (policy.retryAt ?? 0) > now;
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(itemPageUrl(itemId));
      setCopyState("copied");
    } catch {
      setCopyState("manual");
    }
  }
  return (
    <section
      className="bazaar-item-page"
      aria-labelledby={headingId}
      aria-busy={!!item && !detail}
    >
      <div className="bazaar-item-heading">
        <a
          className="bazaar-item-back"
          href="#view=portfolios"
          aria-label="Back to Portfolio"
          title="Back to Portfolio"
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </a>
        {item && <ItemArt id={item.id} size="small" />}
        <div>
          <h1 id={headingId} ref={heading} tabIndex={-1} title={item?.id}>
            {item?.name ?? "Item not found"}
          </h1>
        </div>
        {item && (
          <div className="bazaar-item-share">
            <button
              type="button"
              aria-label="Copy item link"
              onClick={() => void copyLink()}
            >
              <Copy size={16} aria-hidden="true" /> Copy link
            </button>
            <span role="status">
              {copyState === "copied" ? "Link copied" : ""}
            </span>
          </div>
        )}
      </div>
      {copyState === "manual" && (
        <label className="bazaar-item-link">
          Copy this item link:
          <input
            aria-label="Item link"
            readOnly
            value={itemPageUrl(itemId)}
            onFocus={(event) => event.target.select()}
          />
        </label>
      )}
      {!item ? (
        <p>Item not in the Bazaar catalog. Try another name or ID.</p>
      ) : !detail ? (
        <p role="status">Loading cached market data…</p>
      ) : (
        <>
          <div className="bazaar-item-snapshot">
            <p
              className={`bazaar-search-status ${!detail.item || noOrders || stale ? "is-stale" : ""}`}
              role="status"
            >
              {detail.fixture
                ? "Demo data"
                : !detail.item
                  ? "Data unavailable"
                  : noOrders
                    ? "No orders in saved snapshot"
                    : stale
                      ? "Stale data"
                      : "Hourly snapshot"}
              {!detail.fixture && noOrders && stale && " · Stale data"}
              {paused && " · Updates paused"}
            </p>
            <SampleTime
              timestamp={detail.item?.upstreamAt ?? 0}
              now={now}
              compact
            />
            {detail.localSnapshot && (
              <span>Local snapshot · Collection paused</span>
            )}
          </div>
          {detail.error && (
            <p className="bazaar-search-error">{detail.error}</p>
          )}
          {detail.item && (
            <>
              <dl className="bazaar-search-prices">
                <div>
                  <dt>Instant buy</dt>
                  <dd>
                    {buy?.price != null
                      ? `${exact(buy.price)} coins`
                      : "Unavailable"}
                  </dd>
                  <dd
                    className="bazaar-price-depth"
                    title="Available to buy in the saved book"
                  >
                    {buy
                      ? `${exact(buy.quantity)} items · ${exact(buy.orders)} orders · ${buy.levels} ${buy.levels === 1 ? "level" : "levels"}`
                      : "Depth unavailable"}
                  </dd>
                </div>
                <div>
                  <dt>Instant sell</dt>
                  <dd>
                    {sell?.price != null
                      ? `${exact(sell.price)} coins`
                      : "Unavailable"}
                  </dd>
                  <dd
                    className="bazaar-price-depth"
                    title="Available to sell in the saved book"
                  >
                    {sell
                      ? `${exact(sell.quantity)} items · ${exact(sell.orders)} orders · ${sell.levels} ${sell.levels === 1 ? "level" : "levels"}`
                      : "Depth unavailable"}
                  </dd>
                </div>
              </dl>
              <SearchOrderBook
                asks={detail.item.asks}
                bids={detail.item.bids}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
