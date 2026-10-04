import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  addPurchase,
  positionInput,
  quantityFromCostInput,
  type CostMode,
} from "../../shared/companion/positions";
import { assetId, type Holding } from "../../shared/companion/portfolio";
import type { HoldingChange } from "./portfolio-store";
import { exact, ItemArt } from "./components";
import HoldingSearch from "./HoldingSearch";
import { holdingCatalogItem } from "./holding-catalog";

export default function HoldingEditor({
  mode,
  holding,
  busy,
  save,
  cancel,
}: {
  mode: "create" | "edit" | "purchase";
  holding?: Holding;
  busy: boolean;
  save: (change: HoldingChange) => Promise<void>;
  cancel: () => void;
}) {
  const [itemId, setId] = useState(holding?.itemId ?? "");
  const [quantity, setQuantity] = useState(
      mode === "edit" ? String(holding!.quantity) : "",
    ),
    [cost, setCost] = useState(
      mode === "edit" ? String(holding!.costBasis) : "",
    ),
    [costMode, setCostMode] = useState<CostMode>(
      mode === "edit" ? "total" : "average",
    );
  const [quantityMode, setQuantityMode] = useState("manual"),
    [averageCost, setAverageCost] = useState(""),
    [totalSpent, setTotalSpent] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const calculated = quantityMode === "calculated",
    inferred = quantityFromCostInput(averageCost, totalSpent),
    input = calculated ? inferred : positionInput(quantity, cost, costMode),
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
  function switchCost(next: CostMode) {
    if (next === costMode) return;
    if (!input.error)
      setCost(String(next === "total" ? input.costBasis : input.averagePrice));
    else setCost("");
    setCostMode(next);
  }
  function switchQuantity(next: string) {
    if (next === quantityMode) return;
    if (!input.error) {
      if (next === "calculated") {
        setAverageCost(String(input.averagePrice));
        setTotalSpent(String(input.costBasis));
      } else {
        setQuantity(String(input.quantity));
        setCost(
          String(costMode === "total" ? input.costBasis : input.averagePrice),
        );
      }
    } else if (next === "calculated") {
      if (costMode === "average") setAverageCost(cost);
      else setTotalSpent(cost);
    }
    setQuantityMode(next);
    setSubmitted(false);
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
  return (
    <form
      className="panel editor"
      aria-label={title}
      onSubmit={submit}
      noValidate
    >
      <h2 ref={heading} tabIndex={-1}>
        {title}
      </h2>
      <p>
        {mode === "purchase"
          ? "Record just the new purchase using quantity, or average price and total coins spent."
          : "Enter your quantity, or calculate it from your average purchase price and total coins spent."}
      </p>
      <fieldset disabled={busy}>
        {holding ? (
          <div className="asset-title">
            <ItemArt id={holding.itemId} size="small" />
            <strong>{holding.name}</strong>
          </div>
        ) : (
          <>
            <HoldingSearch
              onSelect={(item) => {
                setId(item?.id ?? "");
                setSubmitted(false);
              }}
            />
            {selected && (
              <div className="selected-holding-item asset-title">
                <ItemArt id={selected.id} size="small" />
                <strong>{selected.name}</strong>
                <span className="market-badge">Bazaar</span>
              </div>
            )}
          </>
        )}
        <label>
          Quantity entry
          <select
            value={quantityMode}
            onChange={(e) => switchQuantity(e.target.value)}
          >
            <option value="manual">Enter quantity</option>
            <option value="calculated">Calculate from coins spent</option>
          </select>
        </label>
        <div className="form-grid">
          {calculated ? (
            <>
              <label>
                Average purchase price · coins
                <input
                  value={averageCost}
                  onChange={(e) => setAverageCost(e.target.value)}
                  placeholder="e.g. 12.2m"
                />
              </label>
              <label>
                Total coins spent · coins
                <input
                  value={totalSpent}
                  onChange={(e) => setTotalSpent(e.target.value)}
                  placeholder="e.g. 3.5014b"
                />
              </label>
            </>
          ) : (
            <>
              <label>
                {mode === "purchase" ? "Additional quantity" : "Quantity owned"}
                <input
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Actual whole quantity"
                />
              </label>
              <label>
                Cost entry
                <select
                  aria-label="Cost entry"
                  value={costMode}
                  onChange={(e) => switchCost(e.target.value as CostMode)}
                >
                  <option value="average">Average purchase price</option>
                  <option value="total">Total cost basis</option>
                </select>
              </label>
              <label>
                {costMode === "average"
                  ? "Average purchase price"
                  : "Total cost basis"}{" "}
                · coins
                <input
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="e.g. 12.2m"
                />
              </label>
            </>
          )}
        </div>
        <p className="muted">
          Coins accept commas and k / m / b, in either case. Whole quantities
          only.
          {calculated
            ? " Quantity = total coins spent ÷ average purchase price, rounded to the nearest whole quantity."
            : ""}
        </p>
        <div className="derived" aria-live="polite">
          {calculated ? (
            <>
              Calculated quantity:{" "}
              <strong>{input.error ? "—" : exact(input.quantity)}</strong>
              {!inferred.error && inferred.rounded && (
                <p className="muted">
                  Rounded to the nearest whole quantity. Total coins spent stays
                  the same; recorded average purchase price:{" "}
                  {exact(inferred.averagePrice)} coins.
                </p>
              )}
            </>
          ) : (
            <>
              {costMode === "average"
                ? "Calculated total cost basis"
                : "Calculated average purchase price"}
              :{" "}
              <strong>
                {input.error
                  ? "—"
                  : exact(
                      costMode === "average"
                        ? input.costBasis
                        : input.averagePrice,
                    )}{" "}
                coins
              </strong>
            </>
          )}
          {combined && (
            <p>
              Combined quantity: {exact(combined.quantity)} · Cost basis:{" "}
              {exact(combined.costBasis)} · Weighted average:{" "}
              {exact(combined.costBasis / combined.quantity)}
            </p>
          )}
        </div>
        {(submitted ||
          (calculated ? averageCost && totalSpent : quantity && cost)) &&
          error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
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
      </fieldset>
    </form>
  );
}
