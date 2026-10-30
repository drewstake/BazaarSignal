import { expect, test, type Page } from "@playwright/test";
import { normalizeBazaar } from "../../shared/companion/bazaar";
test.use({ timezoneId: "Asia/Tokyo" });

const now = Date.parse("2026-10-14T15:03:00Z");
const usage = {
  mode: "normal",
  pollMs: 3600000,
  trialId: "search-browser",
  expiresAt: Date.parse("2026-11-01T07:00:00Z"),
};
const cookie = (stamp = now) =>
  normalizeBazaar(
    "BOOSTER_COOKIE",
    {
      buy_summary: [
        { pricePerUnit: 14000000.5, amount: 7, orders: 2 },
        { pricePerUnit: 14000100, amount: 11, orders: 3 },
      ],
      sell_summary: [{ pricePerUnit: 13000000, amount: 13, orders: 4 }],
      quick_status: { buyVolume: 999999, sellVolume: 888888 },
    },
    stamp,
    stamp,
  );
const input = (page: Page) =>
  page.getByRole("combobox", { name: "Search Bazaar items" });

test('simultaneous tabs share a single selected-item GET and retain the cache across tab closure', async ({ page, context }) => {
  let requests = 0;
  await context.route('https://**', route => route.abort());
  await context.route('**/api/companion/**', async route => {
    requests++;
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.fulfill({ json: { bazaar: [cookie()], usage } });
  });
  const other = await context.newPage();
  await other.clock.install({ time: now });
  await Promise.all([page.goto('/#view=item&item=BOOSTER_COOKIE'), other.goto('/#view=item&item=BOOSTER_COOKIE')]);
  for (const tab of [page, other]) await expect(tab.getByRole('region', { name: 'Booster Cookie' })).toContainText('14,000,000.5 coins');
  expect(requests).toBe(1);
  await other.close();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Booster Cookie' })).toContainText('14,000,000.5 coins');
  expect(requests).toBe(1);
});

test('a failed collection is labeled stale even when the returned sample is recent', async ({ page }) => {
  await page.route('**/api/companion/**', route => route.fulfill({ json: { bazaar: [cookie()], usage, error: 'Collection failed; saved snapshot retained.' } }));
  await page.goto('/#view=item&item=BOOSTER_COOKIE');
  const panel = page.getByRole('region', { name: 'Booster Cookie' });
  await expect(panel).toContainText('Stale data');
  await expect(panel).toContainText('Collection failed; saved snapshot retained.');
  await expect(panel).toContainText('14,000,000.5 coins');
  await expect(panel.locator('time')).toHaveAttribute('datetime', new Date(now).toISOString());
});

