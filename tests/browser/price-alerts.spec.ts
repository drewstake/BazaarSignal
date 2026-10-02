import { test, expect } from "@playwright/test";

test("the alerts route reports an unavailable live item feed and retries", async ({
  page,
}) => {
  await page.clock.install();
  let failed = true;
  await page.route("**/api/market", async (route) => {
    if (failed) return route.abort();
    const now = Date.now();
    await route.fulfill({
      json: {
        prices: [
          {
            id: "SUMMONING_EYE",
            name: "Summoning Eye",
            buy: 100,
            sell: 90,
            volume: 10,
          },
        ],
        books: {
          SUMMONING_EYE: {
            buy: [{ amount: 10, pricePerUnit: 100, orders: 1 }],
            sell: [{ amount: 10, pricePerUnit: 90, orders: 1 }],
          },
        },
        status: {
          lastUpdated: now,
          lastSuccess: now,
          lastAttempt: now,
          error: null,
        },
      },
    });
  });
  await page.goto("/?fixtures=1#alerts=1");
  await expect(page.getByRole("alert")).toContainText("Retrying automatically");
  await expect(
    page.getByRole("button", { name: "Retry connection" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Item", { exact: true })).toBeDisabled();
  failed = false;
  await page.clock.runFor(61000);
  await expect(page.getByLabel("Item", { exact: true })).toBeEnabled();
  await page.getByLabel("Item", { exact: true }).selectOption("SUMMONING_EYE");
  await expect(page.locator(".quote-note")).toContainText("100 coins / item");
});

test("alert board filters real saved alerts, searches, edits, and renders its artwork", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?demo=1&fixtures=1#alerts=1");
  await expect(page.getByText("No alerts yet.", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("bazaar-watch-demo-v1")!);
    data.workflows = data.workflows.slice(0, 3).map((w: object, i: number) => ({
      ...w,
      mode: "single",
      quantity: [8, 64, 1][i],
      createdAt: Date.now() - i * 1000,
    }));
    data.workflows.push({
      ...data.workflows[0],
      id: "completed",
      stage: "completed",
    });
    data.workflows.push({ ...data.workflows[2], id: "disabled", paused: true });
    localStorage.setItem("bazaar-watch-demo-v1", JSON.stringify(data));
  });
  await page.reload();
  const filters = page.getByRole("group", { name: "Filter alerts by status" });
  await expect(
    filters.getByRole("button", { name: "Active 3", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".saved-alert")).toHaveCount(3);
  await expect(page.locator(".saved-alert").nth(1)).toContainText(
    "after 1.25% tax",
  );
  await page.getByLabel("Find an alert").fill("diamond");
  await expect(page.locator(".saved-alert")).toHaveCount(1);
  await page.getByLabel("Find an alert").fill("missing item");
  await expect(page.getByText("No alerts match your search.")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await filters.getByRole("button", { name: "Completed 1" }).click();
  await expect(page.locator(".saved-alert")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Edit target" })).toHaveCount(
    0,
  );
  await filters.getByRole("button", { name: "Disabled 1" }).click();
  await expect(page.locator(".saved-alert")).toContainText("Disabled");
  await expect(page.getByRole("button", { name: "Edit target" })).toHaveCount(
    0,
  );
  await filters.getByRole("button", { name: "Active 3", exact: true }).click();
  const eye = page.getByRole("article", { name: "Summoning Eye alert" });
  await eye.getByRole("button", { name: "Edit target" }).click();
  await eye.getByLabel("Target price").fill("1000000");
  await eye.getByRole("button", { name: "Save changes" }).click();
  await expect(eye.getByRole("status")).toHaveText("Target updated.");
  await page.reload();
  await expect(eye).toContainText("1,000,000");
  await page.getByLabel("Item", { exact: true }).selectOption("SUMMONING_EYE");
  await page.getByLabel("Quantity", { exact: true }).fill("8");
  await page.getByLabel("Target price", { exact: true }).fill("1000000");
  await expect(page.locator(".alerts-create .trigger-preview")).toContainText(
    "8 × Summoning Eye",
  );
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page
        .locator(".price-alerts-app img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `.local/previews/price-alerts-${info.project.name}.png`,
    fullPage: true,
  });
  if (info.project.name === "desktop") {
    for (const width of [320, 768, 1024, 1513]) {
      await page.setViewportSize({ width, height: 1040 });
      expect(
        await filters.getByRole("button").evaluateAll((buttons) =>
          buttons.every((button) => {
            const rect = button.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth;
          }),
        ),
        `All status filters fit at ${width}px`,
      ).toBe(true);
      if (width === 320)
        await page.screenshot({
          path: ".local/previews/price-alerts-small-mobile.png",
          fullPage: true,
        });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `No horizontal overflow at ${width}px`,
      ).toBe(true);
    }
    await page
      .getByRole("heading", { name: "Price Alerts", exact: true })
      .click();
    await page.screenshot({
      path: ".local/previews/price-alerts-reference-size.png",
      fullPage: true,
    });
  }
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "Create alert ↓" }).click();
    await expect(page.getByLabel("Find an item", { exact: true })).toBeFocused();
  }
  await eye.getByRole("link", { name: "Summoning Eye", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Summoning Eye", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("both alert entry points create and retain quantity and sell tax semantics", async ({
  page,
}) => {
  await page.goto("/?demo=1&fixtures=1#item=ENCHANTED_DIAMOND_BLOCK&alert=1");
  await expect(
    page.getByRole("heading", { name: "Price Alerts", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Item", { exact: true })).toHaveValue(
    "ENCHANTED_DIAMOND_BLOCK",
  );
  const form = page.locator(".alert-form");
  await form.getByRole("button", { name: "Sell above" }).click();
  await form.getByLabel("Quantity", { exact: true }).fill("600");
  await form.getByLabel("Sale tax (%)").fill("10");
  await form.getByLabel("Target price", { exact: true }).fill("250000");
  // Crosses the first 500-unit level; must not display the spot quote.
  await expect(form.locator(".quote-note")).toContainText(
    "182,457.825 coins / item for 600 items",
  );
  await form.getByRole("button", { name: "Create alert", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Preview alert created." }),
  ).toBeVisible();
  const card = page.getByRole("article", {
    name: "Enchanted Diamond Block alert",
  });
  await expect(card).toContainText("after 10% tax");
  await expect(card.locator(".current-quote")).toContainText("182,457.83");
  await page.getByRole("link", { name: "Price Alerts", exact: true }).click();
  await expect(card).toBeVisible();
  await page
    .getByRole("button", { name: "Preview confirmation email" })
    .click();
  await page.getByRole("link", { name: "Disable this alert" }).click();
  await page
    .getByRole("button", { name: "Disable alert", exact: true })
    .click();
  await page.goto("/?demo=1&fixtures=1#alerts=1");
  await page.getByRole("button", { name: "Disabled 1" }).click();
  await expect(card).toContainText("Disabled");
});

test("depth and stale states never display a fabricated current quote", async ({
  page,
}) => {
  await page.goto("/?demo=1&fixtures=1#alerts=1");
  await page.getByLabel("Item", { exact: true }).selectOption("SUMMONING_EYE");
  const form = page.locator(".alert-form");
  await form.getByLabel("Quantity", { exact: true }).fill("3001");
  await expect(form.locator(".quote-note")).toContainText(
    "Insufficient visible liquidity",
  );
  await form.getByLabel("Target price", { exact: true }).fill("1");
  await form.getByRole("button", { name: "Create alert", exact: true }).click();
  await expect(page.locator(".current-quote")).toContainText(
    "Insufficient depth",
  );
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("bazaar-watch-demo-v1")!);
    data.status.lastUpdated = Date.now() - 240000;
    localStorage.setItem("bazaar-watch-demo-v1", JSON.stringify(data));
  });
  await page.reload();
  await expect(page.locator(".current-quote")).toContainText("Target checks wait for a fresh sample.");
  await expect(page.locator(".current-quote")).toContainText("Insufficient depth");
  await page.getByLabel("Item", { exact: true }).selectOption("SUMMONING_EYE");
  await expect(page.locator(".quote-note")).toContainText("Alerts only trigger on fresh prices.");
});
