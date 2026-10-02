import { test, expect } from '@playwright/test';
import { normalizeBazaar } from '../../shared/companion/bazaar';
import { newPriceAlert } from '../../shared/price-alert';

for (const scenario of ['fresh', 'aging', 'partial', 'missing', 'failed'] as const) {
  test(`${scenario} sampled prices retain direction, provenance and unavailable inputs`, async ({ page }, info) => {
    const now = Date.now(), stamp = now - (scenario === 'fresh' ? 30_000 : 35 * 60_000);
    const product = {buy_summary: scenario === 'partial' ? [] : [{amount:2,pricePerUnit:110,orders:1},{amount:1000,pricePerUnit:120,orders:1}],
      sell_summary:[{amount:1000,pricePerUnit:90,orders:1}],
      quick_status:{buyVolume:10000,sellVolume:10000,buyMovingWeek:100000,sellMovingWeek:100000}};
    const item = {...normalizeBazaar('SUMMONING_EYE',product,stamp,stamp+1000,{name:'Summoning Eye',tier:'EPIC'}),
      feeContext:{mayor:'Diana',multiplier:1,checkedAt:stamp,explanation:'Sampled fee evidence'}};
    const workflow = newPriceAlert('12345678-1234-4234-8234-123456789012','Summoning Eye',
      {requestId:'12345678-1234-4234-8234-123456789012',itemId:'SUMMONING_EYE',side:'sell',quantity:3,target:100,taxRate:1.25},now-1000);
    let publicReads = 0;
    await page.route('**/api/companion/**', async route => {
      publicReads++;
      const path = new URL(route.request().url()).pathname;
      expect(route.request().method()).toBe('GET');
      if (scenario === 'missing' && path.endsWith('/book')) return route.fulfill({status:503,json:{error:'Item unavailable'}});
      const error = scenario === 'failed' ? 'Upstream offline' : null;
      const status = {upstreamAt:stamp,observedAt:stamp+1000,nextAt:now+25*60000,stale:scenario!=='fresh',error};
      const body = path.endsWith('/bazaar') ? {items:scenario==='missing'?[]:[item],status,error} :
        path.endsWith('/book') ? {book:{buy:item.asks,sell:item.bids},timestamp:stamp,observedAt:stamp+1000,status} :
        {prices:[{id:item.id,name:item.name,buy:item.asks[0]?.pricePerUnit??null,sell:90,volume:100000}],books:{},
          status:{lastUpdated:stamp,lastSuccess:stamp+1000,lastAttempt:stamp+1000,error}};
      await route.fulfill({json:body});
    });
    await page.route('https://script.google.com/macros/s/test-alerts/exec', async route => {
      const body = route.request().postDataJSON();
      expect(body.action).toBe('account');
      expect(body.idToken).toBeTruthy();
      await route.fulfill({json:{ok:true,data:{workflows:[workflow],events:[]}}});
    });
    await page.goto('/#alerts=1');
    await page.evaluate(async () => {
      // @ts-expect-error Vite-served emulator client.
      const {auth} = await import('/src/data.ts');
      // @ts-expect-error Vite-served Firebase SDK.
      const {GoogleAuthProvider,signInWithCredential} = await import('/node_modules/.vite/deps/firebase_auth.js');
      if (!auth.emulatorConfig) throw Error('Emulator required');
      await signInWithCredential(auth,GoogleAuthProvider.credential(JSON.stringify({sub:'sample-viewer',email:'sample-viewer@example.test',email_verified:true,iss:'https://accounts.google.com',aud:'demo-client',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})));
    });
    const alert = page.getByRole('article',{name:'Summoning Eye alert'});
    await expect(alert).toBeVisible();
    if (scenario === 'missing') await expect(alert).toContainText('Price unavailable');
    else {
      await expect(alert.locator('.current-quote')).toContainText('88.88');
      await expect(alert.locator('.current-quote')).toContainText('instant sell, after tax');
      await expect(alert.locator('time')).toHaveAttribute('datetime',new Date(stamp).toISOString());
      await expect(alert).toContainText(scenario==='fresh'?'Sampled estimate':'Last sampled');
    }
    if (scenario === 'failed') await expect(alert).toContainText('Collection failed: Upstream offline');
    await expect(page.getByText('Retrying automatically',{exact:true})).toHaveCount(0);
    if (scenario !== 'missing') {
      await page.getByRole('link',{name:'Bazaar',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Bazaar Samples',exact:true})).toBeVisible();
      await page.getByLabel('Quantity',{exact:true}).fill('3');
      await page.getByRole('searchbox',{name:'Search Bazaar items'}).fill('Summoning Eye');
      const card = page.getByRole('article',{name:'Summoning Eye opportunity'});
      await expect(card).toBeVisible();
      await expect(card.locator('.card-subtitle')).toBeVisible();
      await expect(card).toContainText('totals for 3 units');
      const comparison = card.locator('.price-comparison');
      await expect(comparison).toContainText('270');
      if (scenario === 'partial') {
        await expect(card).toContainText('Profit unavailable');
        await expect(comparison).toContainText('—');
      } else {
        await expect(comparison).toContainText('330');
        await expect(comparison).toContainText('56'); // 330 - 4.125 - 270, rounded in card
        if (scenario !== 'fresh') await expect(comparison).toContainText('Sampled profit');
      }
      await page.screenshot({path:`.local/price-fix/${scenario}-${info.project.name}.png`,fullPage:true});
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(publicReads).toBeLessThanOrEqual(6);
  });
}
