import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { BriefcaseBusiness, LogOut, Settings, ShieldCheck } from "lucide-react";
import { auth, login, logout, watchAuth } from "../data";
import { signInErrorMessage } from "../sign-in-error";
import { requestBackend } from "../backend";
import { SkyIcon } from "./components";
import { ownerCandidate } from "./usage-access";
import NightMarketLanding from "./NightMarketLanding";
import BazaarSearch from "./BazaarSearch";
import BazaarItemPage from "./BazaarItemPage";
import "./portfolio.css";
import "./skyblock-theme.css";
import "./night-market-workspace.css";
const Workspace = lazy(() => import("./Workspace"));
type View = "portfolios" | "settings" | "admin" | "item";
export function portfolioRoute(hash = location.hash): {
  view: View;
  portfolioId: string | null;
  itemId: string;
  disable: string | null;
  section: "account" | "notifications";
} {
  const p = new URLSearchParams(hash.slice(1)),
    view = p.get("view");
  return {
    view:
      view === "item"
        ? "item"
        : view === "usage" || view === "admin"
          ? "admin"
          : ["notifications", "account", "settings"].includes(view ?? "")
            ? "settings"
            : "portfolios",
    section:
      view === "notifications" || p.get("section") === "notifications"
        ? "notifications"
        : "account",
    portfolioId: p.get("portfolio"),
    itemId: p.get("item") ?? "",
    disable: p.get("disable"),
  };
}
export default function PortfolioApp() {
  const workspaceOwner = useRef<string | null>(null);
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null),
    [authReady, setAuthReady] = useState(!auth || !!auth.currentUser),
    [epoch, setEpoch] = useState(0),
    [route, setRoute] = useState(() => portfolioRoute()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(
    () =>
      watchAuth((u, reason) => {
        setUser(u);
        setAuthReady(true);
        setEpoch((e) => e + 1);
        setError(reason ?? "");
      }),
    [],
  );
  useEffect(() => {
    const update = () => {
      const r = portfolioRoute();
      setRoute(r);
      if (
        !r.disable &&
        !["portfolios", "settings", "admin", "item"].includes(
          new URLSearchParams(location.hash.slice(1)).get("view") ?? "",
        )
      ) {
        history.replaceState(
          null,
          "",
          `${location.pathname}${location.search}#${new URLSearchParams({ view: r.view, ...(r.view === "settings" ? { section: r.section } : {}), ...(r.portfolioId ? { portfolio: r.portfolioId } : {}) })}`,
        );
        setRoute(portfolioRoute());
      }
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  async function signIn() {
    if (!auth) {
      setError(
        import.meta.env.DEV
          ? "Google sign-in is unavailable in this preview. Start the local workspace with npm run dev:local."
          : "Google sign-in is not configured on this site. Please try again later.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await login();
    } catch (e) {
      setError(signInErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  // Keep a visited workspace mounted for session-cache reuse, but a direct
  // public item visit does not download private workspace/Firestore code.
  if (!user) workspaceOwner.current = null;
  else if (route.view !== "item") workspaceOwner.current = user.uid;
  // A null currentUser during Firebase startup does not mean signed out.
  // Wait for the existing auth observer without starting another request.
  if (!authReady && !route.disable && route.view !== "item") {
    return (
      <main className="auth-loading" aria-busy="true">
        <p role="status">Loading BazaarSignal…</p>
      </main>
    );
  }
  if (!user && !route.disable && route.view !== "item") {
    return (
      <NightMarketLanding
        view={route.view}
        busy={busy}
        error={error}
        onSignIn={() => void signIn()}
      />
    );
  }
  return (
    <div className={`portfolio-app night-workspace${route.view === "item" && !route.disable ? " item-view" : ""}`}>
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
          <a className="market-brand" href="#view=portfolios" aria-label="BazaarSignal home">
            <SkyIcon name="emerald" size={72} className="brand-gem" />
            <span className="brand-word">BazaarSignal</span>
          </a>
          <BazaarSearch />
          <nav className="market-tabs" aria-label="Main navigation">
            {(
              [
                ["portfolios", "Portfolio", BriefcaseBusiness],
                ["settings", "Settings", Settings],
                ...(ownerCandidate(user)
                  ? [["admin", "Admin", ShieldCheck]]
                  : []),
              ] as const
            ).map(([view, label, Icon]) => (
              <a
                key={view as string}
                className={route.view === view ? "active" : undefined}
                href={`#view=${view}`}
                aria-current={route.view === view ? "page" : undefined}
              >
                {view === "portfolios" ? (
                  <SkyIcon
                    name={
                      view === "portfolios" ? "watchlist-chest" : "alert-bell"
                    }
                    size={36}
                    className="tab-icon"
                  />
                ) : (
                  <Icon size={25} />
                )}
                <span>{label as string}</span>
              </a>
            ))}
          </nav>
          <div className="header-signs">
            <span className="server-tag">
              HYPIXEL
              <br />
              <b>SKYBLOCK</b>
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
            <span className="lantern" aria-hidden="true" />
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        <div className="portfolio-frame">
          <div className="portfolio-paper">
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {route.disable ? (
              <LegacyDisable token={route.disable} />
            ) : (
              <>
                {route.view === "item" && <BazaarItemPage key={route.itemId} itemId={route.itemId} />}
                {user && workspaceOwner.current === user.uid && (
                  <Suspense fallback={<p role="status">Loading workspace…</p>}>
                    <Workspace key={user.uid + ":" + epoch} user={user} route={route} />
                  </Suspense>
                )}
              </>
            )}
          </div>
        </div>
      </main>
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
      <a href="#view=settings&section=notifications">Go to notifications</a>
    </section>
  );
}
