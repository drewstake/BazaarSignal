import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { ItemArt } from "./components";
import { searchHoldingItems, type HoldingCatalogItem } from "./holding-catalog";
import "./holding-search.css";

export default function HoldingSearch({
  onSelect,
  compact = false,
  openOnFocus = true,
}: {
  onSelect: (item: HoldingCatalogItem | null) => void;
  compact?: boolean;
  openOnFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const results = useMemo(() => searchHoldingItems(query), [query]);
  const expanded = open && !!query.trim();
  useEffect(() => {
    if (expanded && active >= 0)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [expanded, active, id]);
  function choose(item: HoldingCatalogItem) {
    setQuery(item.name);
    setOpen(false);
    setActive(-1);
    onSelect(item);
  }
  function move(index: number) {
    setActive(index);
  }
  return (
    <div
      className="holding-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={id} className={compact ? "nm-sr-only" : undefined}>
        {compact ? "Search Bazaar items" : "Search"}
      </label>
      <div className="holding-search-input">
        <Search size={19} aria-hidden="true" />
        <input
          id={id}
          ref={input}
          type="search"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={`${id}-results`}
          aria-describedby={`${id}-hint`}
          aria-activedescendant={
            expanded && active >= 0 && results[active]
              ? `${id}-option-${active}`
              : undefined
          }
          value={query}
          placeholder={
            compact
              ? "Search Bazaar items…"
              : "Search Bazaar items by name or ID…"
          }
          onFocus={() => {
            if (openOnFocus) setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
            onSelect(null);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              if (results.length)
                move(
                  event.key === "ArrowDown"
                    ? (open ? active + 1 : 0) % results.length
                    : (!open || active <= 0 ? results.length : active) - 1,
                );
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (expanded && results.length)
                choose(results[active >= 0 ? active : 0]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              setActive(-1);
            }
          }}
        />
        <div className="holding-search-dropdown" hidden={!expanded}>
          <ul id={`${id}-results`} role="listbox" aria-label="Matching items">
            {results.map((item, index) => (
              <li key={item.id} role="none">
                <button
                  type="button"
                  role="option"
                  id={`${id}-option-${index}`}
                  aria-label={`${item.name} (${item.id})`}
                  aria-selected={active === index}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    choose(item);
                    input.current?.focus();
                    setOpen(false);
                  }}
                >
                  <ItemArt id={item.id} size="small" />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.id}</small>
                  </span>
                  <span className="market-badge">Bazaar</span>
                </button>
              </li>
            ))}
          </ul>
          {!results.length && (
            <p role="status">
              No matching Bazaar items. Try another name or item ID.
            </p>
          )}
        </div>
      </div>
      <p
        className={compact ? "nm-sr-only" : "muted search-hint"}
        id={`${id}-hint`}
      >
        Search by item name or ID. Use arrow keys to navigate, Enter to select,
        and Escape to close.
      </p>
    </div>
  );
}
