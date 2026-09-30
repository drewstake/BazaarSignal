import { useEffect, useState, type Dispatch, type SetStateAction, type FormEvent } from "react";
import type { User } from "firebase/auth";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Search,
} from "lucide-react";
import type {
  AlertEvent,
  AppData,
  Book,
  PriceAlertInput,
  ProductPrice,
} from "../shared/model";
import { estimate, isFresh } from "../shared/market";
import {
  auth,
  backendReady,
  configError,
  emptyData,
  isDemo,
  isLocal,
  isLocalLive,
  login,
  logout,
  readDemo,
  saveDemo,
  subscribe,
  watchAuth,
} from "./data";
import {
  evaluateLocal,
  mergeLive,
  readLive,
  saveLive,
  subscribeLive,
} from "./live";
import {
  createCloudAlert,
  createLocalAlert,
  disableCloudAlert,
  disableLocalAlert,
  fetchItemBook,
} from "./alerts";
import OrderBook from "./OrderBookView";
import MyAlerts from "./MyAlerts";
import { signInErrorMessage } from "./sign-in-error";

const coins = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const short = (v: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";
const route = () => new URLSearchParams(window.location.hash.slice(1));
function monitoringLabel(data: AppData) {
  const m=data.monitoring;
  if (!m?.enabled) return 'Monitoring has not been activated.';
  if (m.error) return m.error;
  if (!m.lastSuccess || Date.now()-m.lastAttempt>12*60_000 || Date.now()-m.lastSuccess>12*60_000) return 'Monitoring needs attention · No recent successful check';
  const queued=data.events.filter(e=>['queued','sending'].includes(e.deliveries.email?.status ?? '')).length;
  const failed=data.events.filter(e=>e.deliveries.email?.status==='failed').length;
  if (failed) return `${failed} email delivery failed · Check your alert status`;
  if (m.quota===0 && queued) return `${queued} emails waiting · Daily quota exhausted`;
  return `Checked ${new Date(m.lastSuccess).toLocaleTimeString()} · ~5 min polling${queued?` · ${queued} emails queued`:''}`;
}
function Brand() {
  return (
    <span className="brand">
      Bazaar<span>Signal</span>
      <i />
    </span>
  );
}

export default function App() {
  const [data, setData] = useState<AppData>(() =>
    isLocalLive ? readLive() : isDemo ? readDemo() : emptyData,
  );
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(auth));
  const [hash, setHash] = useState(route);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  useEffect(
    () =>
      watchAuth((u) => {
        setUser(u);
        if (!isLocal) setData((d) => ({ ...d, workflows: [], events: [] }));
        setError("");
        if (u) setAuthError("");
        setAuthLoading(false);
      }),
    [],
  );
  useEffect(() => {
    const update = () => setHash(route());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (isLocal || !backendReady) return;
    setData(emptyData);
    return subscribe(
      user?.uid ?? null,
      (patch) => { setData((d) => ({ ...d, ...patch })); if (patch.prices) setError(""); },
      (message, market) => { setError(message); if (market) setData((d) => ({ ...d, prices: [], books: {}, status: { ...d.status, error: message } })); },
    );
  }, [user]);
  useEffect(() => {
    if (isDemo) saveDemo(data);
    if (isLocalLive) saveLive(data);
  }, [data]);
  useEffect(() => {
    if (!isLocalLive) return;
    return subscribeLive(
      (snapshot) => setData((d) => mergeLive(d, snapshot)),
      (message) =>
        setData((d) => ({ ...d, status: { ...d.status, error: message } })),
    );
  }, []);
  const signIn = async () => {
    setSigningIn(true);
    setAuthError("");
    try {
      await login();
    } catch (e) {
      setAuthError(signInErrorMessage(e));
    } finally {
      setSigningIn(false);
    }
  };
  const home = () => {
    window.location.hash = "";
    setError("");
    setAuthError("");
  };
  const itemId = hash.get("item"),
    token = hash.has("disable") ? (hash.get("disable") ?? "") : null;
  const item = data.prices.find((p) => p.id === itemId);
  const canBrowse = isLocal || backendReady;
  return (
    <div className="minimal-app">
      <header className="site-header">
        <button
          className="brand-button"
          onClick={home}
          aria-label="BazaarSignal home"
        >
          <Brand />
        </button>
        <div className="account">
          {isLocal && (
            <span className="preview-badge">
              {isDemo ? "Demo" : "Local preview"}
            </span>
          )}
          {user ? (
            <>
              <span className="account-email">{user.email}</span>
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={() => logout()}
              >
                <LogOut size={17} />
              </button>
            </>
          ) : auth ? (
            <button
              className="text-button"
              onClick={signIn}
              disabled={signingIn}
            >
              Sign in
            </button>
          ) : (
            <span className="private-label">Public Bazaar prices</span>
          )}
        </div>
      </header>
      {token !== null ? (
        <DisablePage
          key={token}
          token={token}
          data={data}
          update={setData}
          home={home}
        />
      ) : configError ? (
        <main className="center-page">
          <h1>Connection incomplete.</h1>
          <p>{configError}</p>
        </main>
      ) : !canBrowse ? (
        <main className="center-page">
          <span className="eyebrow">SKYBLOCK BAZAAR ALERTS</span>
          <h1>
            Your item.
            <br />
            Your price.
          </h1>
          <p>
            Find an item. Set a target.
            <br />
            Get an email when it’s time.
          </p>
          {!user ? (
            <button
              className="primary google-button"
              onClick={signIn}
              disabled={authLoading || signingIn}
            >
              <span className="google-g" aria-hidden="true">
                G
              </span>
              {authLoading || signingIn
                ? "Connecting…"
                : "Continue with Google"}
            </button>
          ) : (
            <div className="setup-note">
              <Check size={18} />
              <div>
                <strong>You’re signed in.</strong>
                <p>
                  Email alerts are being connected and will be ready here soon.
                </p>
              </div>
            </div>
          )}
          <small>
            {user
              ? "Cloud monitoring is not active yet."
              : "Public prices · Sign in for email alerts"}
          </small>
          {(authError || error) && (
            <p className="error" role="alert">
              {authError || error}
            </p>
          )}
        </main>
      ) : hash.has('alerts') ? (
        <main className="item-page"><button className="text-button" onClick={home}>← Back to market</button>{user || isLocal ? <MyAlerts data={data} update={setData} uid={user?.uid} create={home}/> : <section className="center-page"><h1>Sign in for email alerts.</h1><p>Your saved alerts are private.</p><button className="primary" onClick={signIn} disabled={signingIn}>Continue with Google</button>{authError&&<p role="alert" className="error">{authError}</p>}</section>}</main>
      ) : itemId ? (
        item ? (
          <ItemPage
            key={item.id}
            item={item}
            data={data}
            user={user}
            signIn={signIn}
            signingIn={signingIn}
            authError={authError}
            update={setData}
            home={home}
          />
        ) : (
          <main className="center-page">
            <h1>
              {error ? "Prices unavailable." : data.prices.length ? "Item unavailable." : "Loading the Bazaar…"}
            </h1>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="secondary" onClick={home}>
              Back to search
            </button>
          </main>
        )
      ) : (
        <SearchPage
          prices={data.prices}
          error={authError || error || data.status.error}
          open={(id) => {
            window.location.hash = `item=${encodeURIComponent(id)}`;
          }}
        />
      )}
      <footer className="site-footer">
        <span>
          {isLocal
            ? "Preview only · No emails are sent"
            : "BazaarSignal · Independent SkyBlock tool"}
        </span>
        <span>{!isLocal && backendReady ? monitoringLabel(data) : "Prices are estimates."}</span>
      </footer>
    </div>
  );
}

