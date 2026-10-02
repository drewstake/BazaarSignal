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
  await page.getByRole("button", { name: "Reopen", exact: false }).click();
  const inspector =
    info.project.name === "mobile"
      ? page.getByRole("dialog")
      : page.getByRole("complementary", { name: "Item details" });
  await expect(
    inspector.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Close item details" }).click();
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
