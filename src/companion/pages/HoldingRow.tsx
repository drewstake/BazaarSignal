import type { ReactNode } from "react";
import { exact, percent, ItemArt } from "../components";
import { SampleTime } from "../../SampleTime";
import { PixelIcon } from "../ui/Pixel";
import { Coins } from "./common";
import {
  notificationBaseline,
  type HoldingNotification,
} from "../../../shared/companion/notifications";
import type {
  Holding,
  HoldingValue,
} from "../../../shared/companion/portfolio";

export function notificationSummary(n: HoldingNotification, h: Holding) {
  const thresholds = [
    n.up === null ? "" : `↑ ${n.up}%`,
    n.down === null ? "" : `↓ ${n.down}%`,
  ]
    .filter(Boolean)
    .join(" ");
  return `${n.enabled ? "Enabled" : "Paused"} · ${thresholds} · baseline ${exact(notificationBaseline(n, h))}`;
}

/** One holding in the ledger: identity, three key figures, actions and details. */
export default function HoldingRow({
  holding: h,
  valuation: v,
  notification,
  now,
  busy,
  onEdit,
  onPurchase,
  onNotify,
  onDelete,
  children,
}: {
  holding: Holding;
  valuation: HoldingValue;
  notification?: HoldingNotification;
  now: number;
  busy: boolean;
  onEdit: () => void;
  onPurchase: () => void;
  onNotify: () => void;
  onDelete: () => void;
  children?: ReactNode;
}) {
  const unit = h.kind === "auction" ? "stack" : "unit",
    stale = v.freshness === "stale",
    loss = v.pnl !== null && v.pnl < 0;
  return (
    <article className="holding-row" aria-label={`${h.name} holding`}>
      <div className="holding-main">
        <div className="holding-identity">
          <span className="holding-art">
            <ItemArt id={h.itemId} size="small" />
          </span>
          <div className="holding-name">
            <h3>{h.name}</h3>
            <span className="holding-kind">
              {h.kind === "bazaar"
                ? "Bazaar"
                : `Auction House · stack of ${h.stackSize}`}
            </span>
            <span
              className={`holding-pnl ${v.pnl === null ? "none" : loss ? "loss" : "gain"}`}
            >
              {v.pnl === null ? (
                <>
                  <b>Value unavailable</b> · Waiting for price evidence
                </>
              ) : (
                <>
                  <b>
                    {v.pnl > 0 ? "+" : ""}
                    {exact(v.pnl)}
                  </b>{" "}
                  · {percent(v.returnPercent)}
                  <span className="sr-only"> unrealized return</span>
                </>
              )}
            </span>
          </div>
        </div>
        <dl className="holding-figures">
          <div>
            <dt>Quantity</dt>
            <dd>
              <strong>{exact(h.quantity)}</strong>{" "}
              <small>{h.kind === "auction" ? "stacks" : "items"}</small>
            </dd>
          </div>
          <div>
            <dt>Acquisition price</dt>
            <dd>
              <Coins value={h.costBasis / h.quantity} size={18} />
              <small>per {unit}</small>
              <small className="figure-total">
                Cost basis <b>{exact(h.costBasis)}</b>
              </small>
            </dd>
          </div>
          <div>
            <dt>
              {stale
                ? "Last-known estimate"
                : v.referencePrice === null
                  ? "Estimate"
                  : "Current estimate"}
            </dt>
            <dd>
              <Coins value={v.referencePrice} size={18} />
              {v.referencePrice !== null && <small>per {unit}</small>}
              <small className="figure-total">
                {v.value === null ? (
                  "Position value unavailable"
                ) : (
                  <>
                    Position <b>{exact(v.value)}</b>
                  </>
                )}
              </small>
            </dd>
          </div>
        </dl>
        <div className="holding-actions">
          <button className="button" disabled={busy} onClick={onEdit}>
            <PixelIcon name="pencil" />
            Edit
          </button>
          <button className="button" disabled={busy} onClick={onPurchase}>
            <PixelIcon name="plus" />
            Add purchase
          </button>
          <button className="button" disabled={busy} onClick={onNotify}>
            <PixelIcon name="bell" />
            {notification ? "Edit notification" : "Set notification"}
          </button>
          <button
            className="button icon-only quiet-danger"
            disabled={busy}
            onClick={onDelete}
            aria-label="Delete"
            title={`Delete ${h.name}`}
          >
            <PixelIcon name="trash" />
          </button>
        </div>
      </div>
      <div className="holding-foot">
        <span
          className={`holding-alert ${notification ? (notification.enabled ? "on" : "paused") : "off"}`}
        >
          <PixelIcon name="bell" size={14} />
          {notification
            ? notificationSummary(notification, h)
            : "Notifications off"}
        </span>
        <span className="holding-sample">
          {v.sampledAt ? (
            <>
              <b>{stale ? "Last-known estimate" : "Fresh sample"}</b> ·{" "}
              <SampleTime timestamp={v.sampledAt} now={now} />
            </>
          ) : (
            "No usable price sample"
          )}
        </span>
        <details className="holding-details">
          <summary>Valuation details</summary>
          <p className="reference">
            {v.reference}
            {h.kind === "auction" && ` · ${v.comparables} comparable listings`}
          </p>
          {h.kind === "auction" ? (
            <>
              <pre>{h.configuration}</pre>
              <p>
                At least three exact-configuration listings are required. The
                cache supplies up to 20 of the lowest matching asks. Units here
                are complete stacks, never extrapolated individual items.
              </p>
              {v.uncertainty.map((r, i) => (
                <p key={i}>{r}</p>
              ))}
              <p>{v.liquidationReason}</p>
            </>
          ) : v.liquidation ? (
            <p>
              Full-quantity {stale ? "last-known " : ""}after-tax liquidation
              estimate: <b>{exact(v.liquidation.value)} coins</b> ·{" "}
              {v.liquidation.taxPercent}% tax. Entire quantity fits visible
              bids. Unrealized P&L above uses the indicative top bid before fees
              and slippage.
            </p>
          ) : (
            <p>
              Full-quantity after-tax liquidation unavailable:{" "}
              {v.liquidationReason}
            </p>
          )}
        </details>
      </div>
      {children}
    </article>
  );
}
