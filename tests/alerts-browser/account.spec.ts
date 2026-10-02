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
  await expect(page.getByLabel("Item", {exact:true})).toHaveValue("");
  await page.getByLabel("Find an item", {exact:true}).fill("Summoning");
  await page.getByLabel("Item", {exact:true}).selectOption("SUMMONING_EYE");
  const form = page.locator(".alert-form");
  await expect(form.getByLabel("Target price", {exact:true})).toHaveValue("");
  await form.getByLabel("Target price", {exact:true}).fill("90");
  await form.getByRole("button", {name:"Sell above",exact:true}).click();
  await expect(form.getByLabel("Target price", {exact:true})).toHaveValue("");
  await expect(form.getByLabel("Sale tax (%)")).toBeVisible();
  await form.getByRole("button", {name:"Buy below",exact:true}).click();
  expect(requestIds).toHaveLength(0);
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

test('temporary saved-alert failures recover independently of hourly market sampling', async ({ page }, info) => {
  const stamp = Date.now() - 30 * 60000;
  const workflow = newPriceAlert('12345678-1234-4234-8234-123456789012', 'Summoning Eye',
    {requestId:'12345678-1234-4234-8234-123456789012',itemId:'SUMMONING_EYE',side:'buy',quantity:1,target:80,taxRate:1.25},stamp);
  let accountReads = 0, marketReads = 0, failure: 'once' | 'always' | 'none' = 'once';
  await page.route('**/api/companion/**', async route => {
    marketReads++;
    expect(route.request().method()).toBe('GET');
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/bazaar') ? {items:[]} : path.endsWith('/book')
      ? {book:{buy:[{amount:20,pricePerUnit:100,orders:1}],sell:[{amount:20,pricePerUnit:90,orders:1}]},timestamp:stamp,observedAt:stamp+1000}
      : {prices:[{id:'SUMMONING_EYE',name:'Summoning Eye',buy:100,sell:90,volume:100}],status:{lastUpdated:stamp,lastSuccess:stamp+1000,lastAttempt:stamp+1000,error:null}};
    await route.fulfill({json:data});
  });
  await page.route('https://script.google.com/macros/s/test-alerts/exec', async route => {
    expect(route.request().postDataJSON().action).toBe('account');
    expect(route.request().postDataJSON().idToken).toBeTruthy();
    accountReads++;
    if (failure !== 'none') {
      if (failure === 'once') failure = 'none';
      return route.fulfill({status:503,body:'Service temporarily unavailable'});
    }
    await route.fulfill({json:{ok:true,data:{workflows:[workflow],events:[]}}});
  });
  await page.goto('/#alerts=1');
  await signIn(page, `retry-${info.project.name}-${Date.now()}`);
  const card = page.getByRole('article',{name:'Summoning Eye alert'});
  await expect(card).toBeVisible();
  expect(accountReads).toBe(2); // One shared read plus one bounded retry.
  await expect(card).toContainText('Last sampled');
  await expect(page.locator('.alerts-board > .error')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Active 1',exact:true})).toBeVisible();

  const cachedReads = marketReads;
  failure = 'always';
  await page.getByRole('button',{name:'Refresh alerts',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('HTTP 503');
  await expect(page.getByRole('alert')).toContainText('Showing last loaded alerts');
  await expect(card).toBeVisible();
  await expect(page.getByRole('button',{name:'Active 1',exact:true})).toBeVisible();
  expect(accountReads).toBe(4);
  expect(marketReads).toBe(cachedReads);
  await expect(page.locator('.alerts-board > .error')).toHaveCount(0);
  failure = 'none';
  await page.getByRole('button',{name:'Refresh alerts',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);

  // A new page with no successful account read must show unknown counts, never zero.
  failure = 'always';
  await page.reload();
  await expect(page.getByRole('button',{name:'Retry alerts',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Active —',exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('HTTP 503');
  await expect(page.locator('.alerts-board > .error')).toHaveCount(0);
  const readsBeforeRecovery = marketReads;
  failure = 'none';
  await page.getByRole('button',{name:'Retry alerts',exact:true}).click();
  await expect(card).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Rendering the recovered card reads its cached book once, with no market collection.
  expect(marketReads - readsBeforeRecovery).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
