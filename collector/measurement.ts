import { createHash } from 'node:crypto';
import type { CacheStore } from './cache-store';
import { MarketCollector } from './engine';
import { livePolicy, type LiveAllowanceState } from './allowance-live';
import { TrialSession, TrialStopped, type Counters } from './trial';
import { measurementCapacity, measurementControl, measurementWork, measurementEvidenceExpiry, publicMeasurementEndpoints, type MeasurementPlan } from './measurement-capacity';

export interface MeasurementRun {
  plan: MeasurementPlan; status: 'armed' | 'claimed' | 'complete' | 'failed' | 'expired';
  reserved: Counters; armedAt: number; claimedAt?: number; finishedAt?: number;
  priorStop: { stoppedAt: number; reason: string }; observed?: Counters; errors?: string[];
}
export type MeasurementState = LiveAllowanceState & { measurementRuns?: Record<string, MeasurementRun> };
export const ledgerHash = (state: LiveAllowanceState) => createHash('sha256').update(JSON.stringify(state)).digest('hex');
// Public endpoints expose no numerical anonymous entitlement. One documented
// retrieval per endpoint is an availability attempt, not a quota assertion.
// An error consumes this attempt and prevents every subsequent network attempt.
export function oneShotPublicNetwork(network:typeof fetch):typeof fetch {
  const attempted=new Set<string>();let failed=false;
  return async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    const headers=new Headers(init?.headers);
    if(failed||!publicMeasurementEndpoints.includes(url)||attempted.has(url)||attempted.size>=3||
      (init?.method??'GET')!=='GET'||headers.has('API-Key')||headers.has('Authorization'))throw new TrialStopped('Public measurement attempt exhausted');
    attempted.add(url);
    try {const r=await network(input,{...init,redirect:'error'});if(!r.ok)failed=true;return r;}
    catch(e){failed=true;throw e;}
  };
}
const stopUnchanged = (state: MeasurementState, run: MeasurementRun) =>
  state.stoppedAt === run.priorStop.stoppedAt && state.reason === run.priorStop.reason && state.id === run.plan.allowanceId;

/** The ordinary owner stop is NEVER cleared. A separate single-use grant is
 * atomically attached with every new hold, preserving all prior ledger fields.
 * Unknown commits are not retried by the installer. */
export async function armMeasurement(store: CacheStore, plan: MeasurementPlan, clock = Date.now) {
  const raw = await store.read('live-allowance');
  if (!raw) throw new TrialStopped('Missing existing allowance');
  const state: MeasurementState = JSON.parse(raw), now = store.time ? await store.time() : clock();
  if (ledgerHash(state) !== plan.ledgerSha256) throw new TrialStopped('Ledger changed; rebuild the measurement plan');
  const decision = measurementCapacity(plan, state, now);
  if (!decision.ready) throw new TrialStopped(decision.problems.join('; '));
  const runs = state.measurementRuns ?? {};
  if (Object.hasOwn(runs, plan.id) || Object.keys(runs).length >= 8 ||
      Object.values(runs).some(r => ['armed','claimed'].includes(r.status) && r.plan.deadline > now))
    throw new TrialStopped('Measurement exists, is ambiguous or history is full');
  for (const [key, amount] of Object.entries(decision.work)) {
    const bucket = Object.hasOwn(state.dailyLimits,key) ? state.dailyReserved :
      Object.hasOwn(state.monthlyLimits,key) ? state.monthlyReserved : undefined;
    if (bucket) bucket[key] = (bucket[key] ?? 0) + amount;
  }
  // Preserve an old daily bucket instead of silently resetting its counters/day.
  state.measurementRuns = { ...runs, [plan.id]: { plan, status:'armed', reserved:decision.work, armedAt:now,
    priorStop:{stoppedAt:state.stoppedAt!,reason:state.reason!} } };
  if (Buffer.byteLength(JSON.stringify(state)) > 120 * 1024) throw new TrialStopped('Measurement history exceeds durable bound');
  if (!await store.commit('live-allowance',raw,JSON.stringify(state))) throw new TrialStopped('Measurement installation conflict; no retry');
  return state;
}