test('malformed persistent cache entries recover through one selected read', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/companion/**', route => {
    requests++;
    return route.fulfill({ json: { bazaar: [cookie()], usage } });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const cache = await caches.open('bazaarsignal-public-market-v1');
    await cache.put(location.origin + '/live-market/api/companion/portfolio-prices?assets=bz_BOOSTER_COOKIE', Response.json(null));
  });
  await select(page);
  await expect(page.getByRole('region', { name: 'Booster Cookie' })).toContainText('14,000,000.5 coins');
  expect(requests).toBe(1);
});
async function select(page: Page, query = "BOOSTER_COOKIE") {
  await input(page).fill(query);
  await input(page).press("ArrowDown");
  await input(page).press("Enter");
}
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: now });
  await page.route("https://**", (r) => r.abort());
});

test("public preview explains unavailable sign-in without making a request", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/companion/**", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Google sign-in is unavailable in this preview. Start the local workspace with npm run dev:local.",
  );
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeEnabled();
  expect(requests).toEqual([]);
});

test("unused API entries cannot be selected and filtering adds no market requests", async ({ page }, info) => {
  const requests: string[] = [];
  await page.route("**/api/companion/**", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/");
  for (const query of ["Bazaar Cookie", "BAZAAR_COOKIE", "ENCHANTMENT_AIMING_1", "ENCHANTMENT_FEATHER_FALLING_20"]) {
    await input(page).fill(query);
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(page.getByText("No matching Bazaar items. Try another name or item ID.")).toBeVisible();
    await input(page).press("ArrowDown");
    await input(page).press("Enter");
    await expect(page.getByRole("button", { name: "Close item details" })).toHaveCount(0);
    await input(page).press("Escape");
    await expect(input(page)).toHaveAttribute("aria-expanded", "false");
  }
  await input(page).fill("cookie");
  await expect(page.getByRole("option", { name: "Booster Cookie (BOOSTER_COOKIE)", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Bazaar Cookie (BAZAAR_COOKIE)", exact: true })).toHaveCount(0);
  await input(page).press("ArrowDown");
  await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  expect(requests).toEqual([]);
  await page.screenshot({ path: `.local/bazaar-catalog-cleanup-${info.project.name}.png`, fullPage: true });
});

test("local keyboard search, selected-only network, hourly reuse, layout and navigation", async ({
  page,
}, info) => {
  const requests: string[] = [];
  await page.route("**/api/companion/**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ json: { bazaar: [cookie()], usage } });
  });
  await page.goto("/");
  await expect(input(page)).toBeVisible();
  const brand = await page
    .getByRole("link", { name: "BazaarSignal home" })
    .boundingBox();
  const search = await input(page).boundingBox();
  if (info.project.name === "desktop")
    expect(search!.x).toBeGreaterThanOrEqual(brand!.x + brand!.width);
  else expect(search!.y).toBeGreaterThanOrEqual(brand!.y + brand!.height);
  await input(page).fill("enchanted");
  await expect(page.getByRole("option").first()).toBeVisible();
  await expect(
    page.getByRole("option").first().locator(".item-art"),
  ).toBeVisible();
  expect(requests).toEqual([]);
  await input(page).press("ArrowDown");
  await expect(page.getByRole("option").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await input(page).press("ArrowDown");
  await expect(page.getByRole("option").nth(1)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await input(page).press("ArrowUp");
  await expect(page.getByRole("option").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await input(page).press("ArrowUp");
  await expect(page.getByRole("option").last()).toBeInViewport();
  const activeId = await input(page).getAttribute("aria-activedescendant");
  expect(activeId).toBe(
    await page.getByRole("option").last().getAttribute("id"),
  );
  await page.screenshot({
    path: `.local/bazaar-search-dropdown-${info.project.name}.png`,
    fullPage: true,
  });
  await input(page).press("Escape");
  await expect(input(page)).toHaveAttribute("aria-expanded", "false");
  await input(page).press("Enter");
  expect(requests).toEqual([]);
  await select(page, "booster cookie");
  const panel = page.getByRole("region", { name: "Booster Cookie" });
  await expect(panel).toContainText("14,000,000.5 coins");
  await expect(panel).toContainText("13,000,000 coins");
  await expect(panel).toContainText("18 items · 5 orders · 2 levels");
  await expect(panel).toContainText("13 items · 4 orders · 1 level");
  await expect(panel.locator("time")).toHaveAttribute(
    "datetime",
    new Date(now).toISOString(),
  );
  await expect(panel.locator("time")).toHaveText("10:03 AM EST");
  await expect(panel.locator("time")).toHaveAttribute(
    "title", "Oct 14, 2026, 10:03:00 AM EST",
  );
  await expect(panel).toContainText("Scheduled snapshot");
  expect(requests).toEqual([
    "http://127.0.0.1:5198/live-market/api/companion/portfolio-prices?assets=bz_BOOSTER_COOKIE",
  ]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.screenshot({
    path: `.local/bazaar-item-page-${info.project.name}.png`,
    fullPage: true,
  });
  await expect(page).toHaveURL(/#view=item&item=BOOSTER_COOKIE$/);
  await expect(page.getByRole("heading", { name: "Booster Cookie", exact: true, level: 1 })).toBeFocused();
  await expect(page.locator(".bazaar-search-detail")).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/view=portfolios/);
  await expect(panel).toHaveCount(0);
  await page.goForward();
  await expect(panel).toContainText("14,000,000.5");
  expect(requests).toHaveLength(1);
  await select(page);
  await expect(panel).toContainText("14,000,000.5");
  expect(requests).toHaveLength(1);
  await input(page).press("ArrowDown");
  await input(page).press("Enter");
  await expect(panel).toContainText("14,000,000.5");
  expect(requests).toHaveLength(1);
  await input(page).press("Escape");
  await expect(input(page)).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeVisible();
  await page.reload();
  await select(page);
  await expect(panel).toContainText("14,000,000.5");
  expect(requests).toHaveLength(1);
  await page.clock.fastForward(240000);
  await expect(panel).toContainText("Scheduled snapshot");
  await expect(panel).not.toContainText("Stale data");
  expect(requests).toHaveLength(1);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page).toHaveURL(/view=settings/);
  await expect(panel).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Portfolio" })
    .click();
  await expect(page).toHaveURL(/view=portfolios/);
  // Leaving the item page stops its scheduler. A later selection can read
  // once in the new hourly window; reloads reuse that persisted response.
  await page.clock.fastForward(3600000);
  expect(requests).toHaveLength(1);
  await select(page);
  await expect(panel).toContainText("14,000,000.5");
  expect(requests).toHaveLength(2);
  await page.reload();
  await select(page);
  await expect(panel).toContainText("14,000,000.5");
  expect(requests).toHaveLength(2);
});

test("pre-downloaded portfolio books, empty search, and stale data need no market requests", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/companion/**", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/");
  await page.evaluate(
    async ({ item, usage }) => {
      const c = await caches.open("bazaarsignal-public-market-v1");
      await c.put(
        `${location.origin}/live-market/api/companion/portfolio-prices?assets=bz_BOOSTER_COOKIE%2Cbz_ENCHANTED_DIAMOND_BLOCK`,
        new Response(
          JSON.stringify({ at: Date.now(), body: { bazaar: [item], usage } }),
        ),
      );
    },
    { item: cookie(now - 7200000), usage },
  );
  await input(page).fill("not a real item xyz");
  await expect(
    page.getByText("No matching Bazaar items. Try another name or item ID."),
  ).toBeVisible();
  await input(page).press("Enter");
  expect(requests).toEqual([]);
  await input(page).fill("BOOSTER_COOKIE");
  await page
    .getByRole("option", { name: "Booster Cookie (BOOSTER_COOKIE)" })
    .click();
  const panel = page.getByRole("region", { name: "Booster Cookie" });
  await expect(panel).toContainText("Stale data");
  await expect(panel).toContainText("14,000,000.5 coins");
  expect(requests).toEqual([]);
});

test("both complete order-book sides are visible without extra requests", async ({ page }, info) => {
  const requests: string[] = [];
  await page.route("**/api/companion/**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ json: { usage, bazaar: [{
      ...cookie(now - 40 * 60_000),
      asks: Array.from({ length: 30 }, (_, i) => ({ pricePerUnit: 14000000.5 + i, amount: i + 1, orders: 1 })).reverse(),
      bids: Array.from({ length: 30 }, (_, i) => ({ pricePerUnit: 13000000 - i, amount: 31 - i, orders: 2 })).reverse(),
    }] } });
  });
  await page.goto("/");
  await select(page);
  const panel = page.getByRole("region", { name: "Booster Cookie" });
  await expect(panel).toContainText("Scheduled snapshot");
  await expect(panel).toContainText("40m ago");
  await expect(panel).not.toContainText("Stale data");
  const asks = page.getByRole("table", { name: "Sell offers" });
  const bids = page.getByRole("table", { name: "Buy orders" });
  await expect(asks).toBeVisible();
  await expect(bids).toBeVisible();
  await expect(asks.getByRole("row")).toHaveCount(31);
  await expect(asks.getByRole("row").nth(1)).toHaveText("14,000,000.511");
  await expect(asks.getByRole("row").last()).toHaveText("14,000,029.5301");
  await expect(bids.getByRole("row")).toHaveCount(31);
  await expect(bids.getByRole("row").nth(1)).toHaveText("13,000,000312");
  await expect(bids.getByRole("row").last()).toHaveText("12,999,97122");
  await expect(page.locator(".bazaar-search-book button")).toHaveCount(0);
  const asksBounds = (await asks.boundingBox())!;
  const bidsBounds = (await bids.boundingBox())!;
  expect(bidsBounds.x).toBeGreaterThan(asksBounds.x + asksBounds.width);
  expect(Math.abs(asksBounds.y - bidsBounds.y)).toBeLessThan(1);
  const chartBounds = (await page.getByRole("region", { name: "Price history", exact: true }).boundingBox())!;
  expect(asksBounds.y).toBeGreaterThan(chartBounds.y + chartBounds.height);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(1600);
  const volume = async (table: typeof asks, row: number) => table.getByRole("row").nth(row).evaluate(el => ({
    percent: parseFloat((el as HTMLElement).style.getPropertyValue("--level-volume")),
    background: getComputedStyle(el).backgroundImage,
  }));
  const firstAsk = await volume(asks, 1);
  expect(firstAsk.percent).toBeCloseTo(100 / 31);
  expect(firstAsk.background).toContain("linear-gradient");
  expect((await volume(asks, 30)).percent).toBeCloseTo(3000 / 31);
  expect((await volume(bids, 1)).percent).toBe(100);
  expect((await volume(bids, 30)).percent).toBeCloseTo(200 / 31);
  const dataNotes = page.locator(".bazaar-book-notes");
  await expect(dataNotes).not.toHaveAttribute("open", "");
  await dataNotes.locator("summary").press("Enter");
  await expect(dataNotes.getByText(/Bars show the item quantity/)).toBeVisible();
  await dataNotes.locator("summary").press("Enter");
  await expect(dataNotes.getByText(/Bars show the item quantity/)).not.toBeVisible();
  expect(requests).toHaveLength(1);
  await input(page).focus();
  await page.screenshot({ path: `.local/search-order-book-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.clock.fastForward(23 * 60_000);
  await expect(panel).toContainText("Stale data");
  await expect(asks.getByRole("row")).toHaveCount(31);
  await expect(bids.getByRole("row")).toHaveCount(31);
  expect(requests).toHaveLength(1);
});

test("missing items and empty order books explain unavailable prices without retries", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/companion/**", (route) => {
    requests.push(route.request().url());
    const empty = {
      ...cookie(),
      id: "ENCHANTMENT_ULTIMATE_JERRY_1",
      asks: [],
      bids: [],
    };
    return route.fulfill({
      json: {
        bazaar: route.request().url().includes("BOOSTER_COOKIE") ? [] : [empty],
        usage,
      },
    });
  });
  await page.goto("/");
  await select(page);
  const cookiePanel = page.getByRole("region", { name: "Booster Cookie" });
  await expect(cookiePanel).toContainText("Data unavailable");
  await expect(cookiePanel).toContainText("Sample time unavailable");
  await input(page).press("Escape");
  await select(page);
  await expect(cookiePanel).toContainText("Data unavailable");
  expect(requests).toHaveLength(1);
  await select(page, "ENCHANTMENT_ULTIMATE_JERRY_1");
  const panel = page.getByRole("region", { name: "Enchantment Ultimate Jerry 1", exact: true });
  await expect(panel.locator(".bazaar-search-prices")).toContainText(
    "Unavailable",
  );
  await expect(panel).toContainText("0 items · 0 orders · 0 levels");
  await expect(panel).toContainText("No orders in saved snapshot");
  await expect(panel).toContainText("No sell offers in this snapshot.");
  await expect(panel).toContainText("No buy orders in this snapshot.");
  await page.clock.fastForward(63 * 60_000);
  await expect(panel).toContainText("No orders in saved snapshot · Stale data");
  await expect.poll(() => requests.length).toBe(3);
  await page.getByRole("link", { name: "Back to Portfolio", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await select(page, "ENCHANTMENT_ULTIMATE_JERRY_1");
  await expect(panel).toContainText("No orders in saved snapshot");
  expect(requests).toHaveLength(3);
});

async function visibility(page: Page, state: "visible" | "hidden") {
  await page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

async function advanceTo(page: Page, stamp: number) {
  await page.clock.fastForward(Math.max(0, stamp - await page.evaluate(() => Date.now())));
}

test("visible item pages read hourly, skip hidden hours, and stop on navigation", async ({ page }) => {
  const requests: string[] = [];
  let snapshotAt = now;
  await page.route("**/api/companion/**", route => {
    requests.push(route.request().url());
    return route.fulfill({ json: { usage, bazaar: [cookie(snapshotAt)] } });
  });
  await page.goto("/#view=item&item=BOOSTER_COOKIE");
  const sample = page.locator(".bazaar-item-snapshot time");
  await expect(sample).toHaveAttribute("datetime", new Date(now).toISOString());
  await advanceTo(page, Date.parse("2026-10-14T16:01:59Z"));
  expect(requests).toHaveLength(1);
  snapshotAt = Date.parse("2026-10-14T16:00:00Z");
  await advanceTo(page, Date.parse("2026-10-14T16:02:00Z"));
  await expect(sample).toHaveAttribute("datetime", new Date(snapshotAt).toISOString());
  expect(requests).toHaveLength(2);

  await visibility(page, "hidden");
  await advanceTo(page, Date.parse("2026-10-14T18:30:00Z"));
  expect(requests).toHaveLength(2);
  snapshotAt = Date.parse("2026-10-14T18:00:00Z");
  await visibility(page, "visible");
  await expect(sample).toHaveAttribute("datetime", new Date(snapshotAt).toISOString());
  expect(requests).toHaveLength(3);
  for (let i = 0; i < 3; i++) {
    await visibility(page, "hidden");
    await visibility(page, "visible");
  }
  await advanceTo(page, Date.parse("2026-10-14T19:01:59Z"));
  expect(requests).toHaveLength(3);
  snapshotAt = Date.parse("2026-10-14T19:00:00Z");
  await advanceTo(page, Date.parse("2026-10-14T19:02:00Z"));
  await expect(sample).toHaveAttribute("datetime", new Date(snapshotAt).toISOString());
  expect(requests).toHaveLength(4);
  await page.getByRole("link", { name: "Back to Portfolio", exact: true }).click();
  await expect(sample).toHaveCount(0);
  await page.clock.fastForward(2 * 3600000);
  expect(requests).toHaveLength(4);
  expect(new Set(requests)).toEqual(new Set([
    "http://127.0.0.1:5198/live-market/api/companion/portfolio-prices?assets=bz_BOOSTER_COOKIE",
  ]));
});

test("a returning item page reuses a new portfolio snapshot without another request", async ({ page }) => {
  const requests: string[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  });
  await page.route("**/api/companion/**", route => {
    requests.push(route.request().url());
    return route.fulfill({ json: { usage, bazaar: [cookie()] } });
  });
  await page.goto("/#view=item&item=BOOSTER_COOKIE");
  await page.clock.fastForward(60000);
  expect(requests).toHaveLength(0);
  await visibility(page, "visible");
  const sample = page.locator(".bazaar-item-snapshot time");
  await expect(sample).toHaveAttribute("datetime", new Date(now).toISOString());
  await visibility(page, "hidden");
  await advanceTo(page, Date.parse("2026-10-14T16:03:00Z"));
  expect(requests).toHaveLength(1);
  const latest = cookie(Date.parse("2026-10-14T16:00:00Z"));
  await page.evaluate(async ({ item, usage }) => {
    const cache = await caches.open("bazaarsignal-public-market-v1");
    await cache.put(`${location.origin}/live-market/api/companion/portfolio-prices?assets=bz_BOOSTER_COOKIE%2Cbz_ENCHANTED_DIAMOND_BLOCK`,
      new Response(JSON.stringify({ at: Date.now(), body: { bazaar: [item], usage } })));
  }, { item: latest, usage });
  await visibility(page, "visible");
  await expect(sample).toHaveAttribute("datetime", new Date(latest.upstreamAt).toISOString());
  expect(requests).toHaveLength(1);
});

for (const guard of ["paused", "expired", "backoff", "slow"] as const) {
  test(`item auto-updates respect the ${guard} usage safeguard`, async ({ page }) => {
    const requests: string[] = [];
    const resume = Date.parse(guard === "backoff" ? "2026-10-14T18:30:00Z" : "2026-10-14T18:02:00Z");
    const directive = {
      ...usage,
      ...(guard === "paused" ? { mode: "paused", pollMs: 0, reason: "Budget paused" } : {}),
      ...(guard === "expired" ? { expiresAt: Date.parse("2026-10-14T16:01:00Z") } : {}),
      ...(guard === "backoff" ? { mode: "slow", retryAt: resume, reason: "Waiting for budget reset" } : {}),
      ...(guard === "slow" ? { mode: "slow", pollMs: 3 * 3600000 } : {}),
    };
    await page.route("**/api/companion/**", route => {
      requests.push(route.request().url());
      return route.fulfill({ json: { usage: directive, bazaar: [cookie()] } });
    });
    await page.goto("/#view=item&item=BOOSTER_COOKIE");
    await expect(page.getByRole("table", { name: "Sell offers" })).toBeVisible();
    await advanceTo(page, resume - 1000);
    expect(requests).toHaveLength(1);
    await visibility(page, "hidden");
    await visibility(page, "visible");
    await advanceTo(page, resume);
    if (guard === "paused" || guard === "expired") {
      await page.clock.fastForward(86400000);
      await expect(page.locator(".bazaar-search-status")).toContainText("Updates paused");
      expect(requests).toHaveLength(1);
    } else {
      await expect.poll(() => requests.length).toBe(2);
      await page.clock.fastForward(60000);
      expect(requests).toHaveLength(2);
    }
  });
}

test("a missing book side explains only that unavailable price", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/companion/**", route => {
    requests.push(route.request().url());
    const selling = route.request().url().includes("ENCHANTMENT_ULTIMATE_JERRY_1");
    return route.fulfill({ json: { usage, bazaar: [{ ...cookie(),
      id: selling ? "ENCHANTMENT_ULTIMATE_JERRY_1" : "BOOSTER_COOKIE",
      ...(selling ? { bids: [] } : { asks: [] }),
    }] } });
  });
  await page.goto("/");
  await select(page);
  const buyPanel = page.getByRole("region", { name: "Booster Cookie", exact: true });
  await expect(buyPanel).toContainText("No sell offers in this snapshot.");
  await expect(buyPanel.locator(".bazaar-search-prices > div").first()).toContainText("Unavailable");
  await expect(buyPanel).toContainText("13,000,000 coins");
  await expect(buyPanel).not.toContainText("No orders in saved snapshot");
  await select(page, "ENCHANTMENT_ULTIMATE_JERRY_1");
  const sellPanel = page.getByRole("region", { name: "Enchantment Ultimate Jerry 1", exact: true });
  await expect(sellPanel).toContainText("No buy orders in this snapshot.");
  await expect(sellPanel.locator(".bazaar-search-prices > div").last()).toContainText("Unavailable");
  await expect(sellPanel).toContainText("14,000,000.5 coins");
  await expect(sellPanel).not.toContainText("No orders in saved snapshot");
  expect(requests).toHaveLength(2);
});

test("a late response cannot replace a newer selection", async ({ page }) => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/companion/**", async (route) => {
    const first = route.request().url().includes("BOOSTER_COOKIE");
    if (first) await wait;
    await route.fulfill({
      json: {
        bazaar: [
          {
            ...cookie(),
            id: first ? "BOOSTER_COOKIE" : "ENCHANTED_DIAMOND_BLOCK",
          },
        ],
        usage,
      },
    });
  });
  await page.goto("/");
  await select(page);
  await expect(
    page.getByRole("region", { name: "Booster Cookie" }),
  ).toContainText("Loading cached market data");
  await select(page, "ENCHANTED_DIAMOND_BLOCK");
  await expect(
    page.getByRole("region", { name: "Enchanted Diamond Block" }),
  ).toContainText("14,000,000.5");
  release();
  await expect(
    page.getByRole("region", { name: "Booster Cookie" }),
  ).toHaveCount(0);
});

test("public item links support direct loads, reloads, copy and browser history", async ({ page, context }) => {
  const requests: string[] = [];
  await page.route("**/api/companion/**", route => {
    requests.push(route.request().url());
    const id = new URL(route.request().url()).searchParams.get("assets")!.slice(3);
    return route.fulfill({ json: { usage, bazaar: [{ ...cookie(), id }] } });
  });
  // Capture the clipboard write without touching the user's clipboard.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { (window as any).copiedItemLink = text; },
    } });
  });
  await page.goto("/?unused=private#view=item&item=BOOSTER_COOKIE");
  const heading = page.getByRole("heading", { name: "Booster Cookie", exact: true, level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page).toHaveTitle("Booster Cookie | BazaarSignal");
  await expect(page.getByRole("table", { name: "Sell offers" })).toBeVisible();
  await page.getByRole("button", { name: "Copy item link" }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const copied = await page.evaluate(() => (window as any).copiedItemLink);
  expect(copied).toBe("http://127.0.0.1:5198/#view=item&item=BOOSTER_COOKIE");
  expect(requests).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole("table", { name: "Sell offers" })).toBeVisible();
  expect(requests).toHaveLength(1);
  await select(page, "ENCHANTED_DIAMOND_BLOCK");
  await expect(page.getByRole("heading", { name: "Enchanted Diamond Block", exact: true, level: 1 })).toBeFocused();
  await expect(page.getByRole("table", { name: "Sell offers" })).toBeVisible();
  expect(requests).toHaveLength(2);
  await page.goBack();
  await expect(heading).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/item=ENCHANTED_DIAMOND_BLOCK$/);
  expect(requests).toHaveLength(2);
  const tab = await context.newPage();
  // A newly opened tab cannot precede the first tab's cache-write timestamp.
  await tab.clock.install({ time: now + 60_000 });
  await tab.route("https://**", route => route.abort());
  const unexpected: string[] = [];
  await tab.route("**/api/companion/**", route => { unexpected.push(route.request().url()); return route.abort(); });
  await tab.goto(copied);
  await expect(tab.getByRole("table", { name: "Sell offers" })).toBeVisible();
  expect(unexpected).toEqual([]);
  await tab.close();
});

test("invalid or removed deep links make no market requests and copy has a manual fallback", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/companion/**", route => {
    requests.push(route.request().url());
    return route.fulfill({ json: { usage, bazaar: [cookie()] } });
  });
  for (const value of ["", "BAZAAR_COOKIE", "NOT_REAL", "X%26view%3Dadmin"]) {
    await page.goto(`/#view=item&item=${value}`);
    await expect(page.getByRole("heading", { name: "Item not found", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy item link" })).toHaveCount(0);
  }
  expect(requests).toEqual([]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async () => { throw new Error("Permission denied"); },
    } });
  });
  await page.goto("/#view=item&item=BOOSTER_COOKIE");
  await expect(page.getByRole("table", { name: "Sell offers" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("table", { name: "Sell offers" })).toBeVisible();
  await page.getByRole("button", { name: "Copy item link" }).click();
  await expect(page.getByRole("textbox", { name: "Item link" })).toHaveValue("http://127.0.0.1:5198/#view=item&item=BOOSTER_COOKIE");
  expect(requests).toHaveLength(1);
});
