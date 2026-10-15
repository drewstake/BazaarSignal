import { describe, expect, it } from "vitest";
import rows from "../src/companion/bazaar-catalog.json";
import exclusions from "../docs/bazaar-search-exclusions.json";
import inventory from "../docs/artwork/catalog-inventory.json";
import {
  holdingCatalogItem,
  searchHoldingItems,
} from "../src/companion/holding-catalog";

describe("Bazaar holding search", () => {
  it("finds Bazaar items by name and ID and excludes retired auction assets", () => {
    expect(searchHoldingItems("booster cookie")[0]).toMatchObject({
      id: "BOOSTER_COOKIE",
      kind: "bazaar",
    });
    expect(searchHoldingItems('NECRON_HANDLE')).toEqual([]);
    expect(holdingCatalogItem('NECRON_HANDLE')).toBeUndefined();
  });
  it("ranks exact matches ahead of broad matches and supports multiple words", () => {
    expect(searchHoldingItems("diamond")[0].id).toBe("DIAMOND");
    expect(searchHoldingItems("enchanted diamond block")[0].id).toBe(
      "ENCHANTED_DIAMOND_BLOCK",
    );
    expect(searchHoldingItems("diamond").length).toBeLessThanOrEqual(20);
  });
  it("does not silently invent a market or item for an unmatched query", () => {
    expect(searchHoldingItems("   ")).toEqual([]);
    expect(searchHoldingItems("NotAnActualSkyblockItemXYZ")).toEqual([]);
    expect(holdingCatalogItem("NotAnActualSkyblockItemXYZ")).toBeUndefined();
  });
  it("excludes reviewed unused IDs without dropping other saved Bazaar entries", () => {
    const omitted = new Set(exclusions.ids);
    const expected = inventory.items
      .filter((item) => item.sources.includes("bazaar") && !omitted.has(item.id))
      .map((item) => item.id);
    expect(rows.map(([id]) => id)).toEqual(expected);
    for (const id of omitted) {
      expect(holdingCatalogItem(id)).toBeUndefined();
      expect(searchHoldingItems(id).some((item) => item.id === id)).toBe(false);
    }
    expect(searchHoldingItems("Bazaar Cookie")).toEqual([]);
    expect(searchHoldingItems("cookie").map((item) => item.id)).toContain("BOOSTER_COOKIE");
  });
  it("keeps supported replacements and virtual items, including empty-book items with trading history", () => {
    for (const id of [
      "BOOSTER_COOKIE",
      "AMALGAMATED_CRIMSONITE_NEW",
      "ENCHANTED_HAY_BALE",
      "ENCHANTED_CARROT_STICK",
      "ENCHANTMENT_ULTIMATE_JERRY_1",
      "ENCHANTMENT_ARCANE_6",
      "ESSENCE_WITHER",
      "SHARD_COD",
      "FACTION_RABBIT_HAYBALE",
    ]) expect(searchHoldingItems(id)[0]?.id).toBe(id);
  });
});
