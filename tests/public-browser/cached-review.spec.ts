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
  await expect(page.getByLabel('Quantity',{exact:true})).toHaveValue('1');
  await page.getByRole('searchbox',{name:'Search Bazaar items'}).fill('Summoning Eye');
  const card=page.getByRole('article',{name:'Summoning Eye opportunity'});
  await expect(card).toBeVisible();
  await expect(card).not.toContainText('exceeds your budget');
  await page.getByLabel('Quantity',{exact:true}).fill('64');
  await expect(card).toContainText('exceeds your budget');
  await page.getByLabel('Quantity',{exact:true}).fill('1');
  await expect(card.getByText('View details',{exact:true})).toHaveCount(0);
  await card.click();
  const details=page.getByRole('dialog',{name:'Item details'});
  await expect(details.getByText('Totals for 1 item')).toBeVisible();
  await expect(details.locator('.data-time time')).toHaveAttribute('datetime',new Date(eye.upstreamAt).toISOString());
  const book = details.getByRole('region',{name:'L2 order book'});
  await expect(book).toBeVisible();
  await expect(book.locator('time')).toHaveAttribute('datetime',new Date(eye.upstreamAt).toISOString());
  const format = (n: number) => n.toLocaleString('en-US',{maximumFractionDigits:2});
  const bids = book.getByRole('table',{name:'Buy orders'});
  const asks = book.getByRole('table',{name:'Sell offers'});
  for (const [table, levels] of [[bids,eye.bids],[asks,eye.asks]] as const) {
    await expect(table.locator('tbody tr')).toHaveCount(levels.length);
    await expect(table.locator('tbody tr').first().locator('td')).toHaveText([
      format(levels[0].pricePerUnit),format(levels[0].amount),format(levels[0].orders),
    ]);
    await expect(table.locator('tbody tr').last().locator('td')).toHaveText([
      format(levels.at(-1).pricePerUnit),format(levels.at(-1).amount),format(levels.at(-1).orders),
    ]);
  }
  await expect(book.getByRole('navigation',{name:'Order book pages'})).toHaveCount(0);
  await expect(details.getByRole('link',{name:'Set a price alert'})).toBeVisible();
  await page.screenshot({path:`.local/usability-review/checked-eye-${info.project.name}.png`});
  await page.getByRole('button',{name:'Close item details'}).click();
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search Bazaar items'}).fill('Flames');
  await page.getByRole('button',{name:'Inspect Flames',exact:true}).click();
  await expect(details).not.toContainText('Price moved more than 15%');
  await page.getByRole('button',{name:'Close item details'}).click();
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  await page.screenshot({path:`.local/usability-review/checked-bazaar-${info.project.name}.png`});
  for(const width of info.project.name==='mobile'?[320,390,768]:[1440]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
