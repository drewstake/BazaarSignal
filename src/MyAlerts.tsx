import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import type { AppData, Workflow } from "../shared/model";
import { updatePriceAlertTarget } from "../shared/price-alert";
import { fetchCloudAlerts, updateCloudAlert } from "./alerts";
import { auth, isLocal } from "./data";

const coins = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 6 });
const message = (error: unknown) => error instanceof Error ? error.message : "Couldn’t save your alert. Please try again.";

export default function MyAlerts({ data, update, uid, create }: {
  data: AppData;
  update: Dispatch<SetStateAction<AppData>>;
  uid?: string;
  create: () => void;
}) {
  const [loading, setLoading] = useState(!isLocal);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (isLocal || !uid) return;
    let closed = false;
    setLoading(true);
    setError("");
    fetchCloudAlerts().then(result => {
      if (!closed && auth?.currentUser?.uid === uid)
        update(current => ({ ...current, workflows: result.workflows }));
    }).catch(e => { if (!closed) setError(message(e)); })
      .finally(() => { if (!closed) setLoading(false); });
    return () => { closed = true; };
  }, [uid, refresh, update]);

  async function save(workflow: Workflow, target: number) {
    const changed = isLocal
      ? updatePriceAlertTarget(workflow, target, workflow.revision, Date.now())
      : (await updateCloudAlert(workflow, target)).workflow;
    if (!isLocal && auth?.currentUser?.uid !== uid) return;
    update(current => ({ ...current, workflows: current.workflows.map(w =>
      w.id === changed.id && w.updatedAt <= changed.updatedAt ? changed : w) }));
  }
  const alerts = data.workflows.filter(w => w.mode === "single")
    .sort((a, b) => b.createdAt - a.createdAt);
  return <section className="my-alerts" aria-label="My alerts">
    <div className="my-alerts-heading">
      <div className="form-intro">
        <h2>My alerts</h2>
        <p>Your saved alerts across all items. Change an active alert’s target here.</p>
      </div>
      {!isLocal && <button className="text-button" disabled={loading} onClick={() => setRefresh(v => v + 1)}>Refresh alerts</button>}
    </div>
    {loading ? <p role="status">Loading your alerts…</p> : error ? <p className="error" role="alert">{error}</p> : alerts.length === 0 ?
      <div className="alerts-empty"><p>No alerts yet.</p><button className="primary" onClick={create}>Create your first alert</button></div> :
      <div className="saved-alert-list">{alerts.map(workflow => <SavedAlert key={workflow.id} workflow={workflow} save={save}
        side={workflow.stage === "watching_buy" ? "buy" : workflow.stage === "watching_sell" ? "sell" :
          data.events.find(e => e.workflowId === workflow.id && e.side !== "created")?.side} />)}</div>}
  </section>;
}

function SavedAlert({ workflow: w, side, save }: {
  workflow: Workflow;
  side?: string;
  save: (workflow: Workflow, target: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [original, setOriginal] = useState(w);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const active = !w.paused && ["watching_buy", "watching_sell"].includes(w.stage);
  const target = side === "sell" ? w.sellTarget : w.buyTarget;
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await save(original, Number(draft));
      setEditing(false); setSaved(true);
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  return <article className="saved-alert" aria-label={`${w.itemName} alert`}>
    <div className="saved-alert-heading"><h3>{w.itemName}</h3>
      <span className="alert-status">{w.stage === "completed" ? "Completed" : w.paused ? "Disabled" : "Active"}</span></div>
    <p className="saved-alert-target">{side === "buy" ? "Instant buy at or below" : side === "sell" ? "Instant sell at or above" : "Target"} <strong>{coins(target)}</strong> coins / item{side === "sell" ? ", after tax" : ""}</p>
    <p className="delivery-note">Quantity: {coins(w.quantity)}{side === "sell" ? ` · Sale tax: ${w.taxRate ?? 1.25}%` : ""}</p>
    {editing && active ? <form className="saved-alert-edit" onSubmit={submit}>
      <label>Target price <span>coins / item{side === "sell" ? ", after tax" : ""}</span>
        <input type="number" required min="0.000001" max="1000000000000000" step="any" value={draft} disabled={busy} onChange={e => setDraft(e.target.value)} autoFocus />
      </label>
      <div className="saved-alert-actions"><button className="primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save changes"}</button>
        <button className="text-button" type="button" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>Cancel</button></div>
      <p className="delivery-note">Your new target applies to the next price check.</p>
    </form> : active ? <button className="text-button" onClick={() => { setOriginal(w); setDraft(String(target)); setEditing(true); setSaved(false); setError(""); }}>Edit target</button> :
      <p className="delivery-note">Create a new alert to watch another target.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {saved && <p role="status">Target updated.</p>}
  </article>;
}
