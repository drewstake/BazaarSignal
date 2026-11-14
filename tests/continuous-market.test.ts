import { afterEach, expect, it, vi } from 'vitest';
import { SqliteCache } from '../collector/cache-store';
import { createPaidRuntime, PaidLedger, PAID_BUDGET_KEY, validateContinuous, type PaidBudget } from '../collector/paid-budget';
import { CONTINUOUS_LEDGER_KEY, CONTINUOUS_MARKET_ID } from '../shared/continuous-market';
import { marketServiceActive } from '../shared/market-mode';
import { paidRuntimeFixture, snapshotFixture } from './support/paid-runtime-fixture';
import { trialGoogleStore } from '../collector/trial-google';
import { emptyAdmin, parseAdminReport, pilotStatus } from '../shared/admin';

const now = Date.parse('2026-11-07T21:00:00Z');
const state = (): PaidBudget => ({ version: 2, budgetPolicy: 'uncapped', id: CONTINUOUS_MARKET_ID,
  startsAt: now, expiresAt: 0, limitUsd: 0, stopUsd: 0, reservedUsd: 99,
  reserved: {}, observed: {}, legacyLedgerSha256: 'a'.repeat(64), admissions: {}, admissionCount: 5000 });

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules(); });

it('continuous operation crosses months and the former limits without changing stopped October accounting', async () => {
  const store = new SqliteCache(':memory:');
  const old = JSON.stringify({ id: 'paid-202610', stoppedAt: now - 1, reason: 'Paid release expired' });
  await store.commit(PAID_BUDGET_KEY, null, old);
  await store.commit(CONTINUOUS_LEDGER_KEY, null, JSON.stringify(state()));
  let at = now;
  const ledger = new PaidLedger(store, () => at, undefined, undefined, true);
  try {
    for (const date of ['2026-11-07T21:00:00Z', '2026-12-01T00:00:00Z', '2027-01-01T00:00:00Z']) {
      at = Date.parse(date);
      const attempts = await Promise.all([ledger.admit('collector', date), ledger.admit('collector', date + '-duplicate')]);
      expect(attempts.filter(Boolean)).toHaveLength(1);
      await attempts.find(Boolean)!.finish();
    }
    const saved = JSON.parse((await store.read(CONTINUOUS_LEDGER_KEY))!);
    expect(saved.admissionCount).toBe(5003);
    expect(saved.reservedUsd).toBeGreaterThan(99);
    expect(saved.stoppedAt).toBeUndefined();
    expect(await store.read(PAID_BUDGET_KEY)).toBe(old);
    await ledger.stop('Owner maintenance');
    await expect(ledger.admit('browser', 'after-stop')).rejects.toThrow('Owner maintenance');
  } finally { await store.close(); }
});

it('continuous mode must be explicit and retains per-invocation limits', async () => {
  for (const patch of [{ budgetPolicy: undefined }, { id: 'paid-202610' }, { expiresAt: now + 1 }, { admissionCount: NaN }])
    expect(() => validateContinuous({ ...state(), ...patch } as PaidBudget, now)).toThrow();
  const store = new SqliteCache(':memory:');
  await store.commit(CONTINUOUS_LEDGER_KEY, null, JSON.stringify(state()));
  try {
    const session = await new PaidLedger(store, () => now, undefined, undefined, true).admit('browser', 'bounded');
    expect(() => session!.take({ hypixelRequests: 1 })).toThrow();
    await expect(new PaidLedger(store, () => now).admit('browser', 'legacy')).rejects.toThrow();
  } finally { await store.close(); }
});

