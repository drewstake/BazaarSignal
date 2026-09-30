import { normalizeBazaar } from "../shared/companion/bazaar";
import type { BazaarItem } from "../shared/companion/types";
import { feeContextFromElection } from "../collector/fee-context";
import { fetchJson } from "./store";
import { isFresh } from "../shared/market";
declare const CacheService: any, Utilities: any;
function cachedJson(key: string, url: string, ttl: number) {
  const cache = CacheService.getScriptCache(),
    count = Number(cache.get(`${key}-count`) ?? 0);
  if (Number.isInteger(count) && count > 0 && count < 50) {
    try {
      const chunks = Array.from({ length: count }, (_, i) =>
        cache.get(`${key}-${i}`),
      );
      if (chunks.every(Boolean))
        return JSON.parse(
          Utilities.ungzip(
            Utilities.newBlob(Utilities.base64Decode(chunks.join(""))),
          ).getDataAsString(),
        );
    } catch {
      /* Fetch a new coherent payload after eviction. */
    }
  }
  const data = fetchJson(url);
  if (data.success !== true) throw new Error("Hypixel data unavailable.");
  const encoded = Utilities.base64Encode(
    Utilities.gzip(Utilities.newBlob(JSON.stringify(data))).getBytes(),
  );
  const chunks = encoded.match(/.{1,80000}/g) || [];
  if (chunks.length < 50) {
    const values: Record<string, string> = {
      [`${key}-count`]: String(chunks.length),
    };
    chunks.forEach((x: string, i: number) => (values[`${key}-${i}`] = x));
    cache.putAll(values, ttl);
  }
  return data;
}
// The existing Spark-compatible Apps Script deployment can serve Bazaar without
// a Node host. Auctions still require the 30-second shared collector.
export function publicCompanion() {
  const raw = cachedJson(
      "market",
      "https://api.hypixel.net/v2/skyblock/bazaar",
      60,
    ),
    now = Date.now();
  if (!isFresh(raw.lastUpdated, now) || !raw.products)
    throw new Error("Bazaar data is stale or malformed.");
  let catalog: Record<string, any> = {};
  try {
    const resource = cachedJson(
      "companion-catalog",
      "https://api.hypixel.net/v2/resources/skyblock/items",
      21600,
    );
    catalog = Object.fromEntries(resource.items.map((x: any) => [x.id, x]));
  } catch {
    /* UNKNOWN rarity is explicit; prices remain usable. */
  }
  let election: any = {};
  try {
    election = cachedJson(
      "companion-election",
      "https://api.hypixel.net/v2/resources/skyblock/election",
      300,
    );
  } catch {
    /* Unknown fees withhold recommendations. */
  }
  const feeContext = feeContextFromElection(election, now),
    items: BazaarItem[] = [];
  for (const [id, product] of Object.entries(raw.products)) {
    try {
      items.push({
        ...normalizeBazaar(id, product, raw.lastUpdated, now, catalog[id]),
        feeContext,
      });
    } catch {
      /* Reject malformed books. */
    }
  }
  if (!items.length) throw new Error("No valid Bazaar products.");
  return { items, error: null };
}
