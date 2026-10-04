import { useState, type FormEvent } from "react";
import {
  validateNotification,
  type HoldingNotification,
  type NotificationInput,
} from "../../shared/companion/notifications";
import type { Holding } from "../../shared/companion/portfolio";
export default function NotificationEditor({
  holding,
  current,
  busy,
  save,
  cancel,
}: {
  holding: Holding;
  current?: HoldingNotification;
  busy: boolean;
  save: (input: NotificationInput) => Promise<void>;
  cancel: () => void;
}) {
  const [baseline, setBaseline] = useState<NotificationInput["baseline"]>(
      current?.baseline ?? "acquisition",
    ),
    [up, setUp] = useState(current?.up == null ? "" : String(current.up)),
    [down, setDown] = useState(
      current?.down == null ? "" : String(current.down),
    ),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    const input = {
      baseline,
      up: up.trim() ? Number(up) : null,
      down: down.trim() ? Number(down) : null,
    };
    try {
      validateNotification(input);
      setError("");
      await save(input);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <form
      className="panel editor"
      onSubmit={submit}
      aria-label="Holding notification"
    >
      <h2>Notify me about {holding.name}</h2>
      <fieldset disabled={busy}>
        <label>
          Baseline
          <select
            aria-label="Baseline"
            value={baseline}
            onChange={(e) => setBaseline(e.target.value as typeof baseline)}
          >
            <option value="acquisition">Average acquisition price</option>
            <option value="sample">Price sample when enabled</option>
          </select>
        </label>
        <p>
          {baseline === "acquisition"
            ? "Uses your saved cost basis divided by quantity. Purchases and edits recalculate the baseline and prime the next fresh sample without firing."
            : "Captures a verified fresh reference price on the server. Purchases and edits keep that price fixed. A fresh sample is required to enable or resume."}
        </p>
        <div className="form-grid">
          <label>
            Upward threshold (%)
            <input
              inputMode="decimal"
              value={up}
              onChange={(e) => setUp(e.target.value)}
              placeholder="e.g. 10"
            />
          </label>
          <label>
            Downward threshold (%)
            <input
              inputMode="decimal"
              value={down}
              onChange={(e) => setDown(e.target.value)}
              placeholder="e.g. 10"
            />
          </label>
        </div>
        <p>
          Set either or both. The first eligible sample establishes a starting
          side; it never sends an immediate message. Each threshold sends once
          per crossing, then rearms when a fresh price moves back inside it.
          Missing or stale data waits and primes the next valid sample.
        </p>
        <p>
          Editing or resuming primes again. Deleting a holding or portfolio
          stops its notifications. A different valuation source requires
          enabling again. Delivery uses your verified Google email and account
          preference.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="primary">
            {busy ? "Saving…" : "Save and enable"}
          </button>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}
