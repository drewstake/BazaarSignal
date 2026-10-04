import { afterEach,expect,it,vi } from 'vitest';
import { Readable } from 'node:stream';
import { capacityProblems,chooseCadence,reserveCapacity,capacityMeters } from '../collector/capacity-plan';
import { LiveLedger,createLiveRuntime,liveInvocationCharge,nextPacificReset } from '../collector/allowance-live';
import { SqliteCache } from '../collector/cache-store';
import { visibleDemand,changeVisibleDemand } from '../collector/visible-demand';
import { MarketCollector } from '../collector/engine';
import { capacityFixture } from './support/capacity-fixture';
import { INLINE_STORAGE_RESERVATION } from '../collector/inline-snapshot';

const now=Date.parse('2026-10-04T12:00:00Z');
const stores:SqliteCache[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const s of stores.splice(0))await s.close();});
const decide=(s=capacityFixture(now),at=now)=>chooseCadence(s.capacity,{...s,dailyEnd:nextPacificReset(at)},liveInvocationCharge('collector'),liveInvocationCharge('browser'),at);
async function setup() {
  const s=capacityFixture(now),store=new SqliteCache(':memory:');stores.push(store);
  s.visible=changeVisibleDemand(undefined,'owner','tab',['bz_COOKIE'],true,now,86400000,1);
  await store.commit('live-allowance',null,JSON.stringify(s));return {s,store};
}
it('never treats unknown shared use, units, eligibility, expired evidence or missing meters as capacity',()=>{
  expect(decide().mode).toBe('slow');
  for(const key of Object.keys(capacityMeters)) {
    const s=capacityFixture(now),row=s.capacity!.meters[key as keyof typeof capacityMeters];row.measured=null;
    expect(decide(s).mode,key).toBe('paused');
  }
  for(const bad of [{scopeComplete:false},{eligible:false},{fixedRemaining:null},{unit:'wrong'},{safetyFraction:.24},{measuredAt:now-900001},{allowance:Infinity}]) {
    const s=capacityFixture(now);Object.assign(s.capacity!.meters.cpuSeconds,bad);expect(decide(s).mode).toBe('paused');
  }
  const s=capacityFixture(now);s.capacity!.upstream.scopeComplete=false;expect(decide(s).mode).toBe('paused');
  expect(capacityProblems(capacityFixture(now).capacity,now+900001)).not.toHaveLength(0);
});
it.each([28,29,30,31])('models continuous work across a complete %i-day month and a full 25-hour day separately',days=>{
  const s=capacityFixture(now,days),d=decide(s);
  expect(d.mode).toBe('slow');expect(d.bazaarMs).toBe(days<=29?43200000:86400000);
  expect(d.auctionMs).toBe(0);
  for(const p of d.projections) expect(p.measured+p.reserved+p.fixed+p.work,p.meter).toBeLessThanOrEqual(p.ceiling);
  expect(d.projections.find(p=>p.meter==='app-monthly-collectorInvocations')!.work).toBe(days*(days<=29?2:1));
  expect(d.projections.find(p=>p.meter==='firestoreReads')!.work).toBe((days<=29?3:2)*(700+4*108));
});
it('unrelated shared consumption slows or pauses independently of request capacity and retained storage never resets',()=>{
  const s=capacityFixture(now);s.capacity!.meters.cpuSeconds.measured=135000;
  expect(decide(s).mode).toBe('paused');
  const retained=capacityFixture(now);retained.capacity!.meters.artifactByteMonths.fixedRemaining=500e6;
  expect(decide(retained).reasons).toContain('No sustainable cadence: artifactByteMonths');
  expect(retained.monthlyReserved).toEqual({});
});
it('the pure planner can choose a 60-second bounded burst only when all dimensions and upstream bounds fit',()=>{
  const s=capacityFixture(now,1/24);
  const result=chooseCadence(s.capacity,{...s,dailyEnd:nextPacificReset(now)},
    {runRequests:1,firestoreReads:2,hypixelRequests:3},{runRequests:1,firestoreReads:1},now);
  expect(result.bazaarMs).toBe(60000);
  expect(result.auctionMs).toBe(0);
});
it('keeps measured, reserved and projected use distinct, with no refunds or rolling renewals',()=>{
  const s=capacityFixture(now),p=s.capacity!;p.meters.cpuSeconds.measured=100;p.meters.cpuSeconds.reserved=200;p.meters.cpuSeconds.fixedRemaining=300;
  reserveCapacity(p,{cpuSeconds:10},now);
  const row=decide(s).projections.find(r=>r.meter==='cpuSeconds')!;
  expect(row).toMatchObject({measured:100,reserved:210,fixed:300});expect(row.work).toBeGreaterThan(0);
  const before=JSON.stringify(p);expect(()=>reserveCapacity(p,{cpuSeconds:1e10},now)).toThrow('exhausted');expect(JSON.stringify(p)).toBe(before);
  expect(()=>reserveCapacity(p,{cpuSeconds:1},p.validUntil)).toThrow();
});
it('atomic capacity reservations cannot oversubscribe under concurrent workers, uncertain outcomes or restarts',async()=>{
  const {s,store}=await setup();
  s.capacity!.meters.cpuSeconds.allowance=100;s.capacity!.meters.cpuSeconds.measured=65;
  await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(s));
  const attempts=await Promise.allSettled(Array.from({length:50},()=>new LiveLedger(store,()=>now).add(s.id,{cpuSeconds:10})));
  expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const saved=JSON.parse((await store.read('live-allowance'))!);
  expect(saved.capacity.meters.cpuSeconds.reserved).toBe(10);expect(saved.monthlyReserved.cpuSeconds).toBe(10);
  await expect(new LiveLedger(store,()=>now).add(s.id,{cpuSeconds:1})).rejects.toThrow('Capacity exhausted');
  expect(await store.read('live-allowance')).toBe(JSON.stringify(saved));
});
it('one collector serves concurrent users/tabs; idle work does not reserve an invocation or scan holdings',async()=>{
  const {store}=await setup();
  const runs=await Promise.all(Array.from({length:40},(_,i)=>new LiveLedger(store,()=>now).admit('collector',String(i))));
  expect(runs.filter(Boolean)).toHaveLength(1);
  const saved=JSON.parse((await store.read('live-allowance'))!);expect(saved.monthlyReserved.collectorInvocations).toBe(1);
  expect(await new LiveLedger(store,()=>now+1).admit('collector','restart')).toBeNull();
  saved.visible={};await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(saved));
  const before=await store.read('live-allowance');expect(await new LiveLedger(store,()=>now+2).admit('collector','idle')).toBeNull();
  expect(await store.read('live-allowance')).toBe(before);
});
it('demand is deduplicated, authenticated by owner and expires after failed disconnects',()=>{
  let d=changeVisibleDemand(undefined,'uid','tab1',['bz_COOKIE','bz_COOKIE'],true,now,60000,1);
  d=changeVisibleDemand(d,'uid','tab2',['bz_COOKIE','bz_STONE'],true,now,60000,2);
  expect(visibleDemand(d,now).bazaar).toEqual(['COOKIE','STONE']);
  expect(JSON.stringify(d)).not.toContain('uid');
  expect(()=>changeVisibleDemand(d,'other','tab',['bz_STONE'],true,now,60000,1)).toThrow('capacity');
  d=changeVisibleDemand(d,'uid','tab1',[],false,now,60000,1);expect(visibleDemand(d,now).bazaar).toHaveLength(2);
  expect(visibleDemand(d,now+180000).bazaar).toEqual([]);
});
it('default runtime fails closed on missing evidence and never scans, sends upstream requests, or auto-renews',async()=>{
  const {store,s}=await setup();delete s.capacity;await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(s));
  const network=vi.fn(),scan=vi.fn(),shutdown=vi.fn();
  const runtime=createLiveRuntime({id:s.id,expiresAt:s.expiresAt,store:()=>store,now:()=>now,network,shutdown,portfolioDemand:scan});
  await expect(runtime.collect('missing')).rejects.toThrow('evidence');expect(network).not.toHaveBeenCalled();expect(scan).not.toHaveBeenCalled();expect(shutdown).toHaveBeenCalledOnce();
});
it('inline profile uses its own atomic holds, retains existing usage, and refuses unreserved uploads', async () => {
  const { s, store } = await setup();
  s.monthlyReserved.storageClassA = 168;
  await store.commit('live-allowance', await store.read('live-allowance'), JSON.stringify(s));
  const runs = await Promise.all(Array.from({ length: 40 }, (_, i) =>
    new LiveLedger(store, () => now, true, 'bazaar-inline').admit('collector', String(i))));
  expect(runs.filter(Boolean)).toHaveLength(1);
  const saved = JSON.parse((await store.read('live-allowance'))!);
  expect(saved.monthlyReserved.storageClassA).toBe(168);
  expect(saved.monthlyReserved.hypixelRequests).toBe(9);
  expect(saved.capacity.meters.firestoreStorageBytes.reserved).toBe(INLINE_STORAGE_RESERVATION);
  expect(saved.dailyReserved.firestoreReads).toBe(700);
  expect(() => runs.find(Boolean)!.take({ storageClassA: 1 })).toThrow('storageClassA');
  expect(await store.read('live-allowance')).toBe(JSON.stringify(saved));
});
it.each([28, 29, 30, 31])('models the inline profile for a complete %i-day period without inventing faster capacity', days => {
  const s = capacityFixture(now, days);
  s.monthlyReserved = { collectorInvocations: 39, browserRequests: 222, cpuSeconds: 8340, storageClassA: 168 };
  const before = JSON.stringify(s);
  const d = chooseCadence(s.capacity, { ...s, dailyEnd: nextPacificReset(now) },
    liveInvocationCharge('collector', 'bazaar-inline'), liveInvocationCharge('browser'), now);
  expect(d.mode).toBe('slow');
  expect(d.bazaarMs).toBeGreaterThan(90_000);
  expect(d.auctionMs).toBe(0);
  for (const p of d.projections) expect(p.measured + p.reserved + p.fixed + p.work, p.meter).toBeLessThanOrEqual(p.ceiling);
  expect(d.projections.find(p => p.meter === 'storageClassA')?.work).toBe(0);
  expect(JSON.stringify(s)).toBe(before);
});
it('strict runtime timeouts retain both reservations; retry/restart cannot repeat collection',async()=>{
  const {store,s}=await setup(),shutdown=vi.fn();let clock=now;
  const tick=vi.spyOn(MarketCollector.prototype,'tick').mockRejectedValue(new DOMException('uncertain transport','TimeoutError'));
  const runtime=()=>createLiveRuntime({id:s.id,expiresAt:s.expiresAt,store:()=>store,now:()=>clock,shutdown});
  await expect(runtime().collect('uncertain')).rejects.toThrow('reserved usage retained');
  const saved=JSON.parse((await store.read('live-allowance'))!);
  expect(saved.monthlyReserved.cpuSeconds).toBe(100);expect(saved.capacity.meters.cpuSeconds.reserved).toBe(100);
  clock+=600000;await runtime().collect('restarted');
  expect(tick).toHaveBeenCalledOnce();expect(shutdown).not.toHaveBeenCalled();
  expect(JSON.parse((await store.read('live-allowance'))!).capacity.meters.cpuSeconds.reserved).toBe(100);
});
it('an admitted invocation stops at evidence expiry without refunding its hold',async()=>{
  const {store,s}=await setup();let clock=now;
  s.capacity!.validUntil=now+100;
  await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(s));
  const session=await new LiveLedger(store,()=>clock).admit('browser','expiry',false);
  clock+=100;expect(()=>session!.take({egressBytes:1})).toThrow('expired');
  const saved=JSON.parse((await store.read('live-allowance'))!);
  expect(saved.capacity.meters.egressBytes.reserved).toBe(65536);
});
it('wire-size violations stop before sending an oversized body and keep conservative holds',async()=>{
  const {store,s}=await setup();const shutdown=vi.fn();
  vi.spyOn(MarketCollector.prototype,'portfolioPrices').mockResolvedValue({bazaar:[],listings:[],fixture:false,padding:'x'.repeat(70*1024)} as any);
  const runtime=createLiveRuntime({id:s.id,expiresAt:s.expiresAt,store:()=>store,now:()=>now,shutdown});
  const response:any={headers:{},setHeader(k:string,v:unknown){this.headers[k]=v;},writeHead(status:number){this.status=status;return this;},end(body=''){this.body=body;this.headersSent=true;}};
  await runtime.handle({method:'GET',url:'/api/companion/portfolio-prices?assets=bz_COOKIE',headers:{}} as any,response);
  expect(response.status).toBe(503);expect(response.body.length).toBeLessThan(65536);expect(shutdown).toHaveBeenCalledOnce();
  const saved=JSON.parse((await store.read('live-allowance'))!);expect(saved.capacity.meters.egressBytes.reserved).toBe(65536);
});
it('presence rejects missing/forged authentication and price reads never invoke the collector',async()=>{
  const {store,s}=await setup();const tick=vi.spyOn(MarketCollector.prototype,'tick'),shutdown=vi.fn();
  const runtime=createLiveRuntime({id:s.id,expiresAt:s.expiresAt,store:()=>store,now:()=>now,shutdown,verifyPresence:async()=>{throw new Error('forged');}});
  async function request(url:string,method:string,authorization?:string){
    const req=Object.assign(Readable.from([JSON.stringify({tab:'tab',active:true,assets:['bz_COOKIE']})]),{url,method,headers:{authorization}});
    const res:any={headers:{},setHeader(k:string,v:unknown){this.headers[k]=v;},writeHead(status:number){this.status=status;return this;},end(body=''){this.body=body;this.headersSent=true;}};
    await runtime.handle(req as any,res);return res;
  }
  expect((await request('/api/companion/presence','POST')).status).toBe(401);
  expect((await request('/api/companion/presence','POST','Bearer bad')).status).toBe(401);
  expect((await request('/api/companion/portfolio-prices?assets=bz_COOKIE','GET')).status).toBe(200);
  expect(tick).not.toHaveBeenCalled();expect(shutdown).not.toHaveBeenCalled();
});
