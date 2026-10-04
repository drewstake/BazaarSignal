import { describe, expect, it } from "vitest";
import {
  holdingCatalogItem,
  searchHoldingItems,
} from "../src/companion/holding-catalog";

describe("unified holding search", () => {
  it("finds both markets by name and ID without a market choice", () => {
    expect(searchHoldingItems("booster cookie")[0]).toMatchObject({
      id: "BOOSTER_COOKIE",
      kind: "bazaar",
    });
    expect(searchHoldingItems("NECRON_HANDLE")[0]).toMatchObject({
      id: "NECRON_HANDLE",
      kind: "auction",
    });
    expect(searchHoldingItems("necron’s handle")[0].id).toBe("NECRON_HANDLE");
    expect(searchHoldingItems("necron handle")[0].id).toBe("NECRON_HANDLE");
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
