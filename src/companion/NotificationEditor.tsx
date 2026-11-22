import { useState, type FormEvent } from "react";
import {
  validateNotification,
  type HoldingNotification,
  type NotificationInput,
} from "../../shared/companion/notifications";
import type { Holding } from "../../shared/companion/portfolio";
import { parseCoinAmount } from "../../shared/companion/positions";
import WorkspaceDialog from "./WorkspaceDialog";
import { exact } from "./components";
function draftTargets(current?: HoldingNotification) {
  return {up: current?.up?.toString() ?? "", down: current?.down?.toString() ?? ""};
}

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
      (current && !current.deleted) ? current.baseline : "fixed",
    ),
    [error, setError] = useState("");
  const coinDraft = useState(() => draftTargets(current?.baseline === "fixed" && !current.deleted ? current : undefined));
  const percentDraft = useState(() => draftTargets(current?.baseline !== "fixed" && !current?.deleted ? current : undefined));
  const fixed = baseline === "fixed";
  const [{up, down}, setTargets] = fixed ? coinDraft : percentDraft;
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
  const upTarget = !fixed && targetPrice(up, "up");
  const downTarget = !fixed && targetPrice(down, "down");
  function parseTarget(text: string) {
    if (!text.trim()) return null;
    return fixed ? (parseCoinAmount(text) ?? NaN) : Number(text);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const input = {
      baseline,
      up: parseTarget(up),
      down: parseTarget(down),
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
      <p>Email me when the lowest sell offer crosses a target.</p>
      <fieldset disabled={busy}>
        <label>
          Target type
          <select
            value={baseline}
            onChange={(e) => { setBaseline(e.target.value as typeof baseline); setError(""); }}
          >
            <option value="fixed">Exact price in coins</option>
            <option value="acquisition">Percentage from my average buy price</option>
            <option value="sample">Percentage from price when enabled</option>
          </select>
        </label>
        {!fixed && <p>
          {baseline === "acquisition"
            ? "Updates when you change your holding."
            : "Locks in a fresh market price when enabled. Targets below are estimates."}
        </p>}
        <div className="form-grid">
          <div>
            <label>
              {fixed ? "Price rises to (coins)" : "Price rises by (%)"}
              <input
                autoFocus={embedded}
                inputMode="decimal"
                value={up}
                onChange={(e) => {
                  setTargets({up: e.target.value, down});
                  setError("");
                }}
                placeholder={fixed ? "e.g. 1,500,000" : "e.g. 10"}
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
              {fixed ? "Price falls to (coins)" : "Price falls by (%)"}
              <input
                inputMode="decimal"
                value={down}
                onChange={(e) => {
                  setTargets({up, down: e.target.value});
                  setError("");
                }}
                placeholder={fixed ? "e.g. 1,200,000" : "e.g. 10"}
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
          Set one or both targets using prices per item before fees.
        </p>
        {!emailEnabled && <p>Email delivery is off. Turn it on in Settings to receive alerts.</p>}
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
      initialFocus="input"
    >
      {form}
    </WorkspaceDialog>
  );
}
