import { useEffect, useMemo, useRef, useState } from "react";
import { marketMessage } from '../market-copy';
import type { User } from "firebase/auth";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Grid2X2,
  List,
  LogOut,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import type {
  AuctionFilters,
  AuctionOpportunity,
  BazaarFilters,
  BazaarItem,
  CollectorHealth,
} from "../../shared/companion/types";
import {
  defaultBazaarFilters,
  bazaarTrade,
} from "../../shared/companion/bazaar";
import {
  auctionOpportunity,
  defaultAuctionFilters,
} from "../../shared/companion/auctions";
import { auctionComparison } from "../../shared/companion/auction-comparison";
import { auth, login, logout, watchAuth } from "../data";
import { signInErrorMessage } from "../sign-in-error";
import {
  fixtureMode,
  getAuctions,
  getBazaar,
  getAuctionCommand,
  getAuctionDetail,
} from "./api";
import {
  loadPreferences,
  loadWatchlist,
  removeItem,
  saveItem,
  savePreferences,
  type SavedItem,
} from "./private";
import { AuctionFilterBar, BazaarFilterBar } from "./Filters";
import {
  AuctionGroupInspector,
  BazaarInspector,
  BlankInspector,
  InspectorShell,
} from "./Inspector";
import {
  artGlow,
  SkyIcon,
  EmptyState,
  ItemArt,
  ItemCard,
  LoadingState,
  SelectField,
  titleCase,
} from "./components";
import "./market.css";
import { visiblePoll, pollingDirective, PAUSED_MESSAGE } from "./polling";
import type { CacheResult, CacheStatus } from "./api";
import UsageDashboard from "./UsageDashboard";
import { ownerCandidate } from "./usage-access";
import { SampleTime } from "../SampleTime";
import { bazaarResults } from "./bazaar-results";
import { isFresh } from "../../shared/market";

