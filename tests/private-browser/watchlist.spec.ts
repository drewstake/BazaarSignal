import { test, expect, type Page } from "@playwright/test";
async function emulatorSignIn(page: Page, identity: string) {
  await page.evaluate(async (identity) => {
    // Test-only credential accepted by the local Auth emulator. No application
    // auth bypass, production test identity, or real Google account is used.
    const { auth } = await import("/src/data.ts");
    const { GoogleAuthProvider, signInWithCredential } =
      await import("/node_modules/.vite/deps/firebase_auth.js");
    if (!auth.emulatorConfig)
      throw new Error("Refusing test credentials outside the emulator");
    const token = JSON.stringify({
      sub: identity,
      email: `${identity}@example.test`,
      email_verified: true,
      iss: "https://accounts.google.com",
      aud: "demo-client",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    await signInWithCredential(auth, GoogleAuthProvider.credential(token));
  }, identity);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}
test("save, reload, reopen, remove and switch user without leaking private data", async ({
  page,
}, info) => {
  await page.goto("/?fixtures=1");
  await expect(page.getByRole("article").first()).toBeVisible();
  const alice = `alice-${info.project.name}-${Date.now()}`;
  await emulatorSignIn(page, alice);
  await page.getByRole("button", { name: /^Watchlist/ }).click();
  await expect(
    page.getByRole("heading", { name: "No saved items yet" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bazaar", exact: true }).click();
  const card = page.getByRole("article").first();
  const name = await card.getByRole("heading").innerText();
  await card.getByRole("button", { name: `Save ${name}`, exact: true }).click();
  await expect(
    card.getByRole("button", { name: `Remove ${name}`, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Watchlist/ }).click();
  await expect(
    page.locator(".saved-items").getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".saved-items").getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  const savedCard = page
    .locator(".saved-items article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(savedCard.getByText("Reopen", { exact: true })).toHaveCount(0);
  if (info.project.name === "mobile") await savedCard.tap();
  else await savedCard.click();
  const inspector = page.getByRole("dialog", { name: "Item details" });
  await expect(
    inspector.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close item details" }).click();
  await page.getByRole("button", { name: /^Watchlist/ }).click();
  const reopen = savedCard.getByRole("button", {
    name: `Reopen ${name}`,
    exact: true,
  });
  for (const key of ["Enter", "Space"]) {
    await reopen.focus();
    await expect(reopen).toBeFocused();
    await page.keyboard.press(key);
    await expect(
      inspector.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close item details" }).click();
    await page.getByRole("button", { name: /^Watchlist/ }).click();
  }
  await page.getByRole("button", { name: "Bazaar", exact: true }).click();
  await page.getByText("More filters", { exact: true }).click();
  await page.getByLabel("Budget · coins", { exact: true }).fill("23456789");
  await page.getByRole("button", { name: "Save filters", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "private filter preferences",
  );
  await page.reload();
  await expect(page.getByLabel("Budget · coins", { exact: true })).toHaveValue(
    "23456789",
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: /^Watchlist/ }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to use Watchlist" }),
  ).toBeVisible();
  await emulatorSignIn(page, `bob-${info.project.name}-${Date.now()}`);
  await expect(
    page.getByRole("heading", { name: "No saved items yet" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await emulatorSignIn(page, alice);
  await expect(
    page.locator(".saved-items").getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Remove ${name}`, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No saved items yet" }),
  ).toBeVisible();
});

// Existing watchlist keys are auction IDs, including listings that are not the
// cheapest representative of their newly grouped item.
test("grouped auctions preserve independent saves and reopen an existing non-representative auction", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "bazaarsignal:filters:auctions",
      JSON.stringify({ minProfit: -1e9, minRoi: -1e9 }),
    ),
  );
  await page.goto("/?fixtures=1#market=auctions");
  await emulatorSignIn(page, `auction-${info.project.name}-${Date.now()}`);
  const card = page.getByRole("article", { name: "Livid Dagger opportunity" });
  await card
    .getByRole("button", { name: "Save Livid Dagger", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "Remove Livid Dagger", exact: true }),
  ).toBeVisible();
  await page.getByText("More filters", { exact: true }).click();
  await page
    .getByLabel("Minimum after-fee gap", { exact: true })
    .fill("-1000000000");
  await page
    .getByLabel("Minimum gap / cost (%)", { exact: true })
    .fill("-1000000000");
  await page.getByText("More filters", { exact: true }).click();
  await expect(card).toContainText("17 matching listings");
  await card
    .getByRole("button", { name: "Inspect Livid Dagger", exact: true })
    .click();
  const inspector =
    info.project.name === "mobile"
      ? page.getByRole("dialog")
      : page.getByRole("complementary", { name: "Item details" });
  await expect(inspector.locator(".auction-listing-row")).toHaveCount(17);
  const own = "0123456789abcdef0123456789abcdef";
  await inspector
    .getByRole("button", { name: "Save auction fixture-0", exact: true })
    .click();
  await expect(
    inspector.getByRole("button", {
      name: "Remove auction fixture-0",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    inspector.getByRole("button", {
      name: `Select auction ${own}`,
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Close item details" }).click();
  await page.getByRole("button", { name: /^Watchlist/ }).click();
  await expect(page.locator(".saved-items article")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".saved-items article")).toHaveCount(2);
  await page.route(/\/api\/companion\/auctions\/(fixture-0|0123456789abcdef0123456789abcdef)\?/, async (route) => {
    const { auctionFixtures } = await import("../../src/companion/fixtures");
    const { defaultAuctionFilters } =
      await import("../../shared/companion/auctions");
    const { activeOpportunity } =
      await import("../../shared/companion/active-auctions");
    const result = auctionFixtures(
      { ...defaultAuctionFilters, minProfit: -1e9, minRoi: -1e9 },
      0,
    ).items[0];
    const pool = result.group!.comparisonPool;
    return route.fulfill({
      json: activeOpportunity(
        pool.find((l) => l.id === new URL(route.request().url()).pathname.split("/").pop())!,
        pool,
        Date.now(),
        24,
        result.feeContext,
      ),
    });
  });
  const saved = page.locator(".saved-items article").first();
  await saved
    .getByRole("button", { name: "Reopen Livid Dagger", exact: true })
    .click();
  await expect(inspector.locator(".price-comparison")).toContainText(
    "3,200,000",
  );
  await expect(
    inspector
      .locator(".inspector-item")
      .getByRole("button", { name: "Remove Livid Dagger", exact: true }),
  ).toBeVisible();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Close item details" }).click();
  await page.getByRole("button", { name: /^Watchlist/ }).click();
  await saved
    .getByRole("button", { name: "Remove Livid Dagger", exact: true })
    .click();
  await expect(page.locator(".saved-items article")).toHaveCount(1);
  await page.locator(".saved-items article").getByRole("button", {name:"Reopen Livid Dagger",exact:true}).click();
  await expect(inspector.locator(".price-comparison")).toContainText("2,400,000");
});
