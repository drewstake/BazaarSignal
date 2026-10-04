import { parseBook, isFresh, isValidSample } from "../market";
import type { Level } from "../model";
import type { BazaarItem } from "./types";
const metric = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null;
export function categoryFor(id: string, supplied?: string) {
  if (supplied) return supplied.toLowerCase();
  if (/ENCHANTMENT|BOOK/.test(id)) return "enchantments";
  if (
    /WHEAT|CARROT|POTATO|SUGAR|MELON|PUMPKIN|SEED|CACTUS|COCOA|MUSHROOM|WART/.test(
      id,
    )
  )
    return "farming";
  if (
    /DIAMOND|GOLD|IRON|COAL|LAPIS|REDSTONE|EMERALD|MITHRIL|TITANIUM|GEM|STONE|QUARTZ/.test(
      id,
    )
  )
    return "mining";
  if (/FISH|SALMON|PUFFER|SHARK|BAIT/.test(id)) return "fishing";
  if (/LOG|WOOD/.test(id)) return "foraging";
  if (/EYE|BLAZE|FLESH|BONE|PEARL|STRING|POWDER/.test(id)) return "combat";
  return "other";
}
export function normalizeBazaar(
  id: string,
  raw: unknown,
  upstreamAt: number,
  observedAt: number,
  catalog?: { name?: string; category?: string; tier?: string },
  previous?: BazaarItem,
): BazaarItem {
  const book = parseBook(raw);
  const q =
    (raw as { quick_status?: Record<string, unknown> }).quick_status ?? {};
  // Hypixel uses transaction-side names: buy_summary are asks consumed by instant
  // buyers; sell_summary are bids consumed by instant sellers. Never reverse these.
  const old = previous?.asks[0]?.pricePerUnit,
    current = book.buy[0]?.pricePerUnit;
  return {
    id,
    name:
      catalog?.name?.replace(/§./g, "") ??
      id
        .replaceAll("_", " ")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    category: categoryFor(id, catalog?.category),
    rarity: catalog?.tier ?? "UNKNOWN",
    asks: book.buy,
    bids: book.sell,
    openSellQuantity: metric(q.buyVolume),
    openBuyQuantity: metric(q.sellVolume),
    sellOfferCount: metric(q.buyOrders),
    buyOrderCount: metric(q.sellOrders),
    instantBuyActivity7d: metric(q.buyMovingWeek),
    instantSellActivity7d: metric(q.sellMovingWeek),
    upstreamAt,
    observedAt,
    priceChangePct:
      old && current && previous && upstreamAt > previous.upstreamAt
        ? (current / old - 1) * 100
        : (previous?.priceChangePct ?? null),
  };
}
export function executeDepth(levels: Level[], quantity: number) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) return null;
  let remaining = quantity,
    total = 0;
  for (const level of levels) {
    if (
      ![level.amount, level.pricePerUnit, level.orders].every(
        (n) => Number.isFinite(n) && n > 0,
      )
    )
      return null;
    const take = Math.min(remaining, level.amount);
    total += take * level.pricePerUnit;
    remaining -= take;
    if (!Number.isFinite(total)) return null;
    if (!remaining)
      return {
        total,
        unit: total / quantity,
        slippage:
          Math.abs(total / quantity - levels[0].pricePerUnit) * quantity,
      };
  }
  return null; // Never extrapolate beyond visible levels.
}
export function validBazaarSample(item: BazaarItem, now = Date.now()) {
  return isValidSample(item.upstreamAt, now) && isValidSample(item.observedAt, now) &&
    isFresh(item.upstreamAt, item.observedAt);
}
