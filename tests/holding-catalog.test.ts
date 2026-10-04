import { describe, expect, it } from "vitest";
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
});
