import { test, expect } from "@playwright/test";

test("fresh live prices trigger once; stale data never triggers", async ({ page }) => {
  let price = 1200000, stale = false;
  await page.route("**/api/market", async route => {
    const stamp = Date.now() - (stale ? 240000 : 0);
    await route.fulfill({ json: {
      prices: [{ id: "SUMMONING_EYE", name: "Summoning Eye", buy: price, sell: 1000000, volume: 10000 }],
      books: { SUMMONING_EYE: { buy: [{amount: 1000, pricePerUnit: price, orders: 5}], sell: [{amount: 1000, pricePerUnit: 1000000, orders: 4}] } },
      status: {lastUpdated: stamp, lastSuccess: stamp, lastAttempt: stamp, error: null},
    }});
  });
  await page.goto("/#item=SUMMONING_EYE");
  await page.getByRole("button", { name: "Create alert", exact: true }).click();
  const form = page.locator(".alert-form");
  await form.getByLabel("Target price", { exact: true }).fill("1100000");
  await form.getByRole("button", { name: "Create alert", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Preview alert created." })).toBeVisible();
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("bazaar-watch-live-v1")!));
  expect((await state()).workflows[0].stage).toBe("watching_buy");
  price = 1100000; stale = true;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByText("Awaiting prices", {exact: true})).toBeVisible();
  expect((await state()).workflows[0].stage).toBe("watching_buy");
  stale = false;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(async () => (await state()).workflows[0].stage).toBe("completed");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(async () => (await state()).events.filter((e: {side:string}) => e.side === "buy").length).toBe(1);
  expect((await state()).events.find((e: {side:string}) => e.side === "buy").message).toContain("no email");
});
