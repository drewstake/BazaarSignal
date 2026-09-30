import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Grid2X2,
  List,
  LogOut,
  Plus,
  RefreshCw,
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
  filterBazaar,
} from "../../shared/companion/bazaar";
import {
  auctionOpportunity,
  defaultAuctionFilters,
} from "../../shared/companion/auctions";
import { auth, login, logout, watchAuth } from "../data";
import { signInErrorMessage } from "../sign-in-error";
import { fixtureMode, getAuctions, getBazaar, marketRequest } from "./api";
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
  AuctionInspector,
  BazaarInspector,
  BlankInspector,
  InspectorShell,
} from "./Inspector";
import {
  artGlow,
  SkyIcon,
  compact,
  EmptyState,
  ItemArt,
  ItemCard,
  LoadingState,
  PriceComparison,
  RarityRibbon,
  SelectField,
  titleCase,
} from "./components";
import "./market.css";

type View = "bazaar" | "auctions" | "watchlist";
const currentView = (): View => {
  const v = new URLSearchParams(location.hash.slice(1)).get("market");
  return v === "auctions" || v === "watchlist" ? v : "bazaar";
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
    [refresh, setRefresh] = useState(0),
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
  useEffect(() => {
    const update = () => {
      setView(currentView());
      setSheetOpen(false);
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
  }, [user?.uid]);
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
    const controller = new AbortController();
    let closed = false;
    setBazaarLoading(true);
    const fetchData = () =>
      getBazaar(controller.signal)
        .then((r) => {
          if (!closed) {
            setBazaar(r.items);
            setMarketError(r.error ?? "");
            setBazaarLoading(false);
          }
        })
        .catch((e) => {
          if (!closed) {
            setMarketError(
              e instanceof Error ? e.message : "Bazaar unavailable",
            );
            setBazaarLoading(false);
          }
        });
    void fetchData();
    const timer = setInterval(fetchData, 60000);
    return () => {
      closed = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (view !== "auctions") return;
    const controller = new AbortController();
    let closed = false;
    setAuctionLoading(true);
    setAuctionError("");
    const fetchData = () =>
      getAuctions(af, auctionPage, controller.signal)
        .then((r) => {
          if (!closed) {
            setAuctions(r.items);
            setAuctionTotal(r.total);
            setHealth(r.health);
            setAuctionLoading(false);
            setSelectedAuction(
              (prev) =>
                r.items.find((x) => x.listing.id === prev?.listing.id) ?? prev,
            );
          }
        })
        .catch((e) => {
          if (!closed) {
            setAuctionError(
              e instanceof Error ? e.message : "Auction service unavailable",
            );
            setAuctionLoading(false);
          }
        });
    const debounce = setTimeout(fetchData, 250),
      timer = setInterval(fetchData, 30000);
    return () => {
      closed = true;
      controller.abort();
      clearTimeout(debounce);
      clearInterval(timer);
    };
  }, [view, af, auctionPage, refresh]);
  const validBazaar =
    Object.values(bf).every(
      (v) => typeof v !== "number" || Number.isFinite(v),
    ) &&
    bf.quantity >= 1 &&
    Number.isSafeInteger(bf.quantity) &&
    bf.budget >= 0 &&
    bf.maxActivityShare >= 0;
  const opportunities = useMemo(
    () => (validBazaar ? filterBazaar(bazaar, bf, now) : []),
    [bazaar, bf, now, validBazaar],
  );
  const pages = Math.max(1, Math.ceil(opportunities.length / 6)),
    safePage = Math.min(page, pages - 1),
    shown = opportunities.slice(safePage * 6, safePage * 6 + 6);
  const deal = opportunities.find(
      (q) => q.profit > 0 && q.concerns.length === 0,
    ),
    auctionDeal = auctions.find(
      (o) =>
        o.profit !== null &&
        o.profit > 0 &&
        ["medium", "high"].includes(o.valuation.confidence) &&
        o.listing.status === "active" &&
        now - o.listing.upstreamAt < 180000 &&
        o.flags.length === 0,
    );
  const selectedItem =
    bazaar.find((i) => i.id === selectedBazaar) ?? shown[0]?.item ?? null;
  const rawSelectedAh = selectedAuction ?? auctions[0] ?? null;
  const selectedAh = rawSelectedAh
    ? auctionOpportunity(
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
      )
    : null;
  const categories = [...new Set(bazaar.map((x) => x.category))].sort();
  const navigate = (target: View) => {
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
  async function reopen(item: SavedItem) {
    if (item.kind === "bazaar") {
      navigate("bazaar");
      setSelectedBazaar(item.itemId);
      setTimeout(() => setSheetOpen(true), 0);
      if (!bazaar.some((b) => b.id === item.itemId))
        setToast("Saved item is currently unavailable in the Bazaar feed.");
    } else {
      navigate("auctions");
      try {
        const result =
          auctions.find((a) => a.listing.id === item.itemId) ??
          (await marketRequest<AuctionOpportunity>(`auctions/${item.itemId}`));
        openAuction(result);
      } catch {
        setToast(
          "This saved auction is unavailable or no longer in the collector cache.",
        );
      }
    }
  }
  const lastUpdate =
    view === "auctions" ? health?.activeUpstreamAt : bazaar[0]?.upstreamAt;
  const freshness = (
    <span className="freshness">
      <span
        className={`status-dot ${!lastUpdate || now - lastUpdate > 180000 ? "stale" : ""}`}
      />
      {fixtureMode
        ? "Illustrative fixtures"
        : lastUpdate
          ? `Updated ${new Date(lastUpdate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
          : "Waiting for market data"}
      <button
        aria-label="Refresh market"
        onClick={() => setRefresh((r) => r + 1)}
      >
        <RefreshCw size={14} />
      </button>
    </span>
  );
  const watchSlots = saved.slice(0, 3);
  return (
    <div className="companion">
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
          <h1 className="tagline-sign">
            Good loot. <span>Better deals.</span>
          </h1>
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
          </nav>
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
                  if (view === "watchlist") navigate("bazaar");
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
              {toast}
              <button aria-label="Dismiss message" onClick={() => setToast("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {view === "watchlist" ? (
            <section className="watchlist-page">
              <div className="section-heading">
                <div>
                  <h2>Your treasure chest</h2>
                  <p>Saved opportunities, just for you.</p>
                </div>
                <SkyIcon name="watchlist-chest" size={96} />
              </div>
              {!user ? (
                <EmptyState
                  title="Keep the good finds close"
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
                  title="Room for your next great find"
                  action={
                    <button
                      className="button blue"
                      onClick={() => navigate("bazaar")}
                    >
                      Explore the Bazaar <ArrowRight size={16} />
                    </button>
                  }
                >
                  Use the heart on an item to tuck it away here.
                </EmptyState>
              ) : (
                <div className="saved-items">
                  {saved.map((s) => (
                    <article key={s.key}>
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
                      <button className="button blue" onClick={() => reopen(s)}>
                        Reopen <ArrowRight size={14} />
                      </button>
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
                  {marketError}{" "}
                  {bazaar.length > 0
                    ? "Last successful data remains visible; stale opportunities are excluded."
                    : ""}
                  <a href="#legacy=1">Open existing public price search</a>
                </div>
              )}
              {view === "auctions" && (auctionError || health?.error) && (
                <div className="notice warning" role="alert">
                  {auctionError || health?.error}
                </div>
              )}
              {!validBazaar && view === "bazaar" && (
                <div className="notice warning" role="alert">
                  Enter a valid budget, whole quantity, and finite filter
                  values.
                </div>
              )}
              <div className="market-board">
                <aside className="deal-column" aria-label="Deal of the day">
                  <div className="deal-banner">
                    <SkyIcon
                      name="deal-crown"
                      size={52}
                      className="deal-crown"
                    />
                    <h2>DEAL OF THE DAY</h2>
                  </div>
                  <div className="deal-paper">
                    {view === "bazaar" && deal ? (
                      <>
                        <div className="deal-art" style={artGlow(deal.item.id)}>
                          <RarityRibbon rarity={deal.item.rarity} />
                          <ItemArt id={deal.item.id} size="hero" />
                          <span className="art-spark one" aria-hidden="true" />
                          <span className="art-spark two" aria-hidden="true" />
                          <span
                            className="art-spark three"
                            aria-hidden="true"
                          />
                        </div>
                        <div className="deal-copy">
                          <h2
                            className={`rarity-ink-${deal.item.rarity.toLowerCase()}`}
                          >
                            {deal.item.name}
                          </h2>
                          <p>
                            Fresh prices, active on both sides. A promising find
                            for your next trade.
                          </p>
                          <PriceComparison
                            buy={deal.acquisition}
                            sell={deal.grossSale}
                            profit={deal.profit}
                            roi={deal.roi}
                            variant="feature"
                          />
                          <button
                            className="button green"
                            onClick={() => openBazaar(deal.item.id)}
                          >
                            Inspect this deal{" "}
                            <ChevronRight size={22} strokeWidth={3} />
                          </button>
                          <div className="deal-reason">
                            <ShieldCheck size={16} />
                            <span>
                              Picked from your matches: positive net profit,
                              fresh data and no liquidity flags. Quantity{" "}
                              {deal.quantity}.
                            </span>
                          </div>
                        </div>
                      </>
                    ) : view === "auctions" && auctionDeal ? (
                      <>
                        <div
                          className="deal-art"
                          style={artGlow(auctionDeal.listing.variant.itemId)}
                        >
                          <RarityRibbon
                            rarity={auctionDeal.listing.variant.rarity}
                          />
                          <ItemArt
                            id={auctionDeal.listing.variant.itemId}
                            size="hero"
                          />
                          <span className="art-spark one" aria-hidden="true" />
                          <span className="art-spark two" aria-hidden="true" />
                          <span
                            className="art-spark three"
                            aria-hidden="true"
                          />
                        </div>
                        <div className="deal-copy">
                          <h2
                            className={`rarity-ink-${auctionDeal.listing.variant.rarity.toLowerCase()}`}
                          >
                            {auctionDeal.listing.variant.name}
                          </h2>
                          <p>
                            {auctionDeal.valuation.count} exact comparable sales
                            support this estimate.
                          </p>
                          <PriceComparison
                            buy={auctionDeal.listing.price}
                            sell={auctionDeal.valuation.estimate}
                            profit={auctionDeal.profit}
                            roi={auctionDeal.roi}
                            variant="feature"
                          />
                          <button
                            className="button green"
                            onClick={() => openAuction(auctionDeal)}
                          >
                            Inspect the evidence{" "}
                            <ChevronRight size={22} strokeWidth={3} />
                          </button>
                          <div className="deal-reason">
                            <ShieldCheck size={16} />
                            <span>
                              Fresh, positive estimated profit and at least
                              medium confidence. Recheck availability before
                              trading.
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <EmptyState title="Good deals take patience">
                        {view === "bazaar"
                          ? "No fresh opportunities pass your filters without liquidity concerns. Try a smaller quantity or adjust your filters."
                          : "A deal earns this spot with recent, comparable completed sales. We’re waiting for sufficient evidence."}
                      </EmptyState>
                    )}
                  </div>
                </aside>
                <section
                  className="opportunity-column"
                  aria-label="Market opportunities"
                >
                  <div className="opportunities-heading">
                    <div>
                      <h2>
                        <SkyIcon
                          name="hot-flame"
                          size={40}
                          className="hot-flame"
                        />
                        {view === "bazaar"
                          ? "Hot Opportunities"
                          : "Auction Finds"}
                      </h2>
                      <p>
                        {view === "bazaar"
                          ? opportunities.length
                          : auctionTotal}{" "}
                        matching {view === "bazaar" ? "items" : "listings"} from
                        the {view === "bazaar" ? "Bazaar" : "Auction House"}.
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
                              ["profit", "Highest Profit"],
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
                  <div className="result-status">
                    {freshness}
                    <button
                      className="how-it-works"
                      onClick={() => setHelp((v) => !v)}
                      aria-expanded={help}
                    >
                      <CircleHelp size={15} />
                      How we find deals
                    </button>
                  </div>
                  {help && (
                    <div className="method-note">
                      <ShieldCheck size={24} />
                      <div>
                        <strong>
                          Profit is an estimate. Evidence comes first.
                        </strong>
                        <p>
                          Bazaar uses visible order-book depth, your quantity,
                          and sale tax. Weekly activity is a sizing proxy, not
                          an exact trade count or fill-time promise. Auctions
                          use completed sales of the exact item configuration.
                          Bidding auctions are excluded because bids are not
                          executable purchase prices. Missing history means no
                          recommendation.
                        </p>
                      </div>
                    </div>
                  )}
                  {(view === "bazaar" ? bazaarLoading : auctionLoading) ? (
                    <LoadingState />
                  ) : view === "bazaar" ? (
                    shown.length ? (
                      <div
                        className={`item-grid ${bf.view === "list" ? "compact-list" : ""}`}
                      >
                        {shown.map((q) => (
                          <ItemCard
                            key={q.item.id}
                            id={q.item.id}
                            name={q.item.name}
                            rarity={q.item.rarity}
                            category={q.item.category}
                            buy={q.acquisition}
                            sell={q.grossSale}
                            profit={q.profit}
                            roi={q.roi}
                            badge={titleCase(q.liquidity)}
                            warning={q.concerns[0]}
                            subtitle={
                              <>
                                {q.strategy === "order-offer"
                                  ? "Order → offer"
                                  : q.strategy === "instant-offer"
                                    ? "Instant buy → offer"
                                    : "Order → instant sell"}{" "}
                                · {q.quantity} units
                                <br />
                                {compact(q.item.instantBuyActivity7d)} buy /{" "}
                                {compact(q.item.instantSellActivity7d)} sell ·
                                7d proxy
                              </>
                            }
                            selected={selectedItem?.id === q.item.id}
                            saved={isSaved("bazaar", q.item.id)}
                            onOpen={() => openBazaar(q.item.id)}
                            onSave={() =>
                              toggle("bazaar", q.item.id, q.item.name)
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        title={
                          marketError
                            ? "Market connection needs attention"
                            : "No matching opportunities"
                        }
                        action={
                          <button
                            className="button paper"
                            onClick={() => {
                              setBf({ ...defaultBazaarFilters });
                              setPage(0);
                            }}
                          >
                            Reset filters
                          </button>
                        }
                      >
                        Try a lower quantity, a different strategy, or broader
                        liquidity checks. Losing trades are excluded by the
                        default minimum profit.
                      </EmptyState>
                    )
                  ) : auctions.length ? (
                    <div
                      className={`item-grid ${af.view === "list" ? "compact-list" : ""}`}
                    >
                      {auctions.map((o) => (
                        <ItemCard
                          key={o.listing.id}
                          id={o.listing.variant.itemId}
                          name={o.listing.variant.name}
                          rarity={o.listing.variant.rarity}
                          category={o.listing.variant.category}
                          buy={o.listing.price}
                          sell={o.valuation.estimate}
                          profit={o.profit}
                          roi={o.roi}
                          badge={
                            o.listing.status === "stale"
                              ? "Stale"
                              : `${titleCase(o.valuation.confidence)} confidence`
                          }
                          subtitle={`${o.valuation.count} exact sales · 14-day window`}
                          selected={selectedAh?.listing.id === o.listing.id}
                          saved={isSaved("auction", o.listing.id)}
                          onOpen={() => openAuction(o)}
                          onSave={() =>
                            toggle(
                              "auction",
                              o.listing.id,
                              o.listing.variant.name,
                            )
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title={
                        auctionError
                          ? "Auction service unavailable"
                          : health?.saleCount
                            ? "Not enough matching evidence"
                            : "Collecting price history"
                      }
                      action={
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
                      }
                    >
                      {health
                        ? `${health.saleCount} verified sales collected across ${health.variantCount} variants. `
                        : ""}
                      Recommendations need exact configuration matches. Active
                      asking prices never stand in for completed sales.
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
                  <div className="market-footnote">
                    <ShieldCheck size={16} />
                    <p>
                      {view === "bazaar"
                        ? "After-tax estimates for your selected quantity. Activity is reported 7-day units + live state. Orders can take time to fill."
                        : `Completed BIN sales only. ${health?.missedMs ? `${Math.ceil(health.missedMs / 60000)} minutes of known collection gaps.` : "Coverage begins when the shared collector runs."} Asking prices and bids are not sales.`}
                    </p>
                  </div>
                </section>
                <div className="side-column">
                  <InspectorShell
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
                      <AuctionInspector
                        key={selectedAh.listing.id}
                        opportunity={selectedAh}
                        duration={af.durationHours}
                        saved={isSaved("auction", selectedAh.listing.id)}
                        save={() =>
                          toggle(
                            "auction",
                            selectedAh.listing.id,
                            selectedAh.listing.variant.name,
                          )
                        }
                      />
                    ) : (
                      <BlankInspector />
                    )}
                  </InspectorShell>
                  <section className="watch-chest" aria-label="My watchlist">
                    <div className="watch-chest-heading">
                      <h2>
                        <SkyIcon
                          name="watchlist-chest"
                          size={40}
                          className="chest-heading-icon"
                        />
                        My Watchlist{" "}
                        <span>({user ? saved.length : 0}/100)</span>
                      </h2>
                      <button
                        className="view-all"
                        onClick={() => navigate("watchlist")}
                      >
                        View all <ArrowRight size={15} strokeWidth={2.6} />
                      </button>
                    </div>
                    <div className="chest-box">
                      <div className="chest-slots">
                        {[0, 1, 2].map((i) => {
                          const s = watchSlots[i];
                          return s ? (
                            <button
                              key={s.key}
                              className="chest-slot"
                              aria-label={`Reopen ${s.name}`}
                              title={s.name}
                              style={artGlow(
                                s.kind === "bazaar" ? s.itemId : "CHEST",
                              )}
                              onClick={() => reopen(s)}
                            >
                              {s.kind === "bazaar" ? (
                                <ItemArt id={s.itemId} size="small" />
                              ) : (
                                <SkyIcon name="watchlist-chest" size={48} />
                              )}
                            </button>
                          ) : (
                            <span
                              key={`empty-${i}`}
                              className="chest-slot empty"
                              aria-hidden="true"
                            />
                          );
                        })}
                        <button
                          className="chest-slot add"
                          aria-label={
                            user ? "Open watchlist" : "Sign in to save finds"
                          }
                          onClick={() =>
                            user ? navigate("watchlist") : signIn()
                          }
                          disabled={authBusy}
                        >
                          <Plus size={30} strokeWidth={3} />
                        </button>
                      </div>
                      {!user && (
                        <p>Sign in to keep your best finds in this chest.</p>
                      )}
                    </div>
                  </section>
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
          <span>
            Happy flipping. Trade thoughtfully.{" "}
            <SkyIcon name="favorite-heart" size={18} className="pixel-heart" />
          </span>
        </footer>
      </main>
    </div>
  );
}
