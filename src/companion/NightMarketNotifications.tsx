import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Mail,
  Pause,
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
  emailEnabled: boolean;
  paused: boolean;
  fixture: boolean;
  loading: boolean;
  busy: boolean;
  openHolding: (portfolioId: string) => void;
  change: (
    notification: HoldingNotification,
    operation: "pause" | "resume" | "delete",
  ) => void;
};

export default function NightMarketNotifications({
  notifications,
  portfolios,
  emailEnabled,
  paused,
  fixture,
  loading,
  busy,
  openHolding,
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
          href="#view=account"
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
            <div className="notification-card-grid">
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
                return (
                  <article
                    className="notification-card"
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
                        <p>{portfolio?.name ?? "Deleted portfolio"}</p>
                        <h3>{notification.holdingName || "Holding"}</h3>
                      </div>
                      <span className={`notification-state ${state}`}>
                        <span aria-hidden="true" />
                        {state === "enabled"
                          ? "Enabled"
                          : state === "paused"
                            ? "Paused"
                            : "Stopped"}
                      </span>
                    </div>
                    <div className="notification-thresholds">
                      <div className="notification-threshold upward">
                        <span>
                          <ArrowUpRight size={17} aria-hidden="true" /> Price
                          rises
                        </span>
                        <strong>
                          {notification.up === null
                            ? "—"
                            : `+${exact(notification.up)}%`}
                        </strong>
                      </div>
                      <div className="notification-threshold downward">
                        <span>
                          <ArrowDownRight size={17} aria-hidden="true" /> Price
                          falls
                        </span>
                        <strong>
                          {notification.down === null
                            ? "—"
                            : `−${exact(notification.down)}%`}
                        </strong>
                      </div>
                    </div>
                    <div className="notification-baseline">
                      <span>Compared with</span>
                      <b>
                        {notification.baseline === "acquisition"
                          ? "Average acquisition price"
                          : `Captured sample: ${exact(notification.capturedPrice)} coins`}
                      </b>
                    </div>
                    {!portfolio && (
                      <p className="notification-stopped-note">
                        Portfolio deleted. This alert has stopped.
                      </p>
                    )}
                    <div className="notification-card-actions">
                      <button
                        className="notification-open"
                        disabled={busy || !portfolio}
                        onClick={() => openHolding(notification.portfolioId)}
                      >
                        Open holding{" "}
                        <ChevronRight size={15} aria-hidden="true" />
                      </button>
                      <button
                        disabled={busy || !portfolio}
                        onClick={() =>
                          change(
                            notification,
                            notification.enabled ? "pause" : "resume",
                          )
                        }
                      >
                        {notification.enabled ? (
                          <Pause size={14} aria-hidden="true" />
                        ) : (
                          <Play size={14} aria-hidden="true" />
                        )}
                        {notification.enabled ? "Pause" : "Resume"}
                      </button>
                      <button
                        className="notification-delete"
                        aria-label="Delete notification"
                        title="Delete notification"
                        disabled={busy}
                        onClick={() => change(notification, "delete")}
                      >
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
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
