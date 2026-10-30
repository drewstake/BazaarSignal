import { PAID_PILOT_INTERVAL } from '../shared/paid-pilot';
import { afterEach, expect, it, vi } from 'vitest';
import { fixtureTime, fixtureEnd } from './support/paid-runtime-fixture';

vi.mock('../src/data', () => ({ auth: null }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

it('paid portfolio remounts and duplicate asset orders reuse the 15-minute slot while expiry remains terminal', async () => {
  vi.useFakeTimers(); vi.setSystemTime(fixtureTime);
  vi.stubEnv('VITE_MARKET_OPERATING_MODE', 'paid-budget');
  vi.stubEnv('VITE_MARKET_UPDATES_PAUSED', 'false');
  vi.stubEnv('VITE_MARKET_TRIAL_ID', 'paid-202610');
  vi.stubEnv('VITE_MARKET_TRIAL_END', new Date(fixtureEnd).toISOString());
  vi.stubGlobal('caches', undefined);
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:5173', search: '' });
  const fetcher = vi.fn(async () => Response.json({ bazaar: [], listings: [],
    sources: { bazaar: { upstreamAt: fixtureTime, observedAt: fixtureTime } },
    usage: { mode: 'normal', pollMs: PAID_PILOT_INTERVAL, expiresAt: fixtureEnd, trialId: 'paid-202610' } }));
  vi.stubGlobal('fetch', fetcher);
  const { portfolioMarket } = await import('../src/companion/portfolio-market');
  await Promise.all(Array.from({ length: 12 }, (_, i) => portfolioMarket(i % 2 ? ['bz_ITEM_0', 'bz_ITEM_1', 'bz_ITEM_0'] : ['bz_ITEM_1', 'bz_ITEM_0'])));
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.parse('2026-10-13T21:16:59Z'));
  await portfolioMarket(['bz_ITEM_0', 'bz_ITEM_1']);
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.parse('2026-10-13T21:17:00Z'));
  await portfolioMarket(['bz_ITEM_0', 'bz_ITEM_1']);
  expect(fetcher).toHaveBeenCalledTimes(2);
  vi.setSystemTime(fixtureEnd);
  await portfolioMarket(['bz_ITEM_0', 'bz_ITEM_1']);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const { pollingDirective } = await import('../src/companion/polling');
  expect(pollingDirective().mode).toBe('paused');
});

it('prices large portfolios in bounded sequential batches and reuses both batches for the 15-minute slot', async () => {
  vi.useFakeTimers(); vi.setSystemTime(fixtureTime);
  vi.stubEnv('VITE_MARKET_OPERATING_MODE', 'paid-budget');
  vi.stubEnv('VITE_MARKET_UPDATES_PAUSED', 'false');
  vi.stubEnv('VITE_MARKET_TRIAL_ID', 'paid-202610');
  vi.stubEnv('VITE_MARKET_TRIAL_END', new Date(fixtureEnd).toISOString());
  vi.stubGlobal('caches', undefined);
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:5173', search: '' });
  const usage = { mode: 'normal', pollMs: PAID_PILOT_INTERVAL, expiresAt: fixtureEnd, trialId: 'paid-202610' };
  const assets = Array.from({ length: 101 }, (_, i) => `bz_ITEM_${i}`);
  let active = 0, maximum = 0;
  const fetcher = vi.fn(async (url: string) => {
    maximum = Math.max(maximum, ++active);
    await Promise.resolve(); active--;
    const ids = new URL(url).searchParams.get('assets')!.split(',');
    expect(ids.length).toBeLessThanOrEqual(100);
    return Response.json({ bazaar: ids.map(id => ({ id: id.slice(3) })), listings: [], usage });
  });
  vi.stubGlobal('fetch', fetcher);
  const { portfolioMarket } = await import('../src/companion/portfolio-market');
  expect((await portfolioMarket(assets)).bazaar).toHaveLength(101);
  expect(maximum).toBe(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect((await portfolioMarket([...assets].reverse())).bazaar).toHaveLength(101);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('stops large-portfolio batches when the first response pauses the budget and labels partial data', async () => {
  vi.useFakeTimers(); vi.setSystemTime(fixtureTime);
  vi.stubEnv('VITE_MARKET_OPERATING_MODE', 'paid-budget');
  vi.stubEnv('VITE_MARKET_UPDATES_PAUSED', 'false');
  vi.stubEnv('VITE_MARKET_TRIAL_ID', 'paid-202610');
  vi.stubEnv('VITE_MARKET_TRIAL_END', new Date(fixtureEnd).toISOString());
  vi.stubGlobal('caches', undefined);
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:5173', search: '' });
  const fetcher = vi.fn(async () => Response.json({ bazaar: [{ id: 'ITEM_0' }], listings: [], usage: { mode: 'paused', pollMs: 0, reason: 'Budget stopped' } }));
  vi.stubGlobal('fetch', fetcher);
  const { portfolioMarket } = await import('../src/companion/portfolio-market');
  const result = await portfolioMarket(Array.from({ length: 101 }, (_, i) => `bz_ITEM_${i}`));
  expect(result.bazaar).toEqual([{ id: 'ITEM_0' }]);
  expect(result.stale).toBe(true);
  expect(result.error).toContain('Some prices are unavailable');
  expect(fetcher).toHaveBeenCalledOnce();
});
