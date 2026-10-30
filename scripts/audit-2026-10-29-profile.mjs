// Local production-build profile with native HTTP caching and public-data replay.
// Requires scripts/profile-app.mjs october-audit and the read-only snapshot file.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
const root = resolve('.local/audit/october-audit');
const output = '.local/audit-2026-10-29';
const saved = JSON.parse(readFileSync(`${output}/public-snapshots.json`));
const calls = { books: 0, history: 0, bookBytes: 0, historyBytes: 0 };
const history = Buffer.from(JSON.stringify({ version: 1, item: saved.item, timezone: 'EST', points: saved.points }));
const book = Buffer.from(JSON.stringify({ bazaar: [saved.book], usage: { mode: 'normal', pollMs: 900000,
  trialId: 'audit-local', expiresAt: Date.parse('2026-11-01T07:00:00Z') } }));
const server = createServer((req, res) => {
  // Prevent every off-host dependency without Playwright request routing, which disables HTTP cache.
  res.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'");
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (path.includes('/api/')) {
    const isHistory = path === '/api/price-history';
    const body = gzipSync(isHistory ? history : book);
    calls[isHistory ? 'history' : 'books']++;
    calls[isHistory ? 'historyBytes' : 'bookBytes'] += body.length;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip',
      'Cache-Control': isHistory ? 'private, max-age=300' : 'private, no-store', 'Vary': 'Accept-Encoding' }).end(body);
    return;
  }
  try {
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + sep)) throw Error('Path outside profile');
    const body = readFileSync(file);
    res.writeHead(200, { 'Content-Type': ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.ttf':'font/ttf','.svg':'image/svg+xml'})[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(5206, '127.0.0.1', resolve));
const browser = await chromium.launch();
const samples = [];
try {
  for (let i = 0; i < 7; i++) {
    const context = await browser.newContext({ viewport: { width:1440,height:1000 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const before = {...calls}; let t = performance.now();
    await page.goto('http://127.0.0.1:5206/');
    const search = page.getByRole('combobox', { name: 'Search Bazaar items' });
    await search.waitFor(); const coldLandingMs = performance.now() - t;
    await search.fill('booster cookie');
    await page.getByRole('option').first().waitFor();
    const typingRequests = calls.books + calls.history - before.books - before.history;
    t = performance.now(); await page.getByRole('option').first().click();
    await page.locator('.bazaar-search-prices').waitFor();
    await page.locator('.item-chart-plot').waitFor();
    const itemReadyMs = performance.now() - t;
    const afterCold = {...calls};
    await page.getByRole('link', { name: 'Back to Portfolio', exact: true }).click();
    t = performance.now(); await page.evaluate(() => { location.hash = 'view=item&item=BOOSTER_COOKIE'; });
    await page.locator('.item-chart-plot').waitFor();
    const navigationMs = performance.now() - t, afterNavigation = {...calls};
    t = performance.now(); await page.reload(); await page.locator('.item-chart-plot').waitFor();
    const reloadMs = performance.now() - t, afterReload = {...calls};
    const other = await context.newPage();
    await other.goto('http://127.0.0.1:5206/#view=item&item=BOOSTER_COOKIE');
    await other.locator('.item-chart-plot').waitFor();
    samples.push({coldLandingMs,itemReadyMs,navigationMs,reloadMs,typingRequests,errors,
      before,afterCold,afterNavigation,afterReload,afterSecondTab:{...calls}});
    await context.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
const median = key => samples.map(s=>s[key]).sort((a,b)=>a-b)[3];
const result = {mode:'Loopback built frontend; 4x CPU; seven fresh Chromium contexts; native HTTP cache; CSP blocks external connections; real public snapshot replay',
  medians:Object.fromEntries(['coldLandingMs','itemReadyMs','navigationMs','reloadMs'].map(k=>[k,median(k)])),samples};
writeFileSync(`docs/measurements/app-audit-2026-10-29/native-cache-profile.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({medians:result.medians,example:samples[3]},null,2));
