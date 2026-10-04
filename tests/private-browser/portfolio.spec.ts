import { test, expect, type Page } from "@playwright/test";
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
    .getByRole("button", { name: "New portfolio", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Create portfolio" });
  await form.getByLabel("Portfolio name").fill(name);
  await form.getByRole("button", { name: "Save portfolio" }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
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
  const card = page.getByRole("article", { name: "Booster Cookie holding" });
  const form = page.getByRole("form", { name: "Holding notification" });
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
  await card.getByRole("button", { name: "Edit notification" }).click();
  await form.getByLabel("Upward threshold (%)").fill("15");
  await form.getByRole("button", { name: "Save and enable" }).click();
  await expect(card).toContainText("↑ 15%");
  await page.getByRole("link", { name: "Notifications", exact: true }).click();
  await page.getByRole("button", { name: "Delete notification" }).click();
  await expect(
    page.getByText("No holding notifications yet.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Portfolios", exact: true }).click();
  await card.getByRole("button", { name: "Set notification" }).click();
  await form.getByLabel("Upward threshold (%)").fill("20");
  await form.getByRole("button", { name: "Save and enable" }).click();
  await expect(form).toHaveCount(0);
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(card).toHaveCount(0);
  await add(page);
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
    page.getByRole("heading", { name: /Know what you own/ }),
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
      page.getByRole("heading", { name: /Know what you own/ }),
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
    page.getByRole("heading", { name: "Your first portfolio starts here" }),
  ).toBeVisible();
  await seedPrices(page);
  await create(page, "Long term");
  await add(page);
  const card = page.getByRole("article", { name: "Booster Cookie holding" });
  await expect(card).toContainText("3,501,400,000");
  await expect(card).toContainText("3,731,000,000");
  await expect(card).toContainText("+6.6%");
  await expect(card).toContainText("Last-known estimate");
  await card.getByRole("button", { name: "Add purchase" }).click();
  const purchase = page.getByRole("form", { name: "Add purchase" });
  await purchase.getByLabel("Additional quantity").fill("13");
  await purchase.getByLabel("Cost entry").selectOption("total");
  await purchase.getByLabel(/ · coins$/).fill("130m");
  await expect(purchase).toContainText("12,104,666.67");
  await purchase.getByRole("button", { name: "Save purchase" }).click();
  await expect(purchase).toHaveCount(0);
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
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Delete portfolio" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(
    page.getByRole("heading", { name: "Your first portfolio starts here" }),
  ).toBeVisible();
});
test("Auction House variants, separate portfolios and notification baseline form stay useful offline", async ({
  page,
}, info) => {
  await signIn(page, `auction-${info.project.name}-${Date.now()}`);
  await create(page, "Equipment");
  await page.getByRole("button", { name: "Add holding", exact: true }).click();
  const form = page.getByRole("form", { name: "Add holding" });
  await expect(form.getByLabel("Market", { exact: true })).toHaveCount(0);
  await form
    .getByRole("combobox", { name: "Search", exact: true })
    .fill("necron handle");
  await form
    .getByRole("option", { name: "Necron's Handle (NECRON_HANDLE)" })
    .click();
  await form.getByLabel("Identical stacks owned").fill("2");
  await form.getByLabel(/ · coins$/).fill("600m");
  await form.getByRole("button", { name: "Save holding" }).click();
  await expect(form).toHaveCount(0);
  const card = page.getByRole("article", { name: "Necron's Handle holding" });
  await expect(card).toContainText("1,200,000,000");
  await expect(card).toContainText("Value unavailable");
  await card.getByText("Valuation details", { exact: true }).click();
  await expect(card).toContainText("not executable liquidation");
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
  ).toBeVisible();
  await expect(
    page.getByText("No holding notifications yet.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Portfolios", exact: true }).click();
  await create(page, "Materials");
  await add(page);
  await expect(
    page.getByRole("article", { name: "Booster Cookie holding" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Equipment", exact: true }).click();
  await expect(card).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Booster Cookie holding" }),
  ).toHaveCount(0);
});
test("one search selects either market and never saves a stale item selection", async ({
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
  await expect(form.getByLabel("Identical stacks owned")).toBeVisible();
  await expect(form.getByLabel("Modifiers (JSON object)")).toBeVisible();
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
    page.getByRole("article", { name: "Booster Cookie holding" }),
  ).toHaveCount(0);
  await search.focus();
  await form.getByRole("button", { name: "Add an unlisted item" }).click();
  await form.getByLabel("SkyBlock item ID").fill("UNLISTED_TEST_SWORD");
  await expect(form.getByLabel("Item name", { exact: true })).toHaveValue(
    "Unlisted test sword",
  );
  await expect(form.getByLabel("Identical stacks owned")).toHaveValue("2");
  await form.getByRole("button", { name: "Save holding", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: "Unlisted test sword holding" }),
  ).toContainText("Auction House");
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
  const card = page.getByRole("article", { name: "Booster Cookie holding" });
  await expect(card).toContainText("50,000,000");
  await expect(
    page.getByRole("heading", { name: "My portfolio", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("5 items");
});
