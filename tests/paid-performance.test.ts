import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fixtureTime, paidRuntimeFixture, portfolioAssets, portfolioUrl, snapshotFixture } from './support/paid-runtime-fixture';

const authState = vi.hoisted(() => ({ currentUser: null as any }));
vi.mock('../src/data', () => ({ auth: authState }));
vi.mock('../src/companion/api', () => ({ fixtureMode: false }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

// Opt-in measurement, never part of normal unit-test timing. Run the EXACT same
// file on both versions; the artifact includes source/workload hashes and samples.
it.skipIf(!process.env.PAID_BENCH_OUTPUT)('measures the offline paid portfolio workload', async () => {
  vi.stubGlobal('fetch', () => { throw Error('Real networking forbidden'); });
  const raw = snapshotFixture();
  const scenarios: Record<string, any> = {};
  for (const scenario of ['warm', 'concurrent', 'cold', 'invalidation', 'legacy-blob']) {
    const samples: any[] = [];
    for (let repetition = 0; repetition < 24; repetition++) {
      const f = paidRuntimeFixture(raw, scenario === 'legacy-blob');
      const latencies: number[] = [];
      for (let i = 0; i < 12; i++) {
        if (scenario === 'invalidation' && i === 6) f.publish(snapshotFixture('two'));
        const responses = await Promise.all(Array.from({ length: scenario === 'concurrent' ? 2 : 1 }, (_, j) =>
          f.request(portfolioUrl(i + j), 'GET', scenario === 'cold' ? f.makeRuntime() : f.runtime)));
        for (const response of responses) {
          expect(response.status).toBe(200);
          expect(response.body.bazaar).toHaveLength(10);
          expect(response.body.bazaar[0].asks[0].pricePerUnit).toBeGreaterThan(response.body.bazaar[0].bids[0].pricePerUnit);
          latencies.push(response.ms);
        }
      }
      expect(f.metrics.upstreamCalls).toBe(0);
      expect(f.metrics.shutdowns).toBe(0);
      if (repetition >= 3) samples.push({ ...f.totals(), latencies });
    }
    const sorted = samples.flatMap(s => s.latencies).sort((a: number, b: number) => a - b);
    const quantile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1];
    const { latencies: _, ...counts } = samples[0];
    scenarios[scenario] = { counts, medianMs: quantile(.5), p95Ms: quantile(.95), samples };
  }

  // Exercise the real browser presence lifecycle: 12 brief visits, 10 holdings,
  // one reusable CORS preflight, enter/leave each visit. Price GETs deliberately
  // represent client-cache misses; same-tab same-hour cache hits need no server.
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(fixtureTime);
  vi.stubEnv('VITE_MARKET_OPERATING_MODE', 'paid-budget');
  vi.stubEnv('VITE_MARKET_UPDATES_PAUSED', 'false');
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:5173' });
  const f = paidRuntimeFixture(raw);
  const pending: Promise<unknown>[] = [];
  let preflight = false;
  const token = vi.fn(async () => 'offline-user');
  authState.currentUser = { getIdToken: token };
  vi.stubGlobal('fetch', (url: URL, init: RequestInit) => {
    const work = (async () => {
      if (!preflight) { preflight = true; await f.request(url.pathname, 'OPTIONS'); }
      const response = await f.request(url.pathname, init.method);
      return Response.json(response.body, { status: response.status });
    })();
    pending.push(work);
    return work;
  });
  const { visiblePortfolioPresence } = await import('../src/companion/portfolio-market');
  for (let i = 0; i < 12; i++) {
    const stop = visiblePortfolioPresence(authState.currentUser, portfolioAssets(i));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all(pending);
    expect((await f.request(portfolioUrl(i))).status).toBe(200);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all(pending);
  }
  const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const result = { description: 'Offline real paid handler + Google REST adapter, synthetic 1000-item snapshot, ten holdings per view, three overlapping portfolios, gzip responses. 3 discarded warm-ups + 21 measured workloads per scenario. Cold = new runtime, not OS/Cloud Run boot. No simulated network delay.',
    node: process.version, platform: process.platform, snapshotBytes: Buffer.byteLength(raw),
    hashes: Object.fromEntries(['tests/paid-performance.test.ts', 'tests/support/paid-runtime-fixture.ts', 'collector/paid-budget.ts', 'src/companion/portfolio-market.ts'].map(p => [p, hash(p)])),
    scenarios, visits: { ...f.totals(), tokenCalls: token.mock.calls.length, preflights: Number(preflight) } };
  mkdirSync('docs/measurements', { recursive: true });
  writeFileSync(process.env.PAID_BENCH_OUTPUT!, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ snapshotBytes: result.snapshotBytes, scenarios: Object.fromEntries(Object.entries(scenarios).map(([key, s]) => [key, { ...s.counts, medianMs: s.medianMs, p95Ms: s.p95Ms }])), visits: result.visits }, null, 2));
}, 120_000);