export class MeasurementLedger {
  constructor(private store: CacheStore, private clock = Date.now) {}
  async claim(id: string) {
    for (let attempt=0; attempt<4; attempt++) {
      const raw=await this.store.read('live-allowance'); if(!raw)return null;
      const s:MeasurementState=JSON.parse(raw), run=s.measurementRuns?.[id];
      const now=this.store.time?await this.store.time():this.clock();
      if (!run || run.status!=='armed') return null;
      if (!stopUnchanged(s,run)) throw new TrialStopped('Owner stop or allowance identity changed');
      if (now < run.plan.startsAt || now+90000 >= Math.min(run.plan.deadline,s.expiresAt)) return null;
      // Revalidate evidence without charging a second time. Reconstruct the
      // pre-arm counters in memory only; never persist a decrement or refund.
      const prior=structuredClone(s);
      delete prior.measurementRuns![id];
      for (const [k,n] of Object.entries(run.reserved)) {
        const bucket=Object.hasOwn(prior.dailyLimits,k)?prior.dailyReserved:Object.hasOwn(prior.monthlyLimits,k)?prior.monthlyReserved:undefined;
        if (bucket) bucket[k]-=n;
      }
      const decision=measurementCapacity(run.plan,prior,now);
      if(!decision.ready)throw new TrialStopped(decision.problems.join('; '));
      run.status='claimed';run.claimedAt=now;
      if(await this.store.commit('live-allowance',raw,JSON.stringify(s)))return run;
    }
    throw new TrialStopped('Measurement admission contention');
  }
  async finish(id:string, observed:Counters, errors:string[], expired=false) {
    for(let attempt=0;attempt<4;attempt++) {
      const raw=await this.store.read('live-allowance');if(!raw)throw new TrialStopped('Measurement ledger disappeared');
      const s:MeasurementState=JSON.parse(raw),run=s.measurementRuns?.[id];
      if(!run)throw new TrialStopped('Measurement disappeared');
      if(['complete','failed','expired'].includes(run.status))return;
      if(!stopUnchanged(s,run))throw new TrialStopped('Stop history changed; retain ambiguous measurement');
      for(const [k,n]of Object.entries(observed)) {
        if(!Number.isFinite(n)||n<0)throw new TrialStopped('Invalid measurement');
        s.observed[k]=(s.observed[k]??0)+n;
      }
      run.status=expired?'expired':errors.length?'failed':'complete';run.finishedAt=this.clock();
      run.observed={...observed};run.errors=[...errors];
      if(await this.store.commit('live-allowance',raw,JSON.stringify(s)))return;
    }
    throw new TrialStopped('Measurement completion contention; all reservations retained');
  }
}

export interface MeasurementConfig {
  id?:string; store:(session?:TrialSession,onAttempt?:(c:Counters)=>void)=>CacheStore;
  verifyContained:()=>Promise<void>; network?:typeof fetch; now?:()=>number;
  report?:(receipt:Record<string,unknown>)=>void;
}
/** No timer, presence, cleanup, private holding reads, recurring schedule or
 * envelope extensions. A crashed invocation remains claimed and cannot replay.
 * Session deadlines/cancellation bound collection I/O. Cloud Run's 90-second
 * request timeout is NOT a process kill. Accounting has separate bounded calls;
 * completion failure keeps the grant consumed. */
