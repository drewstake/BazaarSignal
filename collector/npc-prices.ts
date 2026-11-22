import type { NpcPriceChange } from "../shared/flips";
import { historyDay } from "../shared/daily-price-history";
import patchPrices from "./npc-price-changes-2026-11-17.json";

export type NpcChanges = Record<string, NpcPriceChange>;
export type CatalogItem = {
  name: string; tier?: string; category?: string;
  npcSellPrice?: number | null; npcChange?: NpcPriceChange; npcHistory?: NpcPriceChange[];
};
export type Catalog = Record<string, CatalogItem>;

// Hypixel 0.27.3, https://hypixel.net/threads/6169127/ .
// Complete NPC payout diff of the archived API catalog before and after the patch:
// https://hypixelskyblock.minecraft.wiki/w/Special:Diff/870771/874118
// Post-update values checked against https://api.hypixel.net/v2/resources/skyblock/items .
// This seeds existing installations whose earlier catalogs omitted NPC prices.
const patchDay = historyDay(Date.UTC(2026, 10, 17, 12));
const patchChanges: NpcChanges = Object.fromEntries(Object.entries(patchPrices)
  .map(([id, [before, after]]) => [id, { day: patchDay, before, after }]));

export function knownNpcChanges(day: number): NpcChanges {
  return day >= patchDay ? patchChanges : {};
}

export function updateCatalog(items: {id: string; name: string; tier?: string; category?: string; npc_sell_price?: number}[],
  previous: Catalog, day: number): Catalog {
  const seed = knownNpcChanges(day);
  const catalog: Catalog = {};
  for (const item of items.filter(i => typeof i.id === "string").sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const price = item.npc_sell_price ?? null; // Hypixel omits the field for unsellable items.
    if (price !== null && (!Number.isFinite(price) || price < 0)) throw Error("Invalid NPC sell price");
    const prior = previous[item.id];
    const change = prior?.npcChange ?? seed[item.id];
    const before = prior?.npcSellPrice !== undefined ? prior.npcSellPrice : change?.after;
    const npcChange = before !== undefined && before !== price ? {day, before, after: price} : change;
    const history = prior?.npcHistory ?? (change ? [change] : []);
    const npcHistory = npcChange && npcChange !== change ? [...history, npcChange] : history;
    catalog[item.id] = { ...(npcHistory.length ? {npcHistory} : {}), name: item.name, tier: item.tier, category: item.category, npcSellPrice: price, npcChange };
  }
  return catalog;
}
