import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Listing, FeeContext } from "../../shared/companion/types";
import { activePage } from "../../shared/companion/active-auctions";
import { defaultAuctionFilters } from "../../shared/companion/auctions";
import { productionUsage } from "./policy";

const source = JSON.parse(
  readFileSync("tests/fixtures/candy-auctions.json", "utf8"),
) as { observedAt: number; data: { listings: Listing[]; fees: FeeContext } };
for (const stale of [false, true])
  test(`Candy Artifact complete grouped evidence, filters and selection (${stale ? "stale" : "fresh"})`, async ({
    page,
    context,
  }, info) => {
    const now = Date.now(),
      shift = now - source.observedAt - (stale ? 30 * 60000 : 0);
    const all = source.data.listings.map((l) => ({
      ...l,
      start: l.start + shift,
      end: l.end + shift,
      upstreamAt: l.upstreamAt + shift,
      observedAt: l.observedAt + shift,
    }));
    const fees = {
      ...source.data.fees,
      checkedAt: source.data.fees.checkedAt + shift,
    };
    let reads = 0,
      commandId = "";
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            (window as any).copiedCommand = text;
          },
        },
      }),
    );
    const network: string[] = [],
      errors: string[] = [];
    context.on("request", (r) => {
      if (/hypixel|mojang/.test(r.url())) network.push(r.url());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: now });
    await page.addInitScript(
      (f) =>
        localStorage.setItem(
          "bazaarsignal:filters:auctions",
          JSON.stringify(f),
        ),
      {
        ...defaultAuctionFilters,
        budget: 2e10,
        minProfit: -1e12,
        minRoi: -1e9,
        minComps: 0,
        confidence: "insufficient",
        maxAgeMinutes: 1e6,
      },
    );
    await context.route("**/api/companion/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/command")) {
        commandId = url.pathname.split("/").at(-2)!;
        return route.fulfill({
          json: {
            command: "/ah SelectedSeller",
            seller: "SelectedSeller",
            usage: productionUsage(),
          },
        });
      }
      reads++;
      return route.fulfill({
        json: {
          ...activePage(
            all,
            JSON.parse(url.searchParams.get("filters") ?? "{}"),
            Number(url.searchParams.get("page") ?? 0),
            now,
            fees,
          ),
          version: "candy",
          usage: productionUsage(),
          health: {
            activeUpstreamAt: all[0].upstreamAt,
            listingCount: 49,
            error: null,
          },
        },
      });
    });
    await page.goto("/#market=auctions");
    const card = page.getByRole("article", {
      name: "Candy Artifact opportunity",
    });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("49 matching listings");
    await expect(card.getByText("1,300,000", { exact: true })).toBeVisible();
    await expect(card).toContainText("63,650");
    await expect(card).toContainText("+5.2%");
    await expect(page.locator(".opportunities-heading")).toContainText(
      "1 unique item",
    );
    await expect(card.getByText("View details")).toHaveCount(0);
    await card.getByRole("button", { name: "Inspect Candy Artifact" }).focus();
    await page.keyboard.press("Enter");
    const inspector =
      info.project.name === "mobile"
        ? page.getByRole("dialog")
        : page.getByRole("complementary", { name: "Item details" });
    const rows = inspector.locator(".auction-listing-row");
    await expect(rows).toHaveCount(49);
    const ids = await rows.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-listing-id")),
    );
    expect(new Set(ids).size).toBe(49);
    expect([...ids].sort()).toEqual(all.map((l) => l.id).sort());
    const readsBeforeSelection = reads;
    await inspector
      .getByText(
        stale
          ? "Comparable listings in snapshot"
          : "Comparable active listings",
        { exact: true },
      )
      .click();
    await expect(inspector.locator("tbody tr")).toHaveCount(43);
    await expect(inspector.locator("tbody")).toContainText("15,432,000,000");
    await expect(inspector.locator("tbody")).toContainText("Upper outlier");
    await expect(inspector).toContainText("42 matching listings");
    await expect(inspector).toContainText("Low confidence");
    await expect(inspector).toContainText("1 upper-price outlier(s) excluded");
    await inspector.getByLabel("Sort matching auctions").selectOption("desc");
    await expect(rows.first()).toContainText("15,432,000,000");
    await rows
      .first()
      .getByRole("button", { name: /Select auction/ })
      .click();
    await expect(inspector.locator(".price-comparison")).toContainText(
      "1,210,000",
    );
    if (!stale) {
      await inspector
        .getByRole("button", {
          name: "Copy seller command for selected Candy Artifact",
        })
        .click();
      await expect
        .poll(() => page.evaluate(() => (window as any).copiedCommand))
        .toBe("/ah SelectedSeller");
      expect(commandId).toBe("9200d22a4a534a9996b877ad6234f9ae");
    }
    const legendary = all.find((l) => l.variant.rarity === "LEGENDARY")!;
    await inspector
      .getByRole("button", {
        name: `Select auction ${legendary.id}`,
        exact: true,
      })
      .click();
    await expect(inspector.locator(".inspector-item")).toContainText(
      "Legendary",
    );
    await expect(inspector).toContainText("No other valid exact-configuration");
    expect(reads).toBe(readsBeforeSelection);
    await inspector.getByLabel("Sort matching auctions").selectOption("asc");
    await rows
      .first()
      .getByRole("button", { name: /Select auction/ })
      .click();
    await inspector
      .getByRole("button", { name: `Save auction ${all[0].id}`, exact: true })
      .click();
    await expect(
      rows.first().getByRole("button", { name: /Select auction/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await inspector.evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({
      path: `.local/grouped-auctions/candy-${stale ? "stale" : "fresh"}-${info.project.name}.png`,
      fullPage: true,
    });
    if (info.project.name === "mobile")
      await page.getByRole("button", { name: "Close item details" }).click();
    await page
      .getByLabel("Maximum purchase price", { exact: true })
      .fill("1300000");
    await page.clock.runFor(500);
    await expect(card).toContainText("2 matching listings");
    await card.getByRole("button", { name: "Inspect Candy Artifact" }).click();
    await expect(rows).toHaveCount(2);
    await expect(inspector).toContainText("42 matching listings");
    if (stale)
      await expect(
        inspector.getByRole("button", {
          name: "Copy seller command for selected Candy Artifact",
        }),
      ).toHaveCount(0);
    if (info.project.name === "mobile")
      await page.getByRole("button", { name: "Close item details" }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(network).toEqual([]);
    expect(errors).toEqual([]);
  });

test("unique item pagination, support ranking, sparse comparisons and filters spanning pages", async ({
  page,
  context,
}, info) => {
  const now = Date.now(),
    base = source.data.listings[0];
  const make = (itemId: string, prices: number[], sameSeller = false) =>
    prices.map((price, i) => ({
      ...base,
      id: `${itemId}-${i}`,
      price,
      seller: sameSeller ? "one-seller" : `${itemId}-seller-${i}`,
      start: now - 10000,
      end: now + 3600000,
      observedAt: now,
      upstreamAt: now,
      variant: { ...base.variant, itemId, name: itemId, fingerprint: itemId },
    }));
  const all = [
    ...make("SUPPORTED", [1e6, 1.1e6, 1.11e6, 1.12e6, 1.13e6]),
    ...make("SPARSE", [1e6, 5e6]),
    ...make("CONCENTRATED", [1e6, 5e6, 5.1e6, 5.2e6], true),
    ...make("DISPERSED", [1e6, 5e6, 10e6, 15e6, 20e6]),
    ...Array.from({ length: 5 }, (_, i) => make(`SINGLE_${i}`, [1e6])).flat(),
  ];
  await context.route("**/api/companion/**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: {
        ...activePage(
          all,
          JSON.parse(url.searchParams.get("filters") ?? "{}"),
          Number(url.searchParams.get("page") ?? 0),
          now,
          { ...source.data.fees, checkedAt: now },
        ),
        version: "groups",
        usage: productionUsage(),
        health: {
          activeUpstreamAt: now,
          listingCount: all.length,
          error: null,
        },
      },
    });
  });
  await page.goto("/#market=auctions");
  await expect(page.locator(".market-card").first()).toContainText("SUPPORTED");
  await expect(page.locator(".opportunities-heading")).toContainText(
    "9 unique items",
  );
  const firstPage = await page.locator(".market-card h3").allTextContents();
  await page.getByRole("button", { name: "Next results" }).click();
  await expect(page.locator(".market-card")).toHaveCount(3);
  const secondPage = await page.locator(".market-card h3").allTextContents();
  expect(new Set([...firstPage, ...secondPage]).size).toBe(9);
  const search = page.getByRole("searchbox", { name: "Search auction items" });
  await search.fill("SPARSE");
  await expect(page.locator(".market-card")).toHaveCount(1);
  await expect(page.locator(".market-card")).toContainText("Low confidence");
  await search.fill("SINGLE_4");
  const card = page.locator(".market-card");
  await expect(card).toContainText("Resale estimate unavailable");
  await card.getByRole("button", { name: "Inspect SINGLE_4" }).click();
  const inspector =
    info.project.name === "mobile"
      ? page.getByRole("dialog")
      : page.getByRole("complementary", { name: "Item details" });
  await expect(inspector.locator(".auction-listing-row")).toHaveCount(1);
  await expect(inspector).toContainText("No other valid exact-configuration");
});
