import { test, expect } from "@playwright/test";
test("name search reveals filtered items and keeps trade inputs explicit", async ({page}, info) => {
  await page.goto('/?fixtures=1');
  await page.getByText('More filters', {exact:true}).click();
  await page.getByLabel('Budget · coins', {exact:true}).fill('1');
  await page.getByText('More filters', {exact:true}).click();
  await page.getByRole('searchbox', {name:'Search Bazaar items'}).fill('Summoning Eye');
  const card = page.getByRole('article', {name:'Summoning Eye opportunity'});
  await expect(card).toBeVisible();
  await expect(card).toContainText('exceeds your budget');
  await expect(card).toContainText('64 items');
  await expect(card).toContainText('Sell before tax');
  await expect(page.getByLabel('Quantity', {exact:true})).toHaveValue('64');
  await card.getByRole('button', {name:'Inspect Summoning Eye',exact:true}).click();
  const inspector = info.project.name === 'mobile' ? page.getByRole('dialog') : page.getByRole('complementary', {name:'Item details'});
  await inspector.getByLabel('Inspector quantity').fill('1');
  await expect(inspector).toContainText('Totals for 1 item');
  await expect(inspector).toContainText('1.25% sale tax');
  await inspector.getByText('Liquidity & order book', {exact:false}).click();
  await expect(inspector.getByText('Highest buy order / item')).toBeVisible();
  if (info.project.name === 'mobile') await page.getByRole('button', {name:'Close item details'}).click();
  await expect(page.getByLabel('Quantity', {exact:true})).toHaveValue('1');
  await page.getByRole('button', {name:'Clear search',exact:true}).click();
  await expect(page.getByRole('article')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("Bazaar budget, activity, quantity, views, filter persistence and responsive inspector", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?fixtures=1");
  await expect(
    page.getByRole("heading", { name: "Bazaar" }),
  ).toBeVisible();
  await expect(
    page.getByText("DEVELOPMENT FIXTURES", { exact: false }),
  ).toBeVisible();
  await page.getByText("More filters", { exact: true }).click();
  await page.getByLabel("Budget · coins", { exact: true }).fill("50000000");
  await page.getByText("More filters", { exact: true }).click();
  await page.getByLabel("Quantity", { exact: true }).fill("16");
  await expect(
    page.getByRole("article", { name: "Summoning Eye opportunity" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Inspect Summoning Eye", exact: true })
    .click();
  const inspector =
    info.project.name === "mobile"
      ? page.getByRole("dialog", { name: "Item details" })
      : page.getByRole("complementary", { name: "Item details" });
  await expect(inspector.getByText("Fees & calculation")).toBeVisible();
  await inspector.getByLabel("Inspector quantity").fill("8");
  await expect(inspector).toContainText("Profit / unit");
  await expect(inspector).toContainText("7-day units + sampled state");
  await page.screenshot({
    path: `.local/companion/inspector-${info.project.name}.png`,
    fullPage: true,
  });
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Close item details" }).click();
  await page.getByRole("button", { name: "Compact list view" }).click();
  await expect(page.locator(".compact-list")).toBeVisible();
  await page.getByRole("button", { name: "Card view", exact: true }).click();
  await page.getByText("More filters", { exact: true }).click();
  await page.getByLabel("Minimum activity on both sides").fill("999999999");
  await page.getByText("More filters", { exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "No matching opportunities",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText("More filters", { exact: true }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByText("More filters", { exact: true }).click();
  await page.getByText("More filters", { exact: true }).click();
  await page.getByLabel("Budget · coins", { exact: true }).fill("50000000");
  await page.getByText("More filters", { exact: true }).click();
  await page.getByLabel("Quantity", { exact: true }).fill("16");
  await page.reload();
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("16");
  await page.screenshot({
    path: `.local/companion/market-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("auction evidence, enchantment exclusion and availability checks", async ({
  page,
}, info) => {
  await page.goto("/?fixtures=1#market=auctions");
  await expect(
    page.getByRole("article", { name: "Livid Dagger opportunity" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View details for Livid Dagger", exact: true })
    .click();
  const inspector =
    info.project.name === "mobile"
      ? page.getByRole("dialog")
      : page.getByRole("complementary", { name: "Item details" });
  await expect(inspector.getByText("The comparison evidence")).toBeVisible();
  await expect(
    inspector.getByText("Sharpness", { exact: false }),
  ).toBeVisible();
  await inspector.getByRole("button", { name: "Recheck availability" }).click();
  await expect(
    inspector.getByRole("button", { name: "Copy fixture command" }),
  ).toBeVisible();
  await page.screenshot({
    path: `.local/companion/auction-${info.project.name}.png`,
    fullPage: true,
  });
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Close item details" }).click();
  await page.getByText("More filters", { exact: true }).click();
  await page
    .getByLabel("Excluded enchantment", { exact: true })
    .fill("sharpness");
  await page.getByText("More filters", { exact: true }).click();
  await expect(
    page.getByRole("article", { name: "Livid Dagger opportunity" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("anonymous watchlist stays private and alerts remain reachable", async ({
  page,
}) => {
  await page.goto("/?fixtures=1");
  await page
    .getByRole("article")
    .first()
    .getByRole("button", { name: /^Save / })
    .click();
  await expect(page.getByRole("alert")).toContainText("Sign in with Google");
  await page.getByRole("button", { name: "Watchlist", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to use Watchlist" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Price alerts" }).click();
  await expect(page).toHaveURL(/alerts=1/);
});
test("failed live data never falls back to fixtures", async ({ page }) => {
  await page.route("**/api/companion/bazaar", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Upstream test outage" }),
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Upstream test outage");
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(
    page.getByText("DEVELOPMENT FIXTURES", { exact: false }),
  ).toHaveCount(0);
});
