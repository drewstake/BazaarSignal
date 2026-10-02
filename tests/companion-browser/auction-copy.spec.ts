import { test, expect } from "@playwright/test";
import { auctionFixtures } from "../../src/companion/fixtures";
import { defaultAuctionFilters } from "../../shared/companion/auctions";

test("auction actions copy the seller command directly and expose a manual fallback", async ({
  page,
}) => {
  let unavailable = false;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if ((window as any).denyCopy) throw new Error("Clipboard denied");
          (window as any).copiedText = text;
        },
      },
    });
  });
  await page.route("**/api/companion/bazaar", (route) =>
    route.fulfill({ json: { items: [], error: null } }),
  );
  await page.route(/\/api\/companion\/auctions\?/, (route) => {
    const result = auctionFixtures(defaultAuctionFilters, 0);
    result.items.forEach(item => { item.listing.sellerName = "Sky_Player7"; });
    return route.fulfill({ json: result });
  });
  await page.route("**/api/companion/auctions/*/command", (route) =>
    route.fulfill(
      unavailable
        ? {
            status: 503,
            json: {
              error:
                "Listing sold. Refresh auctions and choose another listing.",
            },
          }
        : { json: { command: "/ah Sky_Player7", seller: "Sky_Player7" } },
    ),
  );
  await page.goto("/#market=auctions");
  const card = page.getByRole("article", { name: "Livid Dagger opportunity" });
  const copy = card.getByRole("button", {
    name: "Copy seller command for Livid Dagger",
  });
  await expect(copy).toHaveText(/\/ah Sky_Player7/);
  await copy.click();
  await expect(page.getByRole("status")).toContainText("Copied /ah Sky_Player7");
  await expect(copy).toHaveText(/\/ah Sky_Player7/);
  expect(await page.evaluate(() => (window as any).copiedText)).toBe(
    "/ah Sky_Player7",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "Copied /ah Sky_Player7",
  );
  await page.evaluate(() => {
    (window as any).denyCopy = true;
    (window as any).copiedText = null;
  });
  await copy.click();
  await expect(page.getByRole("status")).toContainText(
    "Clipboard unavailable. Copy manually: /ah Sky_Player7",
  );
  expect(await page.evaluate(() => (window as any).copiedText)).toBeNull();
  unavailable = true;
  await copy.click();
  await expect(page.getByRole("status")).toContainText("Listing sold");
  await expect(copy).not.toHaveText(/Copied!/);
  unavailable = false;
  await page.evaluate(() => {
    (window as any).denyCopy = false;
  });
  await copy.click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedText)).toBe("/ah Sky_Player7");
});
