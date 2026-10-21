import { afterEach, expect, it, vi } from 'vitest';
import { fixtureTime, fixtureEnd } from './support/paid-runtime-fixture';
import { nextMarketRead } from '../shared/market-schedule';

vi.mock('../src/data', () => ({ auth: null }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

const usage = { mode: 'normal', pollMs: 3600_000, trialId: 'paid-202610', expiresAt: fixtureEnd };
const message = 'Price service is temporarily busy. Saved prices remain available; retry after one minute.';
const prices = { bazaar: [{ id: 'SUMMONING_EYE', asks: [{ pricePerUnit: 1488264.5 }], upstreamAt: fixtureTime }], listings: [], usage };
const busy = () => Response.json({ error: message, usage: { ...usage, mode: 'slow', retryAt: Date.now() + 60_000 } }, { status: 503 });

async function setup() {
  vi.useFakeTimers(); vi.setSystemTime(fixtureTime);
  vi.stubEnv('VITE_MARKET_OPERATING_MODE', 'paid-budget');
  vi.stubEnv('VITE_MARKET_UPDATES_PAUSED', 'false');
  vi.stubEnv('VITE_MARKET_TRIAL_ID', usage.trialId);
  vi.stubEnv('VITE_MARKET_TRIAL_END', new Date(fixtureEnd).toISOString());
  vi.stubGlobal('caches', undefined);
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:5173', search: '' });
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', doc); vi.stubGlobal('window', new EventTarget());
  const polling = await import('../src/companion/polling');
  const { portfolioMarket } = await import('../src/companion/portfolio-market');
  return { ...polling, doc, read: (signal?: AbortSignal) => portfolioMarket(['bz_SUMMONING_EYE'], signal) };
}

it('recovers an empty portfolio price view after one minute, survives repeated throttles, then resumes hourly polling', async () => {
  const { visiblePoll, read, pollingDirective } = await setup();
  const fetcher = vi.fn().mockImplementationOnce(busy).mockImplementationOnce(busy)
    .mockImplementation(async () => Response.json(prices));
  vi.stubGlobal('fetch', fetcher);
  let displayed: unknown, error = '';
  const stop = visiblePoll(async signal => {
    try { displayed = await read(signal); error = ''; }
    catch (e) { error = (e as Error).message; }
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(error).toBe(message); expect(displayed).toBeUndefined();
  await vi.advanceTimersByTimeAsync(59_999); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher).toHaveBeenCalledTimes(3); expect(displayed).toMatchObject(prices); expect(error).toBe('');
  expect(pollingDirective().retryAt).toBeUndefined();
  const next = nextMarketRead(Date.now(), 3600_000);
  await vi.advanceTimersByTimeAsync(next - Date.now() - 1); expect(fetcher).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(4);
  stop();
});

it('keeps saved prices on a 503 without freshening their sample and revalidates after the wait', async () => {
  const { read } = await setup();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(prices)).mockImplementationOnce(busy)
    .mockResolvedValueOnce(Response.json({ ...prices, bazaar: [{ ...prices.bazaar[0], upstreamAt: fixtureTime + 3600_000 }] }));
  vi.stubGlobal('fetch', fetcher);
  await read();
  await vi.advanceTimersByTimeAsync(3600_000);
  expect(await read()).toMatchObject({ bazaar: prices.bazaar, error: message });
  await read(); expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await read()).toMatchObject({ bazaar: [{ upstreamAt: fixtureTime + 3600_000 }] });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('revalidates a same-slot cache after a shared retry deadline instead of replaying its old normal policy', async () => {
  const { read, applyPollingDirective } = await setup();
  const fetcher = vi.fn(async () => Response.json(prices)); vi.stubGlobal('fetch', fetcher);
  await read();
  applyPollingDirective({ ...usage, mode: 'slow', retryAt: Date.now() + 60_000 });
  await read(); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  await read(); expect(fetcher).toHaveBeenCalledTimes(2);
});

it('defers a due retry while hidden and recovers when the portfolio becomes visible', async () => {
  const { visiblePoll, read, doc } = await setup();
  const fetcher = vi.fn().mockImplementationOnce(busy).mockResolvedValue(Response.json(prices)); vi.stubGlobal('fetch', fetcher);
  const stop = visiblePoll(async signal => { await read(signal).catch(() => {}); });
  await vi.advanceTimersByTimeAsync(0);
  doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(120_000); expect(fetcher).toHaveBeenCalledTimes(1);
  doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0); expect(fetcher).toHaveBeenCalledTimes(2);
  stop();
});

it('does not repeatedly consume an expired retry deadline when the retry fails without a new directive', async () => {
  const { visiblePoll, applyPollingDirective } = await setup();
  const task = vi.fn(async () => {
    if (task.mock.calls.length === 1) applyPollingDirective({ ...usage, mode: 'slow', retryAt: Date.now() + 60_000 });
    else throw Error('Network offline');
  });
  const stop = visiblePoll(task);
  await vi.advanceTimersByTimeAsync(60_000); expect(task).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(10 * 60_000); expect(task).toHaveBeenCalledTimes(2);
  stop();
});

it('cancels pending recovery when the release is paused', async () => {
  const { visiblePoll, applyPollingDirective } = await setup();
  const task = vi.fn(async () => { applyPollingDirective({ ...usage, mode: 'slow', retryAt: Date.now() + 60_000 }); });
  const stop = visiblePoll(task); await vi.advanceTimersByTimeAsync(0);
  applyPollingDirective({ mode: 'paused', pollMs: 0 });
  await vi.advanceTimersByTimeAsync(120_000); expect(task).toHaveBeenCalledTimes(1);
  stop(); expect(vi.getTimerCount()).toBe(0);
});

it('does not consume a future retry when a portfolio mounts during the wait', async () => {
  const { visiblePoll, read, applyPollingDirective } = await setup();
  const fetcher = vi.fn(async () => Response.json(prices)); vi.stubGlobal('fetch', fetcher);
  applyPollingDirective({ ...usage, mode: 'slow', retryAt: Date.now() + 60_000 });
  const stop = visiblePoll(async signal => { await read(signal).catch(() => {}); });
  await vi.advanceTimersByTimeAsync(59_999); expect(fetcher).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(1);
  stop();
});

it('shares the recovery request between concurrent readers', async () => {
  const { visiblePoll, read } = await setup();
  const fetcher = vi.fn().mockImplementationOnce(busy).mockImplementation(async () => Response.json(prices));
  vi.stubGlobal('fetch', fetcher);
  const task = async (signal: AbortSignal) => { await read(signal).catch(() => {}); };
  const stops = [visiblePoll(task), visiblePoll(task)];
  await vi.advanceTimersByTimeAsync(0); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000); expect(fetcher).toHaveBeenCalledTimes(2);
  stops.forEach(stop => stop());
});

it.each(['unmount', 'expiry'] as const)('cancels recovery on %s', async reason => {
  const { visiblePoll, applyPollingDirective } = await setup();
  const task = vi.fn(async () => applyPollingDirective({ ...usage, mode: 'slow',
    retryAt: Date.now() + 60_000, expiresAt: Date.now() + 60_000 }));
  const stop = visiblePoll(task); await vi.advanceTimersByTimeAsync(0);
  if (reason === 'unmount') stop();
  await vi.advanceTimersByTimeAsync(120_000); expect(task).toHaveBeenCalledTimes(1);
  stop(); expect(vi.getTimerCount()).toBe(0);
});
