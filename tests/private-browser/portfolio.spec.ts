import { test, expect, type Page } from "@playwright/test";
import { normalizeBazaar } from "../../shared/companion/bazaar";
import catalog from '../../src/companion/bazaar-catalog.json' with { type: 'json' };
test.use({ timezoneId: "Asia/Tokyo" });
const signIn = async (page: Page, id: string, waitForHeader = true) => {
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
  if (waitForHeader) await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
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

test("header search reuses portfolio data and preserves holdings and navigation", async ({ page }, info) => {
  const marketRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/companion/')) marketRequests.push(request.url()); });
  await seedPrices(page);
  await signIn(page, `header-search-${info.project.name}-${Date.now()}`);
  await create(page, 'Search portfolio');
  await add(page);
  const holding = page.getByRole('rowgroup', { name: 'Booster Cookie holding' });
  await expect(holding.getByRole('cell', { name: '287', exact: true })).toBeVisible();
  const search = page.getByRole('combobox', { name: 'Search Bazaar items' });
  const brand = await page.locator('.market-brand').boundingBox();
  const searchBox = await search.boundingBox();
  if (info.project.name === 'desktop') expect(searchBox!.x).toBeGreaterThanOrEqual(brand!.x + brand!.width);
  else expect(searchBox!.y).toBeGreaterThanOrEqual(brand!.y + brand!.height);
  await search.fill('BOOSTER_COOKIE'); await search.press('ArrowDown'); await search.press('Enter');
  const panel = page.getByRole('region', { name: 'Booster Cookie' });
  await expect(panel).toContainText('14,000,000 coins');
  await expect(panel).toContainText('1,000 items · 2 orders · 1 level');
  await expect(panel).toContainText('Updates paused');
  await noOverflow(page);
  await page.screenshot({ path: `.local/bazaar-search-workspace-${info.project.name}.png`, fullPage: true });
  await expect(page).toHaveURL(/#view=item&item=BOOSTER_COOKIE$/);
  await page.getByRole('link', { name: 'Back to Portfolio', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await holding.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('form', { name: 'Edit holding' });
  await expect(edit.getByLabel('Quantity owned', { exact: true })).toHaveValue('287');
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/view=settings/);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Portfolio' }).click();
  await expect(holding.getByRole('cell', { name: '287', exact: true })).toBeVisible();
  expect(marketRequests).toEqual([]);
});

test("refresh restores a saved session before choosing the landing page", async ({
  page,
}, info) => {
  await signIn(page, `restore-${info.project.name}-${Date.now()}`);
  await create(page, "Restored portfolio");
  await page.addInitScript(() => {
    (window as any).landingFlashed = false;
    new MutationObserver((changes) => {
      for (const change of changes) for (const node of change.addedNodes) {
        if (node instanceof Element &&
          (node.matches(".night-market") || node.querySelector(".night-market")))
          (window as any).landingFlashed = true;
      }
    }).observe(document, { childList: true, subtree: true });
  });
  // Hold the real persisted-session lookup so the pending state is observable.
  let release!: () => void;
  const lookup = new Promise<void>((resolve) => { release = resolve; });
  const lookupUrl = "**/identitytoolkit.googleapis.com/v1/accounts:lookup*";
  await page.route(lookupUrl, async (route) => {
    await lookup;
    await route.continue();
  });
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("status")).toHaveText("Loading BazaarSignal…");
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    await noOverflow(page);
    expect(await page.evaluate(() => (window as any).landingFlashed)).toBe(false);
    release();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Restored portfolio", exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).landingFlashed)).toBe(false);
  } finally {
    release();
    await page.unroute(lookupUrl);
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByText("Loading BazaarSignal…", { exact: true })).toHaveCount(0);
});

test('signing in on a direct item link defers private code and reads until Portfolio is opened', async ({ page }, info) => {
  await seedPrices(page);
  const privateRequests: string[] = [];
  page.on('request', request => {
    if (/\/src\/(?:companion\/Workspace\.tsx|firestore\.ts)|google\.firestore\.v1/.test(request.url())) privateRequests.push(request.url());
  });
  await page.goto('/#view=item&item=BOOSTER_COOKIE');
  await expect(page.getByRole('region', { name: 'Booster Cookie' })).toContainText('14,000,000 coins');
  await signIn(page, `direct-item-${info.project.name}-${Date.now()}`);
  await expect(page.getByRole('region', { name: 'Booster Cookie' })).toBeVisible();
  expect(privateRequests).toEqual([]);
  await page.getByRole('link', { name: 'Back to Portfolio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create portfolio', exact: true })).toBeVisible();
  expect(privateRequests.some(url => url.includes('/src/firestore.ts'))).toBe(true);
});

