// Bounded static production browsing. Runtime/API and authentication requests
// are blocked. Item UI replays public snapshots obtained via management reads.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const out = '.local/audit-2026-10-29';
mkdirSync(out, { recursive: true });
const saved = JSON.parse(readFileSync(`${out}/public-snapshots.json`, 'utf8'));
const origin = 'https://bazaarsignal.web.app';
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 },
      isMobile: width === 390, hasTouch: width === 390 });
    const events = { requests: [], errors: [], console: [], blocked: [], replayed: [] };
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/companion/portfolio-prices') {
        events.replayed.push('book');
        return route.fulfill({ json: { bazaar: [saved.book], usage: { mode: 'normal', pollMs: 900000, trialId: 'paid-202610', expiresAt: Date.parse('2026-11-01T07:00:00Z') } } });
      }
      if (url.pathname === '/api/price-history') {
        events.replayed.push('history');
        return route.fulfill({ json: { version: 1, item: saved.item, timezone: 'EST', points: saved.points,
          collector: { enabled: true, location: 'cloud', lastError: null, lastSuccess: null } } });
      }
      if (url.origin !== origin || route.request().method() !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__/')) {
        events.blocked.push(url.origin + url.pathname); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => events.errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error') events.console.push(msg.text()); });
    page.on('response', response => events.requests.push({ url: new URL(response.url()).pathname, status: response.status() }));
    const start = performance.now();
    await page.goto(origin, { waitUntil: 'networkidle' });
    const landingMs = performance.now() - start;
    const search = page.getByRole('combobox', { name: 'Search Bazaar items' });
    await search.fill('summoning eye');
    await page.getByRole('option').first().waitFor();
    await search.press('Escape');
    const beforeSelection = events.replayed.length;
    await page.screenshot({ path: `${out}/production-landing-${width}.png`, fullPage: true });
    await page.evaluate(() => { location.hash = 'view=item&item=NOT_A_REAL_ITEM'; });
    await page.getByRole('heading', { name: 'Item not found' }).waitFor();
    const invalidRequests = events.replayed.length - beforeSelection;
    await page.evaluate(() => { location.hash = 'view=item&item=BOOSTER_COOKIE'; });
    await page.getByRole('heading', { name: 'Booster Cookie', exact: true }).waitFor();
    await page.locator('.bazaar-search-prices').waitFor();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.screenshot({ path: `${out}/production-item-replay-${width}.png`, fullPage: true });
    const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
      smallTargets: [...document.querySelectorAll('a,button,input,select')].map(el => {
        const r = el.getBoundingClientRect();
        return { label: el.getAttribute('aria-label') || el.textContent?.trim().slice(0,60), width: r.width, height: r.height };
      }).filter(r => r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24)),
      resources: performance.getEntriesByType('resource').map(r => ({ name: new URL(r.name).pathname, transferSize: r.transferSize, decodedBodySize: r.decodedBodySize })) }));
    results.push({ width, landingMs, invalidRequests, ...layout, ...events });
    await context.close();
  }
} finally { await browser.close(); }
writeFileSync(`${out}/production-browser.json`, JSON.stringify({ at: new Date().toISOString(), mode: 'static-live plus management-snapshot replay; no runtime API requests', results }, null, 2));
console.log(JSON.stringify(results.map(({width,landingMs,invalidRequests,overflow,smallTargets,errors,blocked,replayed}) => ({width,landingMs,invalidRequests,overflow,smallTargets,errors,blocked,replayed})), null, 2));
