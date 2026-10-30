// Isolated Auth/Firestore emulator journeys. APIs are blocked or mocked.
import { expect, test, type Page } from '@playwright/test';
import { normalizeBazaar } from '../../../shared/companion/bazaar';
import catalog from '../../../src/companion/bazaar-catalog.json' with { type: 'json' };
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('.local/audit-fixes-2026-10-29', { recursive: true });
const at = Date.parse('2026-10-29T13:05:00Z');
const usage = { mode: 'normal', pollMs: 900000, trialId: 'paid-202610', expiresAt: Date.parse('2026-11-01T07:00:00Z') };
const book = normalizeBazaar('BOOSTER_COOKIE', {
  buy_summary: [{ pricePerUnit: 100, amount: 1000, orders: 2 }],
  sell_summary: [{ pricePerUnit: 90, amount: 1000, orders: 2 }],
}, at, at);
async function setup(page: Page, uid: string) {
  await page.goto('/');
  await page.evaluate(async uid => {
    const { auth } = await import('/src/data.ts');
    const { GoogleAuthProvider, signInWithCredential } = await import('/node_modules/.vite/deps/firebase_auth.js');
    if (!auth.emulatorConfig) throw Error('Emulator required');
    await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: uid, email: `${uid}@example.test`,
      email_verified: true, iss: 'https://accounts.google.com', aud: 'demo-client', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600 })));
  }, uid);
  await expect(page.getByRole('button', { name: 'Create portfolio', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create portfolio', exact: true }).click();
  const form = page.getByRole('form', { name: 'Create portfolio' });
  await form.getByLabel('Portfolio name').fill('Audit portfolio');
  await form.getByRole('button', { name: 'Save portfolio' }).click();
  await expect(form).toHaveCount(0);
  await page.getByRole('button', { name: 'Add holding', exact: true }).click();
  const h = page.getByRole('form', { name: 'Add holding' });
  await h.getByRole('combobox', { name: 'Search', exact: true }).fill('BOOSTER_COOKIE');
  await h.getByRole('option', { name: /\(BOOSTER_COOKIE\)$/ }).click();
  await h.getByLabel('Quantity owned', { exact: true }).fill('10');
  await h.getByLabel(/ · coins$/).fill('50');
  await h.getByRole('button', { name: 'Save holding', exact: true }).click();
  await expect(h).toHaveCount(0);
}
test.beforeEach(async ({ context, page }) => {
  await context.route('https://**', route => route.abort());
  await context.route('**/api/price-history?**', route => route.fulfill({ status: 503, json: {} }));
  await context.route('**/api/companion/**', route => route.fulfill({ json: { bazaar: [book], usage } }));
  await page.clock.install({ time: at });
});
test('refreshes other-tab holdings and clears private views on sign-out', async ({ page, context }, info) => {
  await setup(page, `audit-tabs-${info.project.name}-${Date.now()}`);
  const other = await context.newPage();
  await other.clock.install({ time: at });
  await other.goto('/#view=portfolios');
  const row = other.getByRole('rowgroup', { name: 'Booster Cookie holding' });
  await expect(row.getByRole('cell', { name: '10', exact: true })).toBeVisible();
  await page.getByRole('rowgroup', { name: 'Booster Cookie holding' }).getByRole('button', { name: 'Edit', exact: true }).click();
  const form = page.getByRole('form', { name: 'Edit holding' });
  await form.getByLabel('Quantity owned', { exact: true }).fill('20');
  await form.getByRole('button', { name: 'Save holding', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole('rowgroup', { name: 'Booster Cookie holding' }).getByRole('cell', { name: '20', exact: true })).toBeVisible();
  await other.clock.fastForward(120000);
  await other.evaluate(() => {
    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
    }
    window.dispatchEvent(new Event('focus'));
  });
  await expect(row.getByRole('cell', { name: '20', exact: true })).toBeVisible();
  await other.getByRole('link', { name: 'Settings', exact: true }).click();
  await other.getByRole('link', { name: 'Portfolio', exact: true }).click();
  await expect(row.getByRole('cell', { name: '20', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await other.close();
});
test('retains partial-refresh quotes and recovers with bounded backoff', async ({ page }, info) => {
  let requests = 0;
  await page.route('**/api/companion/**', route => {
    requests++;
    return route.fulfill({ json: requests !== 2 ? { bazaar: [book], usage } : { bazaar: [], usage, stale: true, error: 'Partial snapshot unavailable' } });
  });
  await setup(page, `audit-partial-${info.project.name}-${Date.now()}`);
  const totals = page.getByRole('region', { name: 'Portfolio value', exact: true });
  await expect(totals).toContainText('1,000');
  await page.clock.fastForward(12 * 60000);
  await expect.poll(() => requests).toBe(2);
  await expect(totals).toContainText('1,000');
  await page.getByText('Some prices are unavailable · Retaining previous estimates', { exact: true }).click();
  await expect(page.getByText('Partial snapshot unavailable', { exact: true })).toBeVisible();
  await page.clock.fastForward(61000);
  await expect.poll(() => requests).toBe(3);
  await expect(page.getByText('Partial snapshot unavailable', { exact: true })).toHaveCount(0);
});

test('defers cross-tab invalidation while editing and refreshes old private data on focus', async ({ page, context }, info) => {
  await setup(page, `audit-draft-${info.project.name}-${Date.now()}`);
  const other = await context.newPage(); await other.clock.install({ time: at });
  await other.goto('/#view=portfolios');
  const row = other.getByRole('rowgroup', { name: 'Booster Cookie holding' });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  const draft = other.getByRole('dialog', { name: 'Edit holding' });
  await draft.getByLabel('Quantity owned', { exact: true }).fill('17');
  await page.getByRole('rowgroup', { name: 'Booster Cookie holding' }).getByRole('button', { name: 'Edit', exact: true }).click();
  const form = page.getByRole('form', { name: 'Edit holding' });
  await form.getByLabel('Quantity owned', { exact: true }).fill('20');
  await form.getByRole('button', { name: 'Save holding', exact: true }).click();
  await expect(form).toHaveCount(0); await other.clock.runFor(200);
  await expect(draft.getByLabel('Quantity owned', { exact: true })).toHaveValue('17');
  await other.keyboard.press('Escape');
  await expect(row.getByRole('cell', { name: '20', exact: true })).toBeVisible();
  // A transaction from another device has no same-origin storage hint.
  await page.evaluate(async () => {
    const { auth } = await import('/src/data.ts');
    const { loadHolding, saveHolding } = await import('/src/companion/portfolio-store.ts');
    const uid = auth.currentUser.uid, pid = new URLSearchParams(location.hash.slice(1)).get('portfolio');
    const current = await loadHolding(uid, pid, 'bz_BOOSTER_COOKIE');
    await saveHolding(uid, pid, { ...current, mode: 'edit', expected: current, quantity: 30 });
  });
  await other.clock.fastForward(61000); await other.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(row.getByRole('cell', { name: '30', exact: true })).toBeVisible();
  await other.close();
});
test('keyboard dialog and offline mutation fail safely then recover without reload', async ({ page, context }, info) => {
  await setup(page, `audit-offline-${info.project.name}-${Date.now()}`);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const edit = page.getByRole('rowgroup', { name: 'Booster Cookie holding' }).getByRole('button', { name: 'Edit', exact: true });
  await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Edit holding' });
  await expect(dialog.getByLabel('Quantity owned', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(edit).toBeFocused();
  await edit.click();
  await dialog.getByLabel('Quantity owned', { exact: true }).fill('11');
  await context.setOffline(true);
  await dialog.getByRole('button', { name: 'Save holding', exact: true }).click();
  await page.clock.fastForward(61000);
  await context.setOffline(false);
  // Firestore transactions may reject or retry; either must preserve a usable UI.
  await expect(page.getByRole('button', { name: 'Saving…' })).toHaveCount(0, { timeout: 20000 });
  if (await dialog.count()) await dialog.getByRole('button', { name: 'Save holding', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('rowgroup', { name: 'Booster Cookie holding' }).getByRole('cell', { name: '11', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const refresh of ['operation', 'automatic']) test(`a deleted emulator account clears the private workspace on ${refresh} token refresh`, async ({ page }, info) => {
  await setup(page, `audit-session-${info.project.name}-${Date.now()}`);
  const token = await page.evaluate(async () => {
    const { auth } = await import('/src/data.ts');
    if (!auth.emulatorConfig) throw Error('Emulator required');
    return auth.currentUser.getIdToken();
  });
  const response = await page.request.post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:delete?key=demo-key', { data: { idToken: token } });
  expect(response.ok()).toBe(true);
  if (refresh === 'automatic') await page.clock.fastForward(61 * 60000);
  else {
    const error = await page.evaluate(async () => {
    const { auth } = await import('/src/data.ts');
    const { sessionToken } = await import('/src/session-token.ts');
    try { await sessionToken(auth.currentUser, true); return null; } catch (error: any) { return error.code; }
    });
    expect(error).toMatch(/user-token-expired|user-not-found|invalid-refresh-token/);
  }
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  await expect(page.getByRole('rowgroup', { name: 'Booster Cookie holding' })).toHaveCount(0);
});

test('a physical double click records one purchase and persists the weighted cost', async ({ page }, info) => {
  await setup(page, `audit-double-${info.project.name}-${Date.now()}`);
  const row = page.getByRole('rowgroup', { name: 'Booster Cookie holding' });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add purchase', exact: true }).click();
  const form = page.getByRole('form', { name: 'Add purchase' });
  await form.getByLabel('Additional quantity').fill('1');
  await form.getByLabel(/ · coins$/).fill('100');
  await form.getByRole('button', { name: 'Save purchase' }).dblclick();
  await expect(form).toHaveCount(0);
  await expect(row.getByRole('cell', { name: '11', exact: true })).toBeVisible();
  await page.reload();
  await expect(row.getByRole('cell', { name: '11', exact: true })).toBeVisible();
  await expect(row.getByRole('cell', { name: '54.55', exact: true })).toBeVisible();
});

test('500 distinct holdings render with five sequential bounded price requests', async ({ page }, info) => {
  await setup(page, `audit-large-${info.project.name}-${Date.now()}`);
  const { uid, pid } = await page.evaluate(async () => ({
    uid: (await import('/src/data.ts')).auth.currentUser.uid,
    pid: new URLSearchParams(location.hash.slice(1)).get('portfolio'),
  }));
  const items = catalog.filter(([id]) => id !== 'BOOSTER_COOKIE').slice(0, 499);
  const response = await page.request.post('http://127.0.0.1:8081/v1/projects/demo-bazaar-watch/databases/(default)/documents:commit', {
    headers: { Authorization: 'Bearer owner' }, data: { writes: items.map(([itemId, name]) => ({ update: {
      name: `projects/demo-bazaar-watch/databases/(default)/documents/users/${uid}/portfolios/${pid}/holdings/bz_${itemId}`,
      fields: Object.fromEntries(Object.entries({ id:`bz_${itemId}`,itemId,name,kind:'bazaar',configuration:'',stackSize:1,
        quantity:1,costBasis:50,createdAt:at,updatedAt:at,revision:1,deleted:false }).map(([key,value]) =>
        [key, typeof value === 'string' ? {stringValue:value} : typeof value === 'boolean' ? {booleanValue:value} : {integerValue:String(value)}])),
    } })) },
  });
  expect(response.ok()).toBe(true);
  const batches: number[] = [];
  await page.route('**/api/companion/**', async route => {
    const ids = new URL(route.request().url()).searchParams.get('assets')!.split(',');
    batches.push(ids.length);
    await route.fulfill({ json: { bazaar: ids.map(id => normalizeBazaar(id.slice(3), {
      buy_summary:[{pricePerUnit:120,amount:1000,orders:1}], sell_summary:[{pricePerUnit:110,amount:1000,orders:1}],
    },at,at)), usage } });
  });
  const started = performance.now();
  await page.reload();
  await expect(page.locator('.holdings-table tbody')).toHaveCount(500);
  // Initial holding has quantity 10, the other 499 have quantity 1.
  await expect(page.getByRole('region', {name:'Portfolio value',exact:true})).toContainText('61,080');
  expect(batches).toEqual([100,100,100,100,100]);
  const layout = await page.evaluate(() => ({ nodes:document.querySelectorAll('*').length, overflow:document.documentElement.scrollWidth>innerWidth }));
  expect(layout.overflow).toBe(false);
  writeFileSync(`.local/audit-fixes-2026-10-29/large-portfolio-${info.project.name}.json`,JSON.stringify({elapsedMs:performance.now()-started,batches,...layout},null,2));
});
