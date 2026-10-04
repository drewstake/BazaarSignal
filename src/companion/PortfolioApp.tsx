import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { SessionReads } from "./session-reads";
import type { User } from "firebase/auth";
import { auth, login, logout, watchAuth } from "../data";
import { localWorkspace } from "../local-workspace";
import { signInErrorMessage } from "../sign-in-error";
import { exact, percent, SkyIcon } from "./components";
import { fixtureMode, getBazaar, marketRequest } from "./api";
import { pollingDirective, visiblePoll } from "./polling";
import { AUCTION_COLLECTION_ENABLED } from "../../shared/market-features";
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
import type {
  HoldingNotification,
  NotificationInput,
} from "../../shared/companion/notifications";
import type { BazaarItem, Listing } from "../../shared/companion/types";
import HoldingEditor from "./HoldingEditor";
import NotificationEditor from "./NotificationEditor";
import HoldingRow from "./pages/HoldingRow";
import NotificationsPage from "./pages/NotificationsPage";
import AccountPage from "./pages/AccountPage";
import { Intro, LegacyDisable } from "./pages/SignedOut";
import { Coins, InfoNote, PageHeading, StatusPill } from "./pages/common";
import { BlockAvatar, PixelIcon, PixelIsland } from "./ui/Pixel";
import type { PixelGlyph } from "./ui/pixel-glyphs";
import "./styles/ledger.css";
import "./styles/pages.css";
const UsageDashboard = lazy(() => import("./UsageDashboard"));
type View = "portfolios" | "notifications" | "account" | "usage";
const views: View[] = ["portfolios", "notifications", "account", "usage"];
export function portfolioRoute(hash = location.hash): {
  view: View;
  portfolioId: string | null;
  disable: string | null;
  notify: string | null;
} {
  const p = new URLSearchParams(hash.slice(1)),
    view = p.get("view");
  return {
    view:
      view === "notifications" || view === "account" || view === "usage"
        ? view
        : "portfolios",
    portfolioId: p.get("portfolio"),
    disable: p.get("disable"),
    notify: p.get("notify"),
  };
}
function navigate(view: View, portfolioId?: string, notify?: string) {
  location.hash = new URLSearchParams({
    view,
    ...(portfolioId ? { portfolio: portfolioId } : {}),
    ...(notify ? { notify } : {}),
  }).toString();
}
const tabs: [View, string, PixelGlyph][] = [
  ["portfolios", "Portfolios", "chest"],
  ["notifications", "Notifications", "bell"],
  ["account", "Account", "user"],
  ["usage", "Usage & Costs", "cpu"],
];
export default function PortfolioApp() {
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null),
    [epoch, setEpoch] = useState(0),
    [route, setRoute] = useState(() => portfolioRoute()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(
    () =>
      watchAuth((u) => {
        setUser(u);
        setEpoch((e) => e + 1);
        setError("");
      }),
    [],
  );
  useEffect(() => {
    const update = () => {
      const r = portfolioRoute();
      setRoute(r);
      if (
        !r.disable &&
        !views.includes(
          new URLSearchParams(location.hash.slice(1)).get("view") as View,
        )
      ) {
        history.replaceState(
          null,
          "",
          `${location.pathname}${location.search}#view=portfolios`,
        );
        setRoute(portfolioRoute());
      }
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      if (!auth)
        throw new Error(
          "Google sign-in is not configured in this environment.",
        );
      await login();
    } catch (e) {
      setError(signInErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const visibleTabs = tabs.filter(
    ([view]) => view !== "usage" || ownerCandidate(user),
  );
  return (
    <div className="ledger-app">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="ledger-shell">
        <header className="ledger-bar">
          <a className="ledger-brand" href="#view=portfolios">
            <SkyIcon name="emerald" size={48} className="brand-gem" />
            <span className="brand-word">BazaarSignal</span>
          </a>
          <nav
            className={`ledger-tabs tabs-${visibleTabs.length}`}
            aria-label="Main navigation"
          >
            {visibleTabs.map(([view, label, icon]) => (
              <a
                key={view}
                className={
                  route.view === view && !route.disable ? "active" : undefined
                }
                href={`#view=${view}`}
                aria-current={
                  route.view === view && !route.disable ? "page" : undefined
                }
              >
                <PixelIcon name={icon} size={18} className="tab-icon" />
                <span>{label}</span>
              </a>
            ))}
          </nav>
          <div className="ledger-bar-meta">
            <p className="bar-tagline">
              Your SkyBlock portfolio
              <span>Manually recorded. Private to you.</span>
            </p>
            {user ? (
              <div className="bar-account">
                <a
                  className="bar-avatar"
                  href="#view=account"
                  title="Your account"
                  aria-label="Your account"
                >
                  <BlockAvatar seed={user.uid} size={30} />
                </a>
                {route.view !== "account" && (
                  <button
                    className="bar-button"
                    onClick={() => void logout()}
                    aria-label="Sign out"
                    title="Sign out"
                  >
                    <PixelIcon name="logout" size={16} />
                    <span>Sign out</span>
                  </button>
                )}
              </div>
            ) : (
              <button
                className="bar-button signin"
                aria-label="Sign in with Google"
                onClick={() => void signIn()}
                disabled={busy}
              >
                <PixelIcon name="key" size={16} />
                <span>Sign in</span>
              </button>
            )}
          </div>
        </header>
        <main id="main-content" className="ledger-paper" tabIndex={-1}>
          {localWorkspace && (
            <InfoNote tone="warn">
              <p>
                <b>Local workspace</b> · Holdings and notification settings are
                saved on this computer. Your production records are separate.
                Market checks and email delivery are disabled.
              </p>
            </InfoNote>
          )}
          {error && (
            <p role="alert" className="banner error">
              <PixelIcon name="warning" size={18} />
              <span>{error}</span>
            </p>
          )}
          {route.disable ? (
            <LegacyDisable token={route.disable} />
          ) : user ? (
            <Workspace key={`${user.uid}:${epoch}`} user={user} route={route} />
          ) : (
            <Intro busy={busy} onSignIn={() => void signIn()} />
          )}
        </main>
      </div>
      <footer className="ledger-footer">
        <span className="footer-brand">
          <SkyIcon name="emerald" size={20} />
          <b>BazaarSignal</b>
          <span>— Manually tracked. Market estimates can change.</span>
        </span>
        <span>Not affiliated with Hypixel.</span>
      </footer>
    </div>
  );
}
function Workspace({
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
    [auctions, setAuctions] = useState<Listing[]>([]),
    [now, setNow] = useState(Date.now()),
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
    [removal, setRemoval] = useState<Holding | "portfolio" | null>(null);
  // Confirmations belong to the page where the change was made.
  useEffect(() => setNotice(""), [route.view]);
  const selected =
    portfolios.find((p) => p.id === route.portfolioId) ??
    (!route.portfolioId ? portfolios[0] : undefined);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    if (route.view === "usage") {
      setLoading(false);
      return;
    }
    Promise.all([
      route.view === "account"
        ? Promise.resolve(portfolios)
        : reads.read("portfolios", () => loadPortfolios(user.uid)),
      route.view === "account"
        ? Promise.resolve(notifications)
        : reads.read("notifications", () => loadNotifications(user.uid)),
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
  // "Edit" on the Notifications page opens that holding's notification editor.
  useEffect(() => {
    if (route.view !== "portfolios" || !route.notify || holdingLoading) return;
    const target = holdings.find((h) => h.id === route.notify && !h.deleted);
    if (!holdings.length && !target) return;
    if (target) {
      setEditor(null);
      setNotificationEditor(target);
    }
    const p = new URLSearchParams(location.hash.slice(1));
    p.delete("notify");
    history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}#${p}`,
    );
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, [route.view, route.notify, holdings, holdingLoading]);
  const needsBazaar = holdings.some((h) => h.kind === "bazaar"),
    auctionAssets = holdings
      .filter((h) => h.kind === "auction")
      .map((h) => h.id)
      .sort()
      .join(","),
    needsAuctions = AUCTION_COLLECTION_ENABLED && !!auctionAssets;
  useEffect(() => {
    if (!needsBazaar || route.view !== "portfolios") return;
    return visiblePoll(async (signal) => {
      try {
        const r = await getBazaar(signal);
        if (!signal.aborted) {
          setBazaar(r.items);
          setMarketError(r.error ?? "");
        }
      } catch (e) {
        if (!signal.aborted) setMarketError((e as Error).message);
      }
    });
  }, [needsBazaar, route.view]);
  useEffect(() => {
    if (!needsAuctions || route.view !== "portfolios") return;
    return visiblePoll(async (signal) => {
      try {
        const r = await marketRequest<{ listings: Listing[] }>(
          `portfolio-auctions?assets=${encodeURIComponent(auctionAssets)}`,
          signal,
        );
        if (!signal.aborted) setAuctions(r.listings);
      } catch (e) {
        if (!signal.aborted) setMarketError((e as Error).message);
      }
    });
  }, [needsAuctions, auctionAssets, route.view]);
  useEffect(() => {
    if (route.view !== "portfolios" || !holdings.length) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [route.view, holdings.length]);
  const paused = pollingDirective().mode === "paused",
    totals = portfolioTotals(
      holdings,
      bazaar,
      auctions,
      now,
      paused || fixtureMode,
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
  const feedback = (
    <>
      {error && (
        <div className="banner error" role="alert">
          <PixelIcon name="warning" size={18} />
          <span>{error}</span>
          <button
            className="button small"
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
        <p className="banner success" role="status">
          <PixelIcon name="check" size={18} />
          <span>{notice}</span>
        </p>
      )}
    </>
  );
  if (route.view === "usage")
    return ownerCandidate(user) ? (
      <Suspense
        fallback={
          <p role="status" className="loading-line">
            Loading usage…
          </p>
        }
      >
        <UsageDashboard user={user} />
      </Suspense>
    ) : (
      <section className="ledger-card narrow-card">
        <h1 className="card-title">Owner access only</h1>
        <p>This page is available only to the BazaarSignal owner account.</p>
        <a className="text-link" href="#view=portfolios">
          Back to Portfolios
        </a>
      </section>
    );
  if (route.view === "account")
    return (
      <AccountPage
        feedback={feedback}
        user={user}
        emailEnabled={emailEnabled}
        busy={busy}
        loading={loading}
        onSignOut={() => void logout()}
        onEmailChange={(enabled) => {
          setEmailEnabled(enabled);
          void action(
            () => emailPreference(user.uid, enabled),
            enabled
              ? "Email delivery enabled for your chosen holding notifications."
              : "Holding notification email delivery disabled.",
            "preference",
          ).then((saved) => {
            if (!saved && auth?.currentUser === user) setEmailEnabled(!enabled);
          });
        }}
      />
    );
  if (route.view === "notifications")
    return (
      <NotificationsPage
        feedback={feedback}
        user={user}
        notifications={notifications}
        portfolios={portfolios}
        emailEnabled={emailEnabled}
        paused={paused}
        busy={busy}
        loading={loading}
        onOpen={(n) => navigate("portfolios", n.portfolioId)}
        onEdit={(n) => navigate("portfolios", n.portfolioId, n.holdingId)}
        onToggle={(n) =>
          void action(
            () =>
              changeNotification(
                user.uid,
                n.portfolioId,
                n.holdingId,
                n.enabled ? "pause" : "resume",
                undefined,
                n,
              ),
            "Notification updated.",
            "notifications",
          )
        }
        onDelete={(n) =>
          void action(
            () =>
              changeNotification(
                user.uid,
                n.portfolioId,
                n.holdingId,
                "delete",
                undefined,
                n,
              ),
            "Notification deleted.",
            "notifications",
          )
        }
      />
    );
  const createPortfolio = () => {
    setName("");
    setPortfolioEditor("create");
  };
  const portfolioForm = portfolioEditor && (
    <form
      className="ledger-card editor"
      aria-label={
        portfolioEditor === "create" ? "Create portfolio" : "Rename portfolio"
      }
      onSubmit={(e) => {
        e.preventDefault();
        void action(
          async () => {
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
        {portfolioEditor === "create" ? "Create portfolio" : "Rename portfolio"}
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
        <button className="button primary" disabled={busy}>
          Save portfolio
        </button>
        <button
          className="button"
          type="button"
          onClick={() => setPortfolioEditor(null)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
  const confirmRemoval = (subject: Holding | "portfolio") =>
    selected && (
      <section
        className="ledger-card confirm"
        role="alertdialog"
        aria-label="Confirm deletion"
      >
        <PixelIcon name="trash" size={28} className="confirm-icon" />
        <div>
          <h2>
            Delete {subject === "portfolio" ? selected.name : subject.name}?
          </h2>
          <p>
            {subject === "portfolio"
              ? "The portfolio and its holdings will be removed from your active view. All its notifications stop."
              : "This holding will be removed from your active view and its notifications stop."}{" "}
            Existing legacy source records are preserved. An email already in
            flight may still arrive.
          </p>
          <div className="actions">
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  if (subject === "portfolio") {
                    await savePortfolio(
                      user.uid,
                      selected.name,
                      selected,
                      true,
                    );
                    navigate("portfolios");
                  } else
                    await saveHolding(user.uid, selected.id, {
                      ...subject,
                      mode: "delete",
                      expected: subject,
                    });
                }, "Deleted. Related notifications are stopped.")
              }
            >
              Confirm delete
            </button>
            <button className="button" onClick={() => setRemoval(null)}>
              Cancel
            </button>
          </div>
        </div>
      </section>
    );
  const marketPill = (
    <StatusPill
      icon={paused ? "pause" : "refresh"}
      tone={paused ? "neutral" : "ok"}
    >
      <b>{paused ? "Market updates paused" : "Shared market cache"}</b> ·
      Holdings remain editable
      {fixtureMode && (
        <strong className="fixture-note">
          {" "}
          · Development fixtures — never eligible for notifications
        </strong>
      )}
    </StatusPill>
  );
  return (
    <>
      <PageHeading title="Portfolios" subtitle="Manually recorded holdings">
        {marketPill}
      </PageHeading>
      {feedback}
      <div className="portfolio-layout">
        <aside className="portfolio-sidebar" aria-label="Your portfolios">
          <h2 className="sr-only">Your portfolios</h2>
          {loading && !portfolios.length ? (
            <p role="status" className="loading-line">
              Loading private portfolios…
            </p>
          ) : (
            <nav className="portfolio-list" aria-label="Portfolio list">
              {portfolios.map((p) => {
                const current = selected?.id === p.id;
                return (
                  <a
                    key={p.id}
                    href={`#view=portfolios&portfolio=${p.id}`}
                    aria-current={current ? "page" : undefined}
                  >
                    <span className="portfolio-dot" aria-hidden="true" />
                    <span className="portfolio-link-text">
                      {p.name}
                      {current && !holdingLoading && (
                        <small>
                          {holdings.length}{" "}
                          {holdings.length === 1 ? "holding" : "holdings"}
                        </small>
                      )}
                    </span>
                  </a>
                );
              })}
            </nav>
          )}
          <button
            className="button new-portfolio"
            onClick={createPortfolio}
            disabled={busy}
          >
            <PixelIcon name="plus" />
            New portfolio
          </button>
          <div className="sidebar-island" aria-hidden="true">
            <PixelIsland />
            <p>
              Manually recorded.
              <br />
              Not connected to your in-game inventory.
            </p>
          </div>
        </aside>
        <div className="portfolio-content">
          {portfolioEditor === "create" && portfolioForm}
          {!loading && !portfolios.length && !portfolioEditor && (
            <section className="ledger-card empty-state large">
              <span className="empty-icon">
                <SkyIcon name="watchlist-chest" size={72} />
              </span>
              <div>
                <h2>Your first portfolio starts here</h2>
                <p>
                  Add only the items you own, with your actual quantities and
                  costs.
                </p>
              </div>
              <button className="button primary" onClick={createPortfolio}>
                <PixelIcon name="plus" />
                Create portfolio
              </button>
            </section>
          )}
          {!!portfolios.length && !selected && (
            <section className="ledger-card narrow-card">
              <h2 className="card-title">Portfolio unavailable</h2>
              <p>
                Choose an available portfolio. This link may refer to a deleted
                portfolio or another account.
              </p>
            </section>
          )}
          {selected && (
            <>
              <div className="portfolio-heading">
                <h2>{selected.name}</h2>
                <button
                  className="button small"
                  onClick={() => {
                    setName(selected.name);
                    setPortfolioEditor("rename");
                  }}
                >
                  <PixelIcon name="pencil" />
                  Edit name
                </button>
                <button
                  className="button small quiet-danger"
                  onClick={() => setRemoval("portfolio")}
                >
                  <PixelIcon name="trash" />
                  Delete portfolio
                </button>
                <button
                  className="button primary add-holding"
                  disabled={busy || holdingLoading}
                  onClick={() => {
                    setEditor({ mode: "create" });
                    setNotificationEditor(null);
                  }}
                >
                  <PixelIcon name="plus" size={18} />
                  Add holding
                </button>
              </div>
              {portfolioEditor === "rename" && portfolioForm}
              {removal === "portfolio" && confirmRemoval("portfolio")}
              <dl className="stat-cards">
                <div>
                  <dt>Cost basis</dt>
                  <dd>
                    <Coins value={totals.costBasis} size={26} />
                  </dd>
                </div>
                <div>
                  <dt>Estimated value</dt>
                  <dd>
                    <Coins value={totals.value} size={26} />
                    {!!holdings.length && (
                      <small>
                        {totals.missing
                          ? "Incomplete valuation"
                          : totals.stale
                            ? "Last-known estimate"
                            : "Indicative value"}
                      </small>
                    )}
                  </dd>
                </div>
                <div
                  className={
                    totals.pnl === null ? "" : totals.pnl < 0 ? "loss" : "gain"
                  }
                >
                  <dt>Unrealized P&L</dt>
                  <dd>
                    {totals.pnl === null ? (
                      <span className="coins unavailable">Unavailable</span>
                    ) : (
                      <span className="pnl-figure">
                        {totals.pnl > 0 ? "+" : ""}
                        {exact(totals.pnl)}
                        <span className="sr-only"> coins</span>
                        <span className="pnl-percent">
                          {" "}
                          · {percent(totals.returnPercent)}
                        </span>
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
              {!!totals.missing && (
                <InfoNote tone="warn">
                  <p>
                    {totals.missing} of {holdings.length} holdings have no
                    usable price. P&L compares available value with only its
                    matching cost basis ({exact(totals.valuedBasis)} coins).
                    Total acquisition cost includes all holdings.
                  </p>
                </InfoNote>
              )}
              {!!auctionAssets && !AUCTION_COLLECTION_ENABLED && (
                <InfoNote tone="warn">
                  <p>
                    Auction price updates are disabled. Your saved auction
                    holdings are still editable.
                  </p>
                </InfoNote>
              )}
              {marketError && (
                <details className="market-detail">
                  <summary>
                    Market data is unavailable; holdings are still editable
                  </summary>
                  <p>{marketError}</p>
                </details>
              )}
              <h2 className="section-title">
                Holdings <span>({holdings.length})</span>
              </h2>
              {editor?.mode === "create" && (
                <HoldingEditor
                  key="create:new"
                  mode="create"
                  busy={busy}
                  save={save}
                  cancel={() => setEditor(null)}
                />
              )}
              {holdingLoading ? (
                <p role="status" className="loading-line">
                  Loading holdings…
                </p>
              ) : !holdings.length ? (
                editor?.mode !== "create" && (
                  <section className="ledger-card empty-state">
                    <span className="empty-icon">
                      <SkyIcon name="bazaar-crate" size={56} />
                    </span>
                    <div>
                      <h3>No holdings yet</h3>
                      <p>
                        Record a Bazaar item or an exact Auction House asset
                        variant to get started.
                      </p>
                    </div>
                  </section>
                )
              ) : (
                <div className="holding-list">
                  {totals.rows.map(({ holding: h, valuation: v }) => (
                    <HoldingRow
                      key={h.id}
                      holding={h}
                      valuation={v}
                      notification={nFor(h)}
                      now={now}
                      busy={busy}
                      onEdit={() => {
                        setEditor({ mode: "edit", holding: h });
                        setNotificationEditor(null);
                      }}
                      onPurchase={() => {
                        setEditor({ mode: "purchase", holding: h });
                        setNotificationEditor(null);
                      }}
                      onNotify={() => {
                        setNotificationEditor(h);
                        setEditor(null);
                      }}
                      onDelete={() => setRemoval(h)}
                    >
                      {editor?.holding?.id === h.id && (
                        <HoldingEditor
                          key={`${editor.mode}:${h.id}`}
                          mode={editor.mode}
                          holding={h}
                          busy={busy}
                          save={save}
                          cancel={() => setEditor(null)}
                        />
                      )}
                      {notificationEditor?.id === h.id && (
                        <NotificationEditor
                          key={h.id}
                          holding={h}
                          current={nFor(h)}
                          busy={busy}
                          save={notify}
                          cancel={() => setNotificationEditor(null)}
                        />
                      )}
                      {removal !== "portfolio" &&
                        removal?.id === h.id &&
                        confirmRemoval(h)}
                    </HoldingRow>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
