import { expect, test } from "@playwright/test";

const now = Date.parse("2026-10-14T15:03:00Z");
const usage = {
  mode: "normal",
  pollMs: 3_600_000,
  trialId: "search-browser",
  expiresAt: Date.parse("2026-11-01T07:00:00Z"),
};
const cookie = (stamp = now) => ({
  id: "BOOSTER_COOKIE",
  upstreamAt: stamp,
  observedAt: stamp,
  asks: [{ pricePerUnit: 14_000_000.5, amount: 7, orders: 2 }],
  bids: [{ pricePerUnit: 13_000_000, amount: 13, orders: 4 }],
});
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: now });
  await page.route("https://**", (route) => route.abort());
  await page.route("**/api/price-history?*", (route) =>
    route.fulfill({
      json: {
        version: 1,
        timezone: "EST",
        item: new URL(route.request().url()).searchParams.get("item"),
        points: [],
        collector: { enabled: false, lastSuccess: null, lastError: null },
      },
    }),
  );
});

test("item price history preserves real snapshots across reloads and explores periods without extra reads", async ({
  page,
}, info) => {
  let requests = 0;
  await page.route("**/api/companion/**", (route) => {
    requests++;
    return route.fulfill({ json: { usage, bazaar: [cookie()] } });
  });
  await page.goto("/");
  await page.evaluate(
    ({ now }) => {
      const source = `${location.origin}/live-market/api/companion/bazaar`;
      const key = `bazaarsignal-item-prices-v1:${encodeURIComponent(source)}:BOOSTER_COOKIE`;
      const points = Array.from({ length: 30 }, (_, index) => ({
        at: now - (30 - index) * 3_600_000,
        buy: 13_850_000 + Math.sin(index / 3) * 125_000 + index * 3000,
        sell:
          index === 20
            ? null
            : 12_800_000 + Math.cos(index / 3) * 150_000 + index * 2500,
      }));
      localStorage.setItem(key, JSON.stringify({ version: 1, points }));
    },
    { now },
  );
  const search = page.getByRole("combobox", { name: "Search Bazaar items" });
  await search.fill("BOOSTER_COOKIE");
  await search.press("ArrowDown");
  await search.press("Enter");
  await page
    .getByRole("button", { name: "Device observations", exact: true })
    .click();
  const chart = page.getByRole("region", {
    name: "Price history",
    exact: true,
  });
  await expect(chart.getByRole("img")).toHaveAttribute(
    "aria-label",
    /24 saved snapshots/,
  );
  await expect(chart).toContainText("14,000,000.5 coins");
  await expect(chart).toContainText("History on this device");
  const explorer = chart.getByRole("slider", {
    name: "Explore item price history",
  });
  await explorer.focus();
  await explorer.press("Home");
  await expect(explorer).toHaveValue("0");
  await expect(explorer).toHaveAttribute("aria-valuetext", /Oct 13/);
  await explorer.press("End");
  await expect(explorer).toHaveAttribute(
    "aria-valuetext",
    /Instant buy: 14,000,000.5 coins/,
  );
  await chart.getByRole("button", { name: "1W", exact: true }).click();
  await expect(chart.getByRole("img")).toHaveAttribute(
    "aria-label",
    /31 saved snapshots/,
  );
  await expect(
    chart.getByRole("button", { name: "1W", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await chart.getByRole("button", { name: "1M", exact: true }).click();
  await chart.getByRole("button", { name: "All", exact: true }).click();
  const plot = chart.locator(".item-chart-plot");
  const bounds = (await plot.boundingBox())!;
  const position = { x: bounds.width * 0.016, y: 50 };
  if (info.project.name === "mobile") await plot.tap({ position });
  else await plot.click({ position });
  await expect(explorer).toHaveValue("0");
  expect(requests).toBe(1);
  const savedHistory = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("bazaarsignal-item-prices-v1:"),
    );
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  });
  expect(savedHistory.version).toBe(2);
  expect(savedHistory.points).toHaveLength(31);
  expect(savedHistory.points.at(-1)).toEqual([now, 14_000_000.5, 13_000_000]);
  await page.screenshot({
    path: `.local/item-price-history-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await page
    .getByRole("button", { name: "Device observations", exact: true })
    .click();
  await chart.getByRole("button", { name: "All", exact: true }).click();
  await expect(chart.getByRole("img")).toHaveAttribute(
    "aria-label",
    /31 saved snapshots/,
  );
  expect(requests).toBe(1);
  await search.fill("ENCHANTED_DIAMOND_BLOCK");
  await search.press("ArrowDown");
  await search.press("Enter");
  await page
    .getByRole("button", { name: "Device observations", exact: true })
    .click();
  await expect(chart).toContainText(
    "Price history starts with the first available price snapshot.",
  );
  await expect(chart.getByRole("img")).toHaveCount(0);
  expect(requests).toBe(2);
});

test("a first price point stays a single point until a new hourly sample arrives", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/companion/**", async (route) => {
    requests++;
    const stamp = await page.evaluate(() => Date.now());
    const item = cookie(stamp);
    if (requests > 1) item.asks = [];
    return route.fulfill({ json: { usage, bazaar: [item] } });
  });
  await page.goto("/#view=item&item=BOOSTER_COOKIE");
  await page
    .getByRole("button", { name: "Device observations", exact: true })
    .click();
  const chart = page.getByRole("region", {
    name: "Price history",
    exact: true,
  });
  await expect(chart.getByRole("img")).toHaveAttribute(
    "aria-label",
    /1 saved snapshot\./,
  );
  await expect(chart).toContainText("First price point.");
  await page.reload();
  await page
    .getByRole("button", { name: "Device observations", exact: true })
    .click();
  await expect(chart.getByRole("img")).toHaveAttribute(
    "aria-label",
    /1 saved snapshot\./,
  );
  expect(requests).toBe(1);
  await page.clock.fastForward(3_600_000);
  await expect(chart.getByRole("img")).toHaveAttribute(
    "aria-label",
    /2 saved snapshots/,
  );
  await expect(
    chart.locator(".item-chart-readout .item-chart-buy"),
  ).toContainText("Unavailable");
  await expect(
    chart.locator(".item-chart-readout .item-chart-sell"),
  ).toContainText("13,000,000 coins");
  expect(requests).toBe(2);
});

test("unavailable storage and demo prices never prevent the chart or book from rendering", async ({
  page,
}) => {
  let requests = 0;
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage blocked", "QuotaExceededError");
    };
  });
  await page.route("**/api/companion/**", (route) => {
    requests++;
    return route.fulfill({ json: { usage, bazaar: [cookie()] } });
  });
  await page.goto("/#view=item&item=BOOSTER_COOKIE");
  await page
    .getByRole("button", { name: "Device observations", exact: true })
    .click();
  const chart = page.getByRole("region", {
    name: "Price history",
    exact: true,
  });
  await expect(chart).toContainText(
    "Storage unavailable · History until you leave this item",
  );
  await expect(chart.getByRole("img")).toHaveAttribute(
    "aria-label",
    /1 saved snapshot\./,
  );
  await expect(page.getByRole("table", { name: "Sell offers" })).toBeVisible();
  await page.goto("/?fixtures=1#view=item&item=BOOSTER_COOKIE");
  await expect(chart).toContainText("Demo snapshot · Not saved");
  expect(requests).toBe(1);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith("bazaarsignal-item-prices-v1:"),
      ),
    ),
  ).toEqual([]);
});
