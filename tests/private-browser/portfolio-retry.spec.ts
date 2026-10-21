import { test, expect } from '@playwright/test';
import { normalizeBazaar } from '../../shared/companion/bazaar';

test('portfolio values recover automatically after a temporary 503 without a reload', async ({ page }, info) => {
  const now = Date.parse('2026-10-20T23:05:00Z');
  const usage = { mode: 'normal', pollMs: 3600_000, trialId: 'paid-202610', expiresAt: Date.parse('2026-11-01T07:00:00Z') };
  let requests = 0;
  await page.clock.install({ time: now });
  await page.route('https://**', route => route.abort());
  await page.route('**/api/companion/**', route => {
    requests++;
    return requests === 1
      ? route.fulfill({ status: 503, json: { error: 'Price service is temporarily busy. Retry after one minute.',
        usage: { ...usage, mode: 'slow', retryAt: now + 60_000 } } })
      : route.fulfill({ json: { bazaar: [normalizeBazaar('SUMMONING_EYE', {
        buy_summary: [{ pricePerUnit: 1488264.5, amount: 4000, orders: 2 }],
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
  await page.screenshot({ path: `.local/automatic-retry-${info.project.name}.png`, fullPage: true });
});
