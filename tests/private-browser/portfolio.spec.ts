import { test, expect, type Page, type Locator } from "@playwright/test";
import { normalizeBazaar } from "../../shared/companion/bazaar";
const signIn = async (page: Page, id: string) => {
  await page.evaluate(async (id) => {
    const { auth } = await import("/src/data.ts");
    const { GoogleAuthProvider, signInWithCredential } =
      await import("/node_modules/.vite/deps/firebase_auth.js");
    if (!auth.emulatorConfig) throw new Error("Emulator required");
    await signInWithCredential(
      auth,
      GoogleAuthProvider.credential(
        JSON.stringify({
          sub: id,
          email: `${id}@example.test`,
          email_verified: true,
          iss: "https://accounts.google.com",
          aud: "demo-client",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ),
    );
  }, id);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
};
const create = async (page: Page, name: string) => {
  await page
    .getByRole("button", { name: "Create portfolio", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Create portfolio" });
  await form.getByLabel("Portfolio name").fill(name);
  await form.getByRole("button", { name: "Save portfolio" }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New portfolio" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Create portfolio" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Your portfolios" }),
  ).toHaveCount(0);
};
const add = async (
  page: Page,
  id = "BOOSTER_COOKIE",
  quantity = "287",
  cost = "12.2M",
) => {
  await page.getByRole("button", { name: "Add holding", exact: true }).click();
  const form = page.getByRole("form", { name: "Add holding" });
  await form.getByRole("combobox", { name: "Search", exact: true }).fill(id);
  await form.getByRole("option", { name: new RegExp(`\\(${id}\\)$`) }).click();
  await form.getByLabel("Quantity owned", { exact: true }).fill(quantity);
  await form.getByLabel(/ · coins$/).fill(cost);
  await form.getByRole("button", { name: "Save holding", exact: true }).click();
  await expect(form).toHaveCount(0);
};
const noOverflow = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
async function expandHolding(holding: Locator) {
  const toggle = holding.getByRole("button", { name: /details for/ });
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
}
async function seedPrices(page: Page) {
  const stamp = Date.now() - 10000,
    item = {
      ...normalizeBazaar(
        "BOOSTER_COOKIE",
        {
          buy_summary: [{ pricePerUnit: 14000000, amount: 1000, orders: 2 }],
          sell_summary: [{ pricePerUnit: 13000000, amount: 500, orders: 2 }],
        },
        stamp,
        stamp,
      ),
      feeContext: {
        mayor: "Test",
        multiplier: 1,
        checkedAt: stamp,
        explanation: "Local test fixture",
      },
    };
  await page.evaluate(async (item) => {
    const cache = await caches.open("bazaarsignal-public-market-v1");
    await cache.put(
      `${location.origin}/api/companion/bazaar`,
      new Response(
        JSON.stringify({
          at: Date.now(),
          etag: null,
          body: { items: [item], error: null },
        }),
      ),
    );
  }, item);
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/companion/**", (r) => r.abort());
  await page.route("https://script.google.com/**", (r) =>
    r.fulfill({
      json: { ok: false, error: "Local test backend: no external delivery." },
    }),
  );
  await page.goto("/#view=portfolios");
});

test("holding quantity can be calculated from coins spent and saved through purchases and edits", async ({
  page,
}, info) => {
  await signIn(page, `calculated-${info.project.name}-${Date.now()}`);
  await create(page, "Calculated quantities");
  await page.getByRole("button", { name: "Add holding", exact: true }).click();
  const form = page.getByRole("form", { name: "Add holding" });
  await form
    .getByRole("combobox", { name: "Search", exact: true })
    .fill("BOOSTER_COOKIE");
  await form
    .getByRole("option", { name: "Booster Cookie (BOOSTER_COOKIE)" })
    .click();
  await form.getByLabel("Quantity entry").selectOption("calculated");
  await expect(form.getByLabel("Quantity owned", { exact: true })).toHaveCount(
    0,
  );
  await form.getByLabel("Average purchase price · coins").fill("12.2M");
  await form.getByLabel("Total coins spent · coins").fill("3.5014b");
  await expect(form).toContainText("Calculated quantity: 287");
  await form.getByLabel("Quantity entry").selectOption("manual");
  await expect(form.getByLabel("Quantity owned", { exact: true })).toHaveValue(
    "287",
  );
  await expect(form.getByLabel("Average purchase price · coins")).toHaveValue(
    "12200000",
  );
  await form.getByLabel("Quantity entry").selectOption("calculated");
  await form.getByRole("button", { name: "Save holding", exact: true }).click();
  await expect(form).toHaveCount(0);
  const card = page.getByRole("rowgroup", { name: "Booster Cookie holding" });
  await page.reload();
  await expect(card).toContainText("287 items");
  await expect(card).toContainText("3,501,400,000");
  await expandHolding(card);
  await card.getByRole("button", { name: "Add purchase" }).click();
  const purchase = page.getByRole("form", { name: "Add purchase" });
  await purchase.getByLabel("Quantity entry").selectOption("calculated");
  await purchase.getByLabel("Average purchase price · coins").fill("10m");
  await purchase.getByLabel("Total coins spent · coins").fill("130m");
  await expect(purchase).toContainText("Calculated quantity: 13");
  await expect(purchase).toContainText("Combined quantity: 300");
  await purchase.getByRole("button", { name: "Save purchase" }).click();
  await expect(purchase).toHaveCount(0);
  await expandHolding(card);
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("form", { name: "Edit holding" });
  await edit.getByLabel("Quantity entry").selectOption("calculated");
  await expect(edit).toContainText("Calculated quantity: 300");
  await edit.getByLabel("Average purchase price · coins").fill("10m");
  await edit.getByLabel("Total coins spent · coins").fill("9m");
  await edit.getByRole("button", { name: "Save holding" }).click();
  await expect(edit.getByRole("alert")).toContainText(
    "Calculated quantity must be",
  );
  await edit.getByLabel("Total coins spent · coins").fill("35m");
  await expect(edit).toContainText("Calculated quantity: 4");
  await expect(edit).toContainText("Rounded to the nearest whole quantity");
  await expect(edit).toContainText(
    "recorded average purchase price: 8,750,000 coins",
  );
  await noOverflow(page);
  await page.screenshot({
    path: `.local/holding-calculated-${info.project.name}.png`,
    fullPage: true,
  });
  await edit.getByRole("button", { name: "Save holding" }).click();
  await expect(edit).toHaveCount(0);
  await page.reload();
  await expect(card).toContainText("4 items");
  await expect(card).toContainText("35,000,000");
});

test("notification controls persist, respect revisions and stay retired after holding deletion", async ({
  page,
}, info) => {
  // Offline transport double only. Server validation/delivery use the separate backend suites.
  // The emulator admin token must never be sent outside this literal loopback URL.
  const documents = new Map<string, any>();
  const operations: string[] = [];
  await page.route("https://script.google.com/**", async (route) => {
    const request = route.request().postDataJSON();
    if (request.action !== "portfolio-notification") {
      await route.fulfill({ json: { ok: true, data: { alerts: [] } } });
      return;
    }
    const claims = JSON.parse(
      Buffer.from(request.idToken.split(".")[1], "base64url").toString(),
    );
    expect(claims.aud).toBe("demo-bazaar-watch");
    const id = `${request.portfolioId}__${request.holdingId}`;
    const current = documents.get(id);
    // Read the actual emulator record, including client-written deletion tombstones.
    const url = `http://127.0.0.1:8081/v1/projects/demo-bazaar-watch/databases/(default)/documents/users/${claims.sub}/portfolioNotifications/${id}`;
    const previous = await page.request.get(url, {
      headers: { Authorization: "Bearer owner" },
    });
    const storedRevision = previous.ok()
      ? Number((await previous.json()).fields.revision.integerValue)
      : 0;
    expect(request.revision).toBe(storedRevision);
    const next = {
      ...current,
      ...request.input,
      id,
      portfolioId: request.portfolioId,
      holdingId: request.holdingId,
      holdingName: "Booster Cookie",
      source: "bazaar-bid-v1",
      capturedPrice: null,
      capturedAt: null,
      enabled: ["save", "resume"].includes(request.operation),
      deleted: request.operation === "delete",
      revision: storedRevision + 1,
      createdAt: current?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    const fields = Object.fromEntries(
      Object.entries(next).map(([key, value]) => [
        key,
        value === null
          ? { nullValue: null }
          : typeof value === "string"
            ? { stringValue: value }
            : typeof value === "boolean"
              ? { booleanValue: value }
              : { integerValue: String(value) },
      ]),
    );
    const result = await page.request.patch(url, {
      headers: { Authorization: "Bearer owner" },
      data: { fields },
    });
    expect(result.ok()).toBe(true);
    documents.set(id, next);
    operations.push(request.operation);
    await route.fulfill({ json: { ok: true, data: next } });
  });
  await signIn(page, `notify-${info.project.name}-${Date.now()}`);
  await create(page, "Notifications test");
  await add(page);
  const card = page.getByRole("rowgroup", { name: "Booster Cookie holding" });
  const form = page.getByRole("form", { name: "Holding notification" });
  await expandHolding(card);
  await card.getByRole("button", { name: "Set notification" }).click();
  await form.getByLabel("Upward threshold (%)").fill("10");
  await form.getByLabel("Downward threshold (%)").fill("5");
  await form.getByRole("button", { name: "Save and enable" }).click();
  await expect(form).toHaveCount(0);
  await expect(card).toContainText("Enabled · ↑ 10% ↓ 5%");
  await page.getByRole("link", { name: "Notifications", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open holding" }).click();
  await expandHolding(card);
  await card.getByRole("button", { name: "Edit notification" }).click();
  await form.getByLabel("Upward threshold (%)").fill("15");
  await form.getByRole("button", { name: "Save and enable" }).click();
  await expect(card).toContainText("↑ 15%");
  await page.getByRole("link", { name: "Notifications", exact: true }).click();
  await page.getByRole("button", { name: "Delete notification" }).click();
  await expect(
    page.getByText("No holding notifications yet.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Portfolio", exact: true }).click();
  await expandHolding(card);
  await card.getByRole("button", { name: "Set notification" }).click();
  await form.getByLabel("Upward threshold (%)").fill("20");
  await form.getByRole("button", { name: "Save and enable" }).click();
  await expect(form).toHaveCount(0);
  await expandHolding(card);
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(card).toHaveCount(0);
  await add(page);
  await expandHolding(card);
  await expect(
    card.getByRole("button", { name: "Set notification" }),
  ).toBeVisible();
  expect(operations).toEqual([
    "save",
    "pause",
    "resume",
    "save",
    "delete",
    "save",
  ]);
});
test("signed-out introduction and obsolete routes redirect without market requests", async ({
  page,
}, info) => {
  const network: string[] = [];
  page.on("request", (r) => {
    if (/hypixel|api\/companion/.test(r.url())) network.push(r.url());
  });
  await expect(
    page.getByRole("heading", { name: /Your SkyBlock portfolio/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Usage & Costs" })).toHaveCount(
    0,
  );
  for (const hash of [
    "market=bazaar",
    "market=auctions",
    "market=watchlist",
    "market=positions",
    "alerts=1",
    "item=DIAMOND",
    "legacy=1",
  ]) {
    await page.goto(`/#${hash}`);
    await expect(page).toHaveURL(/#view=portfolios$/);
    await expect(
      page.getByRole("heading", { name: /Your SkyBlock portfolio/ }),
    ).toBeVisible();
  }
  await noOverflow(page);
  await page.screenshot({
    path: `.local/portfolio-intro-${info.project.name}.png`,
    fullPage: true,
  });
  expect(network).toEqual([]);
});
test("portfolio CRUD, cost calculation, purchases, unavailable prices, identity switching and deletion", async ({
  page,
}, info) => {
  const id = `journey-${info.project.name}-${Date.now()}`;
  await signIn(page, id);
  await expect(
    page.getByRole("heading", { name: "Your portfolio starts here" }),
  ).toBeVisible();
  await seedPrices(page);
  await create(page, "Long term");
  await add(page);
  const card = page.getByRole("rowgroup", { name: "Booster Cookie holding" });
  await expect(
    card.getByRole("button", { name: "Show details for Booster Cookie" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(card.getByRole("button", { name: "Add purchase" })).toBeHidden();
  await expect(card).toContainText("3,501,400,000");
  await expect(card).toContainText("3,731,000,000");
  await expect(card).toContainText("+6.6%");
  await expect(card).toContainText("stale");
  await expandHolding(card);
  await card.getByRole("button", { name: "Add purchase" }).click();
  const purchase = page.getByRole("form", { name: "Add purchase" });
  await purchase.getByLabel("Additional quantity").fill("13");
  await purchase.getByLabel("Cost entry").selectOption("total");
  await purchase.getByLabel(/ · coins$/).fill("130m");
  await expect(purchase).toContainText("12,104,666.67");
  await purchase.getByRole("button", { name: "Save purchase" }).click();
  await expect(purchase).toHaveCount(0);
  await expandHolding(card);
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("form", { name: "Edit holding" });
  await edit.getByLabel("Quantity owned").fill("300.5");
  await edit.getByRole("button", { name: "Save holding" }).click();
  await expect(edit.getByRole("alert")).toContainText("whole quantity");
  await edit.getByLabel("Quantity owned").fill("300");
  await edit.getByLabel(/ · coins$/).fill("3.6314b");
  await edit.getByRole("button", { name: "Save holding" }).click();
  await expect(edit).toHaveCount(0);
  await add(page, "DIAMOND", "64", "100");
  await expect(
    page.getByText(/1 of 2 holdings have no usable price/),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: `.local/portfolio-holdings-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("form", { name: "Rename portfolio" });
  await rename.getByLabel("Portfolio name").fill("Materials");
  await rename.getByRole("button", { name: "Save portfolio" }).click();
  await expect(
    page.getByRole("heading", { name: "Materials", exact: true }),
  ).toBeVisible();
  const url = page.url();
  await page.reload();
  await expect(card).toContainText("3,631,400,000");
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, `${id}-other`);
  await expect(card).toHaveCount(0);
  await expect(page.getByText("3,631,400,000")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, id);
  await page.goto(url);
  await expect(card).toBeVisible();
  await expandHolding(card);
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Delete portfolio" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(
    page.getByRole("heading", { name: "Your portfolio starts here" }),
  ).toBeVisible();
  await create(page, "Replacement portfolio");
});
test("Bazaar holdings share one portfolio and notification baseline form stays useful offline", async ({
  page,
}, info) => {
  await signIn(page, `bazaar-${info.project.name}-${Date.now()}`);
  await create(page, "Equipment");
  await page.getByRole("button", { name: "Add holding", exact: true }).click();
  const form = page.getByRole("form", { name: "Add holding" });
  await expect(form.getByLabel("Market", { exact: true })).toHaveCount(0);
  await form
    .getByRole("combobox", { name: "Search", exact: true })
    .fill("enchanted diamond block");
  await form
    .getByRole("option", { name: "Enchanted Diamond Block (ENCHANTED_DIAMOND_BLOCK)" })
    .click();
  await form.getByLabel("Quantity owned", {exact:true}).fill("2");
  await form.getByLabel(/ · coins$/).fill("600m");
  await form.getByRole("button", { name: "Save holding" }).click();
  await expect(form).toHaveCount(0);
  const card = page.getByRole("rowgroup", { name: "Enchanted Diamond Block holding" });
  await expect(card).toContainText("1,200,000,000");
  await expect(card.locator('td[title="Value unavailable"]')).toBeVisible();
  await expandHolding(card);
  await card.getByText("Valuation details", { exact: true }).click();
  await expect(card).toContainText("liquidation unavailable");
  await expandHolding(card);
  await card.getByRole("button", { name: "Set notification" }).click();
  const notification = page.getByRole("form", { name: "Holding notification" });
  await notification.getByLabel("Upward threshold (%)").fill("10");
  await notification.getByLabel("Downward threshold (%)").fill("5");
  await notification.getByLabel("Baseline").selectOption("sample");
  await expect(notification).toContainText("fresh sample is required");
  await noOverflow(page);
  await page.screenshot({
    path: `.local/portfolio-notification-${info.project.name}.png`,
    fullPage: true,
  });
  await notification.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("link", { name: "Account", exact: true }).click();
  const check = page.getByLabel("Allow email for my holding notifications");
  await expect(check).not.toBeChecked();
  await check.check();
  await expect(check).toBeChecked();
  await expect(
    page.getByRole("status").filter({ hasText: "Email delivery enabled" }),
  ).toBeVisible();
  await page.reload();
  await expect(check).toBeChecked();
  await page.getByRole("link", { name: "Notifications", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Legacy price alerts" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("No holding notifications yet.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Portfolio", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create portfolio" }),
  ).toHaveCount(0);
  await add(page);
  await expect(
    page.getByRole("rowgroup", { name: "Booster Cookie holding" }),
  ).toBeVisible();
  await expect(card).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Equipment", exact: true }),
  ).toBeVisible();
  await expect(card).toBeVisible();
  await expect(
    page.getByRole("rowgroup", { name: "Booster Cookie holding" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create portfolio" }),
  ).toHaveCount(0);
});

test("a stale creation form opens the existing portfolio instead of creating another", async ({
  page,
}, info) => {
  await signIn(page, `single-${info.project.name}-${Date.now()}`);
  await page
    .getByRole("button", { name: "Create portfolio", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Create portfolio" });
  await form.getByLabel("Portfolio name").fill("Duplicate");
  // Simulate another tab creating the account's portfolio after this form opened.
  await page.evaluate(async () => {
    const { auth } = await import("/src/data.ts");
    const { savePortfolio } = await import("/src/companion/portfolio-store.ts");
    await savePortfolio(auth.currentUser.uid, "Existing portfolio");
  });
  await form.getByRole("button", { name: "Save portfolio" }).click();
  await expect(
    page.getByRole("heading", { name: "Existing portfolio", exact: true }),
  ).toBeVisible();
  await expect(form).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const { auth } = await import("/src/data.ts");
      const { loadPortfolios } =
        await import("/src/companion/portfolio-store.ts");
      return (await loadPortfolios(auth.currentUser.uid)).map((p) => p.name);
    }),
  ).toEqual(["Existing portfolio"]);
});
test("Bazaar search rejects auction and unlisted items and never saves a stale selection", async ({
  page,
}, info) => {
  await signIn(page, `search-${info.project.name}-${Date.now()}`);
  await create(page, "Search test");
  await page.getByRole("button", { name: "Add holding", exact: true }).click();
  const form = page.getByRole("form", { name: "Add holding" });
  const search = form.getByRole("combobox", { name: "Search", exact: true });
  await expect(form.getByLabel("Market", { exact: true })).toHaveCount(0);
  await expect(form.getByLabel("Bazaar item", { exact: true })).toHaveCount(0);
  await search.fill("diamond");
  await expect(form.getByRole("option").first()).toHaveAccessibleName(
    "Diamond (DIAMOND)",
  );
  await noOverflow(page);
  await page.screenshot({
    path: `.local/holding-search-${info.project.name}.png`,
    fullPage: true,
  });
  await search.press("Escape");
  await expect(search).toHaveAttribute("aria-expanded", "false");
  await search.fill("NECRON_HANDLE");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(form.getByRole("listbox").getByRole("option")).toHaveCount(0);
  await expect(form.getByLabel("Modifiers (JSON object)")).toHaveCount(0);
  await search.fill("BOOSTER_COOKIE");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(form.getByLabel("Modifiers (JSON object)")).toHaveCount(0);
  await form.getByLabel("Quantity owned", { exact: true }).fill("2");
  await form.getByLabel(/ · coins$/).fill("10m");
  await search.fill("Unlisted test sword");
  await form.getByRole("button", { name: "Save holding", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("Choose an item");
  await expect(
    page.getByRole("rowgroup", { name: "Booster Cookie holding" }),
  ).toHaveCount(0);
  await search.focus();
  await expect(form.getByRole('button', { name: 'Add an unlisted item' })).toHaveCount(0);
  await search.fill('BOOSTER_COOKIE');
  await search.press('ArrowDown');await search.press('Enter');
  await form.getByRole('button', { name: 'Save holding', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole('rowgroup', {name:'Booster Cookie holding'})).toContainText('2 items');
});
test("legacy positions migrate once on login and persist through reload", async ({
  page,
}, info) => {
  await signIn(page, `migration-${info.project.name}-${Date.now()}`);
  const uid = await page.evaluate(async () => {
    const { auth } = await import("/src/data.ts");
    return auth.currentUser.uid;
  });
  const stamp = Date.now();
  const result = await page.request.patch(
    `http://127.0.0.1:8081/v1/projects/demo-bazaar-watch/databases/(default)/documents/users/${uid}/positions/BOOSTER_COOKIE`,
    {
      headers: { Authorization: "Bearer owner" },
      data: {
        fields: {
          itemId: { stringValue: "BOOSTER_COOKIE" },
          name: { stringValue: "Booster Cookie" },
          quantity: { integerValue: "5" },
          costBasis: { integerValue: "50000000" },
          createdAt: { integerValue: String(stamp) },
          updatedAt: { integerValue: String(stamp) },
          revision: { integerValue: "1" },
        },
      },
    },
  );
  expect(result.ok()).toBe(true);
  await page.reload();
  const card = page.getByRole("rowgroup", { name: "Booster Cookie holding" });
  await expect(card).toContainText("50,000,000");
  await expect(
    page.getByRole("heading", { name: "My portfolio", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("5 items");
});

test("portfolio value chart records real totals, survives reloads and excludes partial valuations", async ({ page }, info) => {
  await signIn(page, `value-chart-${info.project.name}-${Date.now()}`);
  await seedPrices(page);
  await create(page, "Value history");
  const chart = page.getByRole("region", { name: "Portfolio value", exact: true });
  await expect(chart).toContainText("Add holdings to start your value chart.");
  await add(page);
  await expect(chart.getByRole("img", { name: /Portfolio value: 1 recorded snapshots/ })).toBeVisible();
  await expect(chart).toContainText("3,731,000,000 coins");
  await expect(chart).toContainText("Last-known prices");
  const holding = page.getByRole("rowgroup", { name: "Booster Cookie holding" });
  await expandHolding(holding);
  await holding.getByRole("button", { name: "Add purchase" }).click();
  const purchase = page.getByRole("form", { name: "Add purchase" });
  await purchase.getByLabel("Additional quantity").fill("13");
  await purchase.getByLabel("Cost entry").selectOption("total");
  await purchase.getByLabel(/ · coins$/).fill("130m");
  await purchase.getByRole("button", { name: "Save purchase" }).click();
  await expect(chart.getByRole("img", { name: /Portfolio value: 2 recorded snapshots/ })).toBeVisible();
  await expect(chart).toContainText("3,900,000,000 coins");
  await page.reload();
  await expect(chart.getByRole("img", { name: /Portfolio value: 2 recorded snapshots/ })).toBeVisible();
  const explorer = chart.getByRole("slider", { name: "Explore portfolio value history" });
  await explorer.focus();
  await explorer.press("Home");
  await expect(chart).toContainText("3,731,000,000 coins");
  await explorer.press("End");
  await expect(chart).toContainText("3,900,000,000 coins");
  for (const period of ["1W", "1M", "All", "1D"]) {
    const button = chart.getByRole("button", { name: period, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  await noOverflow(page);
  await chart.screenshot({ path: `.local/portfolio-value-chart-${info.project.name}.png` });
  await add(page, "DIAMOND", "64", "100");
  await expect(chart).toContainText("Incomplete prices");
  await expect(chart.getByRole("img", { name: /Portfolio value: 2 recorded snapshots/ })).toBeVisible();
  await page.reload();
  await expect(chart.getByRole("img", { name: /Portfolio value: 2 recorded snapshots/ })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, `different-chart-${info.project.name}-${Date.now()}`);
  await expect(chart).toHaveCount(0);
  await expect(page.getByText("3,900,000,000 coins")).toHaveCount(0);
});
