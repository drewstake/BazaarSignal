import { afterEach, expect, it, vi } from 'vitest';
import { fixtureTime } from './support/paid-runtime-fixture';

const authState = vi.hoisted(() => ({ currentUser: null as any }));
vi.mock('../src/data', () => ({ auth: authState }));
vi.mock('../src/companion/api', () => ({ fixtureMode: false }));
vi.mock('../shared/companion/portfolio-policy', () => ({ PORTFOLIO_COLLECTION_ENABLED: true }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
async function setup(mode: string) {
  vi.useFakeTimers(); vi.setSystemTime(fixtureTime);
  vi.stubEnv('VITE_MARKET_OPERATING_MODE', mode);
  vi.stubEnv('VITE_MARKET_UPDATES_PAUSED', 'false');
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', doc); vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:5173' });
  const fetcher = vi.fn(async (_url: URL, _init: RequestInit) => Response.json({ accepted: true }));
  vi.stubGlobal('fetch', fetcher);
  const token = vi.fn(async () => 'valid-user-token');
  authState.currentUser = { getIdToken: token };
  const market = await import('../src/companion/portfolio-market');
  return { ...market, doc, fetcher, token };
}

it('paid visits, hidden tabs, hourly time and unmounts do no presence, token or timer work', async () => {
  const { visiblePortfolioPresence, doc, fetcher, token } = await setup('paid-budget');
  for (let i = 0; i < 12; i++) {
    const stop = visiblePortfolioPresence(authState.currentUser, ['bz_ITEM_0', 'bz_ITEM_1']);
    await vi.advanceTimersByTimeAsync(0);
    doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
    doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'));
    stop();
  }
  await vi.advanceTimersByTimeAsync(2 * 3600_000);
  expect(fetcher).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('free-tier presence still authenticates visible demand, relinquishes it, and respects pause and sign-out', async () => {
  const { visiblePortfolioPresence, doc, fetcher } = await setup('free-tier');
  const stop = visiblePortfolioPresence(authState.currentUser, ['bz_ITEM_0']);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', method: 'POST', headers: { Authorization: 'Bearer valid-user-token' } });
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toMatchObject({ assets: ['bz_ITEM_0'], active: true });
  doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(String(fetcher.mock.calls[1][1].body)).active).toBe(false);
  const { applyPollingDirective } = await import('../src/companion/polling');
  applyPollingDirective({ mode: 'paused', pollMs: 0 });
  doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'));
  authState.currentUser = null;
  await vi.advanceTimersByTimeAsync(3600_000); stop();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
