// Audit regressions. Every API is intercepted; no production requests.
import { expect, test, type Page } from '@playwright/test';
import { normalizeBazaar } from '../../../shared/companion/bazaar';
const at = Date.parse('2026-10-29T13:05:00Z');
const end = Date.parse('2026-11-01T07:00:00Z');
const usage = { mode: 'normal', pollMs: 900000, trialId: 'search-browser', expiresAt: end };
const book = normalizeBazaar('BOOSTER_COOKIE', {
  buy_summary: [{ pricePerUnit: 14000000, amount: 1000, orders: 2 }],
  sell_summary: [{ pricePerUnit: 13000000, amount: 1000, orders: 2 }],
}, at, at);
const visibility = (page: Page, state: string) => page.evaluate(state => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}, state);
test.beforeEach(async ({ context, page }) => {
  await context.route('https://**', route => route.abort());
  await page.clock.install({ time: at });
  await context.route('**/api/price-history?**', route => route.fulfill({ json: {
    version: 1, item: 'BOOSTER_COOKIE', timezone: 'EST', points: [],
    collector: { enabled: false, lastSuccess: null, lastError: null },
  } }));
});
test('resumes an interrupted item immediately on visibility return', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/companion/**', route => {
    requests++;
    if (requests === 1) return; // interrupted request is deliberately pending
    return route.fulfill({ json: { bazaar: [book], usage } });
  });
  await page.goto('/#view=item&item=BOOSTER_COOKIE');
  await expect.poll(() => requests).toBe(1);
  await visibility(page, 'hidden');
  await expect(page.getByText('Market read interrupted. Waiting for the next scheduled check.')).toBeVisible();
  await visibility(page, 'visible');
  await page.clock.fastForward(1000);
  await expect.poll(() => requests).toBe(2);
  await expect(page.locator('.bazaar-search-prices')).toContainText('14,000,000');
  await visibility(page, 'hidden');
  await visibility(page, 'visible');
  await page.clock.fastForward(1000);
  expect(requests).toBe(2);
});
test('does not request uncached history after the configured release expires', async ({ page }) => {
  await page.clock.setSystemTime(end - 60000);
  let books = 0, history = 0;
  await page.route('**/api/companion/**', route => { books++; return route.abort(); });
  await page.route('**/api/price-history?**', route => { history++; return route.fulfill({ status: 503, json: { error: 'Expired' } }); });
  await page.goto('/');
  await page.clock.fastForward(61000);
  await page.evaluate(() => { location.hash = 'view=item&item=BOOSTER_COOKIE'; });
  await expect(page.locator('.bazaar-search-status')).toContainText('Updates paused');
  await expect(page.getByText('Daily history updates are paused. Saved device observations remain available.')).toBeVisible();
  expect(history).toBe(0);
  expect(books).toBe(0);
});
test('measures cross-tab price sharing and separate archive requests', async ({ context, page }) => {
  let books = 0, history = 0;
  await context.route('**/api/companion/**', route => { books++; return route.fulfill({ json: { bazaar: [book], usage } }); });
  await context.route('**/api/price-history?**', route => { history++; return route.fulfill({ json: {
    version: 1, item: 'BOOSTER_COOKIE', timezone: 'EST', points: [],
  } }); });
  const other = await context.newPage();
  await other.clock.install({ time: at });
  await Promise.all([page.goto('/#view=item&item=BOOSTER_COOKIE'), other.goto('/#view=item&item=BOOSTER_COOKIE')]);
  await expect(page.locator('.bazaar-search-prices')).toBeVisible();
  await expect(other.locator('.bazaar-search-prices')).toBeVisible();
  expect(books).toBe(1);
  expect(history).toBe(2);
  await page.getByRole('link', { name: 'Back to Portfolio', exact: true }).click();
  await page.evaluate(() => { location.hash = 'view=item&item=BOOSTER_COOKIE'; });
  await expect(page.locator('.bazaar-search-prices')).toBeVisible();
  expect(books).toBe(1); expect(history).toBe(2);
  await other.close();
});
