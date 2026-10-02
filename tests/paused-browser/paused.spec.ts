import { test, expect } from "@playwright/test";
test("production pause preserves navigation and sign-in gate without a market network request",async({page})=>{
  const marketRequests:string[]=[];
  page.on("request",request=>{if(request.url().includes("/api/companion/"))marketRequests.push(request.url());});
  await page.goto("/");
  await expect(page.getByText("Updates paused to protect the free allowance",{exact:false}).first()).toBeVisible();
  await page.clock.install();
  await expect(page.getByRole("button",{name:"Sign in with Google"})).toBeVisible();
  await page.getByRole("button",{name:"Auctions",exact:true}).click();
  await expect(page.getByText("Updates paused to protect the free allowance",{exact:false}).first()).toBeVisible();
  await page.getByRole("button",{name:"Watchlist",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Sign in to use Watchlist"})).toBeVisible();
  await page.getByRole("link",{name:"Price alerts",exact:true}).click();
  await expect(page).toHaveURL(/alerts=1/);
  await page.clock.fastForward(120000);
  expect(marketRequests).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`.local/companion/paused-production-${test.info().project.name}.png`,fullPage:true});
});
