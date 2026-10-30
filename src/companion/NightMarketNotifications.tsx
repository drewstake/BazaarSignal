import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Mail,
  Pause,
  Pencil,
  Play,
  Radio,
  Trash2,
} from "lucide-react";
import type { HoldingNotification } from "../../shared/companion/notifications";
import type { Portfolio } from "../../shared/companion/portfolio";
import { exact, ItemArt, SkyIcon } from "./components";
import "./night-market-notifications.css";

type NotificationsProps = {
  notifications: HoldingNotification[];
  portfolios: Portfolio[];
  baselines: Record<string, number | null>;
  emailEnabled: boolean;
  paused: boolean;
  fixture: boolean;
  loading: boolean;
  busy: boolean;
  edit: (notification: HoldingNotification) => void;
  change: (
    notification: HoldingNotification,
    operation: "pause" | "resume" | "delete",
  ) => void;
};

export default function NightMarketNotifications({
  notifications,
  portfolios,
  baselines,
  emailEnabled,
  paused,
  fixture,
  loading,
  busy,
  edit,
  change,
}: NotificationsProps) {
  const alerts = notifications.filter((notification) => !notification.deleted);
  const enabled = alerts.filter(
    (notification) =>
      notification.enabled &&
      portfolios.some(
        (portfolio) =>
          portfolio.id === notification.portfolioId && !portfolio.deleted,
      ),
  ).length;

  return (
    <section className="night-notifications" aria-label="Holding notifications">
      <div className="notification-overview">
        <div className="notification-overview-item">
          <div className="notification-overview-icon">
            <SkyIcon name="alert-bell" size={30} />
          </div>
          <div>
            <span className="notification-overview-label">Alerts set</span>
            <strong>{loading ? "—" : alerts.length}</strong>
            <span>{loading ? "Loading…" : `${enabled} enabled`}</span>
          </div>
        </div>
        <a
          className="notification-overview-item notification-settings"
          href="#view=settings&section=account"
        >
          <div className="notification-overview-icon">
            <Mail size={23} aria-hidden="true" />
          </div>
          <div>
            <span className="notification-overview-label">Email delivery</span>
            <strong>{loading ? "—" : emailEnabled ? "On" : "Off"}</strong>
            <span>
              Account settings <ChevronRight size={12} aria-hidden="true" />
            </span>
          </div>
        </a>
        <div className="notification-overview-item">
          <div className="notification-overview-icon notification-check-icon">
            <Radio size={23} aria-hidden="true" />
          </div>
          <div>
            <span className="notification-overview-label">Market checks</span>
            <strong>
              {fixture
                ? "Demo prices"
                : paused
                  ? "Paused"
                  : "Fresh data required"}
            </strong>
            <span>
              {fixture
                ? "Alerts are not sent"
                : paused
                  ? "Your alerts stay saved"
                  : "Alerts wait for eligible prices"}
            </span>
          </div>
        </div>
      </div>

      {!loading &&
        (alerts.length === 0 ? (
          <div className="notification-empty">
            <div className="notification-empty-icon">
              <SkyIcon name="alert-bell" size={68} />
            </div>
            <h2>No holding notifications yet.</h2>
            <p>Choose a holding and set your price thresholds.</p>
            <a className="notification-primary-link" href="#view=portfolios">
              Go to portfolio <ChevronRight size={16} aria-hidden="true" />
            </a>
          </div>
        ) : (
          <>
            <div className="notification-list-heading">
              <h2>Your alerts</h2>
              <a href="#view=portfolios">
                Add an alert <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </div>
            <div
              className="notification-card-grid"
              role="region"
              aria-label="Your alerts"
            >
              {alerts.map((notification) => {
                const portfolio = portfolios.find(
                  (candidate) =>
                    candidate.id === notification.portfolioId &&
                    !candidate.deleted,
                );
                const state = !portfolio
                  ? "stopped"
                  : notification.enabled
                    ? "enabled"
                    : "paused";
                const baseline =
                  notification.baseline === "sample"
                    ? notification.capturedPrice
                    : portfolio
                      ? baselines[notification.id]
                      : null;
                const priceAvailable =
                  typeof baseline === "number" &&
                  Number.isFinite(baseline) &&
                  baseline > 0;
                const baselinePrice = priceAvailable
                  ? `${exact(baseline)} coins`
                  : baseline === undefined
                    ? "Loading price…"
                    : "Price unavailable";
                const triggerPrice = (threshold: number, direction: 1 | -1) =>
                  priceAvailable
                    ? exact(baseline * (1 + (direction * threshold) / 100))
                    : baselinePrice;
                return (
                  <article
                    className="notification-card"
                    data-state={state}
                    key={notification.id}
                    aria-label={`${notification.holdingName || "Holding"} notification`}
                  >
                    <div className="notification-card-header">
                      <div className="notification-item-art">
                        <ItemArt
                          id={
                            notification.holdingId.startsWith("bz_")
                              ? notification.holdingId.slice(3)
                              : "CHEST"
                          }
                          size="small"
                        />
                      </div>
                      <div className="notification-item-name">
                        <h3 title={notification.holdingName || "Holding"}>
                          {notification.holdingName || "Holding"}
                        </h3>
                        <p title={portfolio?.name ?? "Deleted portfolio"}>
                          {portfolio?.name ?? "Deleted portfolio"}
                        </p>
                      </div>
                      <span
                        className={`notification-state ${state}`}
                        title={
                          !portfolio
                            ? "Portfolio deleted. This alert has stopped."
                            : undefined
                        }
                      >
                        <span aria-hidden="true" />
                        {state === "enabled"
                          ? "Enabled"
                          : state === "paused"
                            ? "Paused"
                            : "Stopped"}
                      </span>
                    </div>
                    <div className="notification-card-body">
                      <div className="notification-thresholds">
                        {(["up", "down"] as const).map((direction) => {
                          const threshold = notification[direction];
                          if (threshold === null) return null;
                          const upward = direction === "up";
                          const Arrow = upward ? ArrowUpRight : ArrowDownRight;
                          return (
                            <div
                              className={`notification-threshold ${upward ? "upward" : "downward"}`}
                              key={direction}
                            >
                              <span className="notification-trigger-label">
                                {upward
                                  ? "Alert at or above"
                                  : "Alert at or below"}
                              </span>
                              <div className="notification-trigger-row">
                                <strong
                                  className={`notification-trigger-price${priceAvailable ? "" : " unavailable"}`}
                                >
                                  <span className="notification-price-amount">
                                    {triggerPrice(threshold, upward ? 1 : -1)}
                                  </span>
                                  {priceAvailable && (
                                    <>
                                      {" "}
                                      <span className="notification-price-unit">
                                        coins
                                      </span>
                                    </>
                                  )}
                                </strong>
                                <span className="notification-threshold-percent">
                                  <Arrow size={18} aria-hidden="true" />
                                  <span>
                                    {upward ? "+" : "−"}
                                    {exact(threshold)}%
                                  </span>
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="notification-baseline">
                        <span>
                          {notification.baseline === "acquisition"
                            ? "Average buy price"
                            : "Price when enabled"}
                        </span>{" "}
                        <b>{baselinePrice}</b>
                      </div>
                    </div>
                    <div className="notification-card-footer">
                      <span>Per item · before fees</span>
                      <div className="notification-card-actions">
                        <button
                          aria-label="Edit notification"
                          title="Edit notification"
                          disabled={busy || !portfolio}
                          onClick={() => edit(notification)}
                        >
                          <Pencil size={18} aria-hidden="true" />
                        </button>
                        <button
                          aria-label={notification.enabled ? "Pause" : "Resume"}
                          title={notification.enabled ? "Pause" : "Resume"}
                          disabled={busy || !portfolio}
                          onClick={() =>
                            change(
                              notification,
                              notification.enabled ? "pause" : "resume",
                            )
                          }
                        >
                          {notification.enabled ? (
                            <Pause size={16} aria-hidden="true" />
                          ) : (
                            <Play size={16} aria-hidden="true" />
                          )}
                        </button>
                        <button
                          className="notification-delete"
                          aria-label="Delete notification"
                          title="Delete notification"
                          disabled={busy}
                          onClick={() => change(notification, "delete")}
                        >
                          <Trash2 size={18} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ))}
    </section>
  );
}