it('only the continuous release polls after October and it still honors terminal server pauses', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv('PROD', true); vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_MARKET_OPERATING_MODE', 'continuous');
  vi.stubEnv('VITE_MARKET_UPDATES_PAUSED', 'false');
  vi.stubEnv('VITE_MARKET_TRIAL_ID', CONTINUOUS_MARKET_ID);
  vi.stubEnv('VITE_MARKET_TRIAL_END', '');
  const p = await import('../src/companion/polling');
  expect(p.configuredPause).toBe(false);
  p.applyPollingDirective({ mode: 'normal', pollMs: 900000, trialId: CONTINUOUS_MARKET_ID });
  vi.setSystemTime(new Date('2027-02-01T00:00:00Z'));
  expect(p.pollingDirective()).toEqual({ mode: 'normal', pollMs: 900000, trialId: CONTINUOUS_MARKET_ID });
  expect(vi.getTimerCount()).toBe(0);
  expect(marketServiceActive('paid-budget')).toBe(false);
  expect(marketServiceActive('continuous')).toBe(true);
  p.applyPollingDirective({ mode: 'paused', pollMs: 0 });
  p.applyPollingDirective({ mode: 'normal', pollMs: 900000, trialId: CONTINUOUS_MARKET_ID });
  expect(p.pollingDirective().mode).toBe('paused');
});

it('an old cached pilot directive cannot enter a continuous release', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv('PROD', true); vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_MARKET_OPERATING_MODE', 'continuous');
  vi.stubEnv('VITE_MARKET_UPDATES_PAUSED', 'false');
  vi.stubEnv('VITE_MARKET_TRIAL_ID', CONTINUOUS_MARKET_ID);
  vi.stubEnv('VITE_MARKET_TRIAL_END', '');
  const p = await import('../src/companion/polling');
  p.applyPollingDirective({ mode: 'normal', pollMs: 900000, trialId: 'paid-202610', expiresAt: now + 1000 });
  expect(p.pollingDirective().mode).toBe('paused');
});

it('serves cached prices after expiry without polling the retired billing feed or touching the old ledger', async () => {
  const f = paidRuntimeFixture(snapshotFixture('continuous', now));
  f.setNow(now);
  const old = f.f.read(PAID_BUDGET_KEY);
  f.f.seed(CONTINUOUS_LEDGER_KEY, JSON.stringify(state()));
  const shutdown = vi.fn(), feed = vi.fn(), reports: unknown[] = [];
  const runtime = createPaidRuntime({ continuous: true, expiresAt: NaN, now: () => now,
    shutdown, billingFeed: feed, report: value => reports.push(value),
    network: async () => { throw Error('Browser must not collect'); },
    store: session => trialGoogleStore({ ...f.f.config, inlineSmallSnapshots: true }, session),
  });
  const response = await f.request(undefined, 'GET', runtime);
  expect(response.status, JSON.stringify(reports)).toBe(200);
  expect(response.body.bazaar).toHaveLength(10);
  expect(response.body.usage).toEqual({ mode: 'normal', pollMs: 900000, bazaarMs: 900000, trialId: CONTINUOUS_MARKET_ID });
  expect(f.f.read(PAID_BUDGET_KEY)).toBe(old);
  expect(shutdown).not.toHaveBeenCalled();
  expect(feed).not.toHaveBeenCalled();
});

it('reports continuous status without interpreting usage estimates as a budget stop', () => {
  const report = emptyAdmin(now);
  report.pilot = { budgetPolicy: 'uncapped', measuredAt: now, startsAt: now - 1,
    expiresAt: null, budgetUsd: 0, stopUsd: 0, reservedUsd: 99, stoppedAt: null,
    reason: null, lastPriceCheck: now - 1, priceError: null };
  report.scheduler = { measuredAt: now, state: 'ENABLED', schedule: '*/15 * * * *', expiresAt: null };
  expect(pilotStatus(parseAdminReport(report), now)).toBe('Active');
  report.pilot.stoppedAt = now;
  expect(pilotStatus(report, now)).toBe('Stopped');
  report.pilot.stoppedAt = null;
  report.pilot.budgetPolicy = undefined;
  expect(() => parseAdminReport(report)).toThrow();
});