test('a failed workspace module leaves a clear reload action', async ({ page }, info) => {
  await page.route('**/src/companion/Workspace.tsx*', route => route.abort());
  await signIn(page, `chunk-error-${info.project.name}-${Date.now()}`, false);
  await expect(page.getByRole('alert')).toContainText('This view could not load.');
  await expect(page.getByRole('button', { name: 'Reload BazaarSignal' })).toBeVisible();
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
      source: "bazaar-ask-v1",
      capturedPrice: (request.input?.baseline ?? current?.baseline) === "sample" ? 14000000 : null,
      capturedAt: (request.input?.baseline ?? current?.baseline) === "sample" ? Date.now() : null,
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
  await seedPrices(page);
  await create(page, "Notifications test");
  await add(page);
  const card = page.getByRole("rowgroup", { name: "Booster Cookie holding" });
  const form = page.getByRole("form", { name: "Holding notification" });
  await card.getByRole("button", { name: "Set notification" }).click();
  await form.getByLabel("Price rises by (%)").fill("30");
  await expect(form.locator("#notification-up-target")).toHaveText("Sell price: 15,860,000 coins");
  await form.getByLabel("Price falls by (%)").fill("5");
  await expect(form.locator("#notification-down-target")).toHaveText("Sell price: 11,590,000 coins");
  await form.getByLabel("Compare with").selectOption("sample");
  await expect(form.locator("#notification-up-target")).toHaveText("Est. sell price: 18,200,000 coins");
  await expect(form.locator("#notification-down-target")).toHaveText("Est. sell price: 13,300,000 coins");
  await form.getByLabel("Price rises by (%)").fill("invalid");
  await expect(form.locator("#notification-up-target")).toHaveCount(0);
  await form.getByLabel("Price rises by (%)").fill("");
  await expect(form.locator("#notification-up-target")).toHaveCount(0);
  await form.getByLabel("Compare with").selectOption("acquisition");
  await form.getByLabel("Price rises by (%)").fill("10");
  await form.getByLabel("Price falls by (%)").fill("5");
  await form.getByRole("button", { name: "Save and enable" }).click();
  await expect(form).toHaveCount(0);
  await expect(card).toContainText("Enabled · ↑ 10% ↓ 5%");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const alert = page.getByRole("article", { name: "Booster Cookie notification" });
  await expect(alert.locator(".upward .notification-trigger-price")).toHaveText("13,420,000 coins");
  await expect(alert.locator(".downward .notification-trigger-price")).toHaveText("11,590,000 coins");
  await expect(alert.locator(".notification-baseline")).toHaveText("Average buy price 12,200,000 coins");
  await alert.scrollIntoViewIfNeeded();
  await noOverflow(page);
  for (const price of await alert.locator(".notification-trigger-price").all())
    await expect(price).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: `.local/settings-alert-card-both-${info.project.name}.png` });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(alert.locator(".upward .notification-trigger-price")).toHaveText("13,420,000 coins");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  const settingsEdit = page.getByRole("button", { name: "Edit notification", exact: true });
  await settingsEdit.click();
  await expect(page).toHaveURL(/#view=settings$/);
  await expect(form.getByLabel("Price rises by (%)")).toHaveValue("10");
  await expect(form.getByLabel("Price falls by (%)")).toHaveValue("5");
  await expect(form.locator("#notification-up-target")).toHaveText("Sell price: 13,420,000 coins");
  await form.getByLabel("Price rises by (%)").fill("30");
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);
  await expect(settingsEdit).toBeFocused();
  await settingsEdit.click();
  await expect(form.getByLabel("Price rises by (%)")).toHaveValue("10");
  await form.getByLabel("Price rises by (%)").fill("15");
  await page.screenshot({ path: `.local/settings-edit-alert-${info.project.name}.png` });
  await form.getByRole("button", { name: "Save and enable" }).click();
  await expect(form).toHaveCount(0);
  await expect(page).toHaveURL(/#view=settings$/);
  await expect(page.getByRole("article", { name: "Booster Cookie notification" })).toContainText("+15%");
  await expect(alert.locator(".upward .notification-trigger-price")).toHaveText("14,030,000 coins");
  await page.reload();
  await settingsEdit.click();
  await expect(form.getByLabel("Price rises by (%)")).toHaveValue("15");
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await page.getByRole("link", { name: "Portfolio", exact: true }).click();
  await expect(card).toContainText("↑ 15%");
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  const holdingForm = page.getByRole("form", { name: "Edit holding" });
  await holdingForm.getByLabel(/ · coins$/).fill("2870M");
  await holdingForm.getByRole("button", { name: "Save holding", exact: true }).click();
  await expect(holdingForm).toHaveCount(0);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(alert.locator(".upward .notification-trigger-price")).toHaveText("11,500,000 coins");
  await expect(alert.locator(".downward .notification-trigger-price")).toHaveText("9,500,000 coins");
  await page.getByRole("button", { name: "Delete notification" }).click();
  await expect(
    page.getByText("No holding notifications yet.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Portfolio", exact: true }).click();
  await card.getByRole("button", { name: "Set notification" }).click();
  await form.getByLabel("Compare with").selectOption("sample");
  await form.getByLabel("Price rises by (%)").fill("14");
  await form.getByLabel("Price falls by (%)").fill("");
  await form.getByRole("button", { name: "Save and enable" }).click();
  await expect(form).toHaveCount(0);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(alert.locator(".upward .notification-trigger-price")).toHaveText("15,960,000 coins");
  await expect(alert.locator(".downward")).toHaveCount(0);
  await expect(alert.locator(".notification-baseline")).toHaveText("Price when enabled 14,000,000 coins");
  await alert.scrollIntoViewIfNeeded();
  await noOverflow(page);
  await alert.screenshot({ path: `.local/settings-alert-card-single-${info.project.name}.png` });
  await page.reload();
  await expect(alert.locator(".upward .notification-trigger-price")).toHaveText("15,960,000 coins");
  await page.getByRole("link", { name: "Portfolio", exact: true }).click();
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
  ).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Add purchase" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Set notification" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  await expect(card).toContainText("3,501,400,000");
  await expect(card).toContainText("4,018,000,000");
  await expect(card).toContainText("+14.8%");
  await expect(card).not.toContainText("stale");
  expect(await card.innerText()).not.toMatch(/stale|last-known/i);
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit holding" }).getByRole("button", { name: "Add purchase", exact: true }).click();
  const purchase = page.getByRole("form", { name: "Add purchase" });
  await expect(purchase.getByLabel("Additional quantity")).toHaveValue("");
  await purchase.getByRole("button", { name: "Edit totals", exact: true }).click();
  const totalsEditor = page.getByRole("form", { name: "Edit holding" });
  await expect(totalsEditor.getByLabel("Quantity owned", { exact: true })).toHaveValue("287");
  await totalsEditor.getByRole("button", { name: "Add purchase", exact: true }).click();
  await purchase.getByLabel("Additional quantity").fill("13");
  await purchase.getByLabel(/ · coins$/).fill("10m");
  await expect(purchase).toContainText("12,104,666.67");
  await page.screenshot({ path: `.local/portfolio-purchase-modal-${info.project.name}.png` });
  await purchase.getByRole("button", { name: "Save purchase" }).click();
  await expect(purchase).toHaveCount(0);
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 500 });
  const editButton = card.getByRole("button", { name: "Edit", exact: true });
  await editButton.scrollIntoViewIfNeeded();
  const scrollBeforeEdit = await page.evaluate(() => window.scrollY);
  await editButton.click();
  const edit = page.getByRole("form", { name: "Edit holding" });
  await expect(page.getByRole("dialog", { name: "Edit holding" })).toBeInViewport({ ratio: 1 });
  await expect(edit.getByLabel("Quantity owned", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(edit).toHaveCount(0);
  await expect(editButton).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeEdit);
  await editButton.click();
  await page.screenshot({ path: `.local/portfolio-edit-modal-${info.project.name}.png` });
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
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 500 });
  const deleteHolding = card.getByRole("button", { name: "Delete", exact: true });
  await deleteHolding.scrollIntoViewIfNeeded();
  // Playwright may scroll again while positioning the pointer for the click.
  await deleteHolding.evaluate((button) => {
    button.addEventListener("pointerdown", () => {
      button.setAttribute("data-scroll-before-open", String(window.scrollY));
    }, { once: true });
  });
  await deleteHolding.click();
  const scrollBeforeDeletion = Number(await deleteHolding.getAttribute("data-scroll-before-open"));
  expect(scrollBeforeDeletion).toBeGreaterThan(0);
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeInViewport({ ratio: 1 });
  await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(confirmation.getByRole("button", { name: "Confirm delete" })).toBeInViewport();
  await page.keyboard.press("Shift+Tab");
  await expect(confirmation.getByRole("button", { name: "Confirm delete" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(deleteHolding).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeDeletion);
  await deleteHolding.click();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(card).toBeVisible();
  await deleteHolding.click();
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
  const notifyButton = card.getByRole("button", { name: "Set notification" });
  await notifyButton.scrollIntoViewIfNeeded();
  // Capture after Playwright positions the pointer, including horizontal scrolling.
  await notifyButton.evaluate((button) => {
    button.addEventListener("pointerdown", () => {
      button.setAttribute("data-scroll-before-open", String(window.scrollY));
    }, { once: true });
  });
  await notifyButton.click();
  const scrollBeforeNotification = Number(await notifyButton.getAttribute("data-scroll-before-open"));
  const notification = page.getByRole("form", { name: "Holding notification" });
  await expect(page.getByRole("dialog", { name: /Notify me about/ })).toBeInViewport({ ratio: 1 });
  await expect(notification.getByLabel("Compare with")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(notification).toHaveCount(0);
  await expect(notifyButton).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeNotification);
  await notifyButton.click();
  await notification.getByRole("button", { name: "Save and enable" }).click();
  await expect(notification.getByRole("alert")).toBeVisible();
  await notification.getByLabel("Price rises by (%)").fill("10");
  await notification.getByLabel("Price falls by (%)").fill("5");
  await notification.getByLabel("Compare with").selectOption("sample");
  await expect(notification).toContainText("Locks in a fresh market price");
  await expect(notification.locator("#notification-up-target")).toHaveText("Sell price unavailable");
  await noOverflow(page);
  await page.screenshot({
    path: `.local/portfolio-notification-${info.project.name}.png`,
    fullPage: false,
  });
  await notification.getByRole("button", { name: "Cancel" }).click();
  await expect(notifyButton).toBeFocused();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const check = page.getByLabel("Allow email for my holding notifications");
  await expect(check).not.toBeChecked();
  await check.check();
  await expect(check).toBeChecked();
  await expect(
    page.getByRole("status").filter({ hasText: "Email delivery enabled" }),
  ).toBeVisible();
  await page.reload();
  await expect(check).toBeChecked();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
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
  await expect(page.getByRole('rowgroup', {name:'Booster Cookie holding'}).getByRole('cell', {name:'2', exact:true})).toBeVisible();
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
  await expect(card.getByRole("cell", { name: "5", exact: true })).toBeVisible();
});

