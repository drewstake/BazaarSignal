import HoldingSearch from "./HoldingSearch";
import { itemPageHash } from "./item-route";
import "./bazaar-search.css";

export default function BazaarSearch() {
  return (
    <div className="bazaar-search">
      <HoldingSearch
        compact
        openOnFocus={false}
        onSelect={(item) => {
          if (item) location.hash = itemPageHash(item.id);
        }}
      />
    </div>
  );
}
