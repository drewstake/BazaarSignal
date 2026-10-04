import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CacheStore } from './cache-store';
import { MarketCollector } from './engine';
import { marketHandler, type MarketResponder } from './routes';
import { defaultPolicy } from './policy';
import { TrialSession, TrialStopped, invocationEnvelope, type Counters } from './trial';
import { hourlyTrialActive, HOURLY_TRIAL_END } from '../shared/hourly-trial';
import { SnapshotReadCache } from './snapshot-read-cache';
import { MARKET_HOUR, MARKET_REFRESH_MS } from '../shared/market-schedule';
import { chooseCadence, reserveCapacity, type CapacityPlan, type CadenceDecision } from './capacity-plan';
import { changeVisibleDemand, visibleDemand, type VisibleDemand } from './visible-demand';
import { APP_BUDGET_PAUSE_FRACTION, APP_BUDGET_PAUSE_PERCENT, APP_BUDGET_PAUSE_DESCRIPTION } from '../shared/app-budget-policy';
import { INLINE_STORAGE_RESERVATION } from './inline-snapshot';

export type CollectionProfile = 'legacy' | 'bazaar-inline';
/** Three single-page jobs, each with at most three physical attempts. Auction
 * scans cannot use this envelope. CPU, CAS, daily limits and margins stay intact. */
export function collectionEnvelope(profile: CollectionProfile): Counters {
  return profile === 'bazaar-inline' ? { ...invocationEnvelope('collector'),
    storageClassA: 0, snapshotUploads: 0, storageByteMonths: 0,
    storageClassB: 3, storageEgressBytes: 24 * 1024 ** 2,
    hypixelRequests: 9,
    firestoreStorageBytes: INLINE_STORAGE_RESERVATION,
  } : invocationEnvelope('collector');
}

export const LIVE_HOUR = MARKET_HOUR;
const collectionInterval = (now: number) => hourlyTrialActive(now) ? LIVE_HOUR : MARKET_REFRESH_MS;
export const livePolicy = { ...defaultPolicy, bazaarMs: MARKET_REFRESH_MS,
  electionMs: LIVE_HOUR };