test("portfolio value chart records real totals, survives reloads and excludes partial valuations", async ({ page }, info) => {
  await signIn(page, `value-chart-${info.project.name}-${Date.now()}`);
  await seedPrices(page);
  await create(page, "Value history");
  const chart = page.getByRole("region", { name: "Portfolio value", exact: true });
  await expect(chart).toContainText("Add holdings to start your value chart.");
  await add(page);
  await expect(chart.getByRole("img", { name: /Portfolio value: 1 recorded snapshots/ })).toBeVisible();
  await expect(chart).toContainText("4,018,000,000 coins");
  await expect(chart).toContainText("Estimated value");
  await expect(chart).not.toContainText("Last-known");
  await expect(chart.locator(".value-chart-times")).toContainText("EST");
  const holding = page.getByRole("rowgroup", { name: "Booster Cookie holding" });
  await holding.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit holding" }).getByRole("button", { name: "Add purchase", exact: true }).click();
  const purchase = page.getByRole("form", { name: "Add purchase" });
  await purchase.getByLabel("Additional quantity").fill("13");
  await purchase.getByLabel(/ · coins$/).fill("10m");
  await purchase.getByRole("button", { name: "Save purchase" }).click();
  await expect(chart.getByRole("img", { name: /Portfolio value: 2 recorded snapshots/ })).toBeVisible();
  await expect(chart).toContainText("4,200,000,000 coins");
  await page.reload();
  await expect(chart.getByRole("img", { name: /Portfolio value: 2 recorded snapshots/ })).toBeVisible();
  const explorer = chart.getByRole("slider", { name: "Explore portfolio value history" });
  await explorer.focus();
  await explorer.press("Home");
  await expect(chart).toContainText("4,018,000,000 coins");
  await expect(explorer).toHaveAttribute("aria-valuetext", / EST:/);
  await expect(chart.locator(".value-chart-readout")).toContainText("EST");
  await explorer.press("End");
  await expect(chart).toContainText("4,200,000,000 coins");
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
  await expect(page.getByText("4,200,000,000 coins")).toHaveCount(0);
});

