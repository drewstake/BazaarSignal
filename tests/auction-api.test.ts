import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultAuctionFilters } from "../shared/companion/auctions";
import { auctionFixtures } from "../src/companion/fixtures";
const request = vi.hoisted(() => vi.fn());
vi.mock("../src/companion/request-cache", () => ({
  cachedMarketRequest: request,
}));
beforeEach(() => {
  vi.stubGlobal("location", { search: "", origin: "https://preview.example" });
  request.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("uses a stable new cache key for grouped conservative results instead of legacy hourly entries", async () => {
  const result = auctionFixtures(defaultAuctionFilters, 0);
  request.mockResolvedValue(result);
  const { getAuctions } = await import("../src/companion/api");
  expect(await getAuctions(defaultAuctionFilters, 0)).toBe(result);
  const url = new URL(request.mock.calls[0][0]);
  expect(url.searchParams.get("format")).toBe("grouped-conservative-v1");
  expect(url.searchParams.has("force")).toBe(false);
  expect(url.searchParams.has("refresh")).toBe(false);
});
it("rejects a legacy server response instead of showing duplicate cards or calling an average conservative", async () => {
  const result = auctionFixtures(defaultAuctionFilters, 0);
  delete result.items[0].group;
  request.mockResolvedValue(result);
  const { getAuctions } = await import("../src/companion/api");
  await expect(getAuctions(defaultAuctionFilters, 0)).rejects.toThrow(
    "older comparison format",
  );
});
it("rejects legacy arithmetic details while accepting current standalone saved-auction details", async () => {
  const result = auctionFixtures(defaultAuctionFilters, 0).items[0];
  const { getAuctionDetail } = await import("../src/companion/api");
  request.mockResolvedValue(result);
  expect(await getAuctionDetail(result.listing.id)).toBe(result);
  delete result.valuation.arithmeticMean;
  await expect(getAuctionDetail(result.listing.id)).rejects.toThrow(
    "Conservative estimate unavailable",
  );
});
