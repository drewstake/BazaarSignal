import { afterEach, expect, it, vi } from 'vitest';
import { SqliteCache } from '../collector/cache-store';
import { LiveLedger, liveMaximums, liveDailyMaximums, pacificDay, createLiveRuntime, type LiveAllowanceState } from '../collector/allowance-live';
const stores: SqliteCache[]=[];
afterEach(async()=>{for(const s of stores.splice(0))await s.close();});
async function setup(start=Date.parse('2026-10-02T03:00:00Z')) {
  const store=new SqliteCache(':memory:');stores.push(store);
  const state:LiveAllowanceState={version:1,id:'free-test',startsAt:start-1,expiresAt:start+86_400_000,
    monthlyLimits:{...liveMaximums},monthlyReserved:{},dailyLimits:{...liveDailyMaximums},dailyReserved:{},
    day:pacificDay(start),observed:{},evidence:'offline fixture; no cloud calls'};
  await store.commit('live-allowance',null,JSON.stringify(state));return {store,state,start};
}
it('reserves only one hourly collection across concurrent workers and process-style restarts',async()=>{
  const {store,start}=await setup();
  const runs=await Promise.all(Array.from({length:50},(_,i)=>new LiveLedger(store,()=>start).admit('collector',String(i))));
  expect(runs.filter(Boolean)).toHaveLength(1);
  expect(await new LiveLedger(store,()=>start+60_000).admit('collector','repeat')).toBeNull();
  const saved=JSON.parse((await store.read('live-allowance'))!);
  expect(saved.monthlyReserved.collectorInvocations).toBe(1);
  expect(saved.dailyReserved.firestoreReads).toBe(700);
});
it('keeps reservations spent after a crash and stops before the configured transfer budget',async()=>{
  const {store,state,start}=await setup();state.monthlyLimits.egressBytes=32768;
  await store.commit('live-allowance',await store.read('live-allowance'),JSON.stringify(state));
  const l=new LiveLedger(store,()=>start);
  const session=await l.admit('browser','one');expect(session!.policy().pollMs).toBe(3_600_000);
  await l.admit('browser','two');
  await expect(l.admit('browser','three')).rejects.toThrow('egressBytes');
  await expect(session!.extend({egressBytes:1})).rejects.toThrow('egressBytes');
  expect(JSON.parse((await store.read('live-allowance'))!).monthlyReserved.egressBytes).toBe(32768);
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
