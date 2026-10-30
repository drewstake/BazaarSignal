// Audit probes document current behavior; no Google or upstream network is used.
import { expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CloudPriceHistory, encodeHistory, historyShard } from '../collector/cloud-price-history';
import { historyDay } from '../shared/daily-price-history';
import { createPaidRuntime, PAID_BUDGET_KEY } from '../collector/paid-budget';
import { trialGoogleStore } from '../collector/trial-google';
import { fixtureEnd, fixtureTime, paidRuntimeFixture, snapshotFixture } from './support/paid-runtime-fixture';
mkdirSync('.local/audit-fixes-2026-10-29', { recursive: true });

it('recovers a rejected archive batch inside the existing capture and clears the error', async () => {
  const now = Date.parse('2026-10-29T04:59:10Z');
  const docs = new Map<string, { value: any; update: string }>();
  const lastSuccess = { at: now - 86400000, checkedAt: now - 86400000, closing: true, items: 32 };
  docs.set('meta', { value: { version: 1, years: [2026], lastSuccess }, update: 'seed' });
  let commits = 0;
  const network = vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    if (body.documents) return Response.json(body.documents.map((name: string) => {
      const doc = docs.get(name.split('/').at(-1)!);
      return doc ? { found: { name, fields: { packed: { stringValue: encodeHistory(doc.value) } }, updateTime: doc.update } } : { missing: name };
    }));
    commits++;
    if (commits === 2) return Response.json({ error: { status: 'RESOURCE_EXHAUSTED' } }, { status: 429 });
    for (const row of body.writes) {
      const { decodeHistory } = await import('../collector/cloud-price-history');
      docs.set(row.update.name.split('/').at(-1), { value: decodeHistory(row.update.fields.packed.stringValue), update: String(commits) });
    }
    return Response.json({ writeResults: [] });
  });
  const ids = new Map<number, string>();
  for (let i = 0; ids.size < 32; i++) ids.set(historyShard(`ITEM_${i}`), `ITEM_${i}`);
  const products = Object.fromEntries([...ids.values()].map(id => [id, {
    buy_summary: [{ pricePerUnit: 100, amount: 1, orders: 1 }], sell_summary: [{ pricePerUnit: 90, amount: 1, orders: 1 }],
  }]));
  const archive = new CloudPriceHistory({ project: 'offline-audit', token: async () => 'offline', network, wait: async () => {} });
  await archive.capture(() => now, async () => Response.json({ success: true, lastUpdated: now, products }));
  expect(commits).toBe(10); // eight shard batches, one rejected attempt, metadata
  const first = await archive.item(ids.get(0)!, now + 60000, fixtureEnd);
  const later = await archive.item(ids.get(8)!, now + 60000, fixtureEnd);
  expect(first.points).toHaveLength(1); expect(later.points).toHaveLength(1);
  expect(first.points[0][0]).toBe(historyDay(now));
  expect(first.collector.lastSuccess).toMatchObject({ at: now, items: 32 });
  expect(first.collector.lastError).toBeNull();
});

it('rejects an unknown public route without consuming an admission or storage work', async () => {
  const f = paidRuntimeFixture(snapshotFixture('audit', fixtureTime, 10));
  const before = f.f.read(PAID_BUDGET_KEY);
  const response = await f.request('/not-a-market-route');
  expect(response.status).toBe(404);
  expect(f.f.read(PAID_BUDGET_KEY)).toBe(before);
  expect(f.totals().firestoreReads ?? 0).toBe(0);
  expect(f.totals().firestoreWrites ?? 0).toBe(0);
  expect(f.totals()).toMatchObject({ upstreamCalls: 0, shutdowns: 0 });
});

it('measures two price requests with the deployed one-second accounting queue', async () => {
  const f = paidRuntimeFixture(snapshotFixture('audit', fixtureTime, 10));
  const runtime = createPaidRuntime({ expiresAt: fixtureEnd, now: () => fixtureTime, ledgerWriteIntervalMs: 1000,
    store: session => trialGoogleStore({ ...f.f.config, inlineSmallSnapshots: true }, session),
    shutdown: async () => { throw Error('Unexpected shutdown'); },
    network: async () => { throw Error('Real network forbidden'); },
  });
  const start = performance.now();
  const responses = await Promise.all([f.request(undefined, 'GET', runtime), f.request(undefined, 'GET', runtime)]);
  expect(responses.map(r => r.status)).toEqual([200,200]);
  const elapsedMs = performance.now() - start;
  expect(elapsedMs).toBeGreaterThanOrEqual(2900);
  writeFileSync('.local/audit-fixes-2026-10-29/queued-runtime.json', JSON.stringify({ elapsedMs, latenciesMs: responses.map(r => r.ms), counts: f.totals() },null,2));
}, 15000);
