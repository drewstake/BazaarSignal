import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { SessionReads } from "./session-reads";
import type { User } from "firebase/auth";
import { Bell, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { auth } from "../data";
import { localWorkspace } from "../local-workspace";
import { SampleTime } from "../SampleTime";
import { exact, percent, ItemArt, SkyIcon } from "./components";
import { fixtureMode } from "./api";
import { portfolioMarket, visiblePortfolioPresence } from "./portfolio-market";
import { pollingDirective, visiblePoll } from "./polling";
import { ownerCandidate } from "./usage-access";
import {
  loadHoldings,
  loadPortfolios,
  saveHolding,
  savePortfolio,
  type HoldingChange,
} from "./portfolio-store";
import {
  changeNotification,
  emailPreference,
  loadNotifications,
} from "./portfolio-notifications";
import {
  portfolioTotals,
  type Holding,
  type Portfolio,
} from "../../shared/companion/portfolio";
import {
  notificationBaseline,
  type HoldingNotification,
  type NotificationInput,
} from "../../shared/companion/notifications";
import type { BazaarItem } from "../../shared/companion/types";
import HoldingEditor from "./HoldingEditor";
import NotificationEditor from "./NotificationEditor";
import "./portfolio.css";
import "./skyblock-theme.css";
import "./night-market-workspace.css";
import "./admin-dashboard.css";
import NightMarketAccount from "./NightMarketAccount";
import NightMarketNotifications from "./NightMarketNotifications";
import PortfolioValueChart from "./PortfolioValueChart";
import { useVisibleNow } from "./use-visible-now";
const AdminDashboard = lazy(() => import("./AdminDashboard"));

import type { portfolioRoute } from "./PortfolioApp";
type View = ReturnType<typeof portfolioRoute>["view"];
function navigate(view: View, portfolioId?: string) {
  location.hash = new URLSearchParams({
    view,
    ...(portfolioId ? { portfolio: portfolioId } : {}),
  }).toString();
}
export default function Workspace({
  user,
  route,
}: {
  user: User;
  route: ReturnType<typeof portfolioRoute>;
}) {
  const reads = useRef(new SessionReads()).current;
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]),
    [holdings, setHoldings] = useState<Holding[]>([]),
    [notifications, setNotifications] = useState<HoldingNotification[]>([]),
    [loading, setLoading] = useState(true),
    [holdingLoading, setHoldingLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reload, setReload] = useState(0);
  const [bazaar, setBazaar] = useState<BazaarItem[]>([]),
    [marketError, setMarketError] = useState(""),
    [emailEnabled, setEmailEnabled] = useState(false);
  const [editor, setEditor] = useState<{
      mode: "create" | "edit" | "purchase";
      holding?: Holding;
    } | null>(null),
    [notificationEditor, setNotificationEditor] = useState<Holding | null>(
      null,
    ),
    [portfolioEditor, setPortfolioEditor] = useState<
      "create" | "rename" | null
    >(null),
    [name, setName] = useState(""),
    [removal, setRemoval] = useState<Holding | "portfolio" | null>(null),
    [expandedHolding, setExpandedHolding] = useState<string | null>(null);
  const now = useVisibleNow(
    5000,
    route.view === "portfolios" && !!holdings.length,
  );
  const selected =
    portfolios.find((p) => p.id === route.portfolioId) ??
    (!route.portfolioId ? portfolios[0] : undefined);
  useEffect(() => setExpandedHolding(null), [selected?.id, route.view]);
  useEffect(() => setNotice(""), [route.view]);
  useEffect(() => {
    if (
      route.view === "settings" &&
      new URLSearchParams(location.hash.slice(1)).has("section")
    )
      document
        .getElementById(`settings-${route.section}`)
        ?.scrollIntoView({ block: "start" });
  }, [route.view, route.section]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    if (route.view === "admin" || route.view === "item") {
      setLoading(false);
      return;
    }
    Promise.all([
      reads.read("portfolios", () => loadPortfolios(user.uid)),
      reads.read("notifications", () => loadNotifications(user.uid)),
      reads.read("preference", () => emailPreference(user.uid)),
    ])
      .then(([p, n, e]) => {
        if (alive && auth?.currentUser === user) {
          setPortfolios(p);
          setNotifications(n);
          setEmailEnabled(e);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user, reload, route.view]);
  useEffect(() => {
    let alive = true;
    setHoldings([]);
    setEditor(null);
    setNotificationEditor(null);
    setRemoval(null);
    setPortfolioEditor(null);
    if (!selected || route.view !== "portfolios") {
      setHoldingLoading(false);
      return;
    }
    setHoldingLoading(true);
    reads
      .read(`holdings/${selected.id}`, () =>
        loadHoldings(user.uid, selected.id),
      )
      .then((h) => {
        if (alive && auth?.currentUser === user) setHoldings(h);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setHoldingLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selected?.id, user, reload, route.view]);
  const priceAssets = useMemo(
    () =>
      holdings
        .filter((h) => h.kind === "bazaar")
        .map((h) => h.id)
        .sort()
        .join(","),
    [holdings],
  );
  useEffect(() => {
    if (!priceAssets || route.view !== "portfolios") return;
    return visiblePortfolioPresence(user, priceAssets.split(","));
  }, [user, priceAssets, route.view]);
  useEffect(() => {
    if (!priceAssets || route.view !== "portfolios") return;
    return visiblePoll(async (signal) => {
      try {
        const r = await portfolioMarket(priceAssets.split(","), signal);
        if (!signal.aborted) {
          setBazaar(r.bazaar);
          setMarketError(
            r.error ?? (r.stale ? "The saved market snapshot is stale." : ""),
          );
        }
      } catch (e) {
        if (!signal.aborted) setMarketError((e as Error).message);
      }
    });
  }, [priceAssets, route.view]);
  const paused = pollingDirective().mode === "paused";
  const totals = useMemo(
    () =>
      portfolioTotals(
        holdings,
        bazaar,
        [],
        now,
        paused || fixtureMode || !!marketError,
      ),
    [holdings, bazaar, now, paused, marketError],
  );
  async function action(
    work: () => Promise<unknown>,
    message: string,
    changed?: string,
  ) {
    if (busy) return false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      if (auth?.currentUser !== user) return false;
      reads.invalidate(changed);
      setNotice(message);
      setReload((v) => v + 1);
      setEditor(null);
      setNotificationEditor(null);
      setPortfolioEditor(null);
      setRemoval(null);
      return true;
    } catch (e) {
      if (auth?.currentUser === user) setError((e as Error).message);
      return false;
    } finally {
      if (auth?.currentUser === user) setBusy(false);
    }
  }
  async function save(change: HoldingChange) {
    if (selected)
      await action(
        () => saveHolding(user.uid, selected.id, change),
        "Holding saved.",
        "holdings/",
      );
  }
  async function notify(input: NotificationInput) {
    if (selected && notificationEditor)
      await action(
        () =>
          changeNotification(
            user.uid,
            selected.id,
            notificationEditor.id,
            "save",
            input,
            notifications.find(
              (n) =>
                n.portfolioId === selected.id &&
                n.holdingId === notificationEditor.id,
            ),
          ),
        "Notification settings saved. Checks wait for fresh market data and enabled email delivery.",
        "notifications",
      );
  }
  const nFor = (h: Holding) =>
    notifications.find(
      (n) =>
        !n.deleted && n.portfolioId === selected?.id && n.holdingId === h.id,
    );
  // Keep session reads mounted across item navigation without private reads,
  // portfolio polling or presence work on the public item page.
  if (route.view === "item") return null;
  if (route.view === "admin")
    return ownerCandidate(user) ? (
      <Suspense fallback={<p>Loading Admin…</p>}>
        <AdminDashboard user={user} />
      </Suspense>
    ) : (
      <section className="panel">
        <h1>Owner access only</h1>
        <a href="#view=portfolios">Back to Portfolio</a>
      </section>
    );
  return (
    <div
      className={
        route.view === "portfolios"
          ? "portfolio-workspace"
          : "settings-workspace"
      }
    >
      <div className="page-title">
        <div>
          <h1>{route.view === "portfolios" ? "Portfolio" : "Settings"}</h1>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}{" "}
          <button
            onClick={() => {
              reads.invalidate();
              setReload((v) => v + 1);
            }}
          >
            Reload saved data
          </button>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {route.view === "portfolios" &&
        (paused || fixtureMode) &&
        (!localWorkspace || fixtureMode) && (
          <div className="market-note">
            <span className="status-dot" />
            {paused
              ? "Market updates and notification checks paused. Holdings are editable."
              : ""}
            {fixtureMode && (
              <strong>
                {" "}
                Development fixtures — never eligible for notifications.
              </strong>
            )}
          </div>
        )}
      {loading && (
        <p role="status">
          {route.view === "settings"
            ? "Loading settings…"
            : "Loading your portfolio…"}
        </p>
      )}
      {route.view === "settings" ? (
        <div className="settings-sections">
          <nav className="settings-links" aria-label="Settings sections">
            <a
              href="#view=settings&section=account"
              aria-current={
                route.section === "account" ? "location" : undefined
              }
            >
              Account &amp; email
            </a>
            <a
              href="#view=settings&section=notifications"
              aria-current={
                route.section === "notifications" ? "location" : undefined
              }
            >
              Alerts
            </a>
          </nav>
          <section id="settings-account" className="account-workspace">
            <h2>Account &amp; email</h2>
            <NightMarketAccount
              user={user}
              emailEnabled={emailEnabled}
              disabled={busy || loading}
              paused={paused}
              onEmailChange={(enabled) => {
                setEmailEnabled(enabled);
                void action(
                  () => emailPreference(user.uid, enabled),
                  enabled
                    ? "Email delivery enabled."
                    : "Email delivery disabled.",
                  "preference",
                ).then((saved) => {
                  if (!saved && auth?.currentUser === user)
                    setEmailEnabled(!enabled);
                });
              }}
            />
          </section>
          <section
            id="settings-notifications"
            className="notifications-workspace"
          >
            <h2>Alerts</h2>
            <NightMarketNotifications
              notifications={notifications}
              portfolios={portfolios}
              emailEnabled={emailEnabled}
              paused={paused}
              fixture={fixtureMode}
              loading={loading}
              busy={busy}
              openHolding={(portfolioId) => navigate("portfolios", portfolioId)}
              change={(notification, operation) =>
                void action(
                  () =>
                    changeNotification(
                      user.uid,
                      notification.portfolioId,
                      notification.holdingId,
                      operation,
                      undefined,
                      notification,
                    ),
                  operation === "delete"
                    ? "Notification deleted."
                    : "Notification updated.",
                  "notifications",
                )
              }
            />
          </section>
        </div>
      ) : (
        <>
          {!loading &&
            portfolioEditor &&
            (portfolioEditor === "rename"
              ? !!selected
              : !portfolios.length) && (
              <form
                className="panel editor"
                aria-label={
                  portfolioEditor === "create"
                    ? "Create portfolio"
                    : "Rename portfolio"
                }
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(
                    async () => {
                      if (portfolioEditor === "create") {
                        const existing = await loadPortfolios(user.uid);
                        if (existing.length) {
                          setPortfolioEditor(null);
                          navigate("portfolios", existing[0].id);
                          reads.invalidate("portfolios");
                          setReload((v) => v + 1);
                          throw new Error(
                            "You already have a portfolio. You can add holdings to it or rename it.",
                          );
                        }
                      }
                      const p = await savePortfolio(
                        user.uid,
                        name,
                        portfolioEditor === "rename" ? selected : undefined,
                      );
                      navigate("portfolios", p.id);
                    },
                    "Portfolio saved.",
                    "portfolios",
                  );
                }}
              >
                <h2>
                  {portfolioEditor === "create"
                    ? "Create portfolio"
                    : "Rename portfolio"}
                </h2>
                <label>
                  Portfolio name
                  <input
                    autoFocus
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>
                <div className="actions">
                  <button className="primary" disabled={busy}>
                    Save portfolio
                  </button>
                  <button
                    type="button"
                    onClick={() => setPortfolioEditor(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          {!loading && !error && !portfolios.length && !portfolioEditor && (
            <section className="panel empty">
              <SkyIcon name="watchlist-chest" size={72} />
              <h2>Your portfolio starts here</h2>
              <p>
                Add only the items you own, with your actual quantities and
                costs. Your account has one portfolio for all your holdings.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setName("");
                  setPortfolioEditor("create");
                }}
              >
                Create portfolio
              </button>
            </section>
          )}
          {!!portfolios.length && (
            <div className="portfolio-layout">
              <div className="portfolio-content">
                {!selected ? (
                  <section className="panel">
                    <h2>Portfolio unavailable</h2>
                    <p>
                      This link may refer to a deleted portfolio or another
                      account.
                    </p>
                    <a href="#view=portfolios">Back to your portfolio</a>
                  </section>
                ) : (
                  <>
                    <div className="portfolio-heading">
                      <h2>{selected.name}</h2>
                      <div className="actions">
                        <button
                          className="portfolio-icon-button"
                          aria-label="Rename"
                          title="Rename portfolio"
                          disabled={busy}
                          onClick={() => {
                            setName(selected.name);
                            setPortfolioEditor("rename");
                          }}
                        >
                          <Pencil size={18} aria-hidden="true" />
                        </button>
                        <button
                          className="portfolio-icon-button"
                          aria-label="Delete portfolio"
                          title="Delete portfolio"
                          disabled={busy}
                          onClick={() => setRemoval("portfolio")}
                        >
                          <Trash2 size={18} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    {removal && (
                      <section
                        className="panel confirm"
                        role="alertdialog"
                        aria-label="Confirm deletion"
                      >
                        <h2>
                          Delete{" "}
                          {removal === "portfolio"
                            ? selected.name
                            : removal.name}
                          ?
                        </h2>
                        <p>
                          {removal === "portfolio"
                            ? "The portfolio and its holdings will be removed from your active view. All its notifications stop."
                            : "This holding will be removed from your active view and its notifications stop."}{" "}
                          Existing legacy source records are preserved. An email
                          already in flight may still arrive.
                        </p>
                        <div className="actions">
                          <button
                            className="danger"
                            disabled={busy}
                            onClick={() =>
                              void action(async () => {
                                if (removal === "portfolio") {
                                  await savePortfolio(
                                    user.uid,
                                    selected.name,
                                    selected,
                                    true,
                                  );
                                  navigate("portfolios");
                                } else
                                  await saveHolding(user.uid, selected.id, {
                                    ...removal,
                                    mode: "delete",
                                    expected: removal,
                                  });
                              }, "Deleted. Related notifications are stopped.")
                            }
                          >
                            Confirm delete
                          </button>
                          <button onClick={() => setRemoval(null)}>
                            Cancel
                          </button>
                        </div>
                      </section>
                    )}
                    {!!holdings.length && (
                      <dl className="summary">
                        <Metric label="Cost basis" value={totals.costBasis} />
                        <Metric
                          label="Estimated value"
                          value={totals.value}
                          note={
                            totals.missing ? "Incomplete valuation" : undefined
                          }
                        />
                        <Metric
                          label="Unrealized P&L"
                          value={totals.pnl}
                          note={
                            totals.returnPercent === null
                              ? undefined
                              : percent(totals.returnPercent)
                          }
                          profit
                        />
                      </dl>
                    )}
                    <PortfolioValueChart
                      key={`${user.uid}:${selected.id}`}
                      uid={user.uid}
                      portfolioId={selected.id}
                      totals={totals}
                      loading={loading || holdingLoading}
                      fixture={fixtureMode}
                    />
                    {!!totals.missing && (
                      <details className="coverage">
                        <summary>
                          {totals.missing} of {holdings.length} holdings have no
                          usable price.
                        </summary>
                        <p>
                          P&L uses priced holdings and their matching cost basis
                          ({exact(totals.valuedBasis)} coins). Total cost
                          includes all holdings.
                        </p>
                      </details>
                    )}
                    {!!holdings.length && marketError && (
                      <details className="market-detail">
                        <summary>
                          Market data unavailable · Holdings are editable
                        </summary>
                        <p>{marketError}</p>
                      </details>
                    )}
                    <div className="holding-toolbar">
                      <h2>
                        Holdings <span>{holdings.length}</span>
                      </h2>
                      <button
                        className="primary"
                        disabled={busy || holdingLoading}
                        onClick={() => {
                          setEditor({ mode: "create" });
                          setNotificationEditor(null);
                        }}
                      >
                        <Plus size={18} />
                        Add holding
                      </button>
                    </div>
                    {editor && (
                      <HoldingEditor
                        key={`${editor.mode}:${editor.holding?.id ?? "new"}`}
                        {...editor}
                        busy={busy}
                        save={save}
                        cancel={() => setEditor(null)}
                      />
                    )}
                    {notificationEditor && (
                      <NotificationEditor
                        key={notificationEditor.id}
                        holding={notificationEditor}
                        current={nFor(notificationEditor)}
                        busy={busy}
                        save={notify}
                        cancel={() => setNotificationEditor(null)}
                      />
                    )}
                    {holdingLoading ? (
                      <p role="status">Loading holdings…</p>
                    ) : !holdings.length ? (
                      <section className="panel empty holdings-empty">
                        <SkyIcon name="bazaar-crate" size={48} />
                        <div>
                          <h3>No holdings yet</h3>
                          <p>Add a Bazaar item.</p>
                        </div>
                      </section>
                    ) : (
                      <div
                        className="holdings-table-scroll"
                        tabIndex={0}
                        role="region"
                        aria-label="Holdings table"
                      >
                        <table className="holdings-table">
                          <caption>
                            Unit price: best sell offer · Estimates before fees
                            · Prices in coins
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col">Item</th>
                              <th scope="col">Quantity</th>
                              <th scope="col">Avg. cost</th>
                              <th scope="col">Cost basis</th>
                              <th scope="col">Unit price</th>
                              <th scope="col">Est. value</th>
                              <th scope="col">Total P&L</th>
                              <th scope="col">Return %</th>
                            </tr>
                          </thead>
                          {totals.rows.map(({ holding: h, valuation: v }) => {
                            const notification = nFor(h);
                            const expanded = expandedHolding === h.id;
                            const profitClass =
                              v.pnl === null
                                ? "muted"
                                : v.pnl < 0
                                  ? "loss"
                                  : "gain";
                            return (
                              <tbody
                                key={h.id}
                                aria-label={`${h.name} holding`}
                              >
                                <tr
                                  className={`holding-row ${expanded ? "expanded" : ""}`}
                                >
                                  <th scope="row">
                                    <button
                                      className="holding-toggle"
                                      aria-label={`${expanded ? "Hide" : "Show"} details for ${h.name}`}
                                      aria-expanded={expanded}
                                      aria-controls={`holding-details-${h.id}`}
                                      onClick={() =>
                                        setExpandedHolding(
                                          expanded ? null : h.id,
                                        )
                                      }
                                    >
                                      <ChevronRight size={14} />
                                      <ItemArt id={h.itemId} size="small" />
                                      <span
                                        className="holding-name"
                                        title={h.name}
                                      >
                                        {h.name}
                                      </span>
                                      <span className="holding-market">
                                        {h.kind === "bazaar"
                                          ? "BZ"
                                          : "Unsupported"}
                                      </span>
                                    </button>
                                  </th>
                                  <td
                                    title={
                                      h.kind === "auction"
                                        ? `Complete stacks of ${h.stackSize} items`
                                        : "Items owned"
                                    }
                                  >
                                    {exact(h.quantity)}
                                  </td>
                                  <td>{exact(h.costBasis / h.quantity)}</td>
                                  <td>{exact(h.costBasis)}</td>
                                  <td
                                    title={
                                      v.referencePrice === null
                                        ? "Price unavailable"
                                        : v.reference
                                    }
                                  >
                                    {exact(v.referencePrice)}
                                  </td>
                                  <td
                                    title={
                                      v.value === null
                                        ? "Value unavailable"
                                        : "Indicative market value"
                                    }
                                  >
                                    {exact(v.value)}
                                  </td>
                                  <td className={profitClass}>
                                    {exact(v.pnl)}
                                  </td>
                                  <td className={profitClass}>
                                    {percent(v.returnPercent)}
                                  </td>
                                </tr>
                                <tr
                                  className="holding-detail-row"
                                  hidden={!expanded}
                                >
                                  <td colSpan={8}>
                                    <div
                                      className="holding-expanded"
                                      id={`holding-details-${h.id}`}
                                    >
                                      <p className="holding-identity">
                                        <b>{h.name}</b> ·{" "}
                                        {h.kind === "bazaar"
                                          ? "Bazaar"
                                          : "Unsupported saved asset"}{" "}
                                        · {exact(h.quantity)}{" "}
                                        {h.kind === "auction"
                                          ? "stacks"
                                          : "items"}
                                      </p>
                                      <details className="holding-details">
                                        <summary>Valuation details</summary>
                                        <p className="sample">
                                          {v.sampledAt ? (
                                            <>
                                              <b>
                                                {v.freshness === "stale"
                                                  ? "Last-known estimate"
                                                  : "Fresh sample"}
                                              </b>{" "}
                                              ·{" "}
                                              <SampleTime
                                                timestamp={v.sampledAt}
                                                now={now}
                                              />
                                            </>
                                          ) : (
                                            "No usable price sample"
                                          )}
                                        </p>
                                        <dl className="holding-metrics">
                                          <Metric
                                            label="Average acquisition"
                                            value={h.costBasis / h.quantity}
                                          />
                                          <Metric
                                            label="Reference per unit"
                                            value={v.referencePrice}
                                          />
                                        </dl>
                                        <p className="reference">
                                          {v.reference}
                                        </p>
                                        {v.liquidation ? (
                                          <p>
                                            Full-quantity{" "}
                                            {v.freshness === "stale"
                                              ? "last-known "
                                              : ""}
                                            after-tax liquidation estimate:{" "}
                                            <b>
                                              {exact(v.liquidation.value)} coins
                                            </b>{" "}
                                            · {v.liquidation.taxPercent}% tax.
                                            Entire quantity fits visible bids.
                                            Unrealized P&L above uses the lowest
                                            sell offer before fees; filling a
                                            sell offer is not guaranteed.
                                          </p>
                                        ) : (
                                          <p>
                                            Full-quantity after-tax liquidation
                                            unavailable: {v.liquidationReason}
                                          </p>
                                        )}
                                      </details>
                                      <div className="holding-bottom">
                                        <span className="notification-status">
                                          <Bell size={15} />
                                          {h.kind !== "bazaar"
                                            ? "Monitoring unavailable for this saved asset"
                                            : notification
                                              ? `${notification.enabled ? "Enabled" : "Paused"} · ${notification.up === null ? "" : `↑ ${notification.up}% `}${notification.down === null ? "" : `↓ ${notification.down}% `} · baseline ${exact(notificationBaseline(notification, h))}`
                                              : "Notifications off"}
                                        </span>
                                        <div className="actions">
                                          <button
                                            disabled={
                                              busy || h.kind !== "bazaar"
                                            }
                                            onClick={() =>
                                              setEditor({
                                                mode: "purchase",
                                                holding: h,
                                              })
                                            }
                                          >
                                            Add purchase
                                          </button>
                                          <button
                                            disabled={
                                              busy || h.kind !== "bazaar"
                                            }
                                            onClick={() =>
                                              setEditor({
                                                mode: "edit",
                                                holding: h,
                                              })
                                            }
                                          >
                                            Edit
                                          </button>
                                          <button
                                            disabled={
                                              busy || h.kind !== "bazaar"
                                            }
                                            onClick={() => {
                                              setNotificationEditor(h);
                                              setEditor(null);
                                            }}
                                          >
                                            {notification
                                              ? "Edit notification"
                                              : "Set notification"}
                                          </button>
                                          <button
                                            disabled={busy}
                                            onClick={() => setRemoval(h)}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              </tbody>
                            );
                          })}
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  note,
  profit = false,
}: {
  label: string;
  value: number | null;
  note?: string;
  profit?: boolean;
}) {
  return (
    <div
      className={profit && value !== null ? (value < 0 ? "loss" : "gain") : ""}
    >
      <dt>{label}</dt>
      <dd>
        {value === null ? "Unavailable" : exact(value)}
        {value !== null && <small>coins</small>}
      </dd>
      {note && <span>{note}</span>}
    </div>
  );
}
