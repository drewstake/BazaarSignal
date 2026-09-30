import { test, expect } from "@playwright/test";

test("my alerts edits a saved target, supports cancel, and persists after reload", async ({page}) => {
  await page.goto('/?demo=1#item=SUMMONING_EYE');
  await page.getByRole('button', {name:'My alerts',exact:true}).click();
  await expect(page.getByText('No alerts yet.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Create your first alert'}).click();
  const form=page.locator('.alert-form');
  // Below the current demo price so the alert stays active for editing.
  await form.getByLabel('Target price',{exact:true}).fill('1000000');
  await form.getByRole('button',{name:'Create alert',exact:true}).click();
  await page.getByRole('button',{name:'View my alerts'}).click();
  const alert=page.getByRole('article',{name:'Summoning Eye alert'});
  await expect(alert).toContainText('Instant buy at or below 1,000,000');
  await alert.getByRole('button',{name:'Edit target'}).click();
  await alert.getByLabel('Target price').fill('900000');
  await alert.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(alert).toContainText('Instant buy at or below 1,000,000');
  await alert.getByRole('button',{name:'Edit target'}).click();
  await alert.getByLabel('Target price').fill('950000');
  await page.screenshot({path:`.local/previews/my-alerts-edit-${test.info().project.name}.png`});
  await alert.getByRole('button',{name:'Save changes'}).click();
  await expect(alert.getByRole('status')).toHaveText('Target updated.');
  await expect(alert).toContainText('Instant buy at or below 950,000');
  await page.getByRole('button',{name:'Create alert',exact:true}).click();
  await expect(form.getByLabel('Target price',{exact:true})).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'My alerts',exact:true}).click();
  await expect(alert).toContainText('Instant buy at or below 950,000');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('bazaar-watch-demo-v1')!).workflows.filter((w:{mode?:string})=>w.mode==='single').length)).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`.local/previews/my-alerts-${test.info().project.name}.png`});
});

test("search, view depth, create an alert, and disable it from its email link", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/?demo=1#legacy=1");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search Bazaar items" }).fill("summoning");
  await page.getByRole("button", { name: "View Summoning Eye", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Summoning Eye", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Order book", exact: true }).click();
  await expect(page.getByRole("table", { name: "Buy orders" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  await page.getByRole("button", { name: "Create alert", exact: true }).click();
  const form = page.locator(".alert-form");
  await form.getByLabel("Quantity", { exact: true }).fill("64");
  await form.getByLabel("Target price", { exact: true }).fill("1000000");
  await form.getByRole("button", { name: "Create alert", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Preview alert created." })).toBeVisible();
  await page.getByRole("button", { name: "Preview confirmation email" }).click();
  const link = page.getByRole("link", { name: "Disable this alert" });
  const url = await link.getAttribute("href");
  expect(url).toMatch(/#disable=[a-f0-9]{64}$/);
  await link.click();
  await expect(page.getByRole("heading", { name: "Stop watching?" })).toBeVisible();
  const getAlert = () => page.evaluate(() => JSON.parse(localStorage.getItem("bazaar-watch-demo-v1")!).workflows.find((w: {mode?:string}) => w.mode === "single"));
  expect((await getAlert()).paused).toBe(false);
  await page.getByRole("button", { name: "Disable alert", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alert disabled." })).toBeVisible();
  expect((await getAlert()).paused).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Disable alert", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alert disabled." })).toBeVisible();
  expect((await getAlert()).paused).toBe(true);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a sell target needs no purchase workflow; invalid links cannot disable anything", async ({ page }) => {
  await page.goto("/?demo=1#item=SUMMONING_EYE");
  await page.getByRole("button", { name: "Create alert", exact: true }).click();
  const form = page.locator(".alert-form");
  await form.getByRole("button", { name: "Sell above" }).click();
  await form.getByLabel("Target price", { exact: true }).fill("2000000");
  await form.getByLabel("Sale tax (%)").fill("1.25");
  await form.getByRole("button", { name: "Create alert", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Preview alert created." })).toBeVisible();
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("bazaar-watch-demo-v1")!).workflows.find((w: {mode?:string}) => w.mode === "single"));
  expect(state.stage).toBe("watching_sell");
  expect(state.purchaseCost).toBeNull();
  await page.goto("/?demo=1#disable=invalid");
  await expect(page.getByRole("heading", { name: "Invalid alert link." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disable alert", exact: true })).toHaveCount(0);
});

test('completed and disabled alerts remain visible without an edit action', async ({page}) => {
  await page.goto('/?demo=1#item=SUMMONING_EYE');
  await page.getByRole('button',{name:'Create alert',exact:true}).click();
  const form=page.locator('.alert-form');
  await form.getByLabel('Target price',{exact:true}).fill('1000000');
  await form.getByRole('button',{name:'Create alert',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Preview alert created.'})).toBeVisible();
  await page.evaluate(()=>{
    const state=JSON.parse(localStorage.getItem('bazaar-watch-demo-v1')!);
    const alert=state.workflows.find((w:{mode?:string})=>w.mode==='single');
    alert.stage='completed';
    state.workflows.push({...alert,id:'disabled-alert',stage:'watching_buy',paused:true});
    localStorage.setItem('bazaar-watch-demo-v1',JSON.stringify(state));
  });
  await page.reload();
  await page.getByRole('button',{name:'My alerts',exact:true}).click();
  await expect(page.getByText('Completed',{exact:true})).toBeVisible();
  await expect(page.getByText('Disabled',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Edit target'})).toHaveCount(0);
});
