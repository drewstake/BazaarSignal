import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  addPurchase,
  positionInput,
  type CostMode,
} from "../../shared/companion/positions";
import { assetId, type Holding } from "../../shared/companion/portfolio";
import type { HoldingChange } from "./portfolio-store";
import { exact, ItemArt } from "./components";
import HoldingSearch from "./HoldingSearch";
import { holdingCatalogItem } from "./holding-catalog";
import WorkspaceDialog from "./WorkspaceDialog";

export default function HoldingEditor({
  mode: initialMode,
  holding,
  busy,
  save,
  cancel,
  saveError,
}: {
  mode: "create" | "edit";
  holding?: Holding;
  busy: boolean;
  save: (change: HoldingChange) => Promise<void>;
  cancel: () => void;
  saveError?: string;
}) {
  const [mode, setMode] = useState<"create" | "edit" | "purchase">(initialMode);
  const [itemId, setId] = useState(holding?.itemId ?? "");
  const [quantity, setQuantity] = useState(
      mode === "edit" ? String(holding!.quantity) : "",
    ),
    [cost, setCost] = useState(
      mode === "edit" ? String(holding!.costBasis) : "",
    ),
    costMode: CostMode = mode === "edit" ? "total" : "average";
  const [submitted, setSubmitted] = useState(false);
  function changeMode(next: "edit" | "purchase") {
    if (next === mode || busy) return;
    setMode(next);
    setQuantity(next === "edit" ? String(holding!.quantity) : "");
    setCost(next === "edit" ? String(holding!.costBasis) : "");
    setSubmitted(false);
  }
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (mode !== "edit") heading.current?.focus();
  }, []);
  const input = positionInput(quantity, cost, costMode),
    selected = holdingCatalogItem(itemId),
    kind = "bazaar" as const;
  let configuration = holding?.configuration ?? "",
    error = input.error ?? "",
    combined: ReturnType<typeof addPurchase> | null = null;
  try {
    if (!holding && !selected)
      throw new Error("Choose an item from the search results.");
    if (holding && holding.kind !== "bazaar")
      throw new Error("This saved asset is no longer supported.");
    if (mode === "purchase" && !input.error)
      combined = addPurchase(holding!, input);
  } catch (e) {
    error =
      e instanceof SyntaxError
        ? "Use valid JSON objects for enchantments and modifiers."
        : (e as Error).message;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (error || input.error || busy) return;
    const asset = {
      kind,
      configuration,
      stackSize: 1,
    };
    assetId(itemId, asset);
    await save({
      ...asset,
      mode,
      itemId,
      name: holding?.name ?? selected!.name,
      quantity: input.quantity,
      costBasis: input.costBasis,
      expected: holding,
    });
  }
  const title =
    mode === "create"
      ? "Add holding"
      : mode === "edit"
        ? "Edit holding"
        : "Add purchase";
  const form = (
    <form
      className="panel editor holding-editor"
      aria-label={title}
      onSubmit={submit}
      noValidate
    >
      <h2
        className={initialMode === "edit" ? undefined : "nm-sr-only"}
        ref={heading}
        tabIndex={-1}
      >
        {initialMode === "edit" ? "Edit holding" : title}
      </h2>
      <fieldset disabled={busy}>
        {initialMode === "edit" && (
          <div
            className="holding-edit-mode"
            role="group"
            aria-label="Holding update type"
          >
            <button
              type="button"
              aria-pressed={mode === "edit"}
              onClick={() => changeMode("edit")}
            >
              Edit totals
            </button>
            <button
              type="button"
              aria-pressed={mode === "purchase"}
              onClick={() => changeMode("purchase")}
            >
              Add purchase
            </button>
          </div>
        )}
        <div className="holding-ticket-row">
          {holding ? (
            <div className="asset-title">
              <ItemArt id={holding.itemId} size="small" />
              <strong>{holding.name}</strong>
            </div>
          ) : (
            <HoldingSearch
              compact
              label="Search"
              onSelect={(item) => {
                setId(item?.id ?? "");
                setSubmitted(false);
              }}
            />
          )}
          <div className="form-grid">
            <>
              <label>
                {mode === "purchase" ? "Quantity bought" : "Quantity"}
                <input
                  aria-label={
                    mode === "purchase"
                      ? "Additional quantity"
                      : "Quantity owned"
                  }
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="e.g. 100"
                />
              </label>
              <label>
                {costMode === "average" ? "Avg. price" : "Total spent"} · coins
                <input
                  aria-label={`${costMode === "average" ? "Average purchase price" : "Total cost basis"} · coins`}
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="e.g. 12.2m"
                />
              </label>
            </>
          </div>
          <div className="actions">
            <button className="primary" type="submit">
              {busy
                ? "Saving…"
                : mode === "purchase"
                  ? "Save purchase"
                  : "Save holding"}
            </button>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
        {!input.error && (
          <div className="holding-estimate" aria-live="polite">
            {costMode === "average" ? "Total" : "Avg. price"}:{" "}
            <strong>
              {exact(
                costMode === "average" ? input.costBasis : input.averagePrice,
              )}{" "}
              coins
            </strong>
            {combined && (
              <p>
                Combined quantity: {exact(combined.quantity)} · Cost basis:{" "}
                {exact(combined.costBasis)} · Weighted average:{" "}
                {exact(combined.costBasis / combined.quantity)}
              </p>
            )}
          </div>
        )}
        {(submitted || (quantity && cost)) && error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {saveError && (
          <p role="alert" className="error">
            {saveError}
          </p>
        )}
      </fieldset>
    </form>
  );
  return initialMode === "edit" ? (
    <WorkspaceDialog
      busy={busy}
      cancel={cancel}
      label="Edit holding"
      initialFocus="input"
    >
      {form}
    </WorkspaceDialog>
  ) : (
    form
  );
}
