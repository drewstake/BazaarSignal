import { readFileSync, writeFileSync } from "node:fs";

// Offline selector metadata only. Never bundle a saved market price as live data.
const source = JSON.parse(
  readFileSync(
    new URL("../docs/artwork/catalog-inventory.json", import.meta.url),
    "utf8",
  ),
);
const items = source.items
  .filter((item) => item.sources.includes("bazaar"))
  .map((item) => [
    item.id,
    item.name.replace(/§./g, "").replace(/%%[^%]+%%/g, ""),
  ]);
writeFileSync(
  new URL("../src/companion/bazaar-catalog.json", import.meta.url),
  "[\n" +
    items.map((item) => "  " + JSON.stringify(item)).join(",\n") +
    "\n]\n",
);
console.log(`Saved ${items.length} Bazaar item names without prices.`);
const bazaarIds = new Set(items.map(([id]) => id));
const auctions = source.items
  .filter(
    (item) => item.sources.includes("auctions") && !bazaarIds.has(item.id),
  )
  .map((item) => [
    item.id,
    item.name.replace(/§./g, "").replace(/%%[^%]+%%/g, ""),
  ]);
writeFileSync(
  new URL("../src/companion/auction-catalog.json", import.meta.url),
  "[\n" +
    auctions.map((item) => "  " + JSON.stringify(item)).join(",\n") +
    "\n]\n",
);
console.log(
  `Saved ${auctions.length} Auction House item names without prices.`,
);
