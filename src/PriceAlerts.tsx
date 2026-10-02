import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { User } from "firebase/auth";
import { LogOut, Mail, ShieldCheck } from "lucide-react";
import { ownerCandidate } from './companion/usage-access';
import type { AppData } from "../shared/model";
import { auth, backendReady, isDemo, isLocal, logout } from "./data";
import AlertForm from "./AlertForm";
import MyAlerts from "./MyAlerts";
import { getBazaar } from "./companion/api";
import { pollingDirective, hourlyMarketMode, nextScheduledMarketCheck } from "./companion/polling";
import { ItemArt, SkyIcon } from "./companion/components";
import "./companion/market.css";
import "./price-alerts.css";

export default function PriceAlerts({
  data,
  update,
  user,
  signIn,
  signingIn,
  authError,
  error,
  itemId,
}: {
  data: AppData;
  update: Dispatch<SetStateAction<AppData>>;
  user: User | null;
  signIn: () => Promise<void>;
  signingIn: boolean;
  authError: string;
  error: string;
  itemId: string | null;
}) {
  const [selected, setSelected] = useState(itemId ?? "");
  const [refresh, setRefresh] = useState(0);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const tick = () => setClock(Date.now());
    const timer = setInterval(tick, 15000);
    window.addEventListener('market-usage-policy', tick);
    return () => { clearInterval(timer); window.removeEventListener('market-usage-policy', tick); };
  }, []);
  const nextCheck = nextScheduledMarketCheck(clock);
  const [rarities, setRarities] = useState<Record<string, string>>({});
  const selector = useRef<HTMLSelectElement>(null);
  const board = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (itemId) setSelected(itemId);
  }, [itemId]);
  useEffect(() => {
    // Rarity is optional catalog metadata. The legacy price feed does not contain it.
    const controller = new AbortController();
    getBazaar(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          setRarities(
            Object.fromEntries(
              result.items
                .filter((item) =>
                  /^(COMMON|UNCOMMON|RARE|EPIC|LEGENDARY|MYTHIC|DIVINE|SPECIAL|VERY_SPECIAL)$/.test(
                    item.rarity,
                  ),
                )
                .map((item) => [item.id, item.rarity]),
            ),
          );
      })
      .catch(() => {
        /* Omit unknown rarity rather than guessing. */
      });
    return () => controller.abort();
  }, []);
  const item =
    data.prices.find((p) => p.id === selected) ??
    (!selected ? data.prices[0] : undefined);
  const canCreate = isLocal || Boolean(user && backendReady);
  const create = () => {
    selector.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    selector.current?.focus({ preventScroll: true });
  };
  return (
    <div className="companion price-alerts-app">
      <header className="market-header">
        <div className="market-header-inner">
          <a
            className="market-brand"
            href="#market=bazaar"
            aria-label="BazaarSignal home"
          >
            <SkyIcon name="emerald" size={72} className="brand-gem" />
            <span className="brand-word">BazaarSignal</span>
          </a>
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
                <LogOut size={16} />
                Sign out
              </button>
            ) : (
              auth && (
                <button
                  className="account-button"
                  onClick={signIn}
                  disabled={signingIn}
                >
                  {signingIn ? "Connecting…" : "Sign in with Google"}
                </button>
              )
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
              <a key={id} href={`#market=${id}`}>
                <SkyIcon name={icon} size={36} className="tab-icon" />
                {label}
              </a>
            ))}
            <a href="#alerts=1" className="active" aria-current="page">
              <SkyIcon name="alert-bell" size={36} className="tab-icon" />
              Price Alerts
            </a>
            {ownerCandidate(user) && <a href="#market=usage" className="tab-usage"><ShieldCheck size={25}/><span>Usage &amp; Costs</span></a>}
          </nav>
        </div>
      </header>
      <main className="market-main">
        <div className="market-frame alerts-frame">
          <div className="alerts-board parchment" ref={board} tabIndex={-1}>
            <div className="alerts-title">
              <SkyIcon name="alert-bell" size={96} />
              <div>
                <h1>Price Alerts</h1>
                <p>Your target price. Your next good deal.</p>
              </div>
            </div>
            <div className="alerts-context">
              <span>
                {isLocal
                  ? `${isDemo ? "Demo" : "Local preview"} · No emails are sent`
                  : "One email when your target is reached."}
              </span>
              <button className="create-shortcut" onClick={create}>
                Create alert ↓
              </button>
            </div>
            {hourlyMarketMode && nextCheck !== null && <p role="status" className="market-schedule-notice">
              Prices are sampled hourly. Next scheduled check: <strong>{new Date(nextCheck).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',timeZoneName:'short'})}</strong>.
              {' '}This tab updates automatically while visible. Alerts only evaluate fresh prices; changes between collections can be missed.
            </p>}
            {error && (
              <p role="alert" className="error">
                {error}{" "}
                {pollingDirective().mode === "paused"
                  ? "Existing alerts and target editing remain available. Fresh prices and target checks are paused."
                  : hourlyMarketMode ? "Waiting for the scheduled hourly check shown above." : "Retrying automatically while this tab is visible."}
              </p>
            )}
            {user || isLocal ? (
              <MyAlerts
                data={data}
                update={update}
                uid={user?.uid}
                create={create}
                board
                refreshKey={refresh}
                rarities={rarities}
              />
            ) : (
              <section className="alerts-empty">
                <SkyIcon name="watchlist-chest" size={90} />
                <h2>Sign in for email alerts.</h2>
                <p>
                  Your saved alerts stay private. Use your Google account to
                  create and manage them.
                </p>
                <button
                  className="primary"
                  onClick={signIn}
                  disabled={signingIn || !auth}
                >
                  {signingIn ? "Connecting…" : "Continue with Google"}
                </button>
                {!auth && <p>Account connection is unavailable.</p>}
                {authError && (
                  <p className="error" role="alert">
                    {authError}
                  </p>
                )}
              </section>
            )}
          </div>
          <aside className="alerts-create parchment" aria-label="Create alert">
            <span className="paper-pin" aria-hidden="true" />
            <h2>
              <SkyIcon name="alert-bell" size={54} />
              Create alert
            </h2>
            <label className="alert-item-label" htmlFor="alert-item">
              Item
            </label>
            <div className="alert-item-select">
              {item && <ItemArt id={item.id} size="small" />}
              <select
                id="alert-item"
                ref={selector}
                value={item?.id ?? ""}
                onChange={(e) => setSelected(e.target.value)}
                disabled={!data.prices.length}
              >
                {!item && (
                  <option value="">
                    {selected
                      ? "Choose an available item"
                      : error
                        ? "Items unavailable"
                        : "Loading items…"}
                  </option>
                )}
                {data.prices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            {selected && !item && data.prices.length > 0 && (
              <p role="status">
                This item is unavailable. Choose another item.
              </p>
            )}
            {canCreate && item ? (
              <AlertForm
                key={item.id}
                compact
                item={item}
                data={data}
                user={user}
                signIn={signIn}
                signingIn={signingIn}
                authError={authError}
                update={update}
                onCreated={() => setRefresh((v) => v + 1)}
                onViewAlerts={() => {
                  board.current?.scrollIntoView({ behavior: "smooth" });
                  board.current?.focus({ preventScroll: true });
                }}
              />
            ) : (
              <p className="creation-unavailable">
                <Mail size={22} />
                {!user && !isLocal
                  ? "Sign in to send alerts to your verified email address."
                  : !backendReady && !isLocal
                    ? "Email alerts are not connected yet."
                    : "The creation form will appear when item prices are available."}
              </p>
            )}
            <div className="alert-desk" aria-hidden="true">
              <SkyIcon name="watchlist-chest" size={116} />
              <SkyIcon name="gold-coin" size={36} />
              <span className="desk-paper" />
            </div>
          </aside>
        </div>
        <footer className="alerts-footer">
          BazaarSignal · Independent SkyBlock tool{" "}
          <span>Estimated prices. Trade manually in Minecraft.</span>
        </footer>
      </main>
    </div>
  );
}
