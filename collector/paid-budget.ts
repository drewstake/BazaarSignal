import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CacheStore } from './cache-store';
import { TrialSession, TrialStopped, type Counters } from './trial';
import { MarketCollector } from './engine';
import { livePolicy } from './allowance-live';
import { marketHandler } from './routes';
import { SnapshotReadCache } from './snapshot-read-cache';

export const PAID_INTERVAL_MS = 3_600_000;
export const PAID_BUDGET_KEY = 'paid-budget-october';
// Gross on-demand USD prices, deliberately taking no free-tier credit.
// us-central1 Firestore, Run and Storage are co-located; internal transfer is free.
// Prices checked October 13, 2026. These are reservations, not a provider bill.
export const paidRates: Counters = {
  cpuSeconds: .000024, memoryGiBSeconds: .0000025, runRequests: .4 / 1e6,
  firestoreReads: .03 / 100000, firestoreWrites: .09 / 100000,
  firestoreDeletes: .01 / 100000, egressBytes: .25 / 1024 ** 3,
  logBytes: .5 / 1024 ** 3, storageClassA: .005 / 1000, storageClassB: .0004 / 1000,
};
export interface PaidBudget {
  version: 1; id: string; startsAt: number; expiresAt: number;
  limitUsd: number; stopUsd: number; reservedUsd: number;
  reserved: Counters; observed: Counters; legacyLedgerSha256: string;
  stoppedAt?: number; reason?: string; lastCollectorAt?: number;
  admissions: Record<string, { at: number; finished?: boolean }>;
}
export const paidEnvelope = (kind: 'collector' | 'browser'): Counters => ({
  runRequests: 1, cpuSeconds: kind === 'collector' ? 100 : 20,
  memoryGiBSeconds: kind === 'collector' ? 100 : 20,
  firestoreReads: kind === 'collector' ? 64 : 16,
  firestoreWrites: kind === 'collector' ? 40 : 0,
  firestoreDeletes: 0, storageClassA: 0, storageClassB: 3,
  snapshotUploads: 0, storageListPages: 0, cleanupRuns: 0,
  hypixelRequests: kind === 'collector' ? 9 : 0, sellerRequests: 0,
  upstreamResponseBytes: kind === 'collector' ? 64 * 1024 ** 2 : 0,
  firestoreEgressBytes: (kind === 'collector' ? 512 : 128) * 1024 ** 2,
  firestoreStorageBytes: 1152 * 1024, storageEgressBytes: 24 * 1024 ** 2,
  egressBytes: kind === 'collector' ? 65536 : 16 * 1024,
  logBytes: kind === 'collector' ? 128 * 1024 : 16 * 1024,
});
export function paidCost(costs: Counters) {
  for (const n of Object.values(costs)) if (!Number.isFinite(n) || n < 0) throw new TrialStopped('Invalid paid reservation');
  return Math.ceil(Object.entries(paidRates).reduce((sum, [key, rate]) => sum + (costs[key] ?? 0) * rate, 0) * 1e9) / 1e9;
}
export function validatePaid(s: PaidBudget | null, now: number) {
  if (!s || s.version !== 1 || s.id !== 'paid-202610' ||
    ![s.startsAt,s.expiresAt,s.reservedUsd,s.limitUsd,s.stopUsd].every(Number.isFinite) ||
    s.startsAt > now || now >= s.expiresAt || s.expiresAt <= s.startsAt || s.expiresAt - s.startsAt > 32 * 86400000 ||
    s.limitUsd !== 5 || s.stopUsd !== 4.5 || s.reservedUsd < 1 || s.reservedUsd > s.stopUsd ||
    !/^[a-f0-9]{64}$/.test(s.legacyLedgerSha256) || !s.reserved || !s.observed || !s.admissions ||
    s.stoppedAt !== undefined) throw new TrialStopped(s?.reason ?? 'Paid budget is missing, stopped or expired');
}
export class PaidLedger {
  constructor(private store: CacheStore, private clock = Date.now) {}
  private async change<T>(fn: (s: PaidBudget, now: number) => T, terminal = false) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const raw = await this.store.read(PAID_BUDGET_KEY);
      const s: PaidBudget | null = raw ? JSON.parse(raw) : null;
      const now = this.store.time ? await this.store.time() : this.clock();
      if (!terminal) validatePaid(s, now);
      if (!s) throw new TrialStopped('Paid budget missing');
      const result = fn(s, now);
      if (raw === JSON.stringify(s) || await this.store.commit(PAID_BUDGET_KEY, raw, JSON.stringify(s))) return result;
    }
    throw new TrialStopped('Paid budget contention');
  }
  private reserve(s: PaidBudget, costs: Counters) {
    const usd = paidCost(costs);
    if (s.reservedUsd + usd > s.stopUsd) throw new TrialStopped('Paid budget reservation stop reached ($4.50 of $5)');
    s.reservedUsd += usd;
    for (const [k,n] of Object.entries(costs)) s.reserved[k] = (s.reserved[k] ?? 0) + n;
  }
  async admit(kind: 'collector' | 'browser', id: string) {
    if (!/^[a-zA-Z0-9:_./-]{1,250}$/.test(id) || ['__proto__','constructor','prototype'].includes(id)) throw new TrialStopped('Invalid paid invocation');
    return this.change((s, now) => {
      if (Object.hasOwn(s.admissions,id)) return null;
      if (kind === 'collector' && s.lastCollectorAt !== undefined && Math.floor(now / PAID_INTERVAL_MS) <= Math.floor(s.lastCollectorAt / PAID_INTERVAL_MS)) return null;
      // Keep deduplication for this entire fixed trial. No ambiguous holds are refunded.
      if (Object.keys(s.admissions).length >= 4000) throw new TrialStopped('Paid request limit reached');
      const envelope = paidEnvelope(kind);
      this.reserve(s, {...envelope, firestoreReads: envelope.firestoreReads + 20, firestoreWrites: envelope.firestoreWrites + 8});
      s.admissions[id] = { at: now };
      if (kind === 'collector') s.lastCollectorAt = now;
      return new TrialSession(this, s.id, id, Math.min(s.expiresAt,now + (kind === 'collector' ? 80000 : 14000)), envelope, this.clock, now - this.clock(), 'normal');
    });
  }
  async add(id: string, costs: Counters) {
    if (Object.keys(costs).some(k=>k!=='egressBytes'))throw new TrialStopped('Unreviewed paid extension');
    await this.change(s => { if (s.id !== id) throw new TrialStopped('Paid identity changed'); this.reserve(s, {...costs,firestoreReads:8,firestoreWrites:4}); });
  }
  async finish(id: string, invocation: string, observed: Counters) {
    await this.change(s => {
      if (s.id !== id || !s.admissions[invocation]) throw new TrialStopped('Unknown paid invocation');
      if (s.admissions[invocation].finished) return;
      for (const [k,n] of Object.entries(observed)) {
        if (!Number.isFinite(n) || n < 0) throw new TrialStopped('Invalid observation');
        s.observed[k] = (s.observed[k] ?? 0) + n;
      }
      s.admissions[invocation].finished = true;
    }, true);
  }
  async stop(reason: string) {
    await this.change((s,now) => { s.stoppedAt ??= now; s.reason ??= reason; }, true);
  }
}