test('a 101-holding portfolio renders every record and reuses a full saved snapshot without market reads', async ({ page }, info) => {
  await signIn(page, `large-portfolio-${info.project.name}-${Date.now()}`);
  await create(page, 'Large portfolio');
  const uid = await page.evaluate(async () => (await import('/src/data.ts')).auth.currentUser.uid);
  const pid = new URLSearchParams(new URL(page.url()).hash.slice(1)).get('portfolio')!;
  const stamp = Date.now() - 1000;
  const items = catalog.slice(0, 101);
  const response = await page.request.post('http://127.0.0.1:8081/v1/projects/demo-bazaar-watch/databases/(default)/documents:commit', {
    headers: { Authorization: 'Bearer owner' },
    data: { writes: items.map(([itemId, name]) => ({ update: {
      name: `projects/demo-bazaar-watch/databases/(default)/documents/users/${uid}/portfolios/${pid}/holdings/bz_${itemId}`,
      fields: Object.fromEntries(Object.entries({ id: `bz_${itemId}`, itemId, name, kind: 'bazaar', configuration: '', stackSize: 1,
        quantity: 1, costBasis: 100, createdAt: stamp, updatedAt: stamp, revision: 1, deleted: false }).map(([key, value]) =>
        [key, typeof value === 'string' ? { stringValue: value } : typeof value === 'boolean' ? { booleanValue: value } : { integerValue: String(value) }])),
    } })) },
  });
  expect(response.ok()).toBe(true);
  const prices = items.map(([id]) => normalizeBazaar(id, { buy_summary: [{ pricePerUnit: 120, amount: 1000, orders: 2 }],
    sell_summary: [{ pricePerUnit: 110, amount: 1000, orders: 2 }] }, stamp, stamp));
  await page.evaluate(async prices => {
    const cache = await caches.open('bazaarsignal-public-market-v1');
    await cache.put(location.origin + '/api/companion/bazaar', Response.json({ at: Date.now(), body: { items: prices, error: null } }));
  }, prices);
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/companion/')) requests.push(request.url()); });
  await page.reload();
  await expect(page.locator('.holdings-table tbody')).toHaveCount(101);
  await expect(page.getByRole('region', { name: 'Portfolio value', exact: true })).toContainText('12,120 coins');
  await noOverflow(page);
  expect(requests).toEqual([]);
});