export interface LiveAllowanceState {
  version: 1; id: string; startsAt: number; expiresAt: number;
  monthlyLimits: Counters; monthlyReserved: Counters;
  dailyLimits: Counters; dailyReserved: Counters; day: string;
  observed: Counters; lastCollectorHour?: number; lastCollectorAt?: number; stoppedAt?: number; reason?: string;
  evidence: string;
  capacity?: CapacityPlan;
  visible?: VisibleDemand;
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
export function nextPacificReset(now:number) {
  const day=pacificDay(now);let low=now,high=now+27*LIVE_HOUR;
  while(high-low>1){const middle=Math.floor((low+high)/2);if(pacificDay(middle)===day)low=middle;else high=middle;}
  return high;
}
export class LiveBudgetDeferred extends TrialStopped {
  constructor(readonly key:string,readonly retryAt:number,readonly expiresAt:number,readonly trialId:string,readonly reservationPause=false) {
    super(reservationPause?`${APP_BUDGET_PAUSE_PERCENT}% app reservation pause: ${key}`:`Free-tier operating budget reached: ${key}`);
  }
}
const deferredBudget=(s:LiveAllowanceState,key:string,now:number,reservationPause=false)=>new LiveBudgetDeferred(key,
  Object.hasOwn(liveDailyMaximums,key)?Math.min(nextPacificReset(now),s.expiresAt):s.expiresAt,s.expiresAt,s.id,reservationPause);
const scopeKeys = new Set([...Object.keys(liveMaximums), ...Object.keys(liveDailyMaximums)]);
export function validateLive(s: LiveAllowanceState | null, now: number) {
  if (!s || s.version !== 1 || !/^free-[a-zA-Z0-9_-]+$/.test(s.id) || !s.evidence ||
      !Number.isFinite(s.startsAt + s.expiresAt) || s.startsAt > now || s.expiresAt <= now ||
      s.expiresAt - s.startsAt > 32 * 86_400_000 || s.stoppedAt !== undefined ||
      !s.monthlyReserved || !s.dailyReserved || !s.observed || !s.day ||
      (s.lastCollectorAt !== undefined && (!Number.isSafeInteger(s.lastCollectorAt) || s.lastCollectorAt < 0)))
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
    if ((used[key] ?? 0) + amount > limits[key]) throw deferredBudget(s,key,now,true);
  }
  const pause=reservationBudgetDeferral(s,costs,now);
  if(pause)throw pause;
  for (const [key, amount] of Object.entries(costs)) if (scopeKeys.has(key)) {
    const used = Object.hasOwn(liveDailyMaximums, key) ? s.dailyReserved : s.monthlyReserved;
    used[key] = (used[key] ?? 0) + amount;
  }
}
export function livePressure(s: LiveAllowanceState, now:number) {
  return Math.max(0,...Object.entries(s.monthlyLimits).filter(([,n])=>n>0).map(([k,n])=>(s.monthlyReserved[k]??0)/n),
    ...Object.entries(s.dailyLimits).filter(([,n])=>n>0).map(([k,n])=>s.day===pacificDay(now)?(s.dailyReserved[k]??0)/n:0));
}
export function collectorBudgetDeferral(s:LiveAllowanceState,now:number) {
  return reservationBudgetDeferral(s,liveInvocationCharge('collector'),now);
}
function reservationBudgetDeferral(s:LiveAllowanceState,costs:Counters,now:number) {
  for(const [daily,limits,reserved] of [[false,s.monthlyLimits,s.monthlyReserved],[true,s.dailyLimits,s.dailyReserved]] as const) {
    for(const [key,limit] of Object.entries(limits)) {
      const used=daily&&s.day!==pacificDay(now)?0:reserved[key]??0;
      const amount=costs[key]??0;
      if(limit===0?used+amount>0:used+amount>=limit*APP_BUDGET_PAUSE_FRACTION)
        return deferredBudget(s,key,now,true);
    }
  }
  return null;
}
export class LiveLedger {
  constructor(private store: CacheStore, private clock = Date.now, private requireCapacity = true,
    private profile: CollectionProfile = 'legacy') {}
  private async change<T>(fn: (state: LiveAllowanceState, now: number) => T) {
    for (let i = 0; i < 8; i++) {
      const raw = await this.store.read('live-allowance');
      const now = this.store.time ? await this.store.time() : this.clock();
      const s = raw ? JSON.parse(raw) as LiveAllowanceState : null;
      validateLive(s, now);
      const value = fn(s!, now);
      if (JSON.stringify(s) === raw || await this.store.commit('live-allowance', raw, JSON.stringify(s))) return value;
    }
    throw new TrialStopped('Live allowance reservation contention');
  }
  async admit(kind: 'collector' | 'browser', id: string, sellerLookup=true) {
    return this.change((s, now) => {
      const hour = Math.floor(now / LIVE_HOUR);
      // Apply the same per-resource cutoff before planning, in this CAS. This
      // refuses even zero-cost work once another app budget is already at 90%.
      const budgetPause=reservationBudgetDeferral(s,{},now);
      if(budgetPause)throw budgetPause;
      let decision: CadenceDecision | undefined;
      if(this.requireCapacity) {
        decision=chooseCadence(s.capacity,{...s,dailyEnd:nextPacificReset(now)},liveInvocationCharge('collector',this.profile),liveInvocationCharge('browser'),now);
        if(decision.mode==='paused')throw new TrialStopped(decision.reasons.join('; '));
        // No full private-account scan or upstream work for idle portfolios.
        if(kind==='collector'&&!demandJobs(visibleDemand(s.visible,now),now).length)return null;
      }
      const interval=decision?.bazaarMs??collectionInterval(now),slot=Math.floor(now/interval);
      if(kind==='collector'&&this.requireCapacity&&s.lastCollectorAt!==undefined&&now-s.lastCollectorAt<interval)return null;
      // Preserve legacy admission for its entire hour when no precise marker exists.
      // Upgrades retain every reservation and cannot replay an ambiguous old run.
      if (kind === 'collector' && (s.lastCollectorAt === undefined
        ? (s.lastCollectorHour ?? -1) >= hour : s.lastCollectorAt >= slot*interval)) return null;
      const costs: Counters = { ...(kind==='collector'?collectionEnvelope(this.profile):invocationEnvelope(kind)), cpuSeconds: kind === 'collector' ? 100 : 20,
        memoryGiBSeconds: kind === 'collector' ? 100 : 20,
        egressBytes: kind === 'collector' ? 64*1024 : 16*1024,
        firestoreReads: kind === 'collector' ? 600 : 64 };
      // Cache reads and CORS preflights cannot look up sellers. Do not reserve
      // unrelated external calls for them; lookup routes retain their envelope.
      if(kind==='browser'&&!sellerLookup) {
        // Ordinary routes read at most one snapshot and three control/pointer
        // documents, with no shared writes. Eight reads cover clock refreshes;
        // admission/finish retain their separate margin. A miss downloads at
        // most one bounded 8 MiB compressed object. Seller routes keep all holds.
        Object.assign(costs, { sellerRequests: 0, firestoreReads: 8, firestoreWrites: 0,
          storageClassB: 1, storageEgressBytes: 8 * 1024 ** 2 });
      }
      if(kind==='browser'&&this.requireCapacity)costs.egressBytes=Math.max(costs.egressBytes,s.capacity!.browserResponseBytes);
      // Cover admission and finish RPCs even though they precede/follow the session.
      const charge:Counters={ ...costs, firestoreReads: costs.firestoreReads + 100, firestoreWrites: costs.firestoreWrites + 40 };
      if(kind==='browser') {
        // Protect the full existing collector charge for every remaining UTC
        // hour before Pacific midnight, retaining the existing baseline reserve.
        // Additional five-minute opportunities must fit the same hard caps.
        // These are admission headroom checks,
        // not extra charges, refunds or a change to the daily hard limits.
        const slots=Math.max(0,Math.ceil((nextPacificReset(now)-Math.floor(now/LIVE_HOUR)*LIVE_HOUR)/LIVE_HOUR)
          - ((s.lastCollectorHour??-1)>=hour?1:0));
        for(const [key,perRun]of Object.entries({firestoreReads:700,firestoreWrites:296})) {
          const used=s.day===pacificDay(now)?s.dailyReserved[key]??0:0;
          if(used+(charge[key]??0)+slots*perRun>s.dailyLimits[key])throw deferredBudget(s,key,now);
        }
      }
      hold(s, charge, now);
      if(this.requireCapacity) {
        try { reserveCapacity(s.capacity,charge,now); } catch(error) { throw new TrialStopped((error as Error).message); }
      }
      if (kind === 'collector') { s.lastCollectorHour = hour; s.lastCollectorAt = this.requireCapacity?now:slot*interval; }
      const peak=livePressure(s,now);
      const session=new LiveSession(this, s.id, id, s.expiresAt, costs, this.clock, now - this.clock(), decision?.mode??(peak>=.5?'warning':'normal'));
      session.cadence=decision; session.demand=this.requireCapacity?visibleDemand(s.visible,now):undefined;
      session.responseBytes=this.requireCapacity?s.capacity!.browserResponseBytes:undefined;
      if(this.requireCapacity) {
        session.capacityDeadline=Math.min(s.capacity!.validUntil,...Object.values(s.capacity!.meters).map(m=>m.periodEnd));
        const offset=now-this.clock();session.capacityClock=()=>this.clock()+offset;
      }
      return session;
    });
  }
  async add(id: string, costs: Counters) {
    await this.change((s, now) => {
      if (s.id !== id) throw new TrialStopped('Live release changed'); hold(s, costs, now);
      if(this.requireCapacity)try { reserveCapacity(s.capacity,costs,now); } catch(error) { throw new TrialStopped((error as Error).message); }
    });
  }
  async presence(uid:string,tab:string,assets:string[],active:boolean,interval:number) {
    await this.change((s,now)=>{
      if(!this.requireCapacity||!s.capacity)throw new TrialStopped('Visible demand requires verified capacity');
      s.visible=changeVisibleDemand(s.visible,uid,tab,assets,active,now,interval,s.capacity.readerGroups);
    });
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
  cadence?: CadenceDecision;
  demand?: Demand;
  responseBytes?: number;
  capacityDeadline?: number;
  capacityClock?: ()=>number;
  override assertOpen() {
    super.assertOpen();
    if(this.capacityDeadline!==undefined&&this.capacityClock!()>=this.capacityDeadline)
      throw new TrialStopped('Capacity evidence or allowance period expired');
  }
  override signal(timeoutMs=20_000,parent?:AbortSignal|null) {
    return super.signal(Math.min(timeoutMs,this.capacityDeadline===undefined?Infinity:Math.max(1,this.capacityDeadline-this.capacityClock!())),parent);
  }
  override policy() {
    const base=super.policy(), trial=hourlyTrialActive(base.serverNow);
    if(this.cadence)return {...base,pollMs:this.cadence.pollMs,bazaarMs:this.cadence.bazaarMs,auctionMs:this.cadence.auctionMs,
      reason:this.cadence.reasons.join('; ')||'Collection follows verified free-tier capacity'};
    return { ...base, pollMs: collectionInterval(base.serverNow),
      reason: (trial?`Hourly test until ${new Date(HOURLY_TRIAL_END).toISOString()}. `:'Five-minute Bazaar collection; only Bazaar collection is supported. ')+APP_BUDGET_PAUSE_DESCRIPTION };
  }
}
// Only an admitted, fully accounted invocation may recover from a transport
// timeout. Reservation, completion, deadline and unknown failures stay fatal.
class LiveRequestTimeout extends Error {}
import { demandJobs, type Demand } from './portfolio-demand';
export interface LiveConfig {
  id: string; expiresAt: number;
  store: (session?: TrialSession) => CacheStore & { cleanup?: (interval: number) => Promise<boolean> };
  shutdown: () => Promise<void>; network?: typeof fetch; now?: () => number;
  report?: (measurement: Record<string, unknown>) => void;
  portfolioDemand?: (session: TrialSession) => Promise<Demand>;
  /** Only historical offline regression fixtures may select the old profile. */
  requireCapacity?: boolean;
  verifyPresence?: (idToken: string) => Promise<{uid:string}>;
  collectionProfile?: CollectionProfile;
}
/** The planner uses the SAME conservative bounds as admission, never averages. */
export function liveInvocationCharge(kind:'collector'|'browser',profile:CollectionProfile='legacy'): Counters {
  return kind==='collector'?{...collectionEnvelope(profile),cpuSeconds:100,memoryGiBSeconds:100,egressBytes:64*1024,firestoreReads:700,firestoreWrites:296}:
    {...invocationEnvelope(kind),cpuSeconds:20,memoryGiBSeconds:20,egressBytes:16*1024,firestoreReads:108,firestoreWrites:40,
      sellerRequests:0,storageClassB:1,storageEgressBytes:8*1024**2};
}
export function createLiveRuntime(config: LiveConfig) {
  const now = config.now ?? Date.now;
  // Scoped to this runtime/release and private store factory. No sessions,
  // coordination, owner usage data or authorization decisions are shared.
  const snapshots = new SnapshotReadCache();
  const deferred=new Map<'collector'|'browser',LiveBudgetDeferred>();
  async function run(kind: 'collector' | 'browser', id: string,
    work: (session: LiveSession, collector: MarketCollector, store: ReturnType<LiveConfig['store']>) => Promise<void>,sellerLookup=true) {
    const raw = config.store(), ledger = new LiveLedger(raw, now, config.requireCapacity??true,config.collectionProfile);
    let session: LiveSession | null = null;
    let phase: 'admission' | 'work' | 'accounting' = 'admission';
    try {
      if (!/^free-[a-zA-Z0-9_-]+$/.test(config.id) || !Number.isFinite(config.expiresAt) || now() >= config.expiresAt)
        throw new TrialStopped('Live release expired or not configured');
      const waiting=deferred.get(kind);if(waiting&&now()<waiting.retryAt)throw waiting;
      deferred.delete(kind);
      session = await ledger.admit(kind, id,sellerLookup); if (!session) return;
      if (session.trialId !== config.id || session.expiresAt !== config.expiresAt)
        throw new TrialStopped('Live allowance report does not match this release');
      const store = config.store(session);
      // Keep the coordinator's immutable policy intact across restarts. Adaptive
      // admission only slows it; changing policy requires the existing review.
      const collector = new MarketCollector(store, livePolicy, session.network(config.network), now, Math.random,
        (name, amount) => session!.count(name, amount), session.cadence?.bazaarMs??collectionInterval(now()), snapshots);
      phase = 'work';
      await work(session, collector, store);
      phase = 'accounting';
      await session.finish();
      config.report?.({event:'market_live',kind,at:now(),observed:session.observed});
    } catch (error) {
      // Known allowance refusals defer only this work. They must never revoke
      // API access or pause Scheduler. An admitted request still finalizes its
      // accounting; failure to finalize remains fatal and retains reservations.
      if(error instanceof LiveBudgetDeferred && phase!=='accounting') {
        const refusal=error;
        try {
          if(session)await session.finish();
          deferred.set(kind,refusal);
          config.report?.({event:'market_live_deferred',kind,phase,at:now(),key:refusal.key,retryAt:refusal.retryAt});
        } catch(accountingError) { error=accountingError;phase='accounting'; }
        if(phase!=='accounting')throw refusal;
      }
      if (phase === 'work' && session && error instanceof Error && error.name === 'TimeoutError') {
        try {
          session.assertOpen();
          session.count('transientTimeouts');
          await session.finish();
          config.report?.({event:'market_live_timeout',kind,phase,at:now(),observed:session.observed});
        } catch (accountingError) {
          error = accountingError;
          phase = 'accounting';
        }
        if (phase === 'work') throw new LiveRequestTimeout('Market request timed out; reserved usage retained until the next scheduled attempt');
      }
      const reason = error instanceof Error ? error.message : 'Live accounting failed';
      const results = await Promise.allSettled([ledger.stop(reason), config.shutdown()]);
      config.report?.({event:'market_live_paused',kind,phase,at:now(),reason,shutdownComplete:results.every(x=>x.status==='fulfilled')});
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
    if(session.responseBytes!==undefined&&bytes.length+2048>session.responseBytes)throw new TrialStopped('Response exceeds the reviewed per-read bound');
    if(bytes.length+2048>16384&&session.responseBytes===undefined) await session.extend({egressBytes:bytes.length+2048-16384});
    session.take({egressBytes:bytes.length+2048},false);
    session.count('apiBodyBytes',bytes.length); session.count(`apiHttp${unchanged?304:status}`);
    if(status===200)res.setHeader('ETag',etag);
    if(gzip)res.setHeader('Content-Encoding','gzip');
    res.setHeader('Vary','Origin, Accept-Encoding');res.setHeader('Content-Length',bytes.length);
    res.writeHead(unchanged?304:status).end(bytes);
  };
  return {
    collect: async (event: string) => { try { await run('collector',event,async(session,collector,store)=>{
      const jobs=session.demand?demandJobs(session.demand,now()):config.portfolioDemand?demandJobs(await config.portfolioDemand(session),now()):undefined;
      if(config.collectionProfile==='bazaar-inline' && (!jobs || jobs.some(job=>!['catalog','election','bazaar'].includes(job))))
        throw new TrialStopped('Bazaar inline reservation cannot admit an auction scan or unbounded job set');
      if(!jobs||jobs.length)await collector.tick(jobs);
      if(store.cleanup) {
        const previous=await store.read('cleanup');
        if(!previous || JSON.parse(previous).nextAt<=now()) {
          await session.extend({cleanupRuns:1,storageClassA:4,storageListPages:4});
          session.take({cleanupRuns:1}); await store.cleanup(86_400_000);
        }
      }
    }); } catch(error) { if(!(error instanceof LiveBudgetDeferred))throw error; } },
    async handle(req: IncomingMessage,res: ServerResponse) {
      const path=new URL(req.url??'/', 'http://localhost').pathname;
      if(path==='/api/companion/presence') {
        res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
        if(req.headers.origin==='https://bazaarsignal.web.app') {
          res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
          res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
          res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
          res.setHeader('Access-Control-Max-Age','86400');
        }
        try {
          if(req.method==='OPTIONS') {
            await run('browser',randomUUID(),async session=>respond(session)(req,res,204),false);return;
          }
          if(req.method!=='POST'){res.writeHead(405).end();return;}
          const token=/^Bearer (.+)$/.exec(String(req.headers.authorization??''))?.[1];
          if(!token||!config.verifyPresence){res.writeHead(401).end();return;}
          let principal:{uid:string};
          try {principal=await config.verifyPresence(token);} catch {res.writeHead(401).end();return;}
          await run('browser',randomUUID(),async session=>{
            try {
              const chunks:Buffer[]=[];let size=0;
              for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>16384)throw new Error('Presence too large');chunks.push(Buffer.from(chunk));}
              const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
              if(typeof body.active!=='boolean')throw new Error('Invalid presence');
              await new LiveLedger(config.store(),now,true).presence(principal.uid,body.tab,body.assets,body.active,session.policy().pollMs);
              await respond(session)(req,res,200,{accepted:true});
            } catch(error) {
              if(error instanceof TrialStopped)throw error;
              await respond(session)(req,res,400,{error:'Invalid or over-capacity presence'});
            }
          },false);
        } catch {if(!res.headersSent)res.writeHead(503).end(JSON.stringify({error:'Visible monitoring remains paused',usage:{mode:'paused',pollMs:0}}));}
        return;
      }
      const sellerLookup=req.method==='GET'&&(path==='/api/companion/player-names'||/^\/api\/companion\/auctions\/[a-f0-9]{32}\/command$/i.test(path));
      try { await run('browser',randomUUID(),async(session,collector)=>marketHandler(collector,respond(session))(req,res),sellerLookup); }
      catch (error) {
        if(!res.headersSent) {
          res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
          const origin=req.headers.origin;
          if(origin==='https://bazaarsignal.web.app')res.setHeader('Access-Control-Allow-Origin',origin);
          if(error instanceof LiveBudgetDeferred) {
            res.setHeader('Retry-After',Math.max(1,Math.ceil((error.retryAt-now())/1000)));
            res.setHeader('Access-Control-Allow-Headers','If-None-Match');
            res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
            res.setHeader('Access-Control-Max-Age','86400');
            // Successful preflight lets the GET receive the bounded deferral.
            if(req.method==='OPTIONS'&&origin==='https://bazaarsignal.web.app'){res.writeHead(204).end();return;}
            res.writeHead(429).end(JSON.stringify({error:'Market updates are paused for the app budget. Saved prices remain available.',
              usage:{mode:error.reservationPause?'paused':'slow',pollMs:error.reservationPause?0:LIVE_HOUR,retryAt:error.retryAt,expiresAt:error.expiresAt,trialId:error.trialId,
                reason:error.reservationPause?APP_BUDGET_PAUSE_DESCRIPTION:'Waiting for the app budget reset; scheduled collection remains enabled.'}}));
            return;
          }
          const transient = error instanceof LiveRequestTimeout;
          res.writeHead(503).end(JSON.stringify(transient
            ? {error:'Cached market request timed out. Try again later.',usage:{mode:'slow',pollMs:LIVE_HOUR}}
            : {error:'Updates paused to protect the free allowance',usage:{mode:'paused',pollMs:0}}));
        }
      }
    },
  };
}
