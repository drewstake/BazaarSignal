import { afterEach, expect, it, vi } from 'vitest';
import { SqliteCache } from '../collector/cache-store';
import { LiveLedger as CurrentLiveLedger, liveMaximums, liveDailyMaximums, pacificDay, nextPacificReset, createLiveRuntime as currentLiveRuntime, type LiveAllowanceState } from '../collector/allowance-live';
import { MarketCollector } from '../collector/engine';
import { HOURLY_TRIAL_START, HOURLY_TRIAL_END } from '../shared/hourly-trial';
// Preserve regression coverage of the historical profile. Production uses the
// strict default; capacity-plan.test.ts exercises the new admission boundary.
class LiveLedger extends CurrentLiveLedger {
  constructor(store:SqliteCache,clock=Date.now){super(store,clock,false);}
}
const createLiveRuntime=(config:Parameters<typeof currentLiveRuntime>[0])=>currentLiveRuntime({...config,requireCapacity:false});
const stores: SqliteCache[]=[];
async function request(runtime:ReturnType<typeof createLiveRuntime>,method='GET',url='/api/companion/status') {
  const response:any={headers:{},status:0,body:'',setHeader(k:string,v:unknown){this.headers[k]=v;},writeHead(n:number){this.status=n;return this;},end(body=''){this.body=body;this.headersSent=true;}};
  await runtime.handle({method,url,headers:{origin:'https://bazaarsignal.web.app'}} as any,response);return response;
}
afterEach(async()=>{vi.restoreAllMocks();for(const s of stores.splice(0))await s.close();});
async function setup(start=Date.parse('2026-10-02T03:00:00Z')) {
  const store=new SqliteCache(':memory:');stores.push(store);
  const state:LiveAllowanceState={version:1,id:'free-test',startsAt:start-1,expiresAt:start+86_400_000,
    monthlyLimits:{...liveMaximums},monthlyReserved:{},dailyLimits:{...liveDailyMaximums},dailyReserved:{},
    day:pacificDay(start),observed:{},evidence:'offline fixture; no cloud calls'};
  await store.commit('live-allowance',null,JSON.stringify(state));return {store,state,start};
}
it('reserves only one five-minute collection across concurrent workers and process-style restarts',async()=>{
  const {store,start}=await setup();
  const runs=await Promise.all(Array.from({length:50},(_,i)=>new LiveLedger(store,()=>start).admit('collector',String(i))));
  expect(runs.filter(Boolean)).toHaveLength(1);
  expect(await new LiveLedger(store,()=>start+60_000).admit('collector','repeat')).toBeNull();
  const saved=JSON.parse((await store.read('live-allowance'))!);
  expect(saved.monthlyReserved.collectorInvocations).toBe(1);
  expect(saved.dailyReserved.firestoreReads).toBe(700);
  expect(await new LiveLedger(store,()=>start+299_999).admit('collector','before-slot')).toBeNull();
  expect(await new LiveLedger(store,()=>start+300_000).admit('collector','next-slot')).not.toBeNull();
  expect(JSON.parse((await store.read('live-allowance'))!).monthlyReserved.collectorInvocations).toBe(2);
});
it('keeps reservations spent after a crash and stops before the configured transfer budget',async()=>{
  const {store,state,start}=await setup();state.monthlyLimits.egressBytes=32768;
  await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(state));
  const l=new LiveLedger(store,()=>start);
  const session=await l.admit('browser','one');expect(session!.policy().pollMs).toBe(300_000);
  await expect(l.admit('browser','two')).rejects.toThrow('90%');
  await expect(l.admit('browser','three')).rejects.toThrow('egressBytes');
  await expect(session!.extend({egressBytes:14000})).rejects.toThrow('egressBytes');
  expect(JSON.parse((await store.read('live-allowance'))!).monthlyReserved.egressBytes).toBe(16384);
});
it('preserves an older hourly admission and all accounting when adopting five-minute slots',async()=>{
  const {store,state,start}=await setup();
  state.lastCollectorHour=Math.floor(start/3_600_000);
  state.monthlyReserved={collectorInvocations:4};state.dailyReserved={firestoreReads:2800};
  await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(state));
  const before=await store.read('live-allowance');
  expect(await new LiveLedger(store,()=>start+300_000).admit('collector','legacy-hour')).toBeNull();
  expect(await store.read('live-allowance')).toBe(before);
  expect(await new LiveLedger(store,()=>start+3_600_000).admit('collector','new-hour')).not.toBeNull();
  expect(await new LiveLedger(store,()=>start+3_900_000).admit('collector','next-slot')).not.toBeNull();
  const after=JSON.parse((await store.read('live-allowance'))!);
  expect(after.monthlyReserved.collectorInvocations).toBe(6);
  expect(after.dailyReserved.firestoreReads).toBe(4200);
  expect(after.monthlyLimits).toEqual(state.monthlyLimits);expect(after.expiresAt).toBe(state.expiresAt);
});
it('five-minute collection still defers at the existing cap without resetting or stopping the ledger',async()=>{
  const {store,state,start}=await setup();state.monthlyLimits.collectorInvocations=3;
  await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(state));
  const shutdown=vi.fn(),tick=vi.spyOn(MarketCollector.prototype,'tick').mockResolvedValue(undefined);let now=start;
  const runtime=createLiveRuntime({id:state.id,expiresAt:state.expiresAt,store:()=>store,shutdown,now:()=>now});
  await runtime.collect('first');now+=300_000;await runtime.collect('second');
  const before=await store.read('live-allowance');now+=300_000;await runtime.collect('full');
  expect(await store.read('live-allowance')).toBe(before);expect(tick).toHaveBeenCalledTimes(2);
  expect(shutdown).not.toHaveBeenCalled();
});
it('daily quotas roll over in Pacific time without resetting monthly usage',async()=>{
  const {store,state}=await setup(Date.parse('2026-10-02T06:59:00Z'));let now=state.startsAt+1;
  const l=new LiveLedger(store,()=>now);await l.admit('browser','before');
  now=Date.parse('2026-10-02T07:01:00Z');await l.admit('browser','after');
  const s=JSON.parse((await store.read('live-allowance'))!);
  expect(s.day).toBe('2026-10-02');expect(s.dailyReserved.firestoreReads).toBe(164);
  expect(s.monthlyReserved.browserRequests).toBe(2);
});
it('does not create missing accounting, reopen a pause, or automatically renew a period',async()=>{
  const {store,state,start}=await setup();
  await expect(new LiveLedger(store,()=>state.expiresAt).admit('browser','expired')).rejects.toThrow('expired');
  const l=new LiveLedger(store,()=>start);await l.stop('operator pause');
  await expect(l.admit('browser','paused')).rejects.toThrow('operator pause');
  const blank=new SqliteCache(':memory:');stores.push(blank);
  await expect(new LiveLedger(blank,()=>start).admit('browser','missing')).rejects.toThrow('missing');
});
it('runtime failure attempts infrastructure shutdown and never fetches upstream',async()=>{
  const {store,start}=await setup();const shutdown=vi.fn(async()=>{}),network=vi.fn();
  const r=createLiveRuntime({id:'free-other',expiresAt:start+86_400_000,store:()=>store,shutdown,network,now:()=>start});
  await expect(r.collect('scheduled')).rejects.toThrow('does not match');
  expect(shutdown).toHaveBeenCalledOnce();expect(network).not.toHaveBeenCalled();
  expect(JSON.parse((await store.read('live-allowance'))!).stoppedAt).toBe(start);
});
it('an admitted work timeout retains charges, completes accounting and waits for the next five-minute slot',async()=>{
  const {store,state,start}=await setup(); const shutdown=vi.fn(),network=vi.fn(); let now=start;
  const tick=vi.spyOn(MarketCollector.prototype,'tick').mockRejectedValueOnce(new DOMException('request timed out','TimeoutError')).mockResolvedValue(undefined);
  const r=createLiveRuntime({id:state.id,expiresAt:state.expiresAt,store:()=>store,shutdown,network,now:()=>now});
  await expect(r.collect('first')).rejects.toThrow('reserved usage retained');
  const saved=JSON.parse((await store.read('live-allowance'))!);
  expect(saved.stoppedAt).toBeUndefined();expect(saved.monthlyReserved.collectorInvocations).toBe(1);
  expect(saved.observed.transientTimeouts).toBe(1);expect(saved.expiresAt).toBe(state.expiresAt);
  await r.collect('same-slot');expect(tick).toHaveBeenCalledTimes(1);
  now+=300_000;await r.collect('next-slot');expect(tick).toHaveBeenCalledTimes(2);
  expect(shutdown).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();
});
it.each(['admission','accounting','unknown','deadline'])('%s failures still stop the service',async(phase)=>{
  const {store,state,start}=await setup();const shutdown=vi.fn();let now=start;
  const timeout=new DOMException('timeout','TimeoutError');
  if(phase==='admission')vi.spyOn(CurrentLiveLedger.prototype,'admit').mockRejectedValueOnce(timeout);
  if(phase==='accounting')vi.spyOn(CurrentLiveLedger.prototype,'finish').mockRejectedValueOnce(timeout);
  vi.spyOn(MarketCollector.prototype,'tick').mockImplementation(async()=>{
    if(phase==='deadline')now=state.expiresAt;
    throw phase==='unknown'?new Error('invalid data'):timeout;
  });
  const r=createLiveRuntime({id:state.id,expiresAt:state.expiresAt,store:()=>store,shutdown,now:()=>now});
  await expect(r.collect('failure')).rejects.toThrow();expect(shutdown).toHaveBeenCalledOnce();
  expect(JSON.parse((await store.read('live-allowance'))!).stoppedAt).toBe(now);
});
it('does not halve cadence at 65% reserved and retains the 90% cutoff after the hourly test',async()=>{
  const {store,state}=await setup(HOURLY_TRIAL_START);
  state.expiresAt=HOURLY_TRIAL_END+86400000;
  state.monthlyReserved.cpuSeconds=80000;
  await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(state));
  let now=HOURLY_TRIAL_START;
  const ledger=new LiveLedger(store,()=>now);
  const first=await ledger.admit('collector','odd-test-hour');
  expect(first!.policy().pollMs).toBe(3600000);
  expect(first!.policy().reason).toContain('Hourly test until');
  expect(await ledger.admit('collector','duplicate')).toBeNull();
  now+=3600000;expect(await ledger.admit('collector','next-hour')).not.toBeNull();
  const saved=JSON.parse((await store.read('live-allowance'))!);
  expect(saved.dailyReserved).toMatchObject({firestoreReads:1400,firestoreWrites:592});
  expect(saved.monthlyReserved.cpuSeconds).toBe(80200);
  expect(saved.expiresAt).toBe(state.expiresAt);
  now=HOURLY_TRIAL_END+300000;
  expect(await ledger.admit('collector','odd-after-trial')).not.toBeNull();
  expect((await ledger.admit('browser','after-trial'))!.policy().pollMs).toBe(300000);
});
it('pauses collection at 90% without spending or clearing accounting; daily capacity resets only at Pacific midnight',async()=>{
  const {store,state}=await setup(HOURLY_TRIAL_START);
  state.dailyReserved={firestoreReads:28000,firestoreWrites:10000};
  await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(state));
  const original=await store.read('live-allowance');
  const shutdown=vi.fn(),tick=vi.spyOn(MarketCollector.prototype,'tick').mockResolvedValue(undefined);
  const runtime=createLiveRuntime({id:state.id,expiresAt:state.expiresAt,store:()=>store,shutdown,now:()=>HOURLY_TRIAL_START});
  await runtime.collect('insufficient-test-headroom');
  expect(await store.read('live-allowance')).toBe(original);
  expect(shutdown).not.toHaveBeenCalled();expect(tick).not.toHaveBeenCalled();
  const nextDay=Date.parse('2026-10-03T07:01:00Z');
  expect(await new LiveLedger(store,()=>nextDay).admit('collector','new-day')).not.toBeNull();
  const saved=JSON.parse((await store.read('live-allowance'))!);
  expect(saved.day).toBe('2026-10-03');expect(saved.dailyReserved.firestoreReads).toBe(700);
});
it.each(['cpuSeconds','snapshotUploads','hypixelRequests'])('test respects monthly %s reservations and never renews the budget',async(key)=>{
  const {store,state}=await setup(HOURLY_TRIAL_START);
  state.monthlyReserved[key]=Math.floor(state.monthlyLimits[key]*.9);
  await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(state));
  const before=await store.read('live-allowance');
  await expect(new LiveLedger(store,()=>HOURLY_TRIAL_START).admit('collector',key)).rejects.toThrow(key);
  expect(await store.read('live-allowance')).toBe(before);
});
it('hourly test still enforces browser hard limits, expired periods and explicit stops',async()=>{
  const {store,state}=await setup(HOURLY_TRIAL_START);
  state.dailyReserved.firestoreReads=30000;
  await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(state));
  const ledger=new LiveLedger(store,()=>HOURLY_TRIAL_START);
  await expect(ledger.admit('browser','hard-limit')).rejects.toThrow('firestoreReads');
  await expect(new LiveLedger(store,()=>state.expiresAt).admit('collector','expired')).rejects.toThrow('expired');
  await ledger.stop('operator stop');await expect(ledger.admit('collector','stopped')).rejects.toThrow('operator stop');
});
it('budget refusal keeps Scheduler alive, returns bounded CORS/429, avoids repeated reads and resumes naturally next day',async()=>{
  const {store,state}=await setup(HOURLY_TRIAL_START);let now=HOURLY_TRIAL_START;
  state.dailyReserved={firestoreReads:29972,firestoreWrites:11032};
  await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(state));
  const before=await store.read('live-allowance'),shutdown=vi.fn(),network=vi.fn();
  const runtime=createLiveRuntime({id:state.id,expiresAt:state.expiresAt,store:()=>store,shutdown,network,now:()=>now});
  const res=await request(runtime);expect(res.status).toBe(429);
  expect(JSON.parse(res.body).usage).toMatchObject({mode:'paused',pollMs:0,trialId:state.id,expiresAt:state.expiresAt,retryAt:Date.parse('2026-10-03T07:00:00Z')});
  const reads=vi.spyOn(store,'read');expect((await request(runtime,'OPTIONS')).status).toBe(204);
  expect(reads).not.toHaveBeenCalled();reads.mockRestore();
  await runtime.collect('before-reset');expect(await store.read('live-allowance')).toBe(before);
  const tick=vi.spyOn(MarketCollector.prototype,'tick').mockResolvedValue(undefined);
  now=Date.parse('2026-10-03T07:00:00Z');await runtime.collect('after-reset');
  expect(tick).toHaveBeenCalledOnce();
  const after=JSON.parse((await store.read('live-allowance'))!);
  expect(after.stoppedAt).toBeUndefined();expect(after.day).toBe('2026-10-03');
  expect(after.dailyReserved.firestoreReads).toBe(700);expect(after.monthlyLimits).toEqual(state.monthlyLimits);
  expect(after.monthlyReserved.collectorInvocations).toBe(1);expect(shutdown).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();
});
it('browsing protects the remaining hourly collector budget without pre-spending or resetting it',async()=>{
  const start=Date.parse('2026-10-03T07:00:00Z'),{store,state}=await setup(start);
  state.dailyReserved={firestoreReads:13000};
  await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(state));
  const ledger=new LiveLedger(store,()=>start);
  await ledger.admit('browser','one',false);
  await expect(ledger.admit('browser','protected',false)).rejects.toThrow('firestoreReads');
  expect(await ledger.admit('collector','scheduled')).not.toBeNull();
  const after=JSON.parse((await store.read('live-allowance'))!);
  expect(after.dailyReserved.firestoreReads).toBe(13000+108+700);
  expect(after.monthlyReserved.sellerRequests).toBe(0);
});
it('a denied response-size extension finalizes admitted accounting without shutting down collection',async()=>{
  const {store,state,start}=await setup();state.monthlyLimits.egressBytes=19000;
  await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(state));
  vi.spyOn(MarketCollector.prototype,'bazaar').mockResolvedValue({items:[],padding:'x'.repeat(18000)} as any);
  const shutdown=vi.fn(),runtime=createLiveRuntime({id:state.id,expiresAt:state.expiresAt,store:()=>store,shutdown,now:()=>start});
  expect((await request(runtime,'GET','/api/companion/bazaar')).status).toBe(429);
  const after=JSON.parse((await store.read('live-allowance'))!);
  expect(after.stoppedAt).toBeUndefined();expect(after.monthlyReserved.egressBytes).toBe(16384);
  expect(after.observed.observedHandlerMs).toBeDefined();expect(shutdown).not.toHaveBeenCalled();
});
it('failure to finalize a deferred admitted request still stops infrastructure',async()=>{
  const {store,state,start}=await setup();state.monthlyLimits.egressBytes=19000;
  await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(state));
  vi.spyOn(MarketCollector.prototype,'bazaar').mockResolvedValue({items:[],padding:'x'.repeat(18000)} as any);
  vi.spyOn(CurrentLiveLedger.prototype,'finish').mockRejectedValueOnce(new Error('accounting unavailable'));
  const shutdown=vi.fn(),runtime=createLiveRuntime({id:state.id,expiresAt:state.expiresAt,store:()=>store,shutdown,now:()=>start});
  expect((await request(runtime,'GET','/api/companion/bazaar')).status).toBe(503);
  expect(shutdown).toHaveBeenCalledOnce();
});
it('finds natural Pacific midnight across daylight saving changes',()=>{
  expect(nextPacificReset(Date.parse('2026-10-03T02:00:00Z'))).toBe(Date.parse('2026-10-03T07:00:00Z'));
  expect(nextPacificReset(Date.parse('2026-11-01T07:00:00Z'))).toBe(Date.parse('2026-11-02T08:00:00Z'));
});
