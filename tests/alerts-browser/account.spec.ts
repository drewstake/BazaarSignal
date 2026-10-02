import { test, expect, type Page } from "@playwright/test";
import { newPriceAlert } from "../../shared/price-alert";
import type { Workflow } from "../../shared/model";

async function signIn(page: Page, identity: string) {
  await page.evaluate(async (identity) => {
    // @ts-expect-error Served by Vite in the browser, not imported by the runner.
    const { auth } = await import("/src/data.ts");
    // @ts-expect-error Vite's Firebase client bundle.
    const { GoogleAuthProvider, signInWithCredential } =
      await import("/node_modules/.vite/deps/firebase_auth.js");
    if (!auth.emulatorConfig)
      throw new Error("Only emulator credentials are allowed");
    await signInWithCredential(
      auth,
      GoogleAuthProvider.credential(
        JSON.stringify({
          sub: identity,
          email: `${identity}@example.test`,
          email_verified: true,
          iss: "https://accounts.google.com",
          aud: "demo-client",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ),
    );
  }, identity);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("authenticated alerts refresh after creation, preserve revisions, recover failures and isolate accounts", async ({
  page,
}, info) => {
  let workflows: Workflow[] = [],
    failAccount = false,
    failCreate = true,
    failUpdate = true;
  let release: (() => void) | undefined;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holdAccount = true;
  const requestIds: string[] = [];
  const revisions: number[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/companion/bazaar", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route(
    /(?:script\.google\.com\/macros\/s\/test-alerts\/exec|\/api\/companion\/(?:snapshot|book)(?:\?|$))/,
    async (route) => {
      const url = new URL(route.request().url());
      const publicRead = url.pathname.startsWith("/api/companion/");
      const body = publicRead
        ? {
            action: url.pathname.split("/").pop(),
            itemId: url.searchParams.get("itemId"),
          }
        : route.request().postDataJSON();
      if (!publicRead) expect(["snapshot", "book"]).not.toContain(body.action);
      const now = Date.now();
      let data: unknown;
      if (body.action === "snapshot")
        data = {
          prices: [
            {
              id: "SUMMONING_EYE",
              name: "Summoning Eye",
              buy: 100,
              sell: 90,
              volume: 100,
            },
          ],
          status: {
            lastUpdated: now,
            lastSuccess: now,
            lastAttempt: now,
            error: null,
          },
        };
      else if (body.action === "book")
        data = {
          book: {
            buy: [
              { amount: 2, pricePerUnit: 100, orders: 1 },
              { amount: 20, pricePerUnit: 130, orders: 1 },
            ],
            sell: [{ amount: 20, pricePerUnit: 90, orders: 1 }],
          },
          timestamp: now,
        };
      else {
        expect(body.idToken).toBeTruthy();
        if (body.action === "account") {
          if (holdAccount) await hold;
          if (failAccount)
            return route.fulfill({
              json: {
                ok: false,
                error: "Saved alerts temporarily unavailable.",
              },
            });
          data = { workflows, events: [] };
        } else if (body.action === "create") {
          requestIds.push(body.input.requestId);
          if (failCreate)
            return route.fulfill({
              json: {
                ok: false,
                error: "Creation temporarily unavailable. Retry.",
              },
            });
          workflows = [
            newPriceAlert(
              body.input.requestId,
              "Summoning Eye",
              body.input,
              now,
            ),
          ];
          data = { id: body.input.requestId, emailStatus: "queued" };
        } else if (body.action === "update") {
          revisions.push(body.revision);
          if (failUpdate)
            return route.fulfill({
              json: {
                ok: false,
                error:
                  "This alert changed elsewhere. Refresh your alerts and try again.",
              },
            });
          const workflow = {
            ...workflows[0],
            buyTarget: body.target,
            sellTarget: body.target,
            revision: body.revision + 1,
            updatedAt: now,
          };
          workflows = [workflow];
          data = { workflow };
        } else throw new Error(`Unexpected API action: ${body.action}`);
      }
      await route.fulfill({ json: publicRead ? data : { ok: true, data } });
    },
  );
  await page.goto("/#alerts=1");
  await expect(
    page.getByRole("heading", { name: "Sign in for email alerts." }),
  ).toBeVisible();
  await expect(page.getByLabel("Target price", { exact: true })).toHaveCount(0);
  await signIn(page, `alerts-${info.project.name}-${Date.now()}`);
  await expect(page.getByText("Loading your alerts…")).toBeVisible();
  failAccount = true;
  holdAccount = false;
  release!();
  await expect(
    page.getByRole("button", { name: "Retry alerts" }),
  ).toBeVisible();
  failAccount = false;
  await page.getByRole("button", { name: "Retry alerts" }).click();
  await expect(page.getByText("No alerts yet.", { exact: true })).toBeVisible();
  const form = page.locator(".alert-form");
  await form.getByLabel("Target price", { exact: true }).fill("80");
  await form.getByLabel("Quantity", { exact: true }).fill("3");
  await expect(form.locator(".quote-note")).toContainText("110 coins / item");
  await form.getByRole("button", { name: "Create alert", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText(
    "Creation temporarily unavailable",
  );
  failCreate = false;
  await form.getByRole("button", { name: "Create alert", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Alert created. Your confirmation email is queued.",
    }),
  ).toBeVisible();
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).toBe(requestIds[1]);
  const card = page.getByRole("article", { name: "Summoning Eye alert" });
  await expect(card).toContainText("80");
  await expect(card.locator(".current-quote")).toContainText("110");
  await card.getByRole("button", { name: "Edit target" }).click();
  await card.getByLabel("Target price").fill("85");
  await card.getByRole("button", { name: "Save changes" }).click();
  await expect(card.getByRole("alert")).toContainText("changed elsewhere");
  failUpdate = false;
  await card.getByRole("button", { name: "Save changes" }).click();
  await expect(card.getByRole("status")).toHaveText("Target updated.");
  expect(revisions).toEqual([0, 0]);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Sign in for email alerts." }),
  ).toBeVisible();
  workflows = [];
  await signIn(page, `other-${info.project.name}-${Date.now()}`);
  await expect(page.getByText("No alerts yet.", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
