import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Optional release check against an unmodified response from the real cache.
// Ordinary CI uses the deterministic sampled-price scenarios instead.
test('production build displays the captured real cache without collecting or changing saved data', async ({page}, info) => {
  test.skip(!process.env.REVIEW_CACHE_PATH, 'Set REVIEW_CACHE_PATH to a captured /bazaar response.');
  const cached = JSON.parse(readFileSync(process.env.REVIEW_CACHE_PATH!, 'utf8').replace(/^\uFEFF/,''));
  const eye = cached.items.find((item: {id:string}) => item.id === 'SUMMONING_EYE');
  expect(eye).toBeTruthy();
  const unexpected: string[] = [], errors: string[] = [];
  page.on('pageerror', e=>errors.push(e.message));
  await page.route('**/api/companion/**', async route => {
    if (!route.request().url().endsWith('/bazaar') || route.request().method() !== 'GET') {
      unexpected.push(route.request().url());
      return route.abort();
    }
    await route.fulfill({json:cached});
  });
  await page.route('https://script.google.com/**', route => { unexpected.push('alert backend'); return route.abort(); });
  await page.goto('/');
  await page.getByRole('searchbox',{name:'Search Bazaar items'}).fill('Summoning Eye');
  const card=page.getByRole('article',{name:'Summoning Eye opportunity'});
  await expect(card).toBeVisible();
  await expect(card).toContainText('exceeds your budget');
  await page.getByLabel('Quantity',{exact:true}).fill('1');
  await card.getByRole('button',{name:'Inspect Summoning Eye',exact:true}).click();
  const details=info.project.name==='mobile'?page.getByRole('dialog'):page.getByRole('complementary',{name:'Item details'});
  await expect(details.getByText('Totals for 1 item')).toBeVisible();
  await expect(details.locator('.data-time time')).toHaveAttribute('datetime',new Date(eye.upstreamAt).toISOString());
  await expect(details.getByRole('link',{name:'Set a price alert'})).toBeVisible();
  await page.screenshot({path:`.local/usability-review/checked-eye-${info.project.name}.png`});
  if(info.project.name==='mobile') await page.getByRole('button',{name:'Close item details'}).click();
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  await page.screenshot({path:`.local/usability-review/checked-bazaar-${info.project.name}.png`});
  for(const width of info.project.name==='mobile'?[320,390,768]:[1440]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
