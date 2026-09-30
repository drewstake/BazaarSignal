import { test, expect, type Page } from '@playwright/test';

async function navigate(page: Page, label: string) {
  const menu = page.getByRole('button', { name: 'Open menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Kit navigation' }).getByRole('button', { name: label }).click();
}

for (const kit of ['signal', 'ledger', 'ember']) {
  test(`${kit}: discover, calculate, save, filter, and inspect the component library`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/ui-kits.html?kit=${kit}`);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Sample market', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `.local/ui-kits/${kit}-${info.project.name}.png`, fullPage: true });
    await page.getByRole('button', { name: '7D', exact: true }).click();
    await expect(page.getByText('126.8B', { exact: false })).toBeVisible();

    await navigate(page, 'Bazaar flips');
    const search = page.getByRole('searchbox', { name: 'Search opportunities' });
    await search.fill('Diamond');
    const inspect = kit === 'ember' ? page.getByRole('button', { name: 'Inspect deal', exact: true }) : page.getByRole('button', { name: /^Enchanted Diamond Block Bazaar/ });
    await inspect.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Enchanted Diamond Block' })).toBeVisible();
    await dialog.getByLabel('Flip quantity').fill('64');
    await dialog.getByLabel('Example sale fee', { exact: true }).fill('1.25');
    await expect(dialog.locator('.calc-total')).toContainText('+381,200');
    await dialog.getByLabel('Flip quantity').fill('0');
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByLabel('Flip quantity').fill('64');
    await dialog.getByRole('button', { name: 'Save to watchlist', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Saved to watchlist', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Preview alert', exact: true }).click();
    await dialog.getByLabel('Notify when buy price falls below').fill('190000');
    await dialog.getByRole('button', { name: 'Set demo alert', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('status')).toContainText('190,000 coins');
    await navigate(page, 'Watchlist');
    await expect(page.locator('.opportunities-panel')).toContainText('Enchanted Diamond Block');
    await page.reload();
    await expect(page.locator('.opportunities-panel')).toContainText('Enchanted Diamond Block');
    await page.getByRole('button', { name: 'Unsave Enchanted Diamond Block', exact: true }).click();
    await expect(page.locator('.opportunities-panel')).not.toContainText('Enchanted Diamond Block');

    await navigate(page, 'Auction deals');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `.local/ui-kits/${kit}-auctions-${info.project.name}.png`, fullPage: true });
    await page.getByLabel('Filter by risk').selectOption('Low');
    await expect(page.locator('.deal-card')).toHaveCount(1);
    await expect(page.locator('.deal-card')).toContainText('Necron’s Helmet');
    await page.getByRole('searchbox').fill('no-such-item');
    await expect(page.getByRole('heading', { name: 'No opportunities match.' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await expect(page.locator('.deal-card')).toHaveCount(4);

    await navigate(page, 'UI library');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `.local/ui-kits/${kit}-library-${info.project.name}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Sell offers', exact: true }).click();
    await expect(page.locator('.sample-book')).toContainText('211,500');
    await page.getByRole('switch').uncheck();
    await page.getByRole('button', { name: 'Preview draft', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Demo draft');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export tokens', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`bazaarsignal-${kit}-tokens.css`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('switching design directions preserves the current screen and only uses local preview data', async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on('request', request => { if (['fetch', 'xhr'].includes(request.resourceType())) remoteRequests.push(request.url()); });
  await page.goto('/ui-kits.html?kit=signal&view=auctions');
  for (const name of ['Ledger', 'Ember', 'Signal']) {
    await page.getByRole('button', { name: new RegExp(name + ' The') }).click();
    await expect(page.getByRole('heading', { name: 'Good items. Better prices.' })).toBeVisible();
    await expect(page.locator('.deal-card')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  expect(remoteRequests).toEqual([]);
});
