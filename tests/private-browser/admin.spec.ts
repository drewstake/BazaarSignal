import { test, expect, type Page } from "@playwright/test";
import { emptyAdmin } from "../../shared/admin";
import { BILLING_ACCOUNT_ID, BILLING_INTERVAL_START, BILLING_SUBSCRIPTION } from '../../shared/paid-spending';
// Admin times stay in fixed EST even for a viewer outside Eastern time.
test.use({ timezoneId: "Asia/Tokyo" });
async function signIn(page: Page, email: string) {
  await page.evaluate(async (email) => {
    const { auth } = await import("/src/data.ts");
    const { GoogleAuthProvider, signInWithCredential } =
      await import("/node_modules/.vite/deps/firebase_auth.js");
    if (!auth.emulatorConfig) throw Error("Emulator required");
    await signInWithCredential(
      auth,
      GoogleAuthProvider.credential(
        JSON.stringify({
          sub: email,
          email,
          email_verified: true,
          iss: "https://accounts.google.com",
          aud: "demo-client",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ),
    );
  }, email);
}
const report = () => {
  const now = Date.now(),
    r = emptyAdmin(now);
  r.pilot = {
    measuredAt: now,
    startsAt: now - 3600000,
    expiresAt: now + 86400000,
    budgetUsd: 5,
    stopUsd: 4.5,
    reservedUsd: 1.012,
    stoppedAt: null,
    reason: null,
    lastPriceCheck: now - 1000,
    priceError: null,
  };
  r.scheduler = {
    measuredAt: now,
    state: "ENABLED",
    schedule: "0 * * * *",
    expiresAt: r.pilot.expiresAt,
  };
  r.users = {
    measuredAt: now,
    total: 2,
    disabled: 0,
    days: Array.from({ length: 30 }, (_, i) => ({
      day: new Date(now - (29 - i) * 86400000).toISOString().slice(0, 10),
      count: i === 15 ? 2 : 0,
    })),
  };
  return r;
};

test('actual Google spending drives the budget display even above the old reserve stop', async ({ page }, info) => {
  const snapshot = report(), publishedAt = Date.now() - 3600000;
  snapshot.pilot!.reservedUsd = 5.3;
  snapshot.pilot!.billing = {
    accountId: BILLING_ACCOUNT_ID, budgetId: 'test-budget', subscription: BILLING_SUBSCRIPTION,
    intervalStart: BILLING_INTERVAL_START, scope: 'BazaarSignal market project · after credits',
    latest: { actualUsd: 0, publishedAt, receivedAt: Date.now(), intervalStart: BILLING_INTERVAL_START },
  };
  snapshot.billing = { actualUsd: 0, measuredAt: publishedAt, reason: 'Google-reported net cost after credits.', sourceUrl: 'https://console.cloud.google.com/billing' };
  await page.route('**/macros/s/portfolio-emulator/exec', route => route.fulfill({ json: { ok: true, data: snapshot } }));
  await page.goto('/#view=admin');
  await signIn(page, 'drewstake3@gmail.com');
  await expect(page.getByText('Active paid pilot', { exact: true })).toBeVisible();
  const cards = page.locator('.admin-cards').first();
  await expect(cards.locator('article').nth(0)).toContainText('$0.00');
  await expect(cards.locator('article').nth(1)).toContainText('no longer triggers a spending pause');
  await expect(cards.locator('article').nth(3)).toContainText('$4.50');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-label', 'Reported Google spending toward pause limit');
  await expect(page.getByText('Connect spending data', { exact: true })).toHaveCount(0);
  await page.getByText('How this reserve is calculated', { exact: true }).click();
  await expect(cards.locator('article').nth(1)).toContainText('$1.00 fixed safety buffer + $4.30');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.local/actual-spending-${info.project.name}.png`, fullPage: true });
});

test("owner-only Admin, legacy Usage redirect, private response lifecycle and mobile layout", async ({
  page,
}, info) => {
  const snapshot = report();
  let calls = 0;
  const marketCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("hypixel.net") || r.url().includes("/api/companion"))
      marketCalls.push(r.url());
  });
  await page.route("**/macros/s/portfolio-emulator/exec", (route) => {
    calls++;
    expect(route.request().postDataJSON()).toMatchObject({
      action: "admin-report",
      idToken: expect.any(String),
    });
    return route.fulfill({ json: { ok: true, data: snapshot } });
  });
  await page.goto("/#view=usage");
  await expect(page).toHaveURL(/#view=admin$/);
  await expect(
    page.getByRole("link", { name: "Admin", exact: true }),
  ).toHaveCount(0);
  await signIn(page, "someone-else@example.test");
  await expect(
    page.getByRole("heading", { name: "Owner access only" }),
  ).toBeVisible();
  expect(calls).toBe(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "drewstake3@gmail.com");
  await expect(
    page.getByRole("heading", { name: "Admin", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Active paid pilot", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Actual Google charges")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".admin-cards").first()).toContainText("$1.012");
  await expect(page.locator(".admin-cards").first()).toContainText("$3.488");
  await expect(
    page.getByRole("link", { name: "Google billing notification timing" }),
  ).toBeHidden();
  await page.getByText("About Google spending updates", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Google billing notification timing" }),
  ).toBeVisible();
  await expect(page.getByText("Popular pages", { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Updates daily · 7:10 AM EST", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/^Daily snapshot · Report checked/),
  ).toContainText(/EST · Next scheduled update .* EST\./);
  expect(marketCalls).toEqual([]);
  if (info.project.name === "mobile")
    await page.setViewportSize({ width: 320, height: 850 });
  await page.getByText("Daily sign-up counts", { exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "Reporting period (EST)" }),
  ).toBeVisible();
  await expect(page.locator(".admin-signups tbody tr").first()).toContainText(
    /7:00 PM EST – .*7:00 PM EST/,
  );
  await expect(page.locator(".admin-page")).not.toContainText("UTC");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByText("Daily sign-up counts", { exact: true }).click();
  await page.screenshot({
    path: `.local/admin-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("Actual Google charges")).toHaveCount(0);
  await expect(page.locator(".admin-page")).toHaveCount(0);
});

test("daily snapshot has no manual refresh or background scans and retains measured status until overdue", async ({
  page,
}) => {
  const snapshot = report();
  snapshot.pilot!.expiresAt += 7 * 86400000;
  snapshot.scheduler!.expiresAt = snapshot.pilot!.expiresAt;
  snapshot.failures = [
    "Paid budget and prices: refresh unavailable; any displayed measurement retains its original time.",
  ];
  let calls = 0;
  await page.clock.install();
  await page.route("**/macros/s/portfolio-emulator/exec", (route) => {
    calls++;
    return route.fulfill({ json: { ok: true, data: snapshot } });
  });
  await page.goto("/#view=admin");
  await signIn(page, "drewstake3@gmail.com");
  await expect(
    page.getByText("Active paid pilot", { exact: true }),
  ).toBeVisible();
  const initialCalls = calls;
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("link", { name: "Admin", exact: true }).click();
    await expect(
      page.getByText("Active paid pilot", { exact: true }),
    ).toBeVisible();
  }
  expect(calls).toBe(initialCalls);
  await page.clock.fastForward(12 * 3600000);
  await expect(
    page.getByText("Active paid pilot", { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(14 * 3600000);
  await expect(
    page.getByText("Verification due", { exact: true }),
  ).toBeVisible();
  expect(calls).toBe(initialCalls);
  await expect(
    page.getByText("Verification due", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("Operating measurements & schedule", { exact: true })
    .click();
  await expect(
    page.getByText(/Paid budget and prices: refresh unavailable/),
  ).toBeVisible();
  await expect(
    page.locator(".admin-cards").first().locator("article").first(),
  ).toContainText("Unavailable");
  expect(calls).toBe(initialCalls);
  await page.clock.fastForward(8 * 86400000);
  await expect(page.getByText("Expired", { exact: true })).toBeVisible();
});

test("Settings legacy links select the corresponding section and unsubscribe stays explicit", async ({
  page,
}, info) => {
  await page.goto("/#view=notifications");
  await signIn(page, `settings-${info.project.name}@example.test`);
  await expect(page).toHaveURL(/#view=settings&section=notifications$/);
  await expect(
    page.getByRole("heading", { name: "Alerts", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.goto("/#view=account");
  await expect(page).toHaveURL(/#view=settings&section=account$/);
  await expect(
    page.getByLabel("Allow email for my holding notifications"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Account & email", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `.local/settings-${info.project.name}.png`,
    fullPage: true,
  });
  let mutations = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("macros/s/")) mutations++;
  });
  await page.goto("/#disable=" + "a".repeat(64));
  await expect(
    page.getByRole("heading", { name: "Disable legacy alert" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Disable alert", exact: true }),
  ).toBeVisible();
  expect(mutations).toBe(0);
});

test('failed Admin history can recover on reopening after the cooldown without background requests', async ({ page }) => {
  await page.clock.install();
  let historyCalls = 0;
  await page.route('**/macros/s/portfolio-emulator/exec', route => {
    if (route.request().postDataJSON().action === 'admin-report')
      return route.fulfill({ json: { ok: true, data: report() } });
    historyCalls++;
    return route.fulfill({ json: historyCalls === 1 ? { ok: false, error: 'History temporarily unavailable.' } :
      { ok: true, data: { generatedAt: Date.now(), collection: { state: 'PAUSED', measuredAt: Date.now() }, rows: [] } } });
  });
  await page.goto('/#view=admin');
  await signIn(page, 'drewstake3@gmail.com');
  const summary = page.getByText('Historical free-tier report · October 2026', { exact: true });
  await summary.click();
  await expect(page.getByRole('alert')).toContainText('History temporarily unavailable.');
  await summary.click(); await summary.click();
  await expect(page.getByRole('alert')).toContainText('History temporarily unavailable.');
  expect(historyCalls).toBe(1);
  await summary.click();
  await page.clock.fastForward(61000);
  expect(historyCalls).toBe(1);
  await summary.click();
  await expect(page.locator('.admin-history')).toContainText('Collection was paused');
  expect(historyCalls).toBe(2);
});
