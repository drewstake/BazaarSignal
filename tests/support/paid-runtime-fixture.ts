import { gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { createPaidRuntime, PAID_BUDGET_KEY, type PaidBudget } from '../../collector/paid-budget';
import { trialGoogleStore } from '../../collector/trial-google';
import { encodeInlineSnapshot } from '../../collector/inline-snapshot';
import { Coordinator, emptyJob } from '../../collector/coordinator';
import { livePolicy } from '../../collector/allowance-live';
import { normalizeBazaar } from '../../shared/companion/bazaar';
import { offlineGoogle } from './offline-google';

export const fixtureTime = Date.parse('2026-10-13T21:05:00Z');
export const fixtureEnd = Date.parse('2026-11-01T07:00:00Z');
export const portfolioAssets = (view = 0) => Array.from({ length: 10 }, (_, i) => `bz_ITEM_${view % 3 * 5 + i}`);
export const portfolioUrl = (view = 0) => `/api/companion/portfolio-prices?assets=${portfolioAssets(view).join(',')}`;

// Synthetic public prices only. Both raw and normalized books are retained just
// as in the published snapshot; no private records or production calls.
export function snapshotFixture(version = 'one', at = fixtureTime, itemCount = 1000) {
  const products = Object.fromEntries(Array.from({ length: itemCount }, (_, i) => [`ITEM_${i}`, {
    buy_summary: Array.from({ length: 12 }, (_, j) => ({ amount: 1000 + i, pricePerUnit: 110 + i + j, orders: 2 })),
    sell_summary: Array.from({ length: 12 }, (_, j) => ({ amount: 1000 + i, pricePerUnit: 100 + i - j, orders: 2 })),
  }]));
  return JSON.stringify({ version, observedAt: at, upstreamAt: at, data: {
    items: Object.entries(products).map(([id, raw]) => normalizeBazaar(id, raw, at, at)),
    raw: { success: true, lastUpdated: at, products }, names: {},
  } });
}

export function paidRuntimeFixture(rawSnapshot: string, blob = false) {
  let now = fixtureTime;
  const f = offlineGoogle(() => now);
  const budget: PaidBudget = { version: 1, id: 'paid-202610', startsAt: now - 1000,
    expiresAt: fixtureEnd, limitUsd: 5, stopUsd: 4.5, reservedUsd: 1,
    reserved: {}, observed: {}, legacyLedgerSha256: 'a'.repeat(64), admissions: {} };
  f.seed(PAID_BUDGET_KEY, JSON.stringify(budget));
  const control = new Coordinator(trialGoogleStore(f.config), livePolicy).empty();
  const metrics = { requests: 0, responseBytes: 0, snapshotLoads: 0,
    decodedSnapshotBytes: 0, controlReads: 0, upstreamCalls: 0, shutdowns: 0 };
  function publish(raw: string) {
    const snapshot = JSON.parse(raw);
    control.jobs.bazaar = { ...emptyJob(), observedAt: snapshot.observedAt,
      upstreamAt: snapshot.upstreamAt, snapshotVersion: snapshot.version };
    f.seed('control', JSON.stringify(control));
    if (blob) f.snapshot('bazaar', raw);
    else f.seed('bazaar', encodeInlineSnapshot('bazaar', raw));
  }
  publish(rawSnapshot);
  const makeRuntime = () => createPaidRuntime({ expiresAt: fixtureEnd, now: () => now,
    shutdown: async () => { metrics.shutdowns++; },
    network: async () => { metrics.upstreamCalls++; throw Error('Offline workload forbids upstream collection'); },
    store: session => {
      const store = trialGoogleStore({ ...f.config, inlineSmallSnapshots: true }, session);
      const read = store.read.bind(store);
      store.read = async key => {
        if (key === 'control') metrics.controlReads++;
        if (key === 'bazaar') metrics.snapshotLoads++;
        const raw = await read(key);
        if (key === 'bazaar' && raw) metrics.decodedSnapshotBytes += Buffer.byteLength(raw);
        return raw;
      };
      return store;
    },
  });
  const runtime = makeRuntime();
  async function request(url = portfolioUrl(), method = 'GET', target = runtime) {
    const headers: Record<string, string> = {};
    let status = 0, data = Buffer.alloc(0);
    const response = { headersSent: false,
      setHeader(key: string, value: unknown) { headers[key.toLowerCase()] = String(value); },
      writeHead(value: number) { status = value; this.headersSent = true; return this; },
      end(value?: string | Buffer) { data = Buffer.from(value ?? ''); return this; },
    };
    metrics.requests++;
    const start = performance.now();
    await target.handle({ url, method, headers: { origin: 'http://127.0.0.1:5173', 'accept-encoding': 'gzip' } } as any, response as any);
    const ms = performance.now() - start;
    metrics.responseBytes += data.length;
    const text = (headers['content-encoding'] === 'gzip' ? gunzipSync(data) : data).toString();
    return { status, body: text ? JSON.parse(text) : null, headers, ms };
  }
  const totals = () => ({ ...metrics, ...f.counts,
    reservedUsd: JSON.parse(f.read(PAID_BUDGET_KEY)!).reservedUsd - 1 });
  return { f, control, metrics, request, runtime, makeRuntime, publish, totals, setNow: (at: number) => { now = at; } };
}