export function createPaidRuntime(config: {
  expiresAt: number; store: (session?: TrialSession) => CacheStore;
  shutdown: () => Promise<void>; network?: typeof fetch; now?: () => number;
  report?: (data: Record<string, unknown>) => void;
}) {
  const now = config.now ?? Date.now;
  // One bounded immutable-payload cache per warm runtime. Stores, sessions,
  // durable budget admission and control/freshness reads remain request-local.
  const snapshots = new SnapshotReadCache();
  async function run(kind: 'collector' | 'browser', id: string, work: (session: TrialSession, collector: MarketCollector) => Promise<void>) {
    const raw = config.store(), ledger = new PaidLedger(raw, now);
    let session: TrialSession | null = null;
    try {
      if (!Number.isFinite(config.expiresAt) || now() >= config.expiresAt) throw new TrialStopped('Paid release expired');
      session = await ledger.admit(kind, id);
      if (!session) return;
      const store = config.store(session);
      try {
        const collector = new MarketCollector(store, livePolicy, session.network(config.network), now, Math.random,
          (key,amount) => session!.count(key,amount), PAID_INTERVAL_MS, snapshots);
        await work(session,collector);
      } finally { await store.close(); }
      await session.finish();
      config.report?.({event:'paid_market',kind,at:now(),observed:session.observed});
    } catch (e) {
      if (session) await session.finish().catch(() => {});
      const reason = e instanceof Error ? e.message : 'Paid collection failed';
      const stopped = await Promise.allSettled([ledger.stop(reason),config.shutdown()]);
      config.report?.({event:'paid_market_stopped',kind,reason,shutdownComplete:stopped.every(r=>r.status==='fulfilled')});
      throw e;
    } finally { await raw.close(); }
  }
  return {
    collect: (event: string) => run('collector',event,async (_session,collector) => { await collector.tick(['catalog','election','bazaar']); }),
    async handle(req: IncomingMessage,res: ServerResponse) {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      try {
        await run('browser',randomUUID(),async (session,collector) => {
          if (path === '/api/companion/presence') {
            // Hourly collection also serves email while browsers are closed.
            // Even this no-op consumes admission budget; it cannot evade the stop.
            res.setHeader('Access-Control-Allow-Origin','https://bazaarsignal.web.app');
            res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
            res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
            res.setHeader('Access-Control-Max-Age','86400');
            res.writeHead(req.method === 'OPTIONS' ? 204 : 200).end(req.method === 'OPTIONS' ? '' : '{"accepted":true}'); return;
          }
          await marketHandler(collector,async (request,response,status,body) => {
            const text = body === undefined ? '' : JSON.stringify({...body as object,usage:{mode:'normal',pollMs:PAID_INTERVAL_MS,bazaarMs:PAID_INTERVAL_MS,trialId:'paid-202610',expiresAt:config.expiresAt}});
            if (Buffer.byteLength(text) > 8 * 1024 ** 2) throw new TrialStopped('Paid response exceeds bound');
            const compressed = text && /\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''));
            const bytes = compressed ? gzipSync(text) : Buffer.from(text);
            const size = bytes.length + 2048;
            if (size > 16384) await session.extend({egressBytes:size-16384});
            session.take({egressBytes:size},false);
            if (compressed) response.setHeader('Content-Encoding','gzip');
            response.setHeader('Cache-Control','private, no-store');
            response.setHeader('Content-Length',bytes.length);
            response.writeHead(status).end(bytes);
          })(req,res);
        });
      } catch {
        if (!res.headersSent) {
          res.setHeader('Access-Control-Allow-Origin','https://bazaarsignal.web.app');
          res.setHeader('Content-Type','application/json');
          res.writeHead(503).end(JSON.stringify({error:'Price updates stopped for the monthly budget or a collection error.',usage:{mode:'paused',pollMs:0}}));
        }
      }
    },
  };
}