type View = "bazaar" | "auctions" | "watchlist" | "usage";
const currentView = (): View => {
  const v = new URLSearchParams(location.hash.slice(1)).get("market");
  return v === "auctions" || v === "watchlist" || v === "usage" ? v : "bazaar";
};
function cleanPreferences<T extends object>(defaults: T, values: unknown): T {
  const out = { ...defaults };
  if (!values || typeof values !== "object") return out;
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = (values as T)[key];
    if (
      typeof value === typeof defaults[key] &&
      (typeof value !== "number" || Number.isFinite(value))
    )
      (out as any)[key] = value;
  }
  return out;
}
function localPreferences<T extends object>(market: string, defaults: T) {
  try {
    return cleanPreferences(
      defaults,
      JSON.parse(
        localStorage.getItem(`bazaarsignal:filters:${market}`) ?? "null",
      ),
    );
  } catch {
    return defaults;
  }
}
export default function MarketApp() {
  const inspectAfterNavigation = useRef(false);
  const [copyingAuction, setCopyingAuction] = useState<string | null>(null);
  const [auctionNames, setAuctionNames] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>(currentView),
    [user, setUser] = useState<User | null>(auth?.currentUser ?? null),
    [authBusy, setAuthBusy] = useState(false);
  const [bazaar, setBazaar] = useState<BazaarItem[]>([]),
    [bazaarLoading, setBazaarLoading] = useState(true),
    [marketError, setMarketError] = useState("");
  const [bf, setBf] = useState<BazaarFilters>(() =>
    localPreferences("bazaar", defaultBazaarFilters),
  );
  const [af, setAf] = useState<AuctionFilters>(() =>
    localPreferences("auctions", defaultAuctionFilters),
  );
  const [auctions, setAuctions] = useState<AuctionOpportunity[]>([]),
    [auctionLoading, setAuctionLoading] = useState(false),
    [auctionError, setAuctionError] = useState(""),
    [health, setHealth] = useState<CollectorHealth | null>(null),
    [auctionTotal, setAuctionTotal] = useState(0);
  const [page, setPage] = useState(0),
    [auctionPage, setAuctionPage] = useState(0),
    [now, setNow] = useState(Date.now());
  const [selectedBazaar, setSelectedBazaar] = useState<string | null>(null),
    [selectedAuction, setSelectedAuction] = useState<AuctionOpportunity | null>(
      null,
    ),
    [sheetOpen, setSheetOpen] = useState(false);
  const [saved, setSaved] = useState<SavedItem[]>([]),
    [savedLoading, setSavedLoading] = useState(false),
    [savedBusy, setSavedBusy] = useState(false),
    [toast, setToast] = useState(""),
    [privateError, setPrivateError] = useState("");
  const [help, setHelp] = useState(false);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [usage, setUsage] = useState(pollingDirective);
  useEffect(() => {
    const update = () => setUsage(pollingDirective());
    window.addEventListener("market-usage-policy", update);
    return () => window.removeEventListener("market-usage-policy", update);
  }, []);
  useEffect(() => {
    setCacheStatus(null);
  }, [view]);
  useEffect(() => {
    const update = () => {
      setView(currentView());
      // A cached watchlist result can open before hashchange is delivered.
      // Keep that explicitly requested inspector open on mobile navigation.
      if (!inspectAfterNavigation.current) setSheetOpen(false);
      inspectAfterNavigation.current = false;
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(
    () =>
      watchAuth((u) => {
        setUser(u);
        setSaved([]);
        setPrivateError("");
      }),
    [],
  );
  useEffect(() => {
    let alive = true;
    setSaved([]);
    setPrivateError("");
    if (view === "usage") {
      setSavedLoading(false);
      return;
    }
    if (!user) {
      setSavedLoading(false);
      setBf(localPreferences("bazaar", defaultBazaarFilters));
      setAf(localPreferences("auctions", defaultAuctionFilters));
      return;
    }
    setSavedLoading(true);
    setBf({ ...defaultBazaarFilters });
    setAf({ ...defaultAuctionFilters });
    Promise.all([
      loadWatchlist(user.uid),
      loadPreferences(user.uid, "bazaar"),
      loadPreferences(user.uid, "auctions"),
    ])
      .then(([items, b, a]) => {
        if (alive) {
          setSaved(items);
          setBf(cleanPreferences(defaultBazaarFilters, b));
          setAf(cleanPreferences(defaultAuctionFilters, a));
        }
      })
      .catch((e) => {
        if (alive)
          setPrivateError(
            e instanceof Error ? e.message : "Private data unavailable",
          );
      })
      .finally(() => {
        if (alive) setSavedLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user?.uid, view === "usage"]);
  useEffect(() => {
    if (!user) {
      try {
        localStorage.setItem("bazaarsignal:filters:bazaar", JSON.stringify(bf));
        localStorage.setItem(
          "bazaarsignal:filters:auctions",
          JSON.stringify(af),
        );
      } catch {
        /* Preferences must not block browsing. */
      }
    }
  }, [bf, af, user]);
  useEffect(() => {
    if (view === "auctions" || view === "usage") return;
    let version = "",
      alive = true;
    const stop = visiblePoll(async (signal) => {
      try {
        const r = await getBazaar(signal),
          meta = r as typeof r & CacheResult;
        if (!alive || signal.aborted) return;
        const nextVersion = meta.version ?? String(r.items[0]?.upstreamAt);
        if (nextVersion !== version) {
          version = nextVersion;
          setBazaar(r.items);
        }
        setMarketError(r.error ?? "");
        setCacheStatus((prev) =>
          JSON.stringify(prev) === JSON.stringify(meta.status ?? null)
            ? prev
            : (meta.status ?? null),
        );
        setBazaarLoading(false);
      } catch (e) {
        if (alive && !signal.aborted) {
          setMarketError(e instanceof Error ? e.message : "Bazaar unavailable");
          setBazaarLoading(false);
        }
      }
    });
    return () => {
      alive = false;
      stop();
    };
  }, [view]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState !== "hidden") setNow(Date.now());
    };
    const timer = setInterval(update, 5000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  useEffect(() => {
    if (view !== "auctions") return;
    let version = "",
      alive = true;
    setAuctionLoading(true);
    const stop = visiblePoll(
      async (signal) => {
        try {
          const r = await getAuctions(af, auctionPage, signal),
            meta = r as typeof r & CacheResult;
          if (!alive || signal.aborted) return;
          const nextVersion = meta.version ?? String(r.health.activeUpstreamAt);
          if (nextVersion !== version) {
            version = nextVersion;
            setAuctions(r.items);
            setAuctionTotal(r.total);
            setAuctionPage(r.page);
            setHealth(r.health);
            setSelectedAuction(
              (prev) =>
                r.items.find(
                  (x) =>
                    x.listing.variant.itemId === prev?.listing.variant.itemId,
                ) ?? (prev?.group ? null : prev),
            );
          }
          setCacheStatus((prev) =>
            JSON.stringify(prev) === JSON.stringify(meta.status ?? null)
              ? prev
              : (meta.status ?? null),
          );
          setAuctionError(meta.status?.error ?? r.health.error ?? "");
          setAuctionLoading(false);
        } catch (e) {
          if (alive && !signal.aborted) {
            setAuctionError(
              e instanceof Error ? e.message : "Auction service unavailable",
            );
            setAuctionLoading(false);
          }
        }
      },
      20_000,
      250,
    );
    return () => {
      alive = false;
      stop();
    };
  }, [view, af, auctionPage]);
  const validBazaar =
    Object.values(bf).every(
      (v) => typeof v !== "number" || Number.isFinite(v),
    ) &&
    bf.quantity >= 1 &&
    Number.isSafeInteger(bf.quantity) &&
    bf.budget >= 0 &&
    bf.maxActivityShare >= 0;
  const rows = useMemo(
    () => (validBazaar ? bazaarResults(bazaar, bf, now) : []),
    [bazaar, bf, now, validBazaar],
  );
  const bazaarPageSize = 21;
  const pages = Math.max(1, Math.ceil(rows.length / bazaarPageSize)),
    safePage = Math.min(page, pages - 1),
    shown = rows.slice(
      safePage * bazaarPageSize,
      (safePage + 1) * bazaarPageSize,
    );
  const visibleAuctions = useMemo(
    () =>
      auctions.map((o) => ({
        ...auctionOpportunity(
          {
            ...o.listing,
            status:
              o.listing.end <= now
                ? "expired"
                : now - o.listing.upstreamAt > 180000
                  ? "stale"
                  : o.listing.status,
          },
          [],
          [],
          now,
          af.durationHours,
          false,
          o.valuation,
          o.feeContext,
          o.sampledValuation,
        ),
        group: o.group,
      })),
    [auctions, now, af.durationHours],
  );
  const selectedItem =
    bazaar.find((i) => i.id === selectedBazaar) ?? shown[0]?.item ?? null;
  const rawSelectedAh = selectedAuction ?? visibleAuctions[0] ?? null;
  const selectedAh = rawSelectedAh
    ? {
        ...auctionOpportunity(
          {
            ...rawSelectedAh.listing,
            status:
              rawSelectedAh.listing.end <= now
                ? "expired"
                : now - rawSelectedAh.listing.upstreamAt > 180000
                  ? "stale"
                  : rawSelectedAh.listing.status,
          },
          [],
          [],
          now,
          af.durationHours,
          false,
          rawSelectedAh.valuation,
          rawSelectedAh.feeContext,
          rawSelectedAh.sampledValuation,
        ),
        group: rawSelectedAh.group,
      }
    : null;
  const categories = [...new Set(bazaar.map((x) => x.category))].sort();
  const navigate = (target: View, inspect = false) => {
    inspectAfterNavigation.current = inspect;
    location.hash = `market=${target}`;
  };
  const patchBazaar = (patch: Partial<BazaarFilters>) => {
    setBf((f) => ({ ...f, ...patch }));
    setPage(0);
  };
  const patchAuction = (patch: Partial<AuctionFilters>) => {
    setAf((f) => ({ ...f, ...patch }));
    setAuctionPage(0);
  };
  async function signIn() {
    if (!auth) {
      setPrivateError(
        "Google sign-in needs Firebase configuration. Public browsing is available.",
      );
      return;
    }
    setAuthBusy(true);
    setPrivateError("");
    try {
      await login();
    } catch (e) {
      setPrivateError(signInErrorMessage(e));
    } finally {
      setAuthBusy(false);
    }
  }
  async function toggle(kind: SavedItem["kind"], id: string, name: string) {
    if (!user) {
      setPrivateError("Sign in with Google to save private watchlist items.");
      return;
    }
    if (savedBusy) return;
    setSavedBusy(true);
    const uid = user.uid,
      key = `${kind}_${id}`;
    setPrivateError("");
    try {
      if (saved.some((s) => s.key === key)) {
        await removeItem(uid, key);
        if (auth?.currentUser?.uid === uid)
          setSaved((s) => s.filter((x) => x.key !== key));
      } else {
        if (saved.length >= 100)
          throw new Error(
            "Your watchlist holds 100 items. Remove one to make room.",
          );
        const item: SavedItem = {
          key,
          kind,
          itemId: id,
          name,
          savedAt: Date.now(),
        };
        await saveItem(uid, item);
        if (auth?.currentUser?.uid === uid) setSaved((s) => [item, ...s]);
      }
    } catch (e) {
      if (auth?.currentUser?.uid === uid)
        setPrivateError(
          e instanceof Error ? e.message : "Could not save this item.",
        );
    } finally {
      setSavedBusy(false);
    }
  }
  async function persistFilters() {
    if (!user) {
      setToast(
        "Filters saved on this browser. Sign in to sync them privately.",
      );
      return;
    }
    try {
      await savePreferences(
        user.uid,
        view === "auctions" ? "auctions" : "bazaar",
        view === "auctions" ? af : bf,
      );
      setToast("Your private filter preferences are saved.");
    } catch (e) {
      setPrivateError(
        e instanceof Error ? e.message : "Filters could not be saved.",
      );
    }
  }
  const isSaved = (kind: string, id: string) =>
    saved.some((s) => s.key === `${kind}_${id}`);
  function openBazaar(id: string) {
    setSelectedBazaar(id);
    setSheetOpen(true);
  }
  function openAuction(item: AuctionOpportunity) {
    setSelectedAuction(item);
    setSheetOpen(true);
  }
  async function copyAuction(item: AuctionOpportunity) {
    if (copyingAuction) return;
    setCopyingAuction(item.listing.id);
    setToast("");
    let command = "";
    try {
      const result = await getAuctionCommand(item.listing.id);
      if (!/^\/ah [A-Za-z0-9_]{1,16}$/.test(result.command))
        throw new Error("Seller username unavailable. Please try again.");
      command = result.command;
      setAuctionNames((names) => ({
        ...names,
        [item.listing.id]: command.slice(4),
      }));
      await navigator.clipboard.writeText(command);
      setToast(
        `Copied ${command} — paste into Minecraft chat.${fixtureMode ? " Demo seller only." : ""}`,
      );
    } catch (e) {
      setToast(
        command
          ? `Clipboard unavailable. Copy manually: ${command}`
          : e instanceof Error
            ? e.message
            : "Couldn’t copy the auction command. Please try again.",
      );
    } finally {
      setCopyingAuction(null);
    }
  }
  function auctionLabel(item: AuctionOpportunity) {
    const name = auctionNames[item.listing.id] ?? item.listing.sellerName;
    return name
      ? `/ah ${name}`
      : copyingAuction === item.listing.id
        ? "Finding seller…"
        : "Find seller";
  }
  async function reopen(item: SavedItem) {
    if (item.kind === "bazaar") {
      navigate("bazaar", true);
      setSelectedBazaar(item.itemId);
      setTimeout(() => setSheetOpen(true), 0);
      if (!bazaar.some((b) => b.id === item.itemId))
        setToast("Saved item is currently unavailable in the Bazaar feed.");
    } else {
      navigate("auctions", true);
      try {
        const result =
          auctions.find((a) => a.listing.id === item.itemId) ??
          (await getAuctionDetail(item.itemId, af.durationHours));
        openAuction(result);
      } catch {
        setToast(
          "This saved auction is unavailable or no longer in the current snapshot.",
        );
      }
    }
  }
  const lastUpdate =
    (view === "auctions" ? health?.activeUpstreamAt : bazaar[0]?.upstreamAt) ||
    cacheStatus?.upstreamAt;
  const freshness = (
    <span className="freshness">
      <span
        className={`status-dot ${!lastUpdate || now - lastUpdate > 180000 ? "stale" : ""}`}
      />
      {fixtureMode ? (
        "Illustrative fixtures"
      ) : lastUpdate ? (
        <SampleTime timestamp={lastUpdate} now={now} compact />
      ) : (
        "Waiting for market data"
      )}
      <span className="automatic-status" aria-live="polite">
        {usage.mode === "paused"
          ? `${PAUSED_MESSAGE} · ${lastUpdate ? `data from ${new Date(lastUpdate).toLocaleString()}` : "no saved snapshot"}`
          : usage.retryAt&&now<usage.retryAt
            ? `Waiting for the app budget reset at ${new Date(usage.retryAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',timeZoneName:'short'})}. Saved prices are shown.`
          : !lastUpdate
            ? "Automatic updates · waiting"
            : now - lastUpdate > 180000
              ? view === "bazaar"
                ? "Historical estimates. Check in-game prices before trading."
                : "Snapshot asking-price comparisons. Check in-game prices and availability before trading."
              : (view === "auctions" ? auctionError : marketError)
                ? "Cached update failed · waiting for the next scheduled check"
                : cacheStatus?.refreshing && view === "auctions"
                  ? "Updating automatically…"
                  : "Automatic updates"}
        {usage.mode !== "paused" && usage.pollMs >= 3600_000
          ? ` · next price check ${new Date(Math.max(nextMarketRead(now, usage.pollMs),usage.retryAt??0)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
          : ""}
      </span>
    </span>
  );
  return (
    <div className={`companion ${view === "bazaar" ? "bazaar-layout" : ""}`}>
      <a href="#market-content" className="skip-link">
        Skip to market
      </a>
      <header className="market-header">
        <div className="market-header-inner">
          <button
            className="market-brand"
            onClick={() => navigate("bazaar")}
            aria-label="BazaarSignal home"
          >
            <SkyIcon name="emerald" size={72} className="brand-gem" />
            <span className="brand-word">BazaarSignal</span>
          </button>
          <p className="tagline-sign">
            Good loot. <span>Better deals.</span>
          </p>
          <div className="header-signs">
            <span className="server-tag">
              HYPIXEL
              <br />
              <b>SKYBLOCK</b>
            </span>
            {user ? (
              <button
                className="account-button"
                onClick={() => logout()}
                title={user.email ?? "Signed in"}
              >
                <LogOut size={15} />
                Sign out
              </button>
            ) : (
              <button
                className="account-button"
                disabled={authBusy}
                onClick={signIn}
              >
                {authBusy ? "Connecting…" : "Sign in with Google"}
              </button>
            )}
            <span className="lantern" aria-hidden="true" />
          </div>
          <nav className="market-tabs" aria-label="Main navigation">
            {(
              [
                ["bazaar", "Bazaar", "bazaar-crate"],
                ["auctions", "Auctions", "auction-gavel"],
                ["watchlist", "Watchlist", "favorite-heart"],
              ] as const
            ).map(([id, label, icon]) => (
              <button
                key={id}
                className={`tab-${id} ${view === id ? "active" : ""}`}
                onClick={() => navigate(id)}
                aria-current={view === id ? "page" : undefined}
              >
                <SkyIcon name={icon} size={36} className="tab-icon" />
                <span>{label}</span>
                {id === "watchlist" && saved.length > 0 && (
                  <span className="count-badge">{saved.length}</span>
                )}
              </button>
            ))}
            <a href="#alerts=1" className="tab-alerts">
              <SkyIcon name="alert-bell" size={36} className="tab-icon" />
              <span>Price alerts</span>
            </a>
            {ownerCandidate(user) && (
              <button
                className={view === "usage" ? "active tab-usage" : "tab-usage"}
                onClick={() => navigate("usage")}
                aria-current={view === "usage" ? "page" : undefined}
              >
                <ShieldCheck size={25} />
                <span>Usage &amp; Costs</span>
              </button>
            )}
          </nav>
          {(view === "bazaar" || view === "auctions") && (
            <label className="market-search">
              <Search size={20} strokeWidth={2.4} />
              <input
                type="search"
                aria-label={
                  view === "auctions"
                    ? "Search auction items"
                    : "Search Bazaar items"
                }
                placeholder={
                  view === "auctions"
                    ? "Search Buy It Now listings…"
                    : "Search items…"
                }
                value={view === "auctions" ? af.query : bf.query}
                onChange={(e) => {
                  if (view === "auctions")
                    patchAuction({ query: e.target.value });
                  else {
                    patchBazaar({ query: e.target.value });
                  }
                }}
              />
              {(view === "auctions" ? af.query : bf.query) && (
                <button
                  aria-label="Clear search"
                  onClick={() =>
                    view === "auctions"
                      ? patchAuction({ query: "" })
                      : patchBazaar({ query: "" })
                  }
                >
                  <X size={17} />
                </button>
              )}
            </label>
          )}
        </div>
      </header>
      <main id="market-content" className="market-main">
        <div className="market-frame">
          {fixtureMode && (
            <div className="notice fixture">
              DEVELOPMENT FIXTURES · Illustrative prices and auction evidence.
              No live recommendations.
            </div>
          )}
          {privateError && (
            <div className="notice warning" role="alert">
              {privateError}
              {!user && (
                <button onClick={signIn} disabled={authBusy}>
                  Sign in
                </button>
              )}
              <button
                aria-label="Dismiss account message"
                onClick={() => setPrivateError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {toast && (
            <div className="notice" role="status">
              {marketMessage(toast)}
              <button aria-label="Dismiss message" onClick={() => setToast("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {view === "usage" ? (
            <UsageDashboard key={user?.uid ?? "signed-out"} user={user} />
          ) : view === "watchlist" ? (
            <section className="watchlist-page">
              <div className="section-heading">
                <div>
                  <h2>Watchlist</h2>
                  <p>
                    Saved Bazaar items and auction listings. For email
                    notifications, set a price alert.
                  </p>
                </div>
                <SkyIcon name="watchlist-chest" size={96} />
              </div>
              {!user ? (
                <EmptyState
                  title="Sign in to use Watchlist"
                  action={
                    <button
                      className="button green"
                      onClick={signIn}
                      disabled={authBusy}
                    >
                      Sign in with Google
                    </button>
                  }
                >
                  Sign in to add, remove, and reopen your private saved items.
                </EmptyState>
              ) : savedLoading ? (
                <LoadingState />
              ) : !saved.length ? (
                <EmptyState
                  title="No saved items yet"
                  action={
                    <button
                      className="button blue"
                      onClick={() => navigate("bazaar")}
                    >
                      Explore the Bazaar <ArrowRight size={16} />
                    </button>
                  }
                >
                  Use the star on an item to save it here.
                </EmptyState>
              ) : (
                <div className="saved-items">
                  {saved.map((s) => (
                    <article key={s.key}>
                      <button
                        type="button"
                        className="card-details-trigger"
                        aria-label={`Reopen ${s.name}`}
                        onClick={() => reopen(s)}
                      />
                      <span
                        className="saved-art"
                        style={artGlow(
                          s.kind === "bazaar" ? s.itemId : "CHEST",
                        )}
                      >
                        {s.kind === "bazaar" ? (
                          <ItemArt id={s.itemId} size="small" />
                        ) : (
                          <SkyIcon name="watchlist-chest" size={44} />
                        )}
                      </span>
                      <div>
                        <h3>{s.name}</h3>
                        <p>
                          {s.kind === "bazaar" ? "Bazaar item" : "BIN listing"}{" "}
                          · saved {new Date(s.savedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        className="save-icon is-saved"
                        aria-label={`Remove ${s.name}`}
                        onClick={() => toggle(s.kind, s.itemId, s.name)}
                      >
                        <SkyIcon name="favorite-heart" size={24} />
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <>
              {view === "bazaar" ? (
                <BazaarFilterBar
                  f={bf}
                  set={patchBazaar}
                  categories={categories}
                  reset={() => {
                    setBf({ ...defaultBazaarFilters });
                    setPage(0);
                  }}
                  save={persistFilters}
                />
              ) : (
                <AuctionFilterBar
                  f={af}
                  set={patchAuction}
                  reset={() => {
                    setAf({ ...defaultAuctionFilters });
                    setAuctionPage(0);
                  }}
                  save={persistFilters}
                />
              )}
              {view === "bazaar" && marketError && (
                <div className="notice warning" role="alert">
                  {marketMessage(marketError)}{" "}
                  {bazaar.length > 0
                    ? "Last successful sample remains visible. Estimates use that sample; collection failures are separate from its age."
                    : ""}
                  {usage.mode !== "paused" && (
                    <a href="#legacy=1">Open existing public price search</a>
                  )}
                </div>
              )}
              {view === "auctions" && (auctionError || health?.error) && (
                <div className="notice warning" role="alert">
                  {marketMessage(auctionError || health?.error || '')}
                </div>
              )}
              {!validBazaar && view === "bazaar" && (
                <div className="notice warning" role="alert">
                  Enter a valid budget, whole quantity, and finite filter
                  values.
                </div>
              )}
              <div className="market-board">
                <section
                  className="opportunity-column"
                  aria-label="Market opportunities"
                >
                  <div className="opportunities-heading">
                    <div>
                      <h1>{view === "bazaar" ? "Bazaar" : "Auctions"}</h1>
                      <p>
                        {view === "bazaar" ? rows.length : auctionTotal}{" "}
                        {view === "bazaar"
                          ? rows.length === 1
                            ? "item"
                            : "items"
                          : auctionTotal === 1
                            ? "unique item"
                            : "unique items"}
                        {view === "auctions" &&
                          " · Compare matching Buy It Now asking prices."}
                      </p>
                    </div>
                    <div className="heading-tools">
                      <SelectField
                        label="Sort by"
                        value={view === "bazaar" ? bf.sort : af.sort}
                        onChange={(sort) =>
                          view === "bazaar"
                            ? patchBazaar({
                                sort: sort as BazaarFilters["sort"],
                              })
                            : patchAuction({
                                sort: sort as AuctionFilters["sort"],
                              })
                        }
                      >
                        {(view === "bazaar"
                          ? [
                              ["profit", "Highest Profit"],
                              ["unit", "Profit per Unit"],
                              ["roi", "Highest ROI"],
                              ["activity", "Trading Activity"],
                              ["capital", "Lowest Capital"],
                              ["balanced", "Profit + Liquidity"],
                            ]
                          : [
                              ["supported", "Best supported opportunities"],
                              ["profit", "Largest after-fee gap"],
                              ["roi", "Highest ROI"],
                              ["capital", "Lowest Price"],
                              ["confidence", "Confidence"],
                              ["recent", "Newest Listings"],
                            ]
                        ).map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </SelectField>
                      <div className="view-toggle" aria-label="Results view">
                        <button
                          aria-label="Card view"
                          aria-pressed={
                            (view === "bazaar" ? bf.view : af.view) === "cards"
                          }
                          onClick={() =>
                            view === "bazaar"
                              ? patchBazaar({ view: "cards" })
                              : patchAuction({ view: "cards" })
                          }
                        >
                          <Grid2X2 size={16} />
                        </button>
                        <button
                          aria-label="Compact list view"
                          aria-pressed={
                            (view === "bazaar" ? bf.view : af.view) === "list"
                          }
                          onClick={() =>
                            view === "bazaar"
                              ? patchBazaar({ view: "list" })
                              : patchAuction({ view: "list" })
                          }
                        >
                          <List size={17} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="result-status">{freshness}</div>
                  {view === "bazaar" &&
                    bf.query.trim() &&
                    rows.some((row) => row.outsideFilters) && (
                      <p className="search-filter-note" role="status">
                        Search includes items outside your filters. Estimates
                        still use your strategy, quantity and fees.
                      </p>
                    )}
                  {(view === "bazaar" ? bazaarLoading : auctionLoading) ? (
                    <>
                      {view === "auctions" && (
                        <p role="status">
                          Loading a complete snapshot of current BIN listings…
                        </p>
                      )}
                      <LoadingState />
                    </>
                  ) : view === "bazaar" ? (
                    shown.length ? (
                      <div
                        className={`item-grid ${bf.view === "list" ? "compact-list" : ""}`}
                      >
                        {shown.map(({ item, quote: q, outsideFilters }) => {
                          const trade = bazaarTrade(item, bf, now);
                          const stale =
                            !isFresh(item.upstreamAt, now) ||
                            q?.fresh === false;
                          return (
                            <ItemCard
                              key={item.id}
                              id={item.id}
                              name={item.name}
                              rarity={item.rarity}
                              category={item.category}
                              buy={trade.buy?.total ?? null}
                              sell={trade.sale?.total ?? null}
                              profit={q?.profit ?? null}
                              roi={q?.roi ?? null}
                              sampled={stale || Boolean(marketError)}
                              warning={
                                !q
                                  ? "Profit unavailable: missing prices, depth or fee data."
                                  : outsideFilters
                                    ? q.capital > bf.budget
                                      ? "Outside filters: this quantity exceeds your budget."
                                      : "Outside your profit, category or liquidity filters."
                                    : undefined
                              }
                              selected={selectedItem?.id === item.id}
                              saved={isSaved("bazaar", item.id)}
                              onOpen={() => openBazaar(item.id)}
                              onSave={() =>
                                toggle("bazaar", item.id, item.name)
                              }
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <EmptyState
                        title={
                          usage.mode === "paused"
                            ? "Market updates paused"
                            : marketError
                              ? "Market connection needs attention"
                              : "No matching opportunities"
                        }
                        action={
                          usage.mode !== "paused" &&
                          !marketError && (
                            <button
                              className="button paper"
                              onClick={() => {
                                setBf({ ...defaultBazaarFilters });
                                setPage(0);
                              }}
                            >
                              Reset filters
                            </button>
                          )
                        }
                      >
                        {usage.mode === "paused"
                          ? "Fresh prices are unavailable. Your watchlist and existing Price Alerts remain available, and you can still edit alert targets."
                          : marketError
                            ? "Cached prices could not be loaded. The next scheduled check will try again."
                            : bf.query.trim()
                              ? "No item names match your search. Try a shorter name."
                              : "No trades pass your filters. Try a smaller quantity or adjust More filters."}
                      </EmptyState>
                    )
                  ) : visibleAuctions.length ? (
                    <div
                      className={`item-grid ${af.view === "list" ? "compact-list" : ""}`}
                    >
                      {visibleAuctions.map((o) => {
                        const comparison = auctionComparison(
                          o,
                          af.durationHours,
                          now,
                        );
                        return (
                          <ItemCard
                            key={o.listing.variant.itemId}
                            id={o.listing.variant.itemId}
                            name={o.listing.variant.name}
                            rarity={o.listing.variant.rarity}
                            category={o.listing.variant.category}
                            buy={o.listing.price}
                            askingPrice
                            sampled={comparison.sampled}
                            sell={comparison.valuation.estimate}
                            profit={comparison.profit}
                            roi={comparison.roi}
                            subtitle={
                              <>
                                {o.group?.matchingListings.length ?? 1} matching
                                listings · Lowest matching purchase
                                <br />
                                <SampleTime
                                  timestamp={o.listing.upstreamAt}
                                  compact
                                />
                              </>
                            }
                            warning={
                              comparison.valuation.confidence === "low"
                                ? "Low confidence · inspect comparison evidence"
                                : comparison.valuation.estimate === null
                                  ? "Resale estimate unavailable"
                                  : undefined
                            }
                            selected={
                              selectedAh?.listing.variant.itemId ===
                              o.listing.variant.itemId
                            }
                            saved={isSaved("auction", o.listing.id)}
                            onOpen={() => openAuction(o)}
                            onAction={
                              o.listing.status === "active"
                                ? () => copyAuction(o)
                                : undefined
                            }
                            actionLabel={auctionLabel(o)}
                            actionAriaLabel={`Copy seller command for ${o.listing.variant.name}`}
                            actionBusy={copyingAuction !== null}
                            onSave={() =>
                              toggle(
                                "auction",
                                o.listing.id,
                                o.listing.variant.name,
                              )
                            }
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState
                      title={
                        usage.mode === "paused"
                          ? "Market updates paused"
                          : auctionError
                            ? "Auction service unavailable"
                            : health?.listingCount
                              ? "Not enough matching evidence"
                              : "No matching active listings"
                      }
                      action={
                        usage.mode !== "paused" && (
                          <button
                            className="button paper"
                            onClick={() =>
                              patchAuction({
                                showInsufficient: true,
                                hideFlagged: false,
                              })
                            }
                          >
                            Show listings with insufficient evidence
                          </button>
                        )
                      }
                    >
                      {usage.mode === "paused"
                        ? "Fresh listings and seller commands are unavailable. Your watchlist and existing Price Alerts remain available, and you can still edit alert targets."
                        : `${health ? `${health.listingCount} active BIN listings in the current snapshot. ` : ""}Comparisons need other listings with the exact configuration. Try widening your filters.`}
                    </EmptyState>
                  )}
                  <div className="pagination">
                    <button
                      aria-label="Previous results"
                      disabled={view === "bazaar" ? !safePage : !auctionPage}
                      onClick={() =>
                        view === "bazaar"
                          ? setPage((p) => Math.max(0, p - 1))
                          : setAuctionPage((p) => Math.max(0, p - 1))
                      }
                    >
                      <ChevronLeft size={16} />
                      Previous
                    </button>
                    <span>
                      {view === "bazaar" ? safePage + 1 : auctionPage + 1} /{" "}
                      {view === "bazaar"
                        ? pages
                        : Math.max(1, Math.ceil(auctionTotal / 6))}
                    </span>
                    <button
                      aria-label="Next results"
                      disabled={
                        view === "bazaar"
                          ? safePage + 1 >= pages
                          : (auctionPage + 1) * 6 >= auctionTotal
                      }
                      onClick={() =>
                        view === "bazaar"
                          ? setPage((p) => p + 1)
                          : setAuctionPage((p) => p + 1)
                      }
                    >
                      Next
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <button
                    className="how-it-works"
                    onClick={() => setHelp((v) => !v)}
                    aria-expanded={help}
                  >
                    <CircleHelp size={15} />
                    How estimates work
                  </button>
                  {help && (
                    <div className="method-note">
                      <ShieldCheck size={24} />
                      <div>
                        <strong>Estimates are not guaranteed profit.</strong>
                        <p>
                          Bazaar uses visible order-book depth, your quantity,
                          and sale tax. Weekly activity is a sizing proxy, not
                          an exact trade count or fill-time promise. Auctions
                          use a conservative lower-quartile estimate capped by
                          the lowest valid competing ask for the exact configuration
                          and stack quantity. Sparse matches, concentrated sellers
                          and outliers reduce confidence and default ranking.
                          Bidding auctions are excluded because bids
                          are not executable purchase prices. Asking prices do
                          not prove resale value.
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="market-footnote">
                    <ShieldCheck size={16} />
                    <p>
                      {view === "bazaar"
                        ? "Profit includes sale tax and additional costs. Orders may not fill; check prices in-game."
                        : `Sampled BIN asking prices. Snapshot ${health?.activeUpstreamAt ? new Date(health.activeUpstreamAt).toLocaleTimeString() : "loading"}. Conservative estimates exclude the selected auction. One result per item; comparisons use the full cached pool. After-fee gaps are hypothetical, not proven profit.`}
                    </p>
                  </div>
                </section>
                <div className="side-column">
                  <InspectorShell
                    overlay={view === "bazaar"}
                    open={sheetOpen}
                    onClose={() => setSheetOpen(false)}
                  >
                    {view === "bazaar" ? (
                      selectedItem ? (
                        <BazaarInspector
                          item={selectedItem}
                          filters={bf}
                          set={patchBazaar}
                          saved={isSaved("bazaar", selectedItem.id)}
                          save={() =>
                            toggle("bazaar", selectedItem.id, selectedItem.name)
                          }
                        />
                      ) : (
                        <BlankInspector />
                      )
                    ) : selectedAh ? (
                      <AuctionGroupInspector
                        key={selectedAh.listing.id}
                        opportunity={selectedAh}
                        duration={af.durationHours}
                        now={now}
                        isSaved={(id) => isSaved("auction", id)}
                        save={(listing) =>
                          toggle("auction", listing.id, listing.variant.name)
                        }
                        copySeller={copyAuction}
                        sellerLabel={auctionLabel}
                        copyBusy={copyingAuction !== null}
                      />
                    ) : (
                      <BlankInspector />
                    )}
                  </InspectorShell>
                </div>
              </div>
            </>
          )}
        </div>
        <footer className="market-footer">
          <span>
            <SkyIcon name="emerald" size={26} /> BazaarSignal{" "}
            <span>· An independent SkyBlock companion</span>
          </span>
        </footer>
      </main>
    </div>
  );
}
import { nextMarketRead } from "../../shared/market-schedule";
