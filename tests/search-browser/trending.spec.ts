import { expect, test } from "@playwright/test";

test("public Trending ranks sell offers by default and switches periods with the same response", async ({ page }) => {
  let loads = 0;
  // Match this suite's configured October market release.
  const at = Date.parse("2026-10-30T18:02:00Z");
  await page.clock.install({ time: at });
  await page.route("https://**", route => route.abort());
  const row = { id: "SUMMONING_EYE", name: "Summoning Eye", offerBefore: 1200000, offer: 1500000,
    offerChange: 25, bidChange: -0.52, buyActivity7d: 105000, sellActivity7d: 73000 };
  const rows = [row, ...Array.from({length: 6}, (_, i) => ({ ...row, id: `ITEM_${i}`, name: `Item ${i}` }))];
  await page.route("**/api/companion/flips", route => route.fulfill({json: {
    board: {version:3, at, throughDay: 20750, changedItems: [], periods: {7: [], 30: [], 90: []}},
  }}));
  await page.route("**/api/companion/trending", route => {
    loads++;
    return route.fulfill({ json: { board: { version: 2, at, items: 2207, windows: [
      { hours: 1, baselineAt: at - 3600000, gainers: rows.length, rows },
      { hours: 6, baselineAt: at - 21600000, gainers: 0, rows: [] },
      { hours: 24, baselineAt: null, gainers: 0, rows: [] },
    ] } } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Trending", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trending" })).toBeVisible();
  await expect(page.getByRole("button", { name: "1h", exact: true })).toHaveAttribute("aria-pressed", "true");
  const grid = page.getByRole("list", { name: "1h sell offer gainers" });
  await expect(grid.getByRole("listitem")).toHaveCount(6);
  await expect(grid).toContainText("+25%");
  await expect(grid).toContainText("-0.52%");
  await expect(grid).toContainText("105,000 / 73,000");
  await expect(grid.getByRole("link", { name: "Summoning Eye" })).toHaveAttribute("href", "#view=item&item=SUMMONING_EYE");
  await page.getByRole("button", { name: "Show all 7" }).click();
  await expect(grid.getByRole("listitem")).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "6h", exact: true }).click();
  await expect(page.getByText("No gainers met the liquidity criteria for this period.")).toBeVisible();
  await page.getByRole("button", { name: "24h", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("24 hours earlier");
  expect(loads).toBe(1);
  await expect(page.getByRole("heading", { name: "Flip finder" })).toBeVisible();
});
