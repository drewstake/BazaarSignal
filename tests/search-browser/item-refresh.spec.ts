import { expect, test, type Page } from '@playwright/test';
import { normalizeBazaar } from '../../shared/companion/bazaar';

const at = Date.parse('2026-10-22T13:02:00Z');
const usage = {mode:'normal',pollMs:900000,bazaarMs:900000,trialId:'search-browser',expiresAt:Date.parse('2026-11-01T07:00:00Z')};
const item = (sampledAt: number) => normalizeBazaar('BOOSTER_COOKIE', {
  buy_summary:[{pricePerUnit:14000000,amount:1000,orders:5}],
  sell_summary:[{pricePerUnit:13000000,amount:1000,orders:5}],
},sampledAt,sampledAt);
const visibility = (page: Page, state: string) => page.evaluate(state => {
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>state});
  document.dispatchEvent(new Event('visibilitychange'));
},state);
test.beforeEach(async ({page}) => {
  await page.clock.install({time:at});
  await page.route('https://**',route=>route.abort());
});

test('item pages refresh at each quarter-hour read window, skip hidden slots, and stop on navigation',async ({page}) => {
  let requests=0, sampledAt=at-120000;
  await page.route('**/api/companion/**',route=>{requests++; return route.fulfill({json:{bazaar:[item(sampledAt)],usage}});});
  await page.goto('/#view=item&item=BOOSTER_COOKIE');
  const sample=page.locator('.bazaar-item-snapshot time');
  await expect(sample).toHaveAttribute('datetime',new Date(sampledAt).toISOString());
  await expect(page.locator('.bazaar-search-status')).toContainText('Scheduled snapshot');
  for(let slot=1;slot<=3;slot++) {
    await page.clock.fastForward(899999); expect(requests).toBe(slot);
    sampledAt+=900000;
    await page.clock.fastForward(1);
    await expect(sample).toHaveAttribute('datetime',new Date(sampledAt).toISOString());
    expect(requests).toBe(slot+1);
  }
  await visibility(page,'hidden'); await page.clock.fastForward(1800000); expect(requests).toBe(4);
  sampledAt+=1800000; await visibility(page,'visible');
  await expect(sample).toHaveAttribute('datetime',new Date(sampledAt).toISOString()); expect(requests).toBe(5);
  await page.getByRole('link',{name:'Back to Portfolio',exact:true}).click();
  await page.clock.fastForward(1800000); expect(requests).toBe(5);
});

test('an initial 503 recovers at its one-minute deadline within the same quarter-hour slot',async ({page}) => {
  let requests=0;
  await page.route('**/api/companion/**',route=>{
    requests++;
    return requests===1 ? route.fulfill({status:503,json:{error:'Temporarily busy',usage:{...usage,mode:'slow',retryAt:at+60000}}})
      : route.fulfill({json:{bazaar:[item(at)],usage}});
  });
  await page.goto('/#view=item&item=BOOSTER_COOKIE');
  await expect(page.getByText('Temporarily busy',{exact:true})).toBeVisible();
  await page.clock.fastForward(59999); expect(requests).toBe(1);
  await page.clock.fastForward(1);
  await expect(page.getByRole('region',{name:'Booster Cookie',exact:true})).toContainText('14,000,000 coins');
  await expect(page.getByText('Temporarily busy',{exact:true})).toHaveCount(0);
  expect(requests).toBe(2);
  await page.clock.fastForward(60000); expect(requests).toBe(2);
});

test('saved prices survive a 503 without erasing backoff, then refresh at the recovery deadline',async ({page}) => {
  let requests=0;
  await page.route('**/api/companion/**',route=>{
    requests++;
    return requests===2 ? route.fulfill({status:503,json:{error:'Temporarily busy',usage:{...usage,mode:'slow',retryAt:at+960000}}})
      : route.fulfill({json:{bazaar:[item(requests===1?at-120000:at+780000)],usage}});
  });
  await page.goto('/#view=item&item=BOOSTER_COOKIE');
  const sample=page.locator('.bazaar-item-snapshot time');
  await expect(sample).toHaveAttribute('datetime',new Date(at-120000).toISOString());
  await page.clock.fastForward(900000);
  await expect(page.getByText('Temporarily busy',{exact:true})).toBeVisible();
  await expect(sample).toHaveAttribute('datetime',new Date(at-120000).toISOString());
  await visibility(page,'hidden'); await visibility(page,'visible');
  await page.clock.fastForward(59999); expect(requests).toBe(2);
  await page.clock.fastForward(1);
  await expect(sample).toHaveAttribute('datetime',new Date(at+780000).toISOString());
  expect(requests).toBe(3);
  await expect(page.getByText('Temporarily busy',{exact:true})).toHaveCount(0);
});
