import { useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { auth } from "../../data";
import { readAccount } from "../../account";
import { requestBackend } from "../../backend";
import { exact, ItemArt } from "../components";
import { PixelIcon } from "../ui/Pixel";
import { PageHeading, StatusPill } from "./common";
import type { HoldingNotification } from "../../../shared/companion/notifications";
import type { Portfolio } from "../../../shared/companion/portfolio";
import type { Workflow } from "../../../shared/model";

/** Bazaar holdings use `bz_<ITEM_ID>`; auction variants use an opaque fingerprint. */
const artId = (holdingId: string) =>
  holdingId.startsWith("bz_") ? holdingId.slice(3) : "CHEST";

export default function NotificationsPage({
  user,
  notifications,
  portfolios,
  emailEnabled,
  paused,
  busy,
  loading,
  onEdit,
  onOpen,
  onToggle,
  onDelete,
  feedback,
}: {
  feedback?: ReactNode;
  user: User;
  notifications: HoldingNotification[];
  portfolios: Portfolio[];
  emailEnabled: boolean;
  paused: boolean;
  busy: boolean;
  loading: boolean;
  onEdit: (n: HoldingNotification) => void;
  onOpen: (n: HoldingNotification) => void;
  onToggle: (n: HoldingNotification) => void;
  onDelete: (n: HoldingNotification) => void;
}) {
  const active = notifications.filter((n) => !n.deleted);
  return (
    <>
      <PageHeading
        title="Notifications"
        subtitle="Price changes for your holdings"
      >
        <StatusPill icon="pause" tone={emailEnabled && !paused ? "ok" : "warn"}>
          <a href="#view=account">
            <b>Email {emailEnabled ? "on" : "off"}</b>
          </a>{" "}
          · Evaluation {paused ? "paused" : "waits for fresh data"}
        </StatusPill>
      </PageHeading>
      {feedback}
      {loading && (
        <p role="status" className="loading-line">
          Loading notifications…
        </p>
      )}
      <section className="notification-list" aria-label="Holding notifications">
        <h2 className="sr-only">Holding notifications</h2>
        {loading ? null : !active.length ? (
          <div className="ledger-card empty-state">
            <span className="empty-icon">
              <PixelIcon name="bell" size={40} />
            </span>
            <div>
              <h3>Nothing to watch yet</h3>
              <p>
                No holding notifications yet. Open a portfolio and choose{" "}
                <b>Set notification</b> on a holding.
              </p>
            </div>
            <a className="button" href="#view=portfolios">
              <PixelIcon name="chest" />
              Go to portfolios
            </a>
          </div>
        ) : (
          active.map((n) => {
            const portfolio = portfolios.find((p) => p.id === n.portfolioId);
            const state = !portfolio
              ? "stopped"
              : n.enabled
                ? "enabled"
                : "paused";
            return (
              <article
                className="ledger-card notification-row"
                key={n.id}
                aria-label={`${n.holdingName ?? "Holding"} notification`}
              >
                <div className="notification-identity">
                  <span className="holding-art">
                    <ItemArt id={artId(n.holdingId)} size="small" />
                  </span>
                  <div>
                    <h3>{n.holdingName ?? "Holding"}</h3>
                    <span>{portfolio?.name ?? "Deleted portfolio"}</span>
                  </div>
                </div>
                <dl className="notification-facts">
                  <div>
                    <dt>Price change alerts</dt>
                    <dd className="chips">
                      {n.up !== null && (
                        <span className="chip up">Up {n.up}%</span>
                      )}
                      {n.down !== null && (
                        <span className="chip down">Down {n.down}%</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Based on</dt>
                    <dd>
                      {n.baseline === "acquisition"
                        ? "Average acquisition"
                        : `Captured sample · ${exact(n.capturedPrice)} coins`}
                    </dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd
                      className={`state ${state === "enabled" && paused ? "waiting" : state}`}
                    >
                      <PixelIcon
                        name={
                          state === "stopped"
                            ? "warning"
                            : state === "paused" || paused
                              ? "pause"
                              : "check"
                        }
                        size={16}
                      />
                      <span>
                        {state === "stopped"
                          ? "Stopped: portfolio deleted"
                          : state === "enabled"
                            ? "Enabled"
                            : "Paused"}
                        {state === "enabled" && (
                          <small>
                            {paused
                              ? "Evaluation paused"
                              : "Waiting for eligible checks"}
                          </small>
                        )}
                        {state !== "stopped" && (
                          <button
                            className="link-button"
                            disabled={busy}
                            onClick={() => onToggle(n)}
                          >
                            {n.enabled ? "Pause" : "Resume"}
                          </button>
                        )}
                      </span>
                    </dd>
                  </div>
                </dl>
                <div className="notification-actions">
                  <button
                    className="button"
                    disabled={busy || !portfolio}
                    onClick={() => onEdit(n)}
                    aria-label={`Edit ${n.holdingName ?? "holding"} notification`}
                  >
                    <PixelIcon name="pencil" />
                    Edit
                  </button>
                  <button className="button" onClick={() => onOpen(n)}>
                    <PixelIcon name="open" />
                    Open holding
                  </button>
                  <button
                    className="button icon-only quiet-danger"
                    disabled={busy}
                    onClick={() => onDelete(n)}
                    aria-label="Delete notification"
                    title="Delete notification"
                  >
                    <PixelIcon name="trash" />
                  </button>
                </div>
              </article>
            );
          })
        )}
      </section>
      <LegacyAlerts user={user} />
    </>
  );
}

function LegacyAlerts({ user }: { user: User }) {
  const [alerts, setAlerts] = useState<Workflow[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [open, setOpen] = useState(false);
  async function load() {
    setBusy(true);
    setError("");
    try {
      const data = await readAccount(user);
      if (auth?.currentUser === user) {
        setAlerts(data.workflows);
        setLoaded(true);
      }
    } catch (e) {
      if (auth?.currentUser === user) setError((e as Error).message);
    } finally {
      if (auth?.currentUser === user) setBusy(false);
    }
  }
  return (
    <section className={`ledger-card legacy ${open ? "open" : ""}`}>
      <h2 className="legacy-heading">
        <button
          className="legacy-toggle"
          aria-expanded={open}
          aria-controls="legacy-alerts-body"
          onClick={() => setOpen((o) => !o)}
        >
          <PixelIcon name="bell" size={28} className="legacy-bell" />
          <span className="legacy-text">
            <span className="legacy-title">
              Legacy price alerts{loaded ? ` (${alerts.length})` : ""}
            </span>
            <span className="legacy-sub">
              Previous price-target alerts · new evaluation stopped
            </span>
          </span>
          <PixelIcon name="chevron" size={20} className="legacy-chevron" />
        </button>
      </h2>
      <div id="legacy-alerts-body" className="legacy-body" hidden={!open}>
        <p>
          Previous price targets have not been converted or re-enabled. Their
          records and disable links are preserved. Existing queued mail may
          still be delivered. New evaluation of legacy price targets has
          stopped.
        </p>
        <button className="button" disabled={busy} onClick={() => void load()}>
          <PixelIcon name="refresh" />
          {busy
            ? "Loading…"
            : loaded
              ? "Reload legacy alerts"
              : "Review legacy alerts"}
        </button>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {loaded && !alerts.length && <p className="muted">No legacy alerts.</p>}
        {alerts.map((a) => (
          <div className="legacy-row" key={a.id}>
            <span>
              <b>{a.itemName}</b> ·{" "}
              {a.paused
                ? "Disabled"
                : a.stage === "completed"
                  ? "Completed"
                  : "Legacy record; new evaluation stopped"}
            </span>
            <button
              className="button"
              disabled={busy || a.paused}
              onClick={async () => {
                setBusy(true);
                try {
                  await requestBackend(
                    { action: "legacy-pause", id: a.id },
                    await user.getIdToken(),
                  );
                  await load();
                } catch (e) {
                  if (auth?.currentUser === user)
                    setError((e as Error).message);
                } finally {
                  if (auth?.currentUser === user) setBusy(false);
                }
              }}
            >
              Disable legacy alert
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
