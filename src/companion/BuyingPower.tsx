import { useState } from "react";
import { Pencil } from "lucide-react";
import { parseCoinAmount } from "../../shared/companion/positions";
import { exact } from "./components";

export default function BuyingPower({
  value,
  busy,
  save,
}: {
  value?: number;
  busy: boolean;
  save: (value: number) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="buying-power">
      <dt>Buying power</dt>
      <dd>
        {editing ? (
          <form
            aria-label="Set buying power"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              const parsed = parseCoinAmount(amount, true);
              if (parsed === null) {
                setError("Enter 0 to 1,000,000,000,000,000 coins.");
                return;
              }
              setError("");
              if (await save(parsed)) setEditing(false);
            }}
          >
            <label className="nm-sr-only" htmlFor="available-coins">
              Available coins
            </label>
            <input
              id="available-coins"
              autoFocus
              value={amount}
              disabled={busy}
              placeholder="e.g. 250m"
              aria-describedby="buying-power-help"
              aria-invalid={!!error}
              onChange={(event) => setAmount(event.target.value)}
            />
            <small id="buying-power-help">
              Available coins · update manually
            </small>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="actions">
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button
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
          </form>
        ) : (
          <button
            className="buying-power-value"
            disabled={busy}
            aria-label={
              value === undefined ? "Set buying power" : "Edit buying power"
            }
            onClick={() => {
              setAmount(value === undefined ? "" : String(value));
              setEditing(true);
            }}
          >
            <span>
              {value === undefined ? (
                "Set balance"
              ) : (
                <>
                  {exact(value)} <small>coins</small>
                </>
              )}
            </span>
            <Pencil size={14} aria-hidden="true" />
          </button>
        )}
      </dd>
    </div>
  );
}
