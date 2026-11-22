import { useState, type ReactNode } from "react";
import { ItemArt } from "./components";
import { holdingCatalogItem } from "./holding-catalog";
import { itemPageHash } from "./item-route";

// The illustration sheet has four columns, in reading order.
const illustratedItems = [
  "CHILI_PEPPER", "ESSENCE_CRIMSON", "MITHRIL_ORE", "SLUDGE_JUICE",
  "SHARD_CHAMELEON", "MAGMA_URCHIN", "DRAGON_HORN", "CONTROL_SWITCH",
  "ENCHANTED_MELON_BLOCK", "ENCHANTED_HUGE_MUSHROOM_2", "ENCHANTED_CACTUS", "JACOBS_TICKET",
];

export function MarketCard({ id, name, metric, label, children }: {
  id: string; name: string; metric: string; label: string; children: ReactNode;
}) {
  const slot = illustratedItems.indexOf(id);
  return <article className="market-pick">
    <div className="pick-heading">
      <div className="pick-art" aria-hidden="true">
        {slot < 0 ? <ItemArt id={id} /> : <span className="pick-illustration"
          style={{ backgroundPosition: `${(slot % 4) * 100 / 3}% ${Math.floor(slot / 4) * 50}%` }} />}
      </div>
      <div><h3>{holdingCatalogItem(id) ? <a href={itemPageHash(id)}>{name}</a> : name}</h3>
        <strong className="pick-metric">{metric}</strong><small>{label}</small>
      </div>
    </div>
    {children}
  </article>;
}

export function MarketGrid<T extends { id: string }>({ rows, label, renderCard }: {
  rows: T[]; label: string; renderCard: (row: T) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return <>
    <ol className="market-grid" aria-label={label}>
      {(expanded ? rows : rows.slice(0, 6)).map(row => <li key={row.id}>{renderCard(row)}</li>)}
    </ol>
    {rows.length > 6 && <button className="pick-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? "Show top 6" : `Show all ${rows.length}`}
    </button>}
  </>;
}
