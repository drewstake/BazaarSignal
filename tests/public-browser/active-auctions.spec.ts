import { test, expect } from "@playwright/test";
import { normalizeListing } from "../../collector/normalize";
import { activePage } from "../../shared/companion/active-auctions";
import { defaultAuctionFilters } from "../../shared/companion/auctions";
import { auctionFees } from "../../shared/companion/fees";
import { gzipSync } from "node:zlib";
import { productionUsage } from "./policy";
import { nextMarketRead } from "../../shared/market-schedule";
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
for (const scenario of ["fresh", "sampled", "unavailable"])
  test(`production shared cache ${scenario === "unavailable" ? "shows an unavailable cache" : scenario === "sampled" ? "shows hourly sampled comparisons with stale commands disabled" : "groups active asks with conservative comparisons and copies seller command"}`, async ({
    page,
    context,
  }, info) => {
    await page.clock.install();
    const now = Date.now(),
      sampledAt = now - (scenario === "sampled" ? 30 * 60000 : 0),
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
      checkedAt: sampledAt,
      explanation: "Standard",
    };
    const usage = productionUsage();
    const listings = [1000000, 2000000, 4000000].map((price, i) => ({
      ...normalizeListing(
        {
          uuid: (i + 1).toString(16).padStart(32, "0"),
          auctioneer: seller,
          bin: true,
          starting_bid: price,
          start: sampledAt - 10000,
          end: now + 3600000,
          item_bytes: nbtItem(),
        },
        sampledAt,
        sampledAt,
        { TEST_SWORD: { name: "Test Sword", tier: "RARE", category: "SWORD" } },
      )!,
      sellerName: "TestSeller",
    }));
    await context.route("**/api/companion/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/bazaar"))
        return route.fulfill({ json: { items: [], error: null, usage } });
      if (url.pathname.endsWith("/command"))
        return route.fulfill({
          json: { command: "/ah TestSeller", seller: "TestSeller", usage },
        });
      reads++;
      if (scenario === "unavailable" || fail)
        return route.fulfill({
          status: 503,
          json: {
            usage,
            error: "Shared cache unavailable; automatic recovery pending.",
          },
        });
      const filters = JSON.parse(url.searchParams.get("filters") ?? "{}");
      return route.fulfill({
        json: {
          usage,
          ...activePage(
            listings,
            { ...defaultAuctionFilters, ...filters },
            0,
            now,
            fees,
          ),
          version: String(now),
          health: { activeUpstreamAt: sampledAt, listingCount: 3, error: null },
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
    if (scenario === "unavailable") {
      await expect(page.getByText(/Shared cache unavailable/)).toBeVisible();
      await expect(page.locator(".market-card")).toHaveCount(0);
    } else {
      const card = page.locator(".market-card").first();
      await expect(
        card.getByText("Conservative resale estimate", { exact: true }),
      ).toBeVisible();
      await expect(card.getByText("2,000,000", { exact: true })).toBeVisible();
      const expectedGap = Math.round(
        1000000 - auctionFees(2000000, 24, 1).total,
      ).toLocaleString("en-US");
      await expect(card.locator(".profit-line .coin-value")).toContainText(
        expectedGap,
      );
      if (scenario === "sampled") {
        await expect(
          card.getByText("Sampled after-fee gap", { exact: true }),
        ).toBeVisible();
        await expect(card.locator('.card-art')).toHaveText('');
        await expect(card.getByText(/1 matching listings/)).toBeVisible();
        await expect(
          card.getByRole("button", {
            name: "Copy seller command for Test Sword",
          }),
        ).toHaveCount(0);
      } else {
        await expect(card.getByText(/1 matching listings/)).toBeVisible();
        await card
          .getByRole("button", { name: "Copy seller command for Test Sword" })
          .click();
        await expect
          .poll(() => page.evaluate(() => (window as any).copiedCommand))
          .toBe("/ah TestSeller");
      }
      await expect(card.getByText("View details", { exact: true })).toHaveCount(
        0,
      );
      await card.click();
      const inspector =
        info.project.name === "mobile"
          ? page.getByRole("dialog")
          : page.getByRole("complementary", { name: "Item details" });
      await expect(
        inspector
          .getByText("Arithmetic AH average (context only)", { exact: true })
          .last(),
      ).toBeVisible();
      await inspector
        .getByText(
          scenario === "sampled"
            ? "Comparable listings in snapshot"
            : "Comparable active listings",
          { exact: true },
        )
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
        path: `.local/previews/shared-cache-${scenario}-${info.project.name}.png`,
        fullPage: true,
      });
      // Repeated reads do not replace unchanged cards. A failed read retains them;
      // crossing the freshness deadline keeps labeled snapshot comparisons,
      // while seller commands remain unavailable.
      fail = true;
      await page.clock.fastForward(
        nextMarketRead(Date.now(), usage.pollMs) - Date.now() + 5000,
      );
      await expect(page.getByText(/Shared cache unavailable/)).toBeVisible();
      await expect(card).toBeVisible();
      await page.clock.fastForward(180000);
      await expect(page.locator(".automatic-status")).toContainText("Snapshot asking-price comparisons");
      await expect(card.getByText("2,000,000", { exact: true })).toBeVisible();
      await expect(card.locator(".profit-line .coin-value")).toContainText(
        expectedGap,
      );
      await expect(card.getByText(/sample|Sample/).first()).toBeVisible();
      await expect(
        card.getByRole("button", {
          name: "Copy seller command for Test Sword",
        }),
      ).toHaveCount(0);
      await page.screenshot({
        path: `.local/previews/shared-cache-stale-${info.project.name}.png`,
        fullPage: true,
      });
      expect(reads).toBeGreaterThan(1);
    }
    expect(upstreamRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