function SearchPage({
  prices,
  error,
  open,
}: {
  prices: ProductPrice[];
  error: string | null;
  open: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const matches = prices.filter((p) =>
    `${p.name} ${p.id}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const current = Math.min(
    page,
    Math.max(0, Math.ceil(matches.length / 5) - 1),
  );
  return (
    <main className={`search-page ${query.trim() ? "has-query" : ""}`}>
      <div className="search-intro">
        <span className="eyebrow">A LITTLE LESS PRICE CHECKING</span>
        <h1>What are you watching?</h1>
        <p>Find your item. We’ll watch the price.</p>
      </div>
      <form
        className="search-box"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (matches.length && query.trim()) open(matches[0].id);
        }}
      >
        <Search size={21} />
        <input
          autoFocus
          type="search"
          aria-label="Search Bazaar items"
          placeholder="Search the Bazaar…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <kbd>↵</kbd>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {query.trim() ? (
        <div className="search-results">
          <div className="results-label">
            {matches.length
              ? `${matches.length.toLocaleString()} items`
              : prices.length
                ? "No items found. Try another name."
                : "Loading items…"}
            <span>Instant buy / item</span>
          </div>
          {matches.slice(current * 5, current * 5 + 5).map((p) => (
            <button
              className="result-row"
              key={p.id}
              onClick={() => open(p.id)}
              aria-label={`View ${p.name}`}
            >
              <span>{p.name}</span>
              <span className="result-price">
                {coins(p.buy)} <ArrowRight size={16} />
              </span>
            </button>
          ))}
          {matches.length > 5 && (
            <div className="result-pagination">
              <button
                className="icon-button"
                disabled={!current}
                onClick={() => setPage(current - 1)}
                aria-label="Previous results"
              >
                <ChevronLeft size={17} />
              </button>
              <span>
                {current + 1} / {Math.ceil(matches.length / 5)}
              </span>
              <button
                className="icon-button"
                disabled={(current + 1) * 5 >= matches.length}
                onClick={() => setPage(current + 1)}
                aria-label="Next results"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="suggestions">
          <span>Try</span>
          {["SUMMONING_EYE", "BOOSTER_COOKIE", "ENCHANTED_DIAMOND_BLOCK"]
            .map((id) => prices.find((p) => p.id === id))
            .filter((p): p is ProductPrice => Boolean(p))
            .map((p) => (
              <button key={p.id} onClick={() => open(p.id)}>
                {p.name}
                <ArrowRight size={12} />
              </button>
            ))}
        </div>
      )}
    </main>
  );
}

function ItemPage({
  item,
  data,
  user,
  signIn,
  signingIn,
  authError,
  update,
  home,
}: {
  item: ProductPrice;
  data: AppData;
  user: User | null;
  signIn: () => Promise<void>;
  signingIn: boolean;
  authError: string;
  update: Dispatch<SetStateAction<AppData>>;
  home: () => void;
}) {
  const [tab, setTab] = useState<"details" | "book" | "alert" | "my-alerts">(route().has('alert') ? 'alert' : 'details');
  const [quantity, setQuantity] = useState("1"),
    [side, setSide] = useState<"buy" | "sell">("buy");
  const [target, setTarget] = useState(String(item.buy ?? "")),
    [tax, setTax] = useState("1.25");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [receipt, setReceipt] = useState<AlertEvent | null>(null),
    [success, setSuccess] = useState("");
  const [showEmail, setShowEmail] = useState(false);
  const [cloudBook, setCloudBook] = useState<{
    book: Book;
    timestamp: number;
  } | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((v) => v + 1), 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (isLocal) return;
    let closed = false,
      pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await fetchItemBook(item.id);
        if (!closed) {
          setCloudBook(result);
          setBookError(null);
        }
      } catch (e) {
        if (!closed) setBookError(errorMessage(e));
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = setInterval(load, 60000);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }, [item.id]);
  const book = isLocal ? data.books[item.id] : cloudBook?.book;
  const timestamp = isLocal
    ? data.status.lastUpdated
    : (cloudBook?.timestamp ?? 0);
  const stale =
    !isFresh(timestamp) || Boolean(isLocal ? data.status.error : bookError);
  const qty = Number(quantity),
    taxRate = Number(tax);
  const buy = estimate(book, qty, "buy", taxRate),
    sell = estimate(book, qty, "sell", taxRate),
    quote = side === "buy" ? buy : sell;
  const resetRequest = () => {
    setRequestId(crypto.randomUUID());
    setError("");
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const input: PriceAlertInput = {
      requestId,
      itemId: item.id,
      quantity: qty,
      side,
      target: Number(target),
      taxRate,
    };
    try {
      if (isLocal) {
        const result = createLocalAlert(data, input);
        update(evaluateLocal(result.data));
        setReceipt(result.event);
        setSuccess("Preview alert created.");
      } else {
        const result = await createCloudAlert(input);
        setSuccess(
          result.emailStatus === "sent"
            ? "Confirmation email sent."
            : "Alert created. Your confirmation email is queued.",
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const disableUrl = receipt?.message
    .split("\n")
    .find((line) => line.includes("#disable="));
  return (
    <main className="item-page">
      <div className="item-heading">
        <button
          className="icon-button"
          aria-label="Back to search"
          onClick={home}
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1>{item.name}</h1>
          <span className="item-id">{item.id.replaceAll("_", " ")}</span>
        </div>
        <span className={`market-indicator ${stale ? "stale" : ""}`}>
          <i />
          {stale ? "Awaiting prices" : "Live"}
        </span>
      </div>
      <nav className="item-tabs" aria-label="Item views">
        {(
          [
            ["details", "Details"],
            ["book", "Order book"],
            ["alert", "Create alert"],
            ["my-alerts", "My alerts"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-current={tab === value ? "page" : undefined}
            onClick={() => {
              if (value === "alert" && success) {
                setSuccess("");
                setReceipt(null);
                setShowEmail(false);
                resetRequest();
              }
              setTab(value);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "book" ? (
        <OrderBook
          book={book}
          timestamp={timestamp}
          error={isLocal ? data.status.error : bookError}
        />
      ) : tab === "details" ? (
        <section className="details-view">
          <div className="price-strip">
            <div>
              <span>Instant buy</span>
              <strong>{coins(book?.buy[0]?.pricePerUnit ?? item.buy)}</strong>
              <small>coins / item</small>
            </div>
            <div>
              <span>Instant sell</span>
              <strong>{coins(book?.sell[0]?.pricePerUnit ?? item.sell)}</strong>
              <small>coins / item, before tax</small>
            </div>
            <div>
              <span>Instant-buy activity · 7d + live</span>
              <strong>{short(item.volume)}</strong>
              <small>reported units, not exact completed trades</small>
            </div>
          </div>
          <div className="estimate-heading">
            <h2>Your estimate</h2>
            <label className="quantity-inline">
              Quantity
              <input
                aria-label="Quantity"
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  resetRequest();
                }}
              />
            </label>
          </div>
          <div className="estimate-lines">
            <div>
              <span>Total purchase cost</span>
              <strong>
                {buy
                  ? `${coins(buy.total)} coins`
                  : "Insufficient visible liquidity"}
              </strong>
            </div>
            <div>
              <span>
                Net sale proceeds <small>({tax}% tax)</small>
              </span>
              <strong>
                {sell
                  ? `${coins(sell.total)} coins`
                  : "Insufficient visible liquidity"}
              </strong>
            </div>
            <div>
              <span>Visible supply / demand</span>
              <span>
                {coins(book?.buy.reduce((n, l) => n + l.amount, 0))} /{" "}
                {coins(book?.sell.reduce((n, l) => n + l.amount, 0))}
              </span>
            </div>
          </div>
          <div className="detail-bottom">
            <p>
              {timestamp
                ? `Updated ${new Date(timestamp).toLocaleTimeString()}. `
                : ""}
              Prices can change before you trade.
            </p>
            <button className="primary" onClick={() => setTab("alert")}>
              <Bell size={16} /> Create an alert
            </button>
          </div>
        </section>
      ) : tab === "my-alerts" && (isLocal || user) ? (
        <MyAlerts key={user?.uid ?? "local"} data={data} update={update} uid={user?.uid} create={() => { setSuccess(""); setRequestId(crypto.randomUUID()); setTab("alert"); }} />
      ) : success && tab === "alert" ? (
        <section className="success-view">
          <span className="success-icon">
            <Check size={26} />
          </span>
          <h2>{success}</h2>
          <p>
            {isLocal
              ? "No email was sent. Preview the confirmation below."
              : `We’ll email ${user?.email ?? "your Google account"} when your target is reached. Use the link in your confirmation email to disable this alert.`}
          </p>
          {isLocal && (
            <button
              className="secondary"
              onClick={() => setShowEmail((v) => !v)}
            >
              {showEmail ? "Hide email preview" : "Preview confirmation email"}
            </button>
          )}
          {showEmail && receipt && (
            <div className="email-preview">
              <span className="eyebrow">EMAIL PREVIEW · NOT SENT</span>
              <h3>{receipt.message.split("\n")[0]}</h3>
              <p>
                {receipt.message
                  .split("\n")
                  .find((line) => line.startsWith("Notify me"))}
              </p>
              <p>We’ll email you once when this target is reached.</p>
              <a className="disable-link" href={disableUrl}>
                Disable this alert <ArrowRight size={14} />
              </a>
            </div>
          )}
          <button className="primary" onClick={() => setTab("my-alerts")}>
            View my alerts
          </button>
          <button className="text-button" onClick={home}>
            Back to search <ArrowRight size={15} />
          </button>
        </section>
      ) : !isLocal && !user ? (
        <section className="alert-form">
          <div className="form-intro">
            <h2>Sign in for email alerts.</h2>
            <p>Use your Google account. Your alerts stay private and emails go to your verified address.</p>
          </div>
          <button className="primary google-button" onClick={signIn} disabled={signingIn}>
            {signingIn ? 'Connecting…' : 'Continue with Google'}
          </button>
          <p className="delivery-note">Browsing prices is free and needs no sign-in.</p>
          {authError && <p className="error" role="alert">{authError}</p>}
        </section>
      ) : (
        <form className="alert-form" onSubmit={submit}>
          <div className="form-intro">
            <h2>Set your price.</h2>
            <p>One email when your target is reached.</p>
          </div>
          <div
            className="direction-switch"
            role="group"
            aria-label="Alert direction"
          >
            <button
              type="button"
              aria-pressed={side === "buy"}
              onClick={() => {
                setSide("buy");
                setTarget(String(buy?.unit ?? item.buy ?? ""));
                resetRequest();
              }}
            >
              Buy below
            </button>
            <button
              type="button"
              aria-pressed={side === "sell"}
              onClick={() => {
                setSide("sell");
                setTarget(String(sell?.unit ?? ""));
                resetRequest();
              }}
            >
              Sell above
            </button>
          </div>
          <div className="form-fields">
            <label>
              Target price{" "}
              <span>coins / item{side === "sell" ? ", after tax" : ""}</span>
              <input
                aria-label="Target price"
                type="number"
                required
                min="0.000001"
                step="any"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  resetRequest();
                }}
              />
            </label>
            <label>
              Quantity
              <input
                aria-label="Quantity"
                type="number"
                required
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  resetRequest();
                }}
              />
            </label>
          </div>
          {side === "sell" && (
            <label className="tax-field">
              Sale tax (%)
              <input
                type="number"
                required
                min="0"
                max="99.99"
                step="0.01"
                value={tax}
                onChange={(e) => {
                  setTax(e.target.value);
                  resetRequest();
                }}
              />
            </label>
          )}
          <p className="quote-note">
            {stale
              ? "Waiting for fresh market data. Alerts only trigger on fresh prices."
              : quote
                ? `Current estimate: ${coins(quote.unit)} coins / item for ${coins(qty)} items.`
                : "Insufficient visible liquidity. The alert waits until your full quantity is available."}
          </p>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create alert"}
            <ArrowRight size={16} />
          </button>
          <p className="delivery-note">
            {isLocal
              ? "Preview only. No email will be sent."
              : `Confirmation goes to ${user?.email}.`}
            <br />
            Disable your alert using the link in that email.
            {!isLocal && <><br />Checks about every five minutes can miss brief price movements.
              <br />20 active alerts per account · Free service shares 40 new alerts per day. Delivery may queue.</>}
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </main>
  );
}

function DisablePage({
  token,
  data,
  update,
  home,
}: {
  token: string;
  data: AppData;
  update: (data: AppData) => void;
  home: () => void;
}) {
  const [done, setDone] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const valid = /^[a-f0-9]{64}$/.test(token);
  return (
    <main className="center-page disable-page">
      <span className="eyebrow">EMAIL ALERT</span>
      <h1>
        {done
          ? "Alert disabled."
          : valid
            ? "Stop watching?"
            : "Invalid alert link."}
      </h1>
      <p>
        {done
          ? "You won’t receive future notifications for this alert. An email already on its way may still arrive."
          : valid
            ? "Disable the price alert linked to this email. Your other alerts will stay active."
            : "Open the full link from your confirmation email."}
      </p>
      {!done && valid && (
        <button
          className="primary"
          disabled={busy || (!isLocal && !backendReady)}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              if (isLocal) {
                const next = disableLocalAlert(data, token);
                if (isDemo) saveDemo(next);
                else saveLive(next);
                update(next);
              } else await disableCloudAlert(token);
              setDone(true);
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Disabling…" : "Disable alert"}
        </button>
      )}
      {!isLocal && !backendReady && (
        <small>
          Alert management will be available when email monitoring is activated.
        </small>
      )}
      {isLocal && (
        <small>Preview link · Changes apply in this browser only</small>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="text-button" onClick={home}>
        {done ? "Back to search" : "Keep my alert"}
        <ArrowRight size={15} />
      </button>
    </main>
  );
}
