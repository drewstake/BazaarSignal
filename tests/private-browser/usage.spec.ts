import { test, expect, type Page, type Locator } from "@playwright/test";
import { measureDashboard } from "../../collector/usage-dashboard";
async function signIn(page: Page, email: string) {
  await page.evaluate(async (email) => {
    const { auth } = await import("/src/data.ts");
    const { GoogleAuthProvider, signInWithCredential } =
      await import("/node_modules/.vite/deps/firebase_auth.js");
    if (!auth.emulatorConfig)
      throw new Error("Only the local emulator may accept test identities");
    const token = JSON.stringify({
      sub: email,
      email,
      email_verified: true,
      iss: "https://accounts.google.com",
      aud: "demo-client",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    await signInWithCredential(auth, GoogleAuthProvider.credential(token));
  }, email);
}
async function expandResource(resource: Locator) {
  const toggle = resource.getByRole("button", { name: /details for/ });
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
}

test("local report refresh replaces stale status while keeping unknown spending and making no market calls", async ({ page }) => {
  const snapshot = await measureDashboard({
    store: {read: async () => null, commit: async () => { throw new Error("No writes"); }, close: async () => {}},
    token: async () => "offline", network: async () => new Response("{}"),
  });
  snapshot.generatedAt = Date.now() - 86400000;
  snapshot.nextMeasurementAt = snapshot.generatedAt + 1800000;
  snapshot.stale = true;
  snapshot.localReport = "Read-only cloud measurements cached on this computer. Refresh checks for new measurements at most once every 30 minutes.";
  snapshot.collection.state = "Paused";
  let calls = 0;
  const marketCalls: string[] = [];
  page.on("request", request => {
    if (/\/api\/companion\//.test(request.url()) || request.url().includes("hypixel.net")) marketCalls.push(request.url());
  });
  await page.route("**/api/owner/usage", route => { calls++; return route.fulfill({json: snapshot}); });
  await page.goto("/#view=usage");
  await signIn(page, "drewstake3@gmail.com");
  await expect(page.getByText("Report out of date", {exact: true})).toBeVisible();
  await expect(page.getByText("Current state unknown", {exact: true})).toBeVisible();
  await page.locator(".usage-local-report > summary").click();
  await expect(page.locator(".usage-local-report")).toContainText("30 minutes");
  await expect(page.locator(".usage-local-report")).toContainText("Report checked:");
  await page.clock.install();
  await page.clock.fastForward(61000);
  snapshot.generatedAt = Date.now() + 61000;
  snapshot.nextMeasurementAt = snapshot.generatedAt + 1800000;
  snapshot.localNextAttemptAt = snapshot.nextMeasurementAt;
  snapshot.stale = false;
  await page.getByRole("button", {name: "Refresh", exact: true}).click();
  await expect(page.getByText("Report out of date", {exact: true})).toHaveCount(0);
  await expect(page.getByText("Current state unknown", {exact: true})).toHaveCount(0);
  await expect(page.locator(".usage-summary article").nth(1)).toContainText("Paused");
  await page.getByText("Collection details", {exact: true}).click();
  await expect(page.locator(".usage-summary article").nth(1)).toContainText("90% of any individual app budget");
  await expect(page.locator(".usage-summary article").nth(1)).toContainText("headroom checks can slow or pause them earlier");
  await expect(page.getByText("Updates slow at 65% reserved.", {exact: true})).toHaveCount(0);
  await expect(page.locator(".usage-summary article").nth(2)).toContainText("Unknown");
  await expect(page.locator(".usage-local-report > summary")).toContainText("Refresh checks for new measurements");
  expect(calls).toBe(2);
  expect(marketCalls).toEqual([]);
});

test("owner tab, private response lifecycle, cached refresh UI, mobile layout and no market calls", async ({
  page,
}, info) => {
  const snapshot = await measureDashboard({
    store: {
      read: async () => null,
      commit: async () => {
        throw new Error("Fixture must never write");
      },
      close: async () => {},
    },
    token: async () => "offline-fixture",
    network: async () => new Response("{}"),
  });
  let calls = 0;
  const marketCalls: string[] = [];
  await page.route("**/api/owner/usage", async (route) => {
    calls++;
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    await route.fulfill({ json: snapshot });
  });
  page.on("request", (r) => {
    if (/\/api\/companion\//.test(r.url()) || r.url().includes("hypixel.net"))
      marketCalls.push(r.url());
  });
  await page.goto("/#view=usage");
  await expect(
    page.getByRole("heading", { name: /Your SkyBlock portfolio|Owner access only/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Usage & Costs" })).toHaveCount(
    0,
  );
  expect(calls).toBe(0);
  await signIn(page, "someone-else@example.test");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Your SkyBlock portfolio|Owner access only/ }),
  ).toBeVisible();
  expect(calls).toBe(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "drewstake3@gmail.com");
  await expect(page.getByRole("link", { name: "Usage & Costs" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Usage & Costs", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Actual spending this month")).toBeVisible();
  await expect(page.getByRole("button", { name: /Refresh in/ })).toBeDisabled();
  expect(calls).toBe(1);
  expect(marketCalls).toEqual([]);
  await expect(page.locator(".usage-coverage")).toContainText(
    "unknown measurements",
  );
  await expect(page.locator(".usage-coverage")).toContainText(
    "Unknown usage is not confirmed within allowance",
  );
  await page.locator(".usage-coverage > summary").click();
  await expandResource(
    page.getByRole("rowgroup", { name: "Apps Script URL Fetch", exact: true }),
  );
  await expect(
    page.getByRole("rowgroup", { name: "Apps Script URL Fetch", exact: true }),
  ).toContainText("does not expose remaining URL Fetch");
  await expect(
    page
      .getByRole("rowgroup", { name: "Apps Script URL Fetch", exact: true })
      .getByRole("progressbar"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `.local/usage-dashboard-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: /Your SkyBlock portfolio|Owner access only/ }),
  ).toBeVisible();
  await expect(page.getByText("Actual spending this month")).toHaveCount(0);
  await expect(
    page.getByText("bazaarsignal-510305", { exact: true }),
  ).toHaveCount(0);
});

test("corrected container storage is within allowance and an old cached source becomes unknown without a false cost warning", async ({
  page,
}, info) => {
  const snapshot = await measureDashboard({
    store: {
      read: async () => null,
      commit: async () => false,
      close: async () => {},
    },
    token: async () => "fixture",
    network: async (url: any) =>
      new Response(
        JSON.stringify(
          String(url).startsWith("https://artifactregistry.googleapis.com/")
            ? { sizeBytes: "284076588" }
            : {},
        ),
      ),
  });
  let calls = 0;
  await page.route("**/api/owner/usage", (route) => {
    calls++;
    return route.fulfill({ json: snapshot });
  });
  await page.goto("/#view=usage");
  await signIn(page, "drewstake3@gmail.com");
  const card = page.getByRole("rowgroup", {
    name: "Container images",
    exact: true,
  });
  await expect(card).toContainText("Within allowance");
  await expect(card).toContainText("270.92 MiB");
  await expect(card).toContainText("512 MiB");
  await expect(card.getByRole("progressbar")).toHaveAttribute(
    "aria-valuetext",
    "52.9% of allowance",
  );
  await expect(card.getByRole("progressbar")).toHaveCSS("height", "12px");
  expect(
    await card
      .getByRole("progressbar")
      .evaluate(
        (el) =>
          el.firstElementChild!.getBoundingClientRect().width / el.clientWidth,
      ),
  ).toBeCloseTo(0.529, 2);
  await expect(card).not.toContainText("Storage-only estimate");
  if (info.project.name === "mobile")
    await page.setViewportSize({ width: 320, height: 800 });
  await expandResource(card);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `.local/usage-image-storage-${info.project.name}.png`,
    fullPage: true,
  });
  const row = snapshot.rows.find((r) => r.id === "images")!;
  delete row.measurementBasis;
  row.measured = 791515006;
  await page.reload();
  await expect(page.locator(".usage-coverage")).toBeVisible();
  await page.locator(".usage-coverage > summary").click();
  await expect(card).toContainText("Unknown");
  await expect(card).toContainText("source was corrected");
  await expect(card).not.toContainText("754.85");
  await expect(card).not.toContainText("Storage-only estimate");
  await expect(card.getByRole("progressbar")).toHaveCount(0);
  expect(calls).toBe(2);
});

test("attention first, current and projected usage, capacity estimate, expanded mobile cards and stale report", async ({
  page,
}, info) => {
  const snapshot = await measureDashboard({
    store: {
      read: async () => null,
      commit: async () => false,
      close: async () => {},
    },
    token: async () => "fixture",
    network: async () => new Response("{}"),
  });
  const cpu = snapshot.rows.find((r) => r.id === "run-cpu")!;
  Object.assign(cpu, {
    state: "measured",
    measured: 9000,
    projected: 189000,
    percent: 5,
    measuredAt: Date.now(),
  });
  const images = snapshot.rows.find((r) => r.id === "images")!;
  Object.assign(images, {
    state: "measured",
    measured: 0.75 * 1024 ** 3,
    percent: 150,
    measuredAt: Date.now(),
  });
  const requests = snapshot.rows.find((r) => r.id === "run-requests")!;
  Object.assign(requests, {
    state: "measured",
    measured: 1000,
    projected: 5000,
    percent: 0.05,
    measuredAt: Date.now(),
  });
  let calls = 0;
  await page.route("**/api/owner/usage", (route) => {
    calls++;
    return route.fulfill({ json: snapshot });
  });
  await page.goto("/#view=usage");
  await signIn(page, "drewstake3@gmail.com");
  await expect(page.getByText("2 resources need attention")).toBeVisible();
  const cards = page.locator(
    '[aria-labelledby="usage-resources"] tbody[aria-label]',
  );
  await expect(cards.first()).toHaveAttribute("aria-label", "Container images");
  await expect(cards.first()).toContainText("Over allowance");
  await expect(cards.first()).toContainText("$0.025 USD/month");
  await expect(cards.first()).toContainText("Stored capacity");
  await expect(cards.first().getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  const cpuCard = page.getByRole("rowgroup", {
    name: "Cloud Run CPU",
    exact: true,
  });
  await expect(cpuCard).toContainText("Within allowance");
  await expect(cpuCard).toContainText("Estimated month-end:");
  await expect(cpuCard).toContainText("189,000 vCPU-s");
  await expect(page.getByRole("table")).toHaveCount(1);
  await expect(
    page.getByRole("columnheader", { name: "Used %" }),
  ).toHaveAttribute("aria-sort", "descending");
  await expect(
    cpuCard.getByRole("button", { name: "Show details for Cloud Run CPU" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(cpuCard.getByText("Forecast high")).toBeVisible();
  await expandResource(cpuCard);
  await page.screenshot({
    path: `.local/usage-redesign-${info.project.name}.png`,
    fullPage: true,
  });
  if (info.project.name === "mobile")
    await page.setViewportSize({ width: 320, height: 800 });
  await page.locator(".usage-coverage > summary").click();
  await expandResource(
    page.getByRole("rowgroup", { name: "Apps Script URL Fetch", exact: true }),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `.local/usage-expanded-${info.project.name}.png`,
    fullPage: true,
  });
  // Advance the display clock without fetching; old measurements must lose a healthy status.
  await page.clock.install();
  await page.clock.fastForward(31 * 60000);
  await expect(
    page.getByText("Report out of date", { exact: true }),
  ).toBeVisible();
  await expect(cpuCard).toContainText("Unknown");
  await expect(cpuCard.getByRole("progressbar")).toHaveAttribute(
    "aria-valuetext",
    "Last reported: 5.0% of allowance",
  );
  await expect(cpuCard.getByRole("progressbar")).toHaveClass(/stale/);
  expect(calls).toBe(1);
});
