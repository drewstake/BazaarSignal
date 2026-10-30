import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { paidRuntimeFixture, fixtureTime, snapshotFixture } from './support/paid-runtime-fixture';
import { PAID_BUDGET_KEY } from '../collector/paid-budget';
vi.mock('../src/data', () => ({ auth: null }));
const now = Date.parse('2026-10-29T13:05:00Z'), end = Date.parse('2026-11-01T07:00:00Z');
const usage = { mode: 'normal', pollMs: 900000, trialId: 'paid-202610', expiresAt: end };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv('VITE_MARKET_OPERATING_MODE', 'paid-budget'); vi.stubEnv('VITE_MARKET_UPDATES_PAUSED', 'false');
  vi.stubEnv('VITE_MARKET_TRIAL_ID', 'paid-202610'); vi.stubEnv('VITE_MARKET_TRIAL_END', new Date(end).toISOString());
  vi.stubEnv('VITE_PRICE_HISTORY_URL', ''); vi.stubEnv('VITE_LOCAL_MARKET_PREVIEW', 'false');
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('caches', undefined);
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:5173', search: '' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

it.each(['expiry', 'pause', 'backoff'])('retains cached history and prevents new network reads during %s', async mode => {
  const network = vi.fn(async () => Response.json({ version: 1, timezone: 'EST', item: 'A', points: [] }));
  vi.stubGlobal('fetch', network);
  const { loadDailyHistory } = await import('../src/companion/daily-price-history');
  const { applyPollingDirective } = await import('../src/companion/polling');
  const saved = await loadDailyHistory('A');
  if (mode === 'expiry') vi.setSystemTime(end);
  else applyPollingDirective(mode === 'pause' ? { mode: 'paused', pollMs: 0 } : { ...usage, mode: 'slow', retryAt: now + 60000 });
  expect(await loadDailyHistory('A')).toEqual(saved);
  await expect(loadDailyHistory('B')).rejects.toThrow('paused');
  expect(network).toHaveBeenCalledOnce();
});
it('aborts an in-flight history read when policy pauses and leaves no policy listener work', async () => {
  const network = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))));
  vi.stubGlobal('fetch', network);
  const { loadDailyHistory } = await import('../src/companion/daily-price-history');
  const { applyPollingDirective } = await import('../src/companion/polling');
  const pending = expect(loadDailyHistory('A')).rejects.toThrow('paused');
  applyPollingDirective({ mode: 'paused', pollMs: 0 });
  await pending;
  await expect(loadDailyHistory('A')).rejects.toThrow('paused');
  expect(network).toHaveBeenCalledOnce();
});
it('preserves explicit loopback offline archive access while remote updates are paused', async () => {
  vi.stubEnv('VITE_LOCAL_MARKET_PREVIEW', 'true'); vi.stubEnv('VITE_MARKET_UPDATES_PAUSED', 'true');
  const network = vi.fn(async () => Response.json({ version: 1, timezone: 'EST', item: 'A', points: [] }));
  vi.stubGlobal('fetch', network);
  const { loadDailyHistory } = await import('../src/companion/daily-price-history');
  await loadDailyHistory('A');
  expect(network.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
});
it('does not cache a policy-cancelled history failure beyond its recovery deadline', async () => {
  const network = vi.fn().mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))))
    .mockResolvedValue(Response.json({ version: 1, timezone: 'EST', item: 'A', points: [] }));
  vi.stubGlobal('fetch', network);
  const { loadDailyHistory } = await import('../src/companion/daily-price-history');
  const { applyPollingDirective } = await import('../src/companion/polling');
  const pending = expect(loadDailyHistory('A')).rejects.toThrow('paused');
  applyPollingDirective({ ...usage, mode: 'slow', retryAt: now + 60000 }); await pending;
  vi.setSystemTime(now + 60000);
  await expect(loadDailyHistory('A')).resolves.toMatchObject({ points: [] });
  expect(network).toHaveBeenCalledTimes(2);
});
it('does not cache transient partial prices and preserves old timestamps only for requested assets', async () => {
  const network = vi.fn().mockResolvedValueOnce(Response.json({ bazaar: [], stale: true, error: 'Temporary partial data', usage }))
    .mockResolvedValue(Response.json({ bazaar: [{ id: 'A', upstreamAt: now }], usage }));
  vi.stubGlobal('fetch', network);
  const { portfolioMarket, reconcilePortfolioPrices } = await import('../src/companion/portfolio-market');
  const partial = await portfolioMarket(['bz_A']);
  expect(partial.retryable).toBe(true);
  const previous: any[] = [{ id: 'A', upstreamAt: now - 10000 }, { id: 'REMOVED', upstreamAt: now }];
  expect(reconcilePortfolioPrices(previous, partial, ['bz_A'])).toEqual([previous[0]]);
  const recovered = await portfolioMarket(['bz_A']);
  expect(network).toHaveBeenCalledTimes(2);
  expect(reconcilePortfolioPrices(previous, recovered, ['bz_A'])).toEqual([{ id: 'A', upstreamAt: now }]);
});
it('does not retry legitimate missing products or keep their old quotes', async () => {
  const network = vi.fn(async () => Response.json({ bazaar: [], usage })); vi.stubGlobal('fetch', network);
  const { portfolioMarket, reconcilePortfolioPrices } = await import('../src/companion/portfolio-market');
  const result = await portfolioMarket(['bz_A']);
  expect(result.retryable).toBe(false);
  expect(reconcilePortfolioPrices([{ id: 'A' }] as any, result, ['bz_A'])).toEqual([]);
  await portfolioMarket(['bz_A']); expect(network).toHaveBeenCalledOnce();
});
it('does not mistake an older same-slot quote for recovery after a server deadline', async () => {
  const network = vi.fn().mockResolvedValueOnce(Response.json({ bazaar: [{ id: 'A', upstreamAt: now }], usage }))
    .mockResolvedValueOnce(Response.json({ bazaar: [], stale: true, error: 'Partial', usage }))
    .mockResolvedValue(Response.json({ bazaar: [{ id: 'A', upstreamAt: now + 120000 }], usage }));
  vi.stubGlobal('fetch', network);
  const { portfolioMarket } = await import('../src/companion/portfolio-market');
  const { applyPollingDirective } = await import('../src/companion/polling');
  await portfolioMarket(['bz_A']);
  applyPollingDirective({ ...usage, mode: 'slow', retryAt: now + 60000 });
  vi.setSystemTime(now + 60000);
  expect((await portfolioMarket(['bz_A'])).retryable).toBe(true);
  vi.setSystemTime(now + 120000);
  expect((await portfolioMarket(['bz_A'])).bazaar[0].upstreamAt).toBe(now + 120000);
  expect(network).toHaveBeenCalledTimes(3);
});
it('ignores foreign and malformed private invalidations, and removes its listener on departure', async () => {
  const { watchPrivateChanges } = await import('../src/companion/private-workspace-sync');
  const changed = vi.fn(), stop = watchPrivateChanges('alice', changed);
  const emit = (value: string | null) => window.dispatchEvent(Object.assign(new Event('storage'), { key: 'bazaarsignal-private-invalidation-v1', newValue: value }));
  for (const value of [null, '{', 'x'.repeat(2048), JSON.stringify({ uid: 'bob' })]) emit(value);
  expect(changed).not.toHaveBeenCalled();
  emit(JSON.stringify({ uid: 'alice' })); emit(JSON.stringify({ uid: 'alice' }));
  await vi.advanceTimersByTimeAsync(100); expect(changed).toHaveBeenCalledOnce();
  stop(); emit(JSON.stringify({ uid: 'alice' })); await vi.advanceTimersByTimeAsync(100); expect(changed).toHaveBeenCalledOnce();
});
it.each(['auth/invalid-refresh-token', 'auth/user-token-expired', 'auth/user-disabled', 'auth/user-not-found'])('reports confirmed terminal session error %s to the owning observer', async code => {
  const { sessionToken, watchSessionErrors } = await import('../src/session-token');
  const user = { getIdToken: vi.fn().mockRejectedValue({ code }) }, observe = vi.fn(), stop = watchSessionErrors(observe);
  await expect(sessionToken(user, true)).rejects.toEqual({ code });
  expect(observe).toHaveBeenCalledWith(user, { code }); stop();
});
it.each(['auth/network-request-failed', 'permission-denied', 'auth/too-many-requests'])('does not invalidate sessions for %s', async code => {
  const { sessionToken, watchSessionErrors } = await import('../src/session-token');
  const observe = vi.fn(), stop = watchSessionErrors(observe);
  await expect(sessionToken({ getIdToken: vi.fn().mockRejectedValue({ code }) })).rejects.toEqual({ code });
  expect(observe).not.toHaveBeenCalled(); stop();
});
it.each([
  ['/api/companion/unknown', 'GET', 404], ['/api/companion/bazaar', 'DELETE', 405],
  ['/api/companion/portfolio-prices?assets=INVALID', 'GET', 400], ['/api/companion/bazaar?refresh=1', 'GET', 400],
  ['/api/companion/auctions', 'GET', 410], ['/api/price-history?item=../bad', 'GET', 400],
])('rejects invalid %s %s without allowance/storage work', async (path, method, status) => {
  vi.useRealTimers();
  const f = paidRuntimeFixture(snapshotFixture('routes', fixtureTime, 10)), before = f.f.read(PAID_BUDGET_KEY);
  expect((await f.request(path as string, method as string)).status).toBe(status);
  expect(f.f.read(PAID_BUDGET_KEY)).toBe(before);
  expect(f.totals().firestoreReads ?? 0).toBe(0); expect(f.totals().firestoreWrites ?? 0).toBe(0);
  expect(f.totals().upstreamCalls).toBe(0); expect(f.totals().shutdowns).toBe(0);
});
