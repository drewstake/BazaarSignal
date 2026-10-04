import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  addPurchase,
  positionInput,
  type CostMode,
} from "../../shared/companion/positions";
import {
  assetId,
  auctionVariant,
  type Holding,
} from "../../shared/companion/portfolio";
import type { HoldingChange } from "./portfolio-store";
import { exact, ItemArt } from "./components";
import catalogRows from "./bazaar-catalog.json";
const catalog = catalogRows.map(([id, name]) => ({ id, name }));

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
  const [kind, setKind] = useState(holding?.kind ?? "bazaar"),
    [itemId, setId] = useState(holding?.itemId ?? ""),
    [name, setName] = useState(holding?.name ?? ""),
    [query, setQuery] = useState("");
  const [quantity, setQuantity] = useState(
      mode === "edit" ? String(holding!.quantity) : "",
    ),
    [cost, setCost] = useState(
      mode === "edit" ? String(holding!.costBasis) : "",
    ),
    [costMode, setCostMode] = useState<CostMode>(
      mode === "edit" ? "total" : "average",
    );
  const [stack, setStack] = useState(String(holding?.stackSize ?? 1)),
    [rarity, setRarity] = useState("LEGENDARY"),
    [enchantments, setEnchantments] = useState("{}"),
    [modifiers, setModifiers] = useState("{}"),
    [submitted, setSubmitted] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const input = positionInput(quantity, cost, costMode),
    selected = catalog.find((i) => i.id === itemId),
    choices = catalog
      .filter((i) =>
        `${i.name} ${i.id}`.toLowerCase().includes(query.toLowerCase()),
      )
      .slice(0, 80);
  let configuration = holding?.configuration ?? "",
    error = input.error ?? "",
    combined: ReturnType<typeof addPurchase> | null = null;
  try {
    if (kind === "auction") {
      if (!holding)
        configuration = JSON.stringify({
          rarity,
          enchantments: JSON.parse(enchantments),
          modifiers: JSON.parse(modifiers),
        });
      auctionVariant(itemId, name, Number(stack), configuration);
      if (!name.trim()) throw new Error("Enter the item name.");
    } else if (!selected) throw new Error("Choose a Bazaar item.");
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
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (error || input.error || busy) return;
    const asset = {
      kind,
      configuration,
      stackSize: kind === "bazaar" ? 1 : Number(stack),
    };
    assetId(itemId, asset);
    await save({
      ...asset,
      mode,
      itemId,
      name: holding?.name ?? (kind === "bazaar" ? selected!.name : name.trim()),
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
          ? "Record just the new purchase. Quantity and cost are added transactionally."
          : "Record the quantity you actually own and what you paid."}
      </p>
      <fieldset disabled={busy}>
        {holding ? (
          <div className="asset-title">
            <ItemArt id={holding.itemId} size="small" />
            <strong>{holding.name}</strong>
          </div>
        ) : (
          <>
            <label>
              Market
              <select
                aria-label="Market"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as typeof kind);
                  setId("");
                }}
              >
                <option value="bazaar">Bazaar</option>
                <option value="auction">Auction House</option>
              </select>
            </label>
            {kind === "bazaar" ? (
              <>
                <label>
                  Search Bazaar items
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Booster Cookie, Diamond…"
                  />
                </label>
                <label>
                  Bazaar item
                  <select
                    aria-label="Bazaar item"
                    value={itemId}
                    onChange={(e) => setId(e.target.value)}
                  >
                    <option value="">Choose an item</option>
                    {selected && !choices.includes(selected) && (
                      <option value={selected.id}>{selected.name}</option>
                    )}
                    {choices.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted">
                  Item names are available offline. Showing up to 80 matches.
                </p>
              </>
            ) : (
              <>
                <div className="form-grid">
                  <label>
                    SkyBlock item ID
                    <input
                      value={itemId}
                      onChange={(e) =>
                        setId(e.target.value.trim().toUpperCase())
                      }
                      placeholder="NECRON_HANDLE"
                    />
                  </label>
                  <label>
                    Item name
                    <input
                      maxLength={140}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label>
                    Items in each identical stack
                    <input
                      inputMode="numeric"
                      value={stack}
                      onChange={(e) => setStack(e.target.value)}
                    />
                  </label>
                  <label>
                    Rarity
                    <select
                      aria-label="Rarity"
                      value={rarity}
                      onChange={(e) => setRarity(e.target.value)}
                    >
                      {[
                        "COMMON",
                        "UNCOMMON",
                        "RARE",
                        "EPIC",
                        "LEGENDARY",
                        "MYTHIC",
                        "DIVINE",
                        "SPECIAL",
                        "VERY_SPECIAL",
                      ].map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p>
                  Define the exact asset configuration. Include every
                  enchantment and normalized modifier (reforge, upgrades, pet
                  details, attributes, skins). Empty objects mean none.
                  Different configurations and stack sizes are separate
                  holdings.
                </p>
                <label>
                  Enchantments (JSON object)
                  <textarea
                    value={enchantments}
                    onChange={(e) => setEnchantments(e.target.value)}
                    placeholder={'{"sharpness": 5}'}
                  />
                </label>
                <label>
                  Modifiers (JSON object)
                  <textarea
                    value={modifiers}
                    onChange={(e) => setModifiers(e.target.value)}
                    placeholder={
                      '{"modifier": "withered", "hot_potato_count": 10}'
                    }
                  />
                </label>
              </>
            )}
          </>
        )}
        <div className="form-grid">
          <label>
            {mode === "purchase"
              ? "Additional quantity"
              : kind === "auction"
                ? "Identical stacks owned"
                : "Quantity owned"}
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
        </div>
        <p className="muted">
          Coins accept commas and k / m / b, in either case. Whole quantities
          only.
          {kind === "auction" ? " Average price is per identical stack." : ""}
        </p>
        <div className="derived" aria-live="polite">
          {costMode === "average"
            ? "Calculated total cost basis"
            : "Calculated average purchase price"}
          :{" "}
          <strong>
            {input.error
              ? "—"
              : exact(
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
        {(submitted || (quantity && cost)) && error && (
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
