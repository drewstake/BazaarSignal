import { useState, type FormEvent } from "react";
import {
  validateNotification,
  type HoldingNotification,
  type NotificationInput,
} from "../../shared/companion/notifications";
import type { Holding } from "../../shared/companion/portfolio";
import WorkspaceDialog from "./WorkspaceDialog";
import { exact } from "./components";
export default function NotificationEditor({
  holding,
  current,
  busy,
  save,
  cancel,
  saveError,
  emailEnabled,
  marketPrice,
  embedded = false,
}: {
  holding: Holding;
  current?: HoldingNotification;
  busy: boolean;
  save: (input: NotificationInput) => Promise<void>;
  cancel: () => void;
  saveError?: string;
  emailEnabled: boolean;
  marketPrice: number | null;
  embedded?: boolean;
}) {
  const [baseline, setBaseline] = useState<NotificationInput["baseline"]>(
      current?.baseline ?? "acquisition",
    ),
    [up, setUp] = useState(current?.up == null ? "" : String(current.up)),
    [down, setDown] = useState(
      current?.down == null ? "" : String(current.down),
    ),
    [error, setError] = useState("");
  const comparisonPrice =
    baseline === "acquisition"
      ? holding.costBasis / holding.quantity
      : marketPrice;
  function targetPrice(value: string, direction: "up" | "down") {
    const percentage = Number(value);
    if (
      !value.trim() ||
      !Number.isFinite(percentage) ||
      percentage < 0.01 ||
      percentage > (direction === "up" ? 1e6 : 99.99)
    )
      return null;
    if (comparisonPrice === null || !Number.isFinite(comparisonPrice))
      return "Sell price unavailable";
    const target =
      comparisonPrice *
      (1 + ((direction === "up" ? 1 : -1) * percentage) / 100);
    if (!Number.isFinite(target)) return null;
    return `${baseline === "sample" ? "Est. sell price" : "Sell price"}: ${exact(target)} coins`;
  }
  const upTarget = targetPrice(up, "up");
  const downTarget = targetPrice(down, "down");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
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
  const form = (
    <form
      className="panel editor notification-editor"
      onSubmit={submit}
      aria-label="Holding notification"
    >
      <h2 id="notification-title">Notify me about {holding.name}</h2>
      <p>Email me when the lowest sell price crosses either target.</p>
      <fieldset disabled={busy}>
        <label>
          Compare with
          <select
            autoFocus={embedded}
            value={baseline}
            onChange={(e) => setBaseline(e.target.value as typeof baseline)}
          >
            <option value="acquisition">My average buy price</option>
            <option value="sample">Price when enabled</option>
          </select>
        </label>
        <p>
          {baseline === "acquisition"
            ? "Updates when you change your holding."
            : "Locks in a fresh market price when enabled. Targets below are estimates."}
        </p>
        <div className="form-grid">
          <div>
            <label>
              Price rises by (%)
              <input
                inputMode="decimal"
                value={up}
                onChange={(e) => {
                  setUp(e.target.value);
                  setError("");
                }}
                placeholder="e.g. 10"
                aria-describedby={
                  upTarget ? "notification-up-target" : undefined
                }
              />
            </label>
            {upTarget && (
              <p
                className="notification-target"
                id="notification-up-target"
                aria-live="polite"
              >
                {upTarget}
              </p>
            )}
          </div>
          <div>
            <label>
              Price falls by (%)
              <input
                inputMode="decimal"
                value={down}
                onChange={(e) => {
                  setDown(e.target.value);
                  setError("");
                }}
                placeholder="e.g. 10"
                aria-describedby={
                  downTarget ? "notification-down-target" : undefined
                }
              />
            </label>
            {downTarget && (
              <p
                className="notification-target"
                id="notification-down-target"
                aria-live="polite"
              >
                {downTarget}
              </p>
            )}
          </div>
        </div>
        <p>
          Prices are per item, before fees. Set one or both; no email is sent
          immediately.
        </p>
        <p>
          {emailEnabled
            ? "Sent to your Google email."
            : "Email delivery is off. Turn it on in Settings to receive alerts."}
        </p>
        {(error || saveError) && (
          <p className="error" role="alert">
            {error || saveError}
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
  return embedded ? (
    form
  ) : (
    <WorkspaceDialog
      busy={busy}
      cancel={cancel}
      labelledBy="notification-title"
    >
      {form}
    </WorkspaceDialog>
  );
}
