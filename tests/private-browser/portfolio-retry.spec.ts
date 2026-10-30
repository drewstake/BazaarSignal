import { test, expect, type Page } from '@playwright/test';
import { normalizeBazaar } from '../../shared/companion/bazaar';

async function createHolding(page: Page, id: string) {
  await page.goto('/#view=portfolios');
  await page.evaluate(async id => {
    const { auth } = await import('/src/data.ts');
    const { GoogleAuthProvider, signInWithCredential } = await import('/node_modules/.vite/deps/firebase_auth.js');
    if (!auth.emulatorConfig) throw Error('Emulator required');
    await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: id,
      email: `${id}@example.test`, email_verified: true, iss: 'https://accounts.google.com', aud: 'demo-client',
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })));
  }, id);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('button', { name: 'Create portfolio', exact: true }).click();
  const portfolio = page.getByRole('form', { name: 'Create portfolio' });
  await portfolio.getByLabel('Portfolio name').fill('Interrupted price recovery');
  await portfolio.getByRole('button', { name: 'Save portfolio' }).click();
  await expect(portfolio).toHaveCount(0);
  await page.getByRole('button', { name: 'Add holding', exact: true }).click();
  const holding = page.getByRole('form', { name: 'Add holding' });
  await holding.getByRole('combobox', { name: 'Search', exact: true }).fill('SUMMONING_EYE');
  await holding.getByRole('option', { name: /\(SUMMONING_EYE\)$/ }).click();
  await holding.getByLabel('Quantity owned', { exact: true }).fill('2785');
  await holding.getByLabel(/ · coins$/).fill('1368000');
  await holding.getByRole('button', { name: 'Save holding', exact: true }).click();
  await expect(holding).toHaveCount(0);
}

for (const failure of ['hidden', 'network', 'timeout'] as const) {
  test(`portfolio recovers from ${failure} without reloading`, async ({ page }, info) => {
    const now = Date.parse('2026-10-27T13:05:00Z');
    const usage = { mode: 'normal', pollMs: 900_000, trialId: 'paid-202610', expiresAt: Date.parse('2026-11-01T07:00:00Z') };
    let requests = 0;
    await page.clock.install({ time: now });
    await page.route('https://**', route => route.abort());
    await page.route('**/api/companion/**', route => {
      requests++;
      if (requests === 1) return failure === 'network' ? route.abort('failed') : undefined;
      return route.fulfill({ json: { bazaar: [normalizeBazaar('SUMMONING_EYE', {
        buy_summary: [{ pricePerUnit: 1276421.7, amount: 4000, orders: 2 }],
        sell_summary: [{ pricePerUnit: 1229940.9, amount: 4000, orders: 2 }],
      }, now, now)], listings: [], usage } });
    });
    await createHolding(page, `auto-${failure}-${info.project.name}-${Date.now()}`);
    await expect.poll(() => requests).toBe(1);
    const region = page.getByRole('region', { name: 'Portfolio value', exact: true });
    await expect(region).toContainText('Incomplete prices');
    if (failure === 'hidden') {
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.clock.fastForward(5000);
      expect(requests).toBe(1);
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    } else {
      if (failure === 'timeout') {
        await page.clock.fastForward(20_000);
        await page.getByText('Market data unavailable · Holdings are editable').click();
        await expect(page.getByText('Prices are taking too long to load. Retrying automatically.')).toBeVisible();
      } else {
        await expect(page.getByText('Market data unavailable · Holdings are editable')).toBeVisible();
      }
      await page.clock.fastForward(59_000); expect(requests).toBe(1);
      await page.clock.fastForward(1000);
    }
    await expect(page.getByRole('rowgroup', { name: 'Summoning Eye holding' })).toContainText('1,276,421.7');
    await expect(region).toContainText('3,554,834,434.5');
    await expect(region).not.toContainText('Incomplete prices');
    await expect(page.getByText('Market data unavailable · Holdings are editable')).toHaveCount(0);
    expect(requests).toBe(2);
    await page.screenshot({ path: `.local/portfolio-auto-${failure}-${info.project.name}.png`, fullPage: true });
  });
}

test('portfolio values recover after a temporary 503 and refresh at the next quarter-hour window', async ({ page }, info) => {
  const now = Date.parse('2026-10-20T23:05:00Z');
  const usage = { mode: 'normal', pollMs: 900_000, trialId: 'paid-202610', expiresAt: Date.parse('2026-11-01T07:00:00Z') };
  let requests = 0;
  await page.clock.install({ time: now });
  await page.route('https://**', route => route.abort());
  await page.route('**/api/companion/**', route => {
    requests++;
    return requests === 1
      ? route.fulfill({ status: 503, json: { error: 'Price service is temporarily busy. Retry after one minute.',
        usage: { ...usage, mode: 'slow', retryAt: now + 60_000 } } })
      : route.fulfill({ json: { bazaar: [normalizeBazaar('SUMMONING_EYE', {
        buy_summary: [{ pricePerUnit: requests >= 3 ? 1500000 : 1488264.5, amount: 4000, orders: 2 }],
        sell_summary: [{ pricePerUnit: 1456704.9, amount: 4000, orders: 2 }],
      }, now, now)], listings: [], usage } });
  });
  await page.goto('/#view=portfolios');
  await page.evaluate(async id => {
    const { auth } = await import('/src/data.ts');
    const { GoogleAuthProvider, signInWithCredential } = await import('/node_modules/.vite/deps/firebase_auth.js');
    if (!auth.emulatorConfig) throw Error('Emulator required');
    await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: id,
      email: `${id}@example.test`, email_verified: true, iss: 'https://accounts.google.com', aud: 'demo-client',
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })));
  }, `retry-${info.project.name}-${Date.now()}`);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('button', { name: 'Create portfolio', exact: true }).click();
  const portfolio = page.getByRole('form', { name: 'Create portfolio' });
  await portfolio.getByLabel('Portfolio name').fill('Automatic recovery');
  await portfolio.getByRole('button', { name: 'Save portfolio' }).click();
  await expect(portfolio).toHaveCount(0);
  await page.getByRole('button', { name: 'Add holding', exact: true }).click();
  const holding = page.getByRole('form', { name: 'Add holding' });
  await holding.getByRole('combobox', { name: 'Search', exact: true }).fill('SUMMONING_EYE');
  await holding.getByRole('option', { name: /\(SUMMONING_EYE\)$/ }).click();
  await holding.getByLabel('Quantity owned', { exact: true }).fill('2785');
  await holding.getByLabel(/ · coins$/).fill('1368000');
  await holding.getByRole('button', { name: 'Save holding', exact: true }).click();
  await expect(holding).toHaveCount(0);
  await expect(page.getByText('Market data unavailable · Holdings are editable')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Portfolio value', exact: true })).toContainText('Incomplete prices');
  await page.clock.fastForward(60_000);
  await expect(page.getByRole('rowgroup', { name: 'Summoning Eye holding' })).toContainText('1,488,264.5');
  await expect(page.getByRole('rowgroup', { name: 'Summoning Eye holding' })).toContainText('4,144,816,632.5');
  await expect(page.getByText('Market data unavailable · Holdings are editable')).toHaveCount(0);
  expect(requests).toBe(2);
  await page.clock.fastForward(10 * 60_000);
  expect(requests).toBe(2);
  await page.clock.fastForward(60_000);
  await expect(page.getByRole('rowgroup', { name: 'Summoning Eye holding' })).toContainText('1,500,000');
  expect(requests).toBe(3);
  await page.screenshot({ path: `.local/quarter-hour-refresh-${info.project.name}.png`, fullPage: true });
});
