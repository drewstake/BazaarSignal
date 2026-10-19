import { expect, test } from "@playwright/test";
import {
  historyDay,
  historyDayStart,
  historyDayLabel,
} from "../../shared/daily-price-history";

const now = Date.parse("2026-10-14T15:03:00Z");
const day = historyDay(now) - 1;
test("daily import connects recorded prices across gaps without adding samples and keeps the book below", async ({
  page,
}, info) => {
  await page.clock.install({ time: now });
  await page.route("https://**", (route) => route.abort());
  let marketRequests = 0,
    historyRequests = 0;
  await page.route("**/api/companion/**", (route) => {
    marketRequests++;
    return route.fulfill({
      json: {
        usage: {
          mode: "normal",
          pollMs: 3_600_000,
          trialId: "search-browser",
          expiresAt: Date.parse("2026-11-01T07:00:00Z"),
        },
        bazaar: [
          {
            id: "BOOSTER_COOKIE",
            upstreamAt: now,
            observedAt: now,
            asks: [{ pricePerUnit: 14_000_000, amount: 10, orders: 2 }],
            bids: [{ pricePerUnit: 13_000_000, amount: 10, orders: 2 }],
          },
        ],
      },
    });
  });
  await page.route("**/api/price-history?*", (route) => {
    historyRequests++;
    const item = new URL(route.request().url()).searchParams.get("item");
    return route.fulfill({
      json: {
        version: 1,
        item,
        timezone: "EST",
        points:
          item === "BOOSTER_COOKIE"
            ? [
                [
                  day - 400,
                  historyDayStart(day - 400) + 20 * 3_600_000,
                  10_000_000,
                  9_000_000,
                  "bazaar-calc",
                ],
                [
                  day - 3,
                  historyDayStart(day - 3) + 23 * 3_600_000,
                  12_000_000,
                  11_000_000,
                  "skytrack",
                ],
                [
                  day - 2,
                  historyDayStart(day - 2) + 23 * 3_600_000,
                  13_000_000,
                  null,
                  "skytrack",
                ],
                [
                  day,
                  historyDayStart(day) + 86_340_000,
                  14_000_000.5,
                  13_000_000,
                  "bazaarsignal",
                ],
              ]
            : [],
        collector: {
          enabled: true,
          location: "cloud",
          expiresAt: Date.parse("2026-11-01T07:00:00Z"),
          lastSuccess: { at: now, items: 2201 },
          lastError: null,
        },
      },
    });
  });
  await page.goto("/#view=item&item=BOOSTER_COOKIE");
  const chart = page.getByRole("region", {
    name: "Price history",
    exact: true,
  });
  await expect(chart.getByRole("img")).toHaveAttribute(
    "aria-label",
    /3 recorded days/,
  );
  await expect(
    chart.getByRole("button", { name: "1Y", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(chart).toContainText("14,000,000.5 coins");
  await expect(chart.locator(".item-chart-notes")).toHaveCount(0);
  const paths = chart.locator(".item-chart-plot svg path");
  expect((await paths.nth(0).getAttribute("d"))?.match(/[ML]/g)).toEqual([
    "M",
    "L",
    "L",
  ]);
  expect((await paths.nth(1).getAttribute("d"))?.match(/[ML]/g)).toEqual([
    "M",
    "L",
  ]);
  await chart.getByRole("button", { name: "All", exact: true }).click();
  await expect(chart.getByRole("img")).toHaveAttribute(
    "aria-label",
    /4 recorded days/,
  );
  expect((await paths.nth(0).getAttribute("d"))?.match(/[ML]/g)).toEqual(["M", "L", "L", "L"]);
  expect((await paths.nth(1).getAttribute("d"))?.match(/[ML]/g)).toEqual(["M", "L", "L"]);
  // One marker per actual available price; no dots are synthesized in gaps.
  expect((await paths.nth(2).getAttribute("d"))?.match(/M/g)).toHaveLength(4);
  expect((await paths.nth(3).getAttribute("d"))?.match(/M/g)).toHaveLength(3);
  const explorer = chart.getByRole("slider", {
    name: "Explore item price history",
  });
  await explorer.focus();
  await explorer.press("Home");
  await expect(explorer).toHaveAttribute(
    "aria-valuetext",
    new RegExp(`${historyDayLabel(day - 400)} · Bazaar Calc`),
  );
  await explorer.press("End");
  await expect(explorer).toHaveAttribute("aria-valuetext", /BazaarSignal/);
  await explorer.press("ArrowLeft");
  await expect(explorer).toHaveAttribute("aria-valuetext", /Instant sell: unavailable/);
  await chart.getByRole("button", { name: "1M", exact: true }).click();
  const bounds = (await chart.locator(".item-chart-plot").boundingBox())!;
  if (info.project.name === "mobile")
    await chart
      .locator(".item-chart-plot")
      .tap({ position: { x: bounds.width * 0.8, y: 30 } });
  else await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + 30);
  expect(historyRequests).toBe(1);
  expect(marketRequests).toBe(1);
  const chartBounds = (await chart.boundingBox())!,
    book = (await page
      .getByRole("table", { name: "Sell offers" })
      .boundingBox())!;
  expect(book.y).toBeGreaterThan(chartBounds.y + chartBounds.height);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `.local/daily-price-history-${info.project.name}.png`,
    fullPage: true,
  });
  const search = page.getByRole("combobox", { name: "Search Bazaar items" });
  await search.fill("ENCHANTED_DIAMOND_BLOCK");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(chart).toContainText(
    "No completed daily prices recorded for this item yet.",
  );
  await expect(chart.getByRole("img")).toHaveCount(0);
  expect(historyRequests).toBe(2);
});

test("unavailable daily archive leaves device observations and order book usable", async ({
  page,
}) => {
  await page.clock.install({ time: now });
  await page.route("https://**", (route) => route.abort());
  await page.route("**/api/price-history?*", (route) =>
    route.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await page.route("**/api/companion/**", (route) =>
    route.fulfill({
      json: {
        usage: {
          mode: "normal",
          pollMs: 3_600_000,
          trialId: "search-browser",
          expiresAt: Date.parse("2026-11-01T07:00:00Z"),
        },
        bazaar: [
          {
            id: "BOOSTER_COOKIE",
            upstreamAt: now,
            observedAt: now,
            asks: [{ pricePerUnit: 14_000_000, amount: 10, orders: 2 }],
            bids: [{ pricePerUnit: 13_000_000, amount: 10, orders: 2 }],
          },
        ],
      },
    }),
  );
  await page.goto("/#view=item&item=BOOSTER_COOKIE");
  const chart = page.getByRole("region", {
    name: "Price history",
    exact: true,
  });
  await expect(chart).toContainText("Daily archive unavailable");
  await expect(page.getByRole("table", { name: "Sell offers" })).toBeVisible();
  await chart.getByRole("button", { name: "Device observations" }).click();
  await expect(chart.getByRole("img")).toHaveAttribute(
    "aria-label",
    /1 saved snapshot/,
  );
});
