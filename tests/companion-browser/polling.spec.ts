import { test, expect } from "@playwright/test";

test("two tabs and a reload reuse identical recent public responses",async({context,page})=>{
  let calls=0;
  await context.route("**/api/companion/bazaar",async route=>{
    calls++;
    await route.fulfill({contentType:"application/json",headers:{ETag:'"same"'},body:JSON.stringify({version:"same",items:[],status:{upstreamAt:123}})});
  });
  await page.goto("/ui-kits.html");const second=await context.newPage();await second.goto("/ui-kits.html");
  const read=(p:typeof page)=>p.evaluate(async()=>{
    const module=await import("/src/companion/request-cache.ts");
    return module.cachedMarketRequest(`${location.origin}/api/companion/bazaar`);
  });
  const results=await Promise.all([read(page),read(second)]);
  expect(results[0]).toEqual(results[1]);expect(calls).toBe(1);
  await second.reload();await read(second);expect(calls).toBe(1);
  await second.close();
});

test("paused UI retains data timestamp and does not poll, reload the API, or request seller commands",async({page})=>{
  let calls=0;
  const upstreamAt=Date.now()-240000;
  await page.route("**/api/companion/**",async route=>{
    calls++;
    await route.fulfill({contentType:"application/json",body:JSON.stringify({version:"paused",items:[],error:null,status:{upstreamAt,usage:{mode:"paused",pollMs:0}}})});
  });
  await page.goto("/");
  await expect(page.getByText("Updates paused to protect the free allowance",{exact:false})).toBeVisible();
  await page.clock.install();
  await page.clock.fastForward(120000);
  expect(calls).toBe(1);
  await page.screenshot({path:`.local/companion/paused-${test.info().project.name}.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('a bounded trial stops visible polling on desktop and mobile without a final network reply',async({page})=>{
  let calls=0;
  await page.route('**/api/companion/bazaar',async route=>{
    calls++;
    await route.fulfill({contentType:'application/json',body:JSON.stringify({version:'trial',items:[],usage:{mode:'normal',pollMs:20000,expiresAt:Date.now()+15000}})});
  });
  await page.goto('/ui-kits.html');await page.clock.install();
  await page.evaluate(async()=>{
    const {visiblePoll}=await import('/src/companion/polling.ts');
    const {cachedMarketRequest}=await import('/src/companion/request-cache.ts');
    (window as any).trialStop=visiblePoll(signal=>cachedMarketRequest(`${location.origin}/api/companion/bazaar`,signal).then(()=>{}));
  });
  await page.clock.runFor(1);await expect.poll(()=>calls).toBe(1);
  await page.clock.runFor(16000);
  const mode=await page.evaluate(async()=>(await import('/src/companion/polling.ts')).pollingDirective().mode);
  expect(mode).toBe('paused');await page.clock.fastForward(120000);expect(calls).toBe(1);
  await page.evaluate(()=>(window as any).trialStop());
});
