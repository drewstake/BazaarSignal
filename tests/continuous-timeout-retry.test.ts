import { afterEach, expect, it, vi } from 'vitest';
import { CONTINUOUS_MARKET_ID } from '../shared/continuous-market';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

it('keeps last-known prices during a timeout and automatically rereads after the recovery deadline', async () => {
  const now = Date.parse('2026-11-14T18:00:00Z');
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv('PROD', true); vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_MARKET_OPERATING_MODE', 'continuous');
  vi.stubEnv('VITE_MARKET_UPDATES_PAUSED', 'false');
  vi.stubEnv('VITE_MARKET_TRIAL_ID', CONTINUOUS_MARKET_ID);
  vi.stubEnv('VITE_MARKET_TRIAL_END', '');
  vi.stubGlobal('caches', undefined);
  vi.stubGlobal('location', { origin: 'http://localhost', search: '' });
  const usage = { mode: 'normal', pollMs: 900000, trialId: CONTINUOUS_MARKET_ID };
  const quote = (at: number, price: number) => ({ bazaar: [{ id: 'ITEM_0', upstreamAt: at,
    observedAt: at, asks: [{ pricePerUnit: price, amount: 1, orders: 1 }], bids: [] }], usage });
  const retryAt = now + 20 * 60000 + 60000;
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json(quote(now, 100)))
    .mockResolvedValueOnce(Response.json({ error: 'Price service is temporarily busy.',
      usage: { ...usage, mode: 'slow', retryAt } }, { status: 503, headers: { 'Retry-After': '60' } }))
    .mockResolvedValueOnce(Response.json(quote(retryAt, 105)));
  vi.stubGlobal('fetch', fetcher);
  const { cachedMarketRequest } = await import('../src/companion/request-cache');
  const { pollingDirective } = await import('../src/companion/polling');
  const url = 'http://localhost/api/companion/portfolio-prices?assets=bz_ITEM_0';
  await cachedMarketRequest(url);
  vi.setSystemTime(now + 20 * 60000);
  const saved: any = await cachedMarketRequest(url);
  expect(saved.bazaar[0].upstreamAt).toBe(now);
  expect(saved.bazaar[0].asks[0].pricePerUnit).toBe(100);
  expect(pollingDirective()).toMatchObject({ mode: 'slow', retryAt });
  await cachedMarketRequest(url);
  expect(fetcher).toHaveBeenCalledTimes(2);
  vi.setSystemTime(retryAt);
  const recovered: any = await cachedMarketRequest(url);
  expect(recovered.bazaar[0].asks[0].pricePerUnit).toBe(105);
  expect(recovered.bazaar[0].upstreamAt).toBe(retryAt);
  expect(pollingDirective().mode).toBe('normal');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
