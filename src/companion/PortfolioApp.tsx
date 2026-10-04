import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { SessionReads } from "./session-reads";
import type { User } from "firebase/auth";
import {
  Bell,
  BriefcaseBusiness,
  ChevronLeft,
  Info,
  LockKeyhole,
  LogOut,
  Pause,
  Plus,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { auth, login, logout, watchAuth } from "../data";
import { localWorkspace } from "../local-workspace";
import { signInErrorMessage } from "../sign-in-error";
import { SampleTime } from "../SampleTime";
import { readAccount } from "../account";
import { requestBackend } from "../backend";
import { exact, ItemArt, SkyIcon } from "./components";
import { fixtureMode, getBazaar, marketRequest } from "./api";
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
import type { BazaarItem, Listing } from "../../shared/companion/types";
import type { Workflow } from "../../shared/model";
import HoldingEditor from "./HoldingEditor";
import NotificationEditor from "./NotificationEditor";
import ActionMenu from "./ActionMenu";
import { portfolioCompact, portfolioPercent } from "./portfolio-format";
import "./portfolio.css";
import "./skyblock-theme.css";
const UsageDashboard = lazy(() => import("./UsageDashboard"));
type View = "portfolios" | "notifications" | "account" | "usage";
export function portfolioRoute(hash = location.hash): {
  view: View;
  portfolioId: string | null;
  disable: string | null;
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
  };
}
function navigate(view: View, portfolioId?: string) {
  location.hash = new URLSearchParams({
    view,
    ...(portfolioId ? { portfolio: portfolioId } : {}),
  }).toString();
}
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
        !["portfolios", "notifications", "account", "usage"].includes(
          new URLSearchParams(location.hash.slice(1)).get("view") ?? "",
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
  return (
    <div className="portfolio-app">
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
      <header className="market-header">
        <div className="market-header-inner">
          <a className="market-brand" href="#view=portfolios">
            <SkyIcon name="emerald" size={36} className="brand-gem" />
            <span className="brand-word">BazaarSignal</span>
          </a>
          <p className="tagline-sign">Your SkyBlock portfolio.</p>
          <nav className="market-tabs" aria-label="Main navigation">
            {(
              [
                ["portfolios", "Portfolios", BriefcaseBusiness],
                ["notifications", "Notifications", Bell],
                ["account", "Account", Settings],
                ...(ownerCandidate(user)
                  ? [["usage", "Usage & Costs", ShieldCheck]]
                  : []),
              ] as const
            ).map(([view, label, Icon]) => (
              <a
                key={view as string}
                className={route.view === view ? "active" : undefined}
                href={`#view=${view}`}
                aria-current={route.view === view ? "page" : undefined}
              >
                <Icon size={17} />
                <span>{label as string}</span>
              </a>
            ))}
          </nav>
          <div className="header-signs">
            <span className="private-account">
              <LockKeyhole size={15} /> Private account
            </span>
            {user ? (
              <button
                className="account-button signout"
                onClick={() => void logout()}
              >
                <LogOut size={16} />
                Sign out
              </button>
            ) : (
              <button
                className="account-button"
                onClick={() => void signIn()}
                disabled={busy}
              >
                Sign in with Google
              </button>
            )}
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        <div className="portfolio-frame">
          <div className="portfolio-paper">
            {localWorkspace && (
              <p className="notice local-workspace-notice">
                Local workspace · Holdings and notification settings are saved
                on this computer. Your production records are separate. Market
                checks and email delivery are disabled.
              </p>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {route.disable ? (
              <LegacyDisable token={route.disable} />
            ) : user ? (
              <Workspace
                key={`${user.uid}:${epoch}`}
                user={user}
                route={route}
              />
            ) : (
              <section className="intro">
                <div>
                  <p className="eyebrow">PERSONAL SKYBLOCK PORTFOLIOS</p>
                  <h1>
                    Know what you own.
                    <br />
                    <span>See how it’s doing.</span>
                  </h1>
                  <p className="intro-copy">
                    Keep your Bazaar items and Auction House assets in one
                    place. Record what you paid, follow estimated value, and
                    choose the price changes that matter to you.
                  </p>
                  <button
                    className="primary"
                    onClick={() => void signIn()}
                    disabled={busy}
                  >
                    Sign in with Google
                  </button>
                  <p className="muted">
                    Private to your account. Manually recorded holdings.
                    <br />
                    No connection to your in-game inventory.
                  </p>
                </div>
                <div className="intro-art" aria-hidden="true">
                  <img src="/assets/items/booster_cookie.webp" alt="" />
                  <img
                    src="/assets/items/enchanted_diamond_block.webp"
                    alt=""
                  />
                  <img src="/assets/items/summoning_eye.webp" alt="" />
                  <span>YOUR ITEMS. YOUR COST BASIS.</span>
                </div>
                <div className="intro-features">
                  <article>
                    <b>Organize your holdings</b>
                    <p>
                      Create portfolios for your own goals and record additional
                      purchases.
                    </p>
                  </article>
                  <article>
                    <b>Understand your returns</b>
                    <p>
                      Estimated value and unrealized P&L with clear valuation
                      references.
                    </p>
                  </article>
                  <article>
                    <b>Choose your thresholds</b>
                    <p>
                      Holding-based percentage notifications, with an explicit
                      baseline.
                    </p>
                  </article>
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
      <footer>
        Manually tracked. Market estimates can change. Not affiliated with
        Hypixel.
      </footer>
    </div>
  );
}
function LegacyDisable({ token }: { token: string }) {
  const [done, setDone] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel">
      <h1>Disable legacy alert</h1>
      <p>
        This link belongs to an existing price-target alert. Opening the link
        does not change it.
      </p>
      {done ? (
        <p role="status">
          Alert disabled. Any email already in flight may still arrive.
        </p>
      ) : (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await requestBackend({ action: "disable", token, confirm: true });
              setDone(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Disable alert
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <a href="#view=notifications">Go to notifications</a>
    </section>
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
  const needsBazaar = holdings.some((h) => h.kind === "bazaar"),
    auctionAssets = holdings
      .filter((h) => h.kind === "auction")
      .map((h) => h.id)
      .sort()
      .join(","),
    needsAuctions = !!auctionAssets;
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
  const confirmation = useRef<HTMLElement>(null);
  useEffect(() => {
    if (removal) confirmation.current?.focus();
  }, [removal]);
  if (route.view === "usage")
    return ownerCandidate(user) ? (
      <Suspense fallback={<p>Loading usage…</p>}>
        <UsageDashboard user={user} />
      </Suspense>
    ) : (
      <section className="panel">
        <h1>Owner access only</h1>
        <a href="#view=portfolios">Back to Portfolios</a>
      </section>
    );
  return (
    <div
      className={
        route.view === "portfolios" ? "portfolio-layout" : "workspace-page"
      }
    >
      {route.view === "portfolios" && (
        <aside className="portfolio-sidebar" aria-label="Your portfolios">
          <h2>Your portfolios</h2>
          <nav aria-label="Portfolio selection">
            {portfolios.map((p) => (
              <a
                key={p.id}
                href={`#view=portfolios&portfolio=${p.id}`}
                aria-current={selected?.id === p.id ? "page" : undefined}
              >
                <BriefcaseBusiness size={20} />
                <span>{p.name}</span>
              </a>
            ))}
          </nav>
          <button
            className="new-portfolio"
            disabled={busy}
            onClick={() => {
              setName("");
              setPortfolioEditor("create");
            }}
          >
            <Plus size={20} /> New portfolio
          </button>
          <div className="tracking-note">
            <Info size={17} />
            <p>
              Manually tracked<span>Not connected to your inventory.</span>
            </p>
          </div>
        </aside>
      )}
      <div className="portfolio-content">
        <div className="page-title">
          <div>
            {route.view === "portfolios" ? (
              <p className="portfolio-breadcrumb">
                <ChevronLeft size={16} /> Portfolios
              </p>
            ) : (
              <p className="eyebrow">YOUR PRIVATE ACCOUNT</p>
            )}
            <div className="portfolio-title-row">
              <h1>
                {route.view === "portfolios"
                  ? (selected?.name ?? "Portfolios")
                  : route.view === "notifications"
                    ? "Notifications"
                    : "Account"}
              </h1>
              {route.view === "portfolios" && selected && (
                <ActionMenu label="Portfolio actions" disabled={busy}>
                  <button
                    onClick={() => {
                      setName(selected.name);
                      setPortfolioEditor("rename");
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="destructive-action"
                    onClick={() => setRemoval("portfolio")}
                  >
                    Delete portfolio
                  </button>
                </ActionMenu>
              )}
            </div>
            <p>
              {route.view === "portfolios"
                ? "Your SkyBlock holdings, at a glance."
                : route.view === "notifications"
                  ? "Percentage changes for the holdings you choose."
                  : "Your identity and delivery preferences."}
            </p>
          </div>
          {route.view === "portfolios" && selected && (
            <button
              className="primary"
              onClick={() => {
                setEditor({ mode: "create" });
                setNotificationEditor(null);
              }}
              disabled={busy || holdingLoading}
            >
              <Plus size={18} />
              Add holding
            </button>
          )}
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
        <div className="market-note">
          {paused ? (
            <Pause size={16} className="pause-icon" aria-hidden="true" />
          ) : (
            <Info size={18} aria-hidden="true" />
          )}
          <div>
            <strong>
              {paused ? "Market updates paused" : "Shared market prices"}
            </strong>{" "}
            <span>Holdings are still editable.</span>
            {fixtureMode && (
              <strong>
                {" "}
                Development fixtures — never eligible for notifications.
              </strong>
            )}
          </div>
          {paused && (
            <span className="market-note-detail">
              New notification checks paused
            </span>
          )}
        </div>
        {loading && <p role="status">Loading private portfolios…</p>}
        {route.view === "account" ? (
          <section className="panel account">
            <h2>Signed in with Google</h2>
            <p>{user.email}</p>
            <p>
              <ShieldCheck size={18} /> Your portfolios, quantities, acquisition
              costs and notification settings are private to this account.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={emailEnabled}
                disabled={busy}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setEmailEnabled(enabled);
                  void action(
                    () => emailPreference(user.uid, enabled),
                    enabled
                      ? "Email delivery enabled for your chosen holding notifications."
                      : "Holding notification email delivery disabled.",
                    "preference",
                  ).then((saved) => {
                    if (!saved && auth?.currentUser === user)
                      setEmailEnabled(!enabled);
                  });
                }}
              />
              Allow email for my holding notifications
            </label>
            <p>
              No holding notifications are created automatically. Delivery waits
              for fresh eligible samples, verified identity, available quota and
              an authorized service release.
            </p>
            <p>
              Legacy price alerts keep their existing delivery settings until
              you pause them in Notifications.
            </p>
          </section>
        ) : route.view === "notifications" ? (
          <>
            <section className="panel">
              <h2>Holding notifications</h2>
              <p>
                Email delivery is {emailEnabled ? "enabled" : "off in Account"}.
                Market evaluation is{" "}
                {paused
                  ? "paused"
                  : "subject to fresh evidence and service availability"}
                .
              </p>
              {!notifications.some((n) => !n.deleted) ? (
                <p>
                  No holding notifications yet. Open a portfolio and choose{" "}
                  <b>Set notification</b> on a holding.
                </p>
              ) : (
                notifications
                  .filter((n) => !n.deleted)
                  .map((n) => {
                    const portfolio = portfolios.find(
                      (p) => p.id === n.portfolioId,
                    );
                    return (
                      <article className="notification-row" key={n.id}>
                        <div>
                          <b>
                            {portfolio?.name ?? "Deleted portfolio"} ·{" "}
                            {n.holdingName ?? "Holding"}
                          </b>
                          <p>
                            {n.up !== null ? `Up ${n.up}% ` : ""}
                            {n.down !== null ? `Down ${n.down}%` : ""} ·{" "}
                            {n.baseline === "acquisition"
                              ? "Average acquisition price"
                              : `Captured sample: ${exact(n.capturedPrice)} coins`}
                          </p>
                          <span>
                            {!portfolio
                              ? "Stopped: portfolio deleted"
                              : n.enabled
                                ? "Enabled · waiting for eligible checks"
                                : "Paused"}
                          </span>
                        </div>
                        <div className="actions">
                          <button
                            onClick={() =>
                              navigate("portfolios", n.portfolioId)
                            }
                          >
                            Open holding
                          </button>
                          <button
                            disabled={busy || !portfolio}
                            onClick={() =>
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
                          >
                            {n.enabled ? "Pause" : "Resume"}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
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
                          >
                            Delete notification
                          </button>
                        </div>
                      </article>
                    );
                  })
              )}
            </section>
            <LegacyAlerts user={user} />
          </>
        ) : (
          <>
            {portfolioEditor && (
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
            {!loading && !portfolios.length && !portfolioEditor && (
              <section className="panel empty">
                <SkyIcon name="watchlist-chest" size={72} />
                <h2>Your first portfolio starts here</h2>
                <p>
                  Add only the items you own, with your actual quantities and
                  costs.
                </p>
                <button
                  className="primary"
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
              <>
                {!selected ? (
                  <section className="panel">
                    <h2>Portfolio unavailable</h2>
                    <p>
                      Choose an available portfolio. This link may refer to a
                      deleted portfolio or another account.
                    </p>
                  </section>
                ) : (
                  <>
                    {removal && (
                      <section
                        className="panel confirm"
                        role="alertdialog"
                        aria-label="Confirm deletion"
                        ref={confirmation}
                        tabIndex={-1}
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
                    <dl className="summary">
                      <Metric
                        label="Estimated value"
                        value={totals.value}
                        overview
                        featured
                        note={
                          totals.missing
                            ? "Incomplete valuation"
                            : totals.stale
                              ? "Last-known estimate"
                              : "Indicative value"
                        }
                      />
                      <Metric
                        label="Total cost basis"
                        value={totals.costBasis}
                        overview
                      />
                      <Metric
                        label="Unrealized P&L"
                        value={totals.pnl}
                        note={portfolioPercent(totals.returnPercent)}
                        overview
                        profit
                      />
                    </dl>
                    {!!totals.missing && (
                      <p className="coverage">
                        {totals.missing} of {holdings.length} holdings have no
                        usable price. P&L compares available value with only its
                        matching cost basis ({exact(totals.valuedBasis)} coins).
                        Total acquisition cost includes all holdings.
                      </p>
                    )}
                    {marketError && (
                      <details className="market-detail">
                        <summary>
                          Market data is unavailable; holdings are still
                          editable
                        </summary>
                        <p>{marketError}</p>
                      </details>
                    )}
                    <div className="holding-toolbar">
                      <h2>
                        Holdings <span>{holdings.length}</span>
                      </h2>
                      <span className="holdings-count">
                        {exact(
                          holdings.reduce(
                            (count, h) =>
                              count +
                              h.quantity *
                                (h.kind === "auction" ? h.stackSize : 1),
                            0,
                          ),
                        )}{" "}
                        items total
                      </span>
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
                      <section className="panel empty">
                        <SkyIcon name="bazaar-crate" size={60} />
                        <h3>No holdings yet</h3>
                        <p>
                          Record a Bazaar item or an exact Auction House asset
                          variant to get started.
                        </p>
                      </section>
                    ) : (
                      totals.rows.map(({ holding: h, valuation: v }) => {
                        const notification = nFor(h);
                        return (
                          <article
                            className="holding panel"
                            key={h.id}
                            aria-label={`${h.name} holding`}
                          >
                            <div className="holding-top">
                              <div className="asset-title">
                                <span className="holding-art">
                                  <ItemArt id={h.itemId} size="small" />
                                </span>
                                <div>
                                  <div className="asset-name">
                                    <h3>{h.name}</h3>
                                    <span className="market-badge">
                                      {h.kind === "bazaar"
                                        ? "Bazaar"
                                        : "Auction House"}
                                    </span>
                                  </div>
                                  <span className="muted">
                                    {exact(h.quantity)}{" "}
                                    {h.kind === "auction" ? "stacks" : "items"}
                                    {h.kind === "auction" &&
                                      ` · ${exact(h.stackSize)} items per stack`}
                                  </span>
                                </div>
                              </div>
                              <div
                                className={`holding-return ${v.pnl === null ? "muted" : v.pnl < 0 ? "loss" : "gain"}`}
                              >
                                <strong>
                                  {v.pnl === null
                                    ? "Value unavailable"
                                    : `${exact(v.pnl)} coins`}
                                </strong>
                                <span>
                                  {v.pnl === null
                                    ? "Waiting for price evidence"
                                    : `${portfolioPercent(v.returnPercent)} unrealized return`}
                                </span>
                              </div>
                            </div>
                            <dl className="holding-metrics">
                              <Metric
                                label={
                                  h.kind === "auction"
                                    ? "Stacks owned"
                                    : "Quantity"
                                }
                                value={h.quantity}
                                unit=""
                              />
                              <Metric
                                label="Avg. acquisition"
                                value={h.costBasis / h.quantity}
                                unit={
                                  h.kind === "auction"
                                    ? "coins / stack"
                                    : "coins / item"
                                }
                              />
                              <Metric
                                label="Reference price"
                                value={v.referencePrice}
                                unit={
                                  h.kind === "auction"
                                    ? "coins / stack"
                                    : "coins / item"
                                }
                              />
                              <Metric label="Position value" value={v.value} />
                            </dl>
                            <details className="valuation-details">
                              <summary>
                                <span>Valuation details</span>
                                <span className="reference">
                                  {v.reference}
                                  {h.kind === "auction" &&
                                    ` · ${v.comparables} comparable listings`}
                                </span>
                              </summary>
                              <p>
                                Cost basis: <b>{exact(h.costBasis)} coins</b>
                              </p>
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
                              {h.kind === "auction" ? (
                                <>
                                  <pre>{h.configuration}</pre>
                                  <p>
                                    At least three exact-configuration listings
                                    are required. The cache supplies up to 20 of
                                    the lowest matching asks. Units here are
                                    complete stacks, never extrapolated
                                    individual items.
                                  </p>
                                  {v.uncertainty.map((r, i) => (
                                    <p key={i}>{r}</p>
                                  ))}
                                  <p>{v.liquidationReason}</p>
                                </>
                              ) : v.liquidation ? (
                                <p>
                                  Full-quantity{" "}
                                  {v.freshness === "stale" ? "last-known " : ""}
                                  after-tax liquidation estimate:{" "}
                                  <b>
                                    {exact(v.liquidation.value)} coins
                                  </b> · {v.liquidation.taxPercent}% tax. Entire
                                  quantity fits visible bids. Unrealized P&L
                                  above uses the indicative top bid before fees
                                  and slippage.
                                </p>
                              ) : (
                                <p>
                                  Full-quantity after-tax liquidation
                                  unavailable: {v.liquidationReason}
                                </p>
                              )}
                            </details>
                            <div className="holding-bottom">
                              <div className="holding-notification">
                                <span className="notification-status">
                                  <Bell size={15} />
                                  {notification
                                    ? `${notification.enabled ? "Enabled" : "Paused"} · ${notification.up === null ? "" : `↑ ${notification.up}% `}${notification.down === null ? "" : `↓ ${notification.down}% `} · baseline ${exact(notificationBaseline(notification, h))}`
                                    : "Notifications off"}
                                </span>
                                <button
                                  className="text-action"
                                  disabled={busy}
                                  onClick={() => {
                                    setNotificationEditor(h);
                                    setEditor(null);
                                  }}
                                >
                                  {notification
                                    ? "Edit notification"
                                    : "Set notification"}
                                </button>
                              </div>
                              <div className="actions">
                                <button
                                  disabled={busy}
                                  onClick={() => {
                                    setEditor({ mode: "edit", holding: h });
                                    setNotificationEditor(null);
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="purchase-action"
                                  disabled={busy}
                                  onClick={() => {
                                    setEditor({ mode: "purchase", holding: h });
                                    setNotificationEditor(null);
                                  }}
                                >
                                  Add purchase
                                </button>
                                <ActionMenu
                                  label={`${h.name} actions`}
                                  disabled={busy}
                                >
                                  <button
                                    className="destructive-action"
                                    disabled={busy}
                                    onClick={() => setRemoval(h)}
                                  >
                                    Delete
                                  </button>
                                </ActionMenu>
                              </div>
                            </div>
                          </article>
                        );
                      })
                    )}
                    <p className="estimate-note">
                      <Info size={16} /> Estimates use{" "}
                      {totals.stale || paused ? "last-known" : "available"}{" "}
                      market prices.
                    </p>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
function Metric({
  label,
  value,
  note,
  profit = false,
  overview = false,
  featured = false,
  unit = "coins",
}: {
  label: string;
  value: number | null;
  note?: string;
  profit?: boolean;
  overview?: boolean;
  featured?: boolean;
  unit?: string;
}) {
  return (
    <div
      className={`${featured ? "featured-metric" : ""} ${profit && value !== null ? (value < 0 ? "loss" : "gain") : ""}`}
    >
      <dt>
        {label}
        {featured && note && <span className="estimate-badge">{note}</span>}
      </dt>
      <dd>
        <span className={value === null ? "unavailable-value" : undefined}>
          {value === null
            ? "Unavailable"
            : overview
              ? portfolioCompact(value)
              : exact(value)}
        </span>
        {value !== null && unit && <small>{unit}</small>}
        {profit && note && note !== "—" && (
          <span className="return-badge">{note}</span>
        )}
        {overview && value !== null && (
          <span className="metric-exact">
            {exact(value)}
            {profit ? " coins" : ""}
          </span>
        )}
      </dd>
      {note && !featured && !profit && <dd className="metric-note">{note}</dd>}
    </div>
  );
}
function LegacyAlerts({ user }: { user: User }) {
  const [alerts, setAlerts] = useState<Workflow[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
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
    <section className="panel legacy">
      <h2>Legacy price alerts</h2>
      <p>
        Previous price targets have not been converted or re-enabled. Their
        records and disable links are preserved. Existing queued mail may still
        be delivered. New evaluation of legacy price targets has stopped.
      </p>
      <button disabled={busy} onClick={() => void load()}>
        {busy ? "Loading…" : "Review legacy alerts"}
      </button>
      {error && <p role="alert">{error}</p>}
      {loaded && !alerts.length && <p>No legacy alerts.</p>}
      {alerts.map((a) => (
        <div className="notification-row" key={a.id}>
          <span>
            {a.itemName} ·{" "}
            {a.paused
              ? "Disabled"
              : a.stage === "completed"
                ? "Completed"
                : "Legacy record; new evaluation stopped"}
          </span>
          <button
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
                if (auth?.currentUser === user) setError((e as Error).message);
              } finally {
                if (auth?.currentUser === user) setBusy(false);
              }
            }}
          >
            Disable legacy alert
          </button>
        </div>
      ))}
    </section>
  );
}
