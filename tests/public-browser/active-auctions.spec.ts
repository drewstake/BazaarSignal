import { test, expect } from "@playwright/test";
import { normalizeListing } from "../../collector/normalize";
import { activePage } from "../../shared/companion/active-auctions";
import { defaultAuctionFilters } from "../../shared/companion/auctions";
import { gzipSync } from "node:zlib";
function nbtItem() {
  const text = (s: string) => {
    const b = Buffer.from(s),
      n = Buffer.alloc(2);
    n.writeUInt16BE(b.length);
    return Buffer.concat([n, b]);
  };
  const field = (type: number, name: string, value: Buffer) =>
    Buffer.concat([Buffer.from([type]), text(name), value]);
  const compound = (...parts: Buffer[]) =>
    Buffer.concat([...parts, Buffer.from([0])]);
  const item = compound(
    field(1, "Count", Buffer.from([1])),
    field(
      10,
      "tag",
      compound(
        field(
          10,
          "ExtraAttributes",
          compound(field(8, "id", text("TEST_SWORD"))),
        ),
      ),
    ),
  );
  return gzipSync(
    Buffer.concat([
      Buffer.from([10]),
      text(""),
      compound(
        field(9, "i", Buffer.concat([Buffer.from([10, 0, 0, 0, 1]), item])),
      ),
    ]),
  ).toString("base64");
}
for (const unavailable of [false, true])
  test(`production shared cache ${unavailable ? "shows an unavailable cache" : "averages active asks and copies seller command"}`, async ({
    page,
    context,
  }, info) => {
    const now = Date.now(),
      seller = "a".repeat(32),
      upstreamRequests: string[] = [],
      errors: string[] = [];
    let fail = false,
      reads = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    context.on("request", (r) => {
      if (r.url().includes("api.hypixel.net")) upstreamRequests.push(r.url());
    });
    await context.route("https://api.hypixel.net/**", (r) => r.abort());
    const fees = {
      mayor: "Normal",
      multiplier: 1,
      checkedAt: now,
      explanation: "Standard",
    };
    const listings = [1000000, 2000000, 4000000].map((price, i) => ({
      ...normalizeListing(
        {
          uuid: (i + 1).toString(16).padStart(32, "0"),
          auctioneer: seller,
          bin: true,
          starting_bid: price,
          start: now - 10000,
          end: now + 3600000,
          item_bytes: nbtItem(),
        },
        now,
        now,
        { TEST_SWORD: { name: "Test Sword", tier: "RARE", category: "SWORD" } },
      )!,
      sellerName: "TestSeller",
    }));
    await context.route("**/api/companion/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/bazaar"))
        return route.fulfill({ json: { items: [], error: null } });
      if (url.pathname.endsWith("/command"))
        return route.fulfill({
          json: { command: "/ah TestSeller", seller: "TestSeller" },
        });
      reads++;
      if (unavailable || fail)
        return route.fulfill({
          status: 503,
          json: {
            error: "Shared cache unavailable; automatic recovery pending.",
          },
        });
      const filters = JSON.parse(url.searchParams.get("filters") ?? "{}");
      return route.fulfill({
        json: {
          ...activePage(
            listings,
            { ...defaultAuctionFilters, ...filters },
            0,
            now,
            fees,
          ),
          version: String(now),
          health: { activeUpstreamAt: now, listingCount: 3, error: null },
        },
      });
    });
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            (window as any).copiedCommand = text;
          },
        },
      }),
    );
    await page.goto("/#market=auctions");
    await expect(
      page.getByRole("button", { name: "Refresh market" }),
    ).toHaveCount(0);
    if (unavailable) {
      await expect(page.getByText(/Shared cache unavailable/)).toBeVisible();
      await expect(page.locator(".market-card")).toHaveCount(0);
    } else {
      const card = page.locator(".market-card").first();
      await expect(card.getByText("AH average", { exact: true })).toBeVisible();
      await expect(card.getByText("3,000,000", { exact: true })).toBeVisible();
      await expect(card.getByText("2 matching active listings")).toBeVisible();
      await card
        .getByRole("button", { name: "Copy seller command for Test Sword" })
        .click();
      await expect
        .poll(() => page.evaluate(() => (window as any).copiedCommand))
        .toBe("/ah TestSeller");
      await card
        .getByRole("button", { name: "View details for Test Sword" })
        .click();
      const inspector =
        info.project.name === "mobile"
          ? page.getByRole("dialog")
          : page.getByRole("complementary", { name: "Item details" });
      await expect(
        inspector.getByText("Current AH average", { exact: true }),
      ).toBeVisible();
      await inspector
        .getByText("Comparable active listings", { exact: true })
        .click();
      await expect(inspector.getByRole("table")).toBeVisible();
      if (info.project.name === "mobile")
        await page.getByRole("button", { name: "Close item details" }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.local/previews/shared-cache-${info.project.name}.png`,
        fullPage: true,
      });
      // Repeated reads do not replace unchanged cards. A failed read retains them;
      // crossing the freshness deadline strips their comparisons locally.
      await page.clock.install();
      fail = true;
      await page.clock.runFor(6000);
      await expect(page.getByText(/Shared cache unavailable/)).toBeVisible();
      await expect(card).toBeVisible();
      await page.clock.runFor(180000);
      await expect(page.locator(".automatic-status")).toContainText("Stale");
      await expect(card.getByText("3,000,000", { exact: true })).toHaveCount(0);
      await expect(card.getByText("Stale", { exact: true })).toBeVisible();
      await page.screenshot({
        path: `.local/previews/shared-cache-stale-${info.project.name}.png`,
        fullPage: true,
      });
      expect(reads).toBeGreaterThan(1);
    }
    expect(upstreamRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
