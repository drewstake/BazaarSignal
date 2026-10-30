import { expect, it } from 'vitest';
import { PAID_BUDGET_KEY } from '../collector/paid-budget';
import { legacyHolding, portfolioTotals, valueHolding } from '../shared/companion/portfolio';
import { eligibleSample } from '../shared/companion/notifications';
import { fixtureEnd, fixtureTime, paidRuntimeFixture, portfolioUrl, snapshotFixture } from './support/paid-runtime-fixture';

const snapshot = () => snapshotFixture('one', fixtureTime, 30);

it('shares only immutable public prices across concurrent requests; each request reserves and finishes its own budget', async () => {
  const f = paidRuntimeFixture(snapshot());
  const results = await Promise.all([f.request(portfolioUrl(0)), f.request(portfolioUrl(1))]);
  expect(results.map(r => r.status)).toEqual([200, 200]);
  expect(results[0].body.bazaar[0].id).toBe('ITEM_0');
  expect(results[1].body.bazaar[0].id).toBe('ITEM_5');
  expect(f.metrics.snapshotLoads).toBe(1);
  expect(f.metrics.controlReads).toBe(2);
  const budget = JSON.parse(f.f.read(PAID_BUDGET_KEY)!);
  expect(f.receipts().every(a => a.finished)).toBe(true);
  expect(f.receipts()).toHaveLength(2);
  expect(budget.admissionCount).toBe(2);
  expect(budget.reserved.runRequests).toBe(2);
  expect(budget.observed.firestoreReads).toBe(3); // two controls + one payload
  expect(f.metrics.upstreamCalls).toBe(0);
  expect(f.metrics.shutdowns).toBe(0);
});

it('reloads changed generations, isolates cold runtimes and stores, and supports legacy blob snapshots', async () => {
  const f = paidRuntimeFixture(snapshot(), true);
  expect((await f.request()).body.versions.bazaar).toBe('one');
  expect((await f.request()).body.versions.bazaar).toBe('one');
  expect(f.f.counts.storageClassB).toBe(1);
  f.publish(snapshotFixture('two', fixtureTime, 30)); // same timestamp, new identity
  expect((await f.request()).body.versions.bazaar).toBe('two');
  expect(f.f.counts.storageClassB).toBe(2);
  expect((await f.request(portfolioUrl(), 'GET', f.makeRuntime())).body.versions.bazaar).toBe('two');
  expect(f.f.counts.storageClassB).toBe(3);
  const other = paidRuntimeFixture(snapshotFixture('other-store', fixtureTime, 30));
  expect((await other.request()).body.versions.bazaar).toBe('other-store');
  expect((await f.request()).body.versions.bazaar).toBe('two');
});

it('keeps source timestamps and ask valuations unchanged while warm prices become ineligible for alerts', async () => {
  const f = paidRuntimeFixture(snapshot());
  const fresh = (await f.request()).body;
  const holding = legacyHolding({ itemId: 'ITEM_0', name: 'Item 0', quantity: 10, costBasis: 1000,
    createdAt: fixtureTime - 1000, updatedAt: fixtureTime - 1000, revision: 1 });
  const value = valueHolding(holding, fresh.bazaar, [], fixtureTime);
  expect(value).toMatchObject({ referencePrice: 110, value: 1100, pnl: 100, returnPercent: 10, freshness: 'fresh' });
  expect(eligibleSample(value, fixtureTime)).toBe(true);
  f.setNow(fixtureTime + 180_001);
  f.control.jobs.bazaar.error = 'Upstream unavailable';
  f.control.jobs.bazaar.failures = 1;
  f.f.seed('control', JSON.stringify(f.control));
  const stale = (await f.request()).body;
  expect(stale.sources).toEqual(fresh.sources);
  const staleValue = valueHolding(holding, stale.bazaar, [], fixtureTime + 180_001);
  expect(staleValue).toMatchObject({ referencePrice: 110, value: 1100, freshness: 'stale' });
  expect(eligibleSample(staleValue, fixtureTime + 180_001)).toBe(false);
  expect(staleValue).toMatchObject({ pnl: value.pnl, returnPercent: value.returnPercent });
  expect(portfolioTotals([holding], stale.bazaar, [], fixtureTime + 180_001)).toMatchObject({ value: 1100, pnl: 100, returnPercent: 10, stale: true });
  expect(portfolioTotals([{ ...holding, quantity: 20, costBasis: 2000 }], stale.bazaar, [], fixtureTime + 180_001)).toMatchObject({ value: 2200, pnl: 200, returnPercent: 10 });
  const status = (await f.request('/api/companion/bazaar')).body;
  expect(status).toMatchObject({ error: 'Upstream unavailable', status: { stale: true, failures: 1 } });
  expect(f.metrics.snapshotLoads).toBe(1);
  expect(f.metrics.controlReads).toBe(3);
});

it.each(['owner-stop', 'exhausted', 'ledger-expired', 'release-expired'])('never serves a warm payload past %s', async reason => {
  const f = paidRuntimeFixture(snapshot());
  await f.request();
  const budget = JSON.parse(f.f.read(PAID_BUDGET_KEY)!);
  if (reason === 'owner-stop') { budget.stoppedAt = fixtureTime; budget.reason = 'Owner stopped'; }
  if (reason === 'exhausted') budget.reservedUsd = 4.49999;
  if (reason === 'ledger-expired') budget.expiresAt = fixtureTime;
  if (reason === 'release-expired') f.setNow(fixtureEnd);
  f.f.seed(PAID_BUDGET_KEY, JSON.stringify(budget));
  const response = await f.request();
  expect(response.status).toBe(503);
  expect(response.body.usage.mode).toBe('paused');
  expect(response.body.bazaar).toBeUndefined();
  expect(f.metrics.snapshotLoads).toBe(1);
  expect(f.metrics.shutdowns).toBe(1);
});

it('a failed replacement never serves the previous cached generation; its hold remains and a later read retries', async () => {
  const f = paidRuntimeFixture(snapshot());
  await f.request();
  const before = JSON.parse(f.f.read(PAID_BUDGET_KEY)!).reservedUsd;
  f.publish(snapshotFixture('two', fixtureTime, 30));
  const network = f.f.config.network;
  f.f.config.network = async (url, init) => {
    if (String(url).endsWith(':batchGet') && JSON.parse(String(init?.body)).documents.some((p: string) => p.endsWith('/bazaar')))
      throw Error('snapshot unavailable');
    return network(url, init);
  };
  const response = await f.request();
  expect(response.status).toBe(503);
  expect(response.body.bazaar).toBeUndefined();
  expect(f.metrics.shutdowns).toBe(0);
  expect(JSON.parse(f.f.read(PAID_BUDGET_KEY)!).reservedUsd).toBeGreaterThan(before);
  f.f.config.network = network;
  expect((await f.request()).body.versions.bazaar).toBe('two');
});

it('old paid presence clients still pass budget gates, and repeated refresh controls cannot collect', async () => {
  const f = paidRuntimeFixture(snapshot());
  await f.request('/api/companion/presence', 'POST');
  expect(JSON.parse(f.f.read(PAID_BUDGET_KEY)!).reserved.runRequests).toBe(1);
  for (let i = 0; i < 3; i++) expect((await f.request(`${portfolioUrl()}&refresh=true`)).status).toBe(400);
  expect(f.metrics.snapshotLoads).toBe(0);
  expect(f.metrics.upstreamCalls).toBe(0);
});