test("buying power persists and the holding ticket stays compact", async ({ page }, info) => {
  await signIn(page, `buying-power-${info.project.name}-${Date.now()}`);
  await create(page, "Available coins");
  await page.getByRole("button", { name: "Set buying power", exact: true }).click();
  const balance = page.getByRole("form", { name: "Set buying power" });
  await balance.getByLabel("Available coins").fill("-1");
  await balance.getByRole("button", { name: "Save", exact: true }).click();
  await expect(balance.getByRole("alert")).toBeVisible();
  await balance.getByLabel("Available coins").fill("250M");
  await balance.getByRole("button", { name: "Save", exact: true }).click();
  await expect(balance).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Edit buying power" })).toContainText("250,000,000");
  await page.getByRole("button", { name: "Add holding", exact: true }).click();
  const ticket = page.getByRole("form", { name: "Add holding" });
  await expect(ticket.locator("select")).toHaveCount(0);
  await expect(ticket.locator("input:visible")).toHaveCount(3);
  await expect(ticket.locator(".holding-estimate")).toHaveCount(0);
  expect((await ticket.boundingBox())!.height).toBeLessThan(350);
  await noOverflow(page);
  await ticket.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `.local/compact-holding-${info.project.name}.png`, fullPage: true });
  await ticket.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Edit buying power" }).click();
  await balance.getByLabel("Available coins").fill("0");
  await balance.getByRole("button", { name: "Save", exact: true }).click();
  await expect(balance).toHaveCount(0);
  await add(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "Edit buying power" })).toHaveText(/0 coins/);
});
