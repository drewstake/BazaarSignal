import { test, expect } from "@playwright/test";
import { productionUsage } from './policy';
test.beforeEach(async ({ page }) => {
  await page.route(
    /\/api\/companion\/(snapshot|book)(?:\?|$)/,
    async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      expect(request.method()).toBe("GET");
      expect(url.searchParams.has("idToken")).toBe(false);
      const now = Date.now(),
        book = {
          buy: [
            { amount: 2, pricePerUnit: 100, orders: 1 },
            { amount: 20, pricePerUnit: 130, orders: 1 },
          ],
          sell: [{ amount: 30, pricePerUnit: 90, orders: 1 }],
        };
      const data = url.pathname.endsWith("/book")
        ? { book, timestamp: now }
        : {
            prices: [
              {
                id: "SUMMONING_EYE",
                name: "Summoning Eye",
                buy: 100,
                sell: 90,
                volume: 100,
              },
            ],
            books: {},
            status: {
              lastUpdated: now,
              lastSuccess: now,
              lastAttempt: now,
              error: null,
            },
          };
      await route.fulfill({ json: { ...data, usage: productionUsage() } });
    },
  );
  await page.route("https://script.google.com/macros/s/**/exec", () => {
    throw new Error("Anonymous prices must not consume Apps Script quota");
  });
});
test("anonymous public search and depth work; email creation requires Google sign-in", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#legacy=1");
  await expect(
    page.getByRole("heading", { name: "What are you watching?" }),
  ).toBeVisible();
  await expect(
    page.getByText("Private workspace", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("searchbox", { name: "Search Bazaar items" })
    .fill("summoning");
  await page
    .getByRole("button", { name: "View Summoning Eye", exact: true })
    .click();
  await page.getByLabel("Quantity", { exact: true }).fill("3");
  await expect(page.getByText("330 coins", { exact: true })).toBeVisible();
  await expect(page.getByText("266.63 coins", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Order book", exact: true }).click();
  await expect(page.getByRole("table", { name: "Buy orders" })).toBeVisible();
  await page.getByRole("button", { name: "Create alert", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in for email alerts." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Target price", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "My alerts", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in for email alerts." }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

for (const popup of ["closed", "blocked"] as const) {
  test(`Google popup ${popup} shows recovery instructions and allows retry`, async ({
    page,
  }) => {
    await page.addInitScript((state) => {
      window.open = () =>
        state === "blocked"
          ? null
          : ({
              closed: true,
              close() {},
              focus() {},
            } as Window);
    }, popup);
    await page.goto("/#item=SUMMONING_EYE");
    await page
      .getByRole("button", { name: "Create alert", exact: true })
      .click();
    const signIn = page.getByRole("button", {
      name: "Continue with Google",
      exact: true,
    });
    await signIn.click();
    const message =
      popup === "closed"
        ? "Google sign-in closed before it finished."
        : "Your browser blocked the Google sign-in window.";
    await expect(page.getByRole("alert")).toContainText(message, {
      timeout: 20000,
    });
    await expect(page.getByRole("alert")).not.toContainText("Firebase:");
    await expect(signIn).toBeEnabled();
    // A successful market refresh must not silently clear sign-in recovery help.
    await page.clock.install();
    await page.clock.runFor(61000);
    await expect(page.getByRole("alert")).toContainText(message);
    await signIn.click();
    await expect(page.getByRole("alert")).toContainText(message, {
      timeout: 20000,
    });
    await expect(signIn).toBeEnabled();
    await expect(page.getByLabel("Target price", { exact: true })).toHaveCount(
      0,
    );
  });
}