export function createMeasurementRuntime(config:MeasurementConfig) {
  const now=config.now??Date.now;
  return { async collect(eventId:string) {
    const id=config.id??eventId.replace(/^measurement:/,'');
    if(!/^measure-[a-zA-Z0-9_-]{1,80}$/.test(id) || eventId!==`measurement:${id}`)return;
    const accounting:Counters={},errors:string[]=[],cpuStart=process.cpuUsage();
    const raw=config.store(undefined,c=>{for(const[k,n]of Object.entries(c)) {
      accounting[k]=(accounting[k]??0)+n;
      if(accounting[k]>(measurementControl[k]??0))throw new TrialStopped(`Measurement accounting bound: ${k}`);
    }});
    const ledger=new MeasurementLedger(raw,now);
    let session:TrialSession|undefined,run:MeasurementRun|null=null;
    try {
      await config.verifyContained();
      run=await ledger.claim(id);if(!run)return;
      const deadline=Math.min(run.plan.deadline-30000,run.claimedAt!+60000,run.plan.verifiedAt+900000,
        run.plan.isolation.verifiedAt+900000,run.plan.upstream.verifiedAt+900000,
        ...Object.values(run.plan.meters).map(m=>measurementEvidenceExpiry(m!)));
      session=new TrialSession({add:async()=>{throw new TrialStopped('Measurement extensions are disabled');},finish:async()=>{}},
        run.plan.allowanceId,id,deadline,measurementWork(),now,run.claimedAt!-now(),'normal');
      session.count('collectorInvocations');
      const network=run.plan.upstream.publicOneShot?oneShotPublicNetwork(config.network??fetch):config.network;
      const policy=run.plan.upstream.publicOneShot?{...livePolicy,maxRetries:0}:livePolicy;
      const collector=new MarketCollector(config.store(session),policy,session.network(network),now,Math.random,
        (key,n)=>session!.count(key,n));
      await collector.tick(['catalog','election','bazaar']);
      if(session.observed.bazaarRefreshesCompleted!==1)throw new TrialStopped('Initial Bazaar collection did not complete; no forced due-time or retry');
    } catch(error) { errors.push(error instanceof Error?error.message:'Measurement failed'); }
    finally {
      if(run) {
        if(session) {
          const cpu=process.cpuUsage(cpuStart);
          session.count('processCpuUserMicros',cpu.user);session.count('processCpuSystemMicros',cpu.system);
          session.count('processPeakRssBytes',process.resourceUsage().maxRSS*1024);
        }
        try {await session?.finish();}catch(e){errors.push((e as Error).message);}
        try {await config.verifyContained();}catch(e){errors.push(`Containment: ${(e as Error).message}`);}
        try {await ledger.finish(id,session?.observed??{},errors,now()>=run.plan.deadline);}
        catch(e){errors.push(`Accounting: ${(e as Error).message}`);}
        config.report?.({event:'market_measurement',id,at:now(),observed:session?.observed??{},ledgerAttempts:accounting,
          errors,reserved:run.reserved,providerCompute:'unreported; handler duration is not billed CPU',automaticStop:true});
      }
    }
    if(errors.length)throw new TrialStopped(errors.join('; '));
  } };
}

export async function verifyMeasurementContainment(project:string, token:()=>Promise<string>, network:typeof fetch=fetch) {
  const root=`projects/${project}/locations/us-central1`;
  for(const [name,url]of [
    ['scheduler',`https://cloudscheduler.googleapis.com/v1/${root}/jobs/firebase-schedule-refreshMarket-us-central1`],
    ['api',`https://run.googleapis.com/v1/${root}/services/marketapi:getIamPolicy?options.requestedPolicyVersion=3`],
  ]) {
    const response=await network(url,{redirect:'error',headers:{Authorization:`Bearer ${await token()}`},signal:AbortSignal.timeout(3000)});
    if(!response.ok)throw new TrialStopped(`Containment unavailable: ${name} HTTP ${response.status}`);
    const data=await response.json();
    if(name==='scheduler'?data.state!=='PAUSED':data.bindings?.some((b:any)=>b.members?.some((m:string)=>['allUsers','allAuthenticatedUsers'].includes(m))))
      throw new TrialStopped(`Measurement containment changed: ${name}`);
  }
}
