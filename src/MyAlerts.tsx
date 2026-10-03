import {
  useEffect,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import type { AppData, Workflow } from "../shared/model";
import { updatePriceAlertTarget } from "../shared/price-alert";
import { fetchCloudAlerts, updateCloudAlert } from "./alerts";
import { auth, isLocal } from "./data";
import { watchAccountReads } from './account';
import { ArrowDown, ArrowUp, Mail, Search } from "lucide-react";
import { estimate } from "../shared/market";
import { Coin, ItemArt, RarityRibbon, artGlow } from "./companion/components";
import { useAlertBook } from "./useAlertBook";
import { SampleTime } from './SampleTime';

const coins = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 6 });
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Couldn’t save your alert. Please try again.";

const statusOf = (w: Workflow) =>
  w.stage === "completed" ? "Completed" : w.paused ? "Disabled" : "Active";

export default function MyAlerts({
  data,
  update,
  uid,
  create,
  board = false,
  refreshKey = 0,
  rarities = {},
}: {
  data: AppData;
  update: Dispatch<SetStateAction<AppData>>;
  uid?: string;
  create: () => void;
  board?: boolean;
  refreshKey?: number;
  rarities?: Record<string, string>;
}) {
  const [filter, setFilter] = useState("Active");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(!isLocal);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(isLocal);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (isLocal || !uid) return;
    let closed = false;
    const controller = new AbortController();
    const owner = auth?.currentUser;
    const stop = owner?.uid === uid ? watchAccountReads(owner, (failure) => {
      if (closed) return;
      setError(failure ? message(failure) : '');
      if (!failure) setLoaded(true);
    }) : () => {};
    setLoading(true);
    setError("");
    fetchCloudAlerts(controller.signal)
      .then((result) => {
        if (!closed && auth?.currentUser?.uid === uid) {
          update((current) => ({ ...current, ...result }));
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (!closed) setError(message(e));
      })
      .finally(() => {
        if (!closed) setLoading(false);
      });
    return () => {
      closed = true;
      stop();
      controller.abort();
    };
  }, [uid, refresh, refreshKey, update]);

  async function save(workflow: Workflow, target: number) {
    const changed = isLocal
      ? updatePriceAlertTarget(
          data.workflows.find((w) => w.id === workflow.id) ?? workflow,
          target,
          workflow.revision,
          Date.now(),
        )
      : (await updateCloudAlert(workflow, target)).workflow;
    if (!isLocal && auth?.currentUser?.uid !== uid) return;
    update((current) => ({
      ...current,
      workflows: current.workflows.map((w) =>
        w.id === changed.id && w.updatedAt <= changed.updatedAt ? changed : w,
      ),
    }));
  }
  const alerts = data.workflows
    .filter((w) => w.mode === "single")
    .sort((a, b) => b.createdAt - a.createdAt);
  const visible = alerts.filter(
    (w) =>
      !board ||
      (statusOf(w) === filter &&
        w.itemName.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const triggers = data.events
    .filter(
      (e) => e.side !== "created" && alerts.some((w) => w.id === e.workflowId),
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3);
  return (
    <section className="my-alerts" aria-label="My alerts">
      {!board && (
        <div className="my-alerts-heading">
          <div className="form-intro">
            <h2>My alerts</h2>
            <p>
              Your saved alerts across all items. Change an active alert’s
              target here.
            </p>
          </div>
          {!isLocal && (
            <button
              className="text-button"
              disabled={loading}
              onClick={() => setRefresh((v) => v + 1)}
            >
              Refresh alerts
            </button>
          )}
        </div>
      )}
      {board && (
        <div className="alerts-toolbar">
          <div
            className="alert-filters"
            role="group"
            aria-label="Filter alerts by status"
          >
            {["Active", "Completed", "Disabled"].map((status) => (
              <button
                key={status}
                aria-pressed={filter === status}
                onClick={() => setFilter(status)}
              >
                {status}
                <span>
                  {!loaded
                    ? "—"
                    : alerts.filter((w) => statusOf(w) === status).length}
                </span>
              </button>
            ))}
          </div>
          <label className="alert-search">
            <Search size={20} />
            <input
              type="search"
              aria-label="Find an alert"
              placeholder="Find an alert…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      )}
      {error && loaded && <p className="error" role="alert">{error} Showing last loaded alerts; refresh to check for changes.</p>}
      {loading && !loaded ? (
        <p className="alerts-empty" role="status">
          Loading your alerts…
        </p>
      ) : error && !loaded ? (
        <div className="alerts-empty">
          <p className="error" role="alert">
            {error}
          </p>
          <button onClick={() => setRefresh((v) => v + 1)}>Retry alerts</button>
        </div>
      ) : alerts.length === 0 ? (
        <div className="alerts-empty">
          <p>No alerts yet.</p>
          <button className="primary" onClick={create}>
            Create your first alert
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="alerts-empty">
          <p>
            {query
              ? "No alerts match your search."
              : `No ${filter.toLowerCase()} alerts yet.`}
          </p>
          {query && <button onClick={() => setQuery("")}>Clear search</button>}
        </div>
      ) : (
        <div className="saved-alert-list">
          {visible.map((workflow) => (
            <SavedAlert
              key={workflow.id}
              workflow={workflow}
              save={save}
              data={data}
              board={board}
              rarity={rarities[workflow.itemId]}
              side={
                workflow.stage === "watching_buy"
                  ? "buy"
                  : workflow.stage === "watching_sell"
                    ? "sell"
                    : (data.events.find(
                        (e) =>
                          e.workflowId === workflow.id && e.side !== "created",
                      )?.side ??
                      (data.events
                        .find(
                          (e) =>
                            e.workflowId === workflow.id &&
                            e.side === "created",
                        )
                        ?.message.includes("instant-buy cost")
                        ? "buy"
                        : data.events
                              .find(
                                (e) =>
                                  e.workflowId === workflow.id &&
                                  e.side === "created",
                              )
                              ?.message.includes("instant-sell proceeds")
                          ? "sell"
                          : undefined))
              }
            />
          ))}
        </div>
      )}
      {board && !loading && !error && (
        <details className="recent-triggers" aria-label="Recent triggers">
          <summary>Recent delivery history</summary>
          {triggers.length ? (
            triggers.map((event) => (
              <div className="trigger-row" key={event.id}>
                <Mail size={20} />
                <strong>{event.itemName}</strong>
                <span>Target reached</span>
                <time dateTime={new Date(event.createdAt).toISOString()}>
                  {new Date(event.createdAt).toLocaleString()}
                </time>
                <small>
                  {isLocal
                    ? "Preview · no email sent"
                    : `Email ${event.deliveries.email?.status ?? "status unavailable"}`}
                </small>
              </div>
            ))
          ) : (
            <p>
              No recent trigger events available. Reached targets will appear
              here when reported.
            </p>
          )}
        </details>
      )}
      {board && !isLocal && (
        <button
          className="refresh-alerts"
          disabled={loading}
          onClick={() => setRefresh((v) => v + 1)}
        >
          Refresh alerts
        </button>
      )}
    </section>
  );
}

function SavedAlert({
  workflow: w,
  side,
  save,
  data,
  board,
  rarity,
}: {
  workflow: Workflow;
  side?: string;
  save: (workflow: Workflow, target: number) => Promise<void>;
  data: AppData;
  board: boolean;
  rarity?: string;
}) {
  const {
    book,
    stale,
    timestamp,
    observedAt,
    collectionError,
    error: priceError,
  } = useAlertBook(w.itemId, data);
  const quote =
    side === "buy" || side === "sell"
      ? estimate(book, w.quantity, side, w.taxRate ?? 1.25)
      : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [original, setOriginal] = useState(w);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const active =
    !w.paused && ["watching_buy", "watching_sell"].includes(w.stage);
  const target = side === "sell" ? w.sellTarget : w.buyTarget;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await save(original, Number(draft));
      setEditing(false);
      setSaved(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="saved-alert" aria-label={`${w.itemName} alert`}>
      {board && (
        <a
          href={`#item=${encodeURIComponent(w.itemId)}`}
          className="alert-art"
          style={artGlow(w.itemId)}
          aria-label={`View ${w.itemName}`}
        >
          <ItemArt id={w.itemId} />
        </a>
      )}
      <div className="saved-alert-body">
        <div className="saved-alert-heading">
          <h3>
            {board ? (
              <a href={`#item=${encodeURIComponent(w.itemId)}`}>{w.itemName}</a>
            ) : (
              w.itemName
            )}
          </h3>
          {rarity && <RarityRibbon rarity={rarity} />}
          <span className={`alert-status status-${statusOf(w).toLowerCase()}`}>
            {statusOf(w)}
          </span>
        </div>
        <p className={`saved-alert-target direction-${side}`}>
          {board &&
            (side === "buy" ? (
              <ArrowDown size={23} />
            ) : side === "sell" ? (
              <ArrowUp size={23} />
            ) : null)}
          <span>
            {side === "buy"
              ? `Buy ${coins(w.quantity)} ${w.quantity === 1 ? 'item' : 'items'} at ≤`
              : side === "sell"
                ? `Sell ${coins(w.quantity)} ${w.quantity === 1 ? 'item' : 'items'} at ≥`
                : "Target"}{" "}
            <strong>{coins(target)}</strong> coins each
            {side === "sell" ? ` (instant sell, after ${w.taxRate ?? 1.25}% tax).` : side === "buy" ? " (instant buy)." : ""}
          </span>
        </p>
        <div className="alert-card-details">
          {board && (
            <>
              <div className="current-quote">
                <span>{stale ? 'Saved prices' : 'Sampled estimate'} · {side === 'sell' ? 'instant sell, after tax' : 'instant buy'}</span>
                <strong>
                  {!book ? (
                    "Price unavailable"
                  ) : !side ? (
                    "Direction unavailable"
                  ) : !quote ? (
                    "Insufficient depth"
                  ) : (
                    <Coin value={quote.unit} full />
                  )}
                </strong>
                {quote && <span>coins each · priced for {coins(w.quantity)} {w.quantity === 1 ? 'item' : 'items'}</span>}
                <SampleTime timestamp={timestamp} compact />
                {stale && <span>Target checks wait for a fresh sample.</span>}
                {priceError && <span>{collectionError ? 'Collection failed' : 'Cached price read failed'}: {priceError}</span>}
                <details className="sample-details"><summary>Sample details</summary><SampleTime timestamp={timestamp} observedAt={observedAt} /></details>
              </div>
            </>
          )}
          {!board && <p className="delivery-note">
            Quantity: <b>{coins(w.quantity)}</b>
          </p>}
          {!board && (
            side === "sell" && (
              <p className="delivery-note">Sale tax: {w.taxRate ?? 1.25}%</p>
            )
          )}
        </div>
        {editing && active ? (
          <form className="saved-alert-edit" onSubmit={submit}>
            <label>
              Target price{" "}
              <span>coins / item{side === "sell" ? ", after tax" : ""}</span>
              <input
                type="number"
                required
                min="0.000001"
                max="1000000000000000"
                step="any"
                value={draft}
                disabled={busy}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
              />
            </label>
            <div className="saved-alert-actions">
              <button className="primary" disabled={busy} type="submit">
                {busy ? "Saving…" : "Save changes"}
              </button>
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setError("");
                }}
              >
                Cancel
              </button>
            </div>
            <p className="delivery-note">
              Your new target applies to the next price check.
            </p>
          </form>
        ) : active ? (
          <button
            className="text-button"
            onClick={() => {
              setOriginal(w);
              setDraft(String(target));
              setEditing(true);
              setSaved(false);
              setError("");
            }}
          >
            Edit target
          </button>
        ) : (
          <p className="delivery-note">
            Create a new alert to watch another target.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {saved && <p role="status">Target updated.</p>}
      </div>
    </article>
  );
}
