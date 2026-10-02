import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CacheStore } from './cache-store';
import { MarketCollector } from './engine';
import { marketHandler, type MarketResponder } from './routes';
import { defaultPolicy } from './policy';
import { TrialSession, TrialStopped, invocationEnvelope, type Counters } from './trial';

export const LIVE_HOUR = 3_600_000;
export const livePolicy = { ...defaultPolicy, bazaarMs: LIVE_HOUR, auctionMinMs: LIVE_HOUR,
  electionMs: LIVE_HOUR };
export interface LiveAllowanceState {
  version: 1; id: string; startsAt: number; expiresAt: number;
  monthlyLimits: Counters; monthlyReserved: Counters;
  dailyLimits: Counters; dailyReserved: Counters; day: string;
  observed: Counters; lastCollectorHour?: number; stoppedAt?: number; reason?: string;
  evidence: string;
}
export const pacificDay = (now: number) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

// These are conservative APPLICATION budgets for this workload, not Google caps.
// The deployment supplies smaller limits after retaining baseline/rollout margin.
export const liveMaximums: Counters = {
  runRequests: 1_400_000, cpuSeconds: 110_000, memoryGiBSeconds: 250_000,
  egressBytes: 650 * 1024 ** 2, storageClassA: 3200, storageClassB: 32000,
  // Private bucket -> Run in the same region: internal gross transfer, not the Internet allowance.
  storageEgressBytes: 512 * 1024 ** 3, logBytes: 512 * 1024 ** 2,
  collectorInvocations: 744, browserRequests: 2000, snapshotUploads: 3000,
  storageListPages: 124, cleanupRuns: 31, hypixelRequests: 75_000, sellerRequests: 500,
};
export const liveDailyMaximums: Counters = { firestoreReads: 30_000, firestoreWrites: 12_000, firestoreDeletes: 0 };
const scopeKeys = new Set([...Object.keys(liveMaximums), ...Object.keys(liveDailyMaximums)]);
export function validateLive(s: LiveAllowanceState | null, now: number) {
  if (!s || s.version !== 1 || !/^free-[a-zA-Z0-9_-]+$/.test(s.id) || !s.evidence ||
      !Number.isFinite(s.startsAt + s.expiresAt) || s.startsAt > now || s.expiresAt <= now ||
      s.expiresAt - s.startsAt > 32 * 86_400_000 || s.stoppedAt !== undefined ||
      !s.monthlyReserved || !s.dailyReserved || !s.observed || !s.day)
    throw new TrialStopped(s?.reason ?? 'Live allowance report is missing, stopped or expired');
  for (const [limits, ceilings, used] of [[s.monthlyLimits, liveMaximums, s.monthlyReserved],
    [s.dailyLimits, liveDailyMaximums, s.dailyReserved]] as const)
    for (const [key, max] of Object.entries(ceilings))
      if (!limits || !Number.isFinite(limits[key]) || limits[key] < 0 || limits[key] > max ||
          !Number.isFinite(used[key] ?? 0) || (used[key] ?? 0) < 0 || (used[key] ?? 0) > limits[key])
        throw new TrialStopped(`Invalid live allowance: ${key}`);
}
function hold(s: LiveAllowanceState, costs: Counters, now: number) {
  validateLive(s, now);
  const day = pacificDay(now);
  if (day < s.day) throw new TrialStopped('Allowance clock moved backwards');
  if (day !== s.day) { s.day = day; s.dailyReserved = {}; }
  for (const [key, amount] of Object.entries(costs)) {
    if (!Number.isFinite(amount) || amount < 0) throw new TrialStopped('Invalid reservation');
    if (!scopeKeys.has(key)) continue; // Invocation-only byte/capacity bounds remain enforced by TrialSession.
    const daily = Object.hasOwn(liveDailyMaximums, key);
    const used = daily ? s.dailyReserved : s.monthlyReserved, limits = daily ? s.dailyLimits : s.monthlyLimits;
    if ((used[key] ?? 0) + amount > limits[key]) throw new TrialStopped(`Free-tier operating budget reached: ${key}`);
  }
  for (const [key, amount] of Object.entries(costs)) if (scopeKeys.has(key)) {
    const used = Object.hasOwn(liveDailyMaximums, key) ? s.dailyReserved : s.monthlyReserved;
    used[key] = (used[key] ?? 0) + amount;
  }
}
function pressure(s: LiveAllowanceState) {
  return Math.max(0,...Object.entries(s.monthlyLimits).filter(([,n])=>n>0).map(([k,n])=>(s.monthlyReserved[k]??0)/n),
    ...Object.entries(s.dailyLimits).filter(([,n])=>n>0).map(([k,n])=>(s.dailyReserved[k]??0)/n));
}
export class LiveLedger {
  constructor(private store: CacheStore, private clock = Date.now) {}
  private async change<T>(fn: (state: LiveAllowanceState, now: number) => T) {
    for (let i = 0; i < 8; i++) {
      const now = this.store.time ? await this.store.time() : this.clock();
      const raw = await this.store.read('live-allowance');
      const s = raw ? JSON.parse(raw) as LiveAllowanceState : null;
      validateLive(s, now);
      const value = fn(s!, now);
      if (JSON.stringify(s) === raw || await this.store.commit('live-allowance', raw, JSON.stringify(s))) return value;
    }
    throw new TrialStopped('Live allowance reservation contention');
  }
  async admit(kind: 'collector' | 'browser', id: string) {
    return this.change((s, now) => {
      const hour = Math.floor(now / LIVE_HOUR);
      if (kind === 'collector' && (s.lastCollectorHour ?? -1) >= hour) return null;
      if (kind === 'collector' && pressure(s)>=.65 && hour%2) return null;
      const costs: Counters = { ...invocationEnvelope(kind), cpuSeconds: kind === 'collector' ? 100 : 20,
        memoryGiBSeconds: kind === 'collector' ? 100 : 20,
        egressBytes: kind === 'collector' ? 64*1024 : 16*1024,
        firestoreReads: kind === 'collector' ? 600 : 64 };
      // Cover admission and finish RPCs even though they precede/follow the session.
      hold(s, { ...costs, firestoreReads: costs.firestoreReads + 100, firestoreWrites: costs.firestoreWrites + 40 }, now);
      if (kind === 'collector') s.lastCollectorHour = hour;
      const peak=pressure(s);
      return new LiveSession(this, s.id, id, s.expiresAt, costs, this.clock, now - this.clock(), peak>=.65?'slow':peak>=.5?'warning':'normal');
    });
  }
  async add(id: string, costs: Counters) {
    await this.change((s, now) => { if (s.id !== id) throw new TrialStopped('Live release changed'); hold(s, costs, now); });
  }
  async finish(id: string, _invocationId: string, observed: Counters) {
    await this.change(s => {
      if (s.id !== id) throw new TrialStopped('Live release changed');
      for (const [key, n] of Object.entries(observed)) {
        if (!Number.isFinite(n) || n < 0) throw new TrialStopped('Invalid live measurement');
        s.observed[key] = (s.observed[key] ?? 0) + n;
      }
    });
  }
  async stop(reason: string) {
    for (let i=0;i<8;i++) {
      const old = await this.store.read('live-allowance'); if (!old) return;
      const s = JSON.parse(old); s.stoppedAt ??= this.clock(); s.reason ??= reason;
      if (await this.store.commit('live-allowance',old,JSON.stringify(s))) return;
    }
    throw new TrialStopped('Could not persist live pause');
  }
}
class LiveSession extends TrialSession {
  override policy() { return { ...super.policy(), pollMs: this.mode==='slow'?2*LIVE_HOUR:LIVE_HOUR, reason: 'Hourly collection to conserve the free allowances' }; }
}
export interface LiveConfig {
  id: string; expiresAt: number;
  store: (session?: TrialSession) => CacheStore & { cleanup?: (interval: number) => Promise<boolean> };
  shutdown: () => Promise<void>; network?: typeof fetch; now?: () => number;
  report?: (measurement: Record<string, unknown>) => void;
}
export function createLiveRuntime(config: LiveConfig) {
  const now = config.now ?? Date.now;
  async function run(kind: 'collector' | 'browser', id: string,
    work: (session: LiveSession, collector: MarketCollector, store: ReturnType<LiveConfig['store']>) => Promise<void>) {
    const raw = config.store(), ledger = new LiveLedger(raw, now);
    let session: LiveSession | null = null;
    try {
      if (!/^free-[a-zA-Z0-9_-]+$/.test(config.id) || !Number.isFinite(config.expiresAt) || now() >= config.expiresAt)
        throw new TrialStopped('Live release expired or not configured');
      session = await ledger.admit(kind, id); if (!session) return;
      if (session.trialId !== config.id || session.expiresAt !== config.expiresAt)
        throw new TrialStopped('Live allowance report does not match this release');
      const store = config.store(session);
      const collector = new MarketCollector(store, livePolicy, session.network(config.network), now, Math.random,
        (name, amount) => session!.count(name, amount));
      await work(session, collector, store);
      await session.finish();
      config.report?.({event:'market_live',kind,at:now(),observed:session.observed});
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Live accounting failed';
      const results = await Promise.allSettled([ledger.stop(reason), config.shutdown()]);
      config.report?.({event:'market_live_paused',at:now(),reason,shutdownComplete:results.every(x=>x.status==='fulfilled')});
      throw error;
    }
  }
  const respond = (session: LiveSession): MarketResponder => async (req, res, status, body) => {
    const usage = session.policy(); delete (usage as any).serverNow;
    const text = body === undefined ? '' : JSON.stringify({...body as object,usage});
    if (Buffer.byteLength(text)>8*1024**2) throw new TrialStopped('Response size exceeds live bound');
    const etag = `"${createHash('sha256').update(text).digest('hex')}"`;
    const unchanged = status===200 && req.headers['if-none-match']===etag;
    const gzip = !unchanged && text && /\bgzip\b/.test(String(req.headers['accept-encoding']??''));
    const bytes = unchanged ? Buffer.alloc(0) : gzip ? gzipSync(text) : Buffer.from(text);
    if(bytes.length+2048>16384) await session.extend({egressBytes:bytes.length+2048-16384});
    session.take({egressBytes:bytes.length+2048},false);
    session.count('apiBodyBytes',bytes.length); session.count(`apiHttp${unchanged?304:status}`);
    if(status===200)res.setHeader('ETag',etag);
    if(gzip)res.setHeader('Content-Encoding','gzip');
    res.setHeader('Vary','Origin, Accept-Encoding');res.setHeader('Content-Length',bytes.length);
    res.writeHead(unchanged?304:status).end(bytes);
  };
  return {
    collect: (event: string) => run('collector',event,async(session,collector,store)=>{
      await collector.tick();
      if(store.cleanup) {
        const previous=await store.read('cleanup');
        if(!previous || JSON.parse(previous).nextAt<=now()) {
          await session.extend({cleanupRuns:1,storageClassA:4,storageListPages:4});
          session.take({cleanupRuns:1}); await store.cleanup(86_400_000);
        }
      }
    }),
    async handle(req: IncomingMessage,res: ServerResponse) {
      try { await run('browser',randomUUID(),async(session,collector)=>marketHandler(collector,respond(session))(req,res)); }
      catch {
        if(!res.headersSent) {
          res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
          const origin=req.headers.origin;
          if(origin==='https://bazaarsignal.web.app')res.setHeader('Access-Control-Allow-Origin',origin);
          res.writeHead(503).end(JSON.stringify({error:'Updates paused to protect the free allowance',usage:{mode:'paused',pollMs:0}}));
        }
      }
    },
  };
}
