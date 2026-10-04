import { afterEach, expect, it } from 'vitest';
import { SqliteCache } from '../collector/cache-store';
import { LiveLedger, liveMaximums, liveDailyMaximums, collectorBudgetDeferral, nextPacificReset, liveInvocationCharge } from '../collector/allowance-live';
import { chooseCadence } from '../collector/capacity-plan';
import { collectionStatus } from '../collector/usage-dashboard';
import { capacityFixture } from './support/capacity-fixture';
import { APP_BUDGET_PAUSE_FRACTION } from '../shared/app-budget-policy';

const now=Date.parse('2026-10-04T12:00:00Z'), stores:SqliteCache[]=[];
afterEach(async()=>{for(const store of stores.splice(0))await store.close();});
async function setup() {
  const s=capacityFixture(now),store=new SqliteCache(':memory:'); stores.push(store);
  return {s,store,save:()=>store.commit('live-allowance',null,JSON.stringify(s))};
}
it.each(Object.entries({...liveMaximums,...liveDailyMaximums}).filter(([,n])=>n>0))(
  'pauses all optional work when the individual %s reservation reaches 90%%, without resetting any budget',async(key,limit)=>{
    const {s,store,save}=await setup();
    const reserved=Object.hasOwn(liveDailyMaximums,key)?s.dailyReserved:s.monthlyReserved;
    reserved[key]=limit*APP_BUDGET_PAUSE_FRACTION;
    await save(); const before=await store.read('live-allowance');
    for(const kind of ['collector','browser'] as const)
      await expect(new LiveLedger(store,()=>now).admit(kind,'at-boundary',false)).rejects.toThrow(`90% app reservation pause: ${key}`);
    expect(await store.read('live-allowance')).toBe(before);
  });
it('one reservation can win just below 90%; concurrent competitors and restarts cannot reach the threshold',async()=>{
  const {s,store,save}=await setup();s.monthlyReserved.cpuSeconds=98980;await save();
  const results=await Promise.allSettled(Array.from({length:40},()=>new LiveLedger(store,()=>now).add(s.id,{cpuSeconds:10})));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const saved=JSON.parse((await store.read('live-allowance'))!);
  expect(saved.monthlyReserved.cpuSeconds).toBe(98990);
  expect(saved.capacity.meters.cpuSeconds.reserved).toBe(10);
  await expect(new LiveLedger(store,()=>now).add(s.id,{cpuSeconds:10})).rejects.toThrow('90%');
  expect(await store.read('live-allowance')).toBe(JSON.stringify(saved));
});
it('includes the whole next collector envelope, not just the current percentage, in report and admission decisions',async()=>{
  const {s,store,save}=await setup();s.monthlyReserved.cpuSeconds=98900;await save();
  expect(collectorBudgetDeferral(s,now)?.key).toBe('cpuSeconds');
  expect(collectionStatus(s,null,'ENABLED',now)).toMatchObject({state:'Paused',nextCollectionAt:s.expiresAt});
  expect(collectionStatus(s,null,'ENABLED',now).reason).toContain('90%');
  const before=await store.read('live-allowance');
  // Historical admission bypasses only evidence planning, never the new cutoff.
  await expect(new LiveLedger(store,()=>now,false).admit('collector','projected-boundary')).rejects.toThrow('90%');
  expect(await store.read('live-allowance')).toBe(before);
});
it('projects every full app period against 90% while retaining the separate 25% provider margin',()=>{
  const s=capacityFixture(now);
  const decision=chooseCadence(s.capacity,{...s,dailyEnd:nextPacificReset(now)},liveInvocationCharge('collector'),liveInvocationCharge('browser'),now);
  expect(decision.mode).toBe('slow');
  expect(decision.projections.find(p=>p.meter==='app-monthly-cpuSeconds')!.ceiling).toBe(99000);
  expect(decision.projections.find(p=>p.meter==='cpuSeconds')!.ceiling).toBe(135000);
  for(const p of decision.projections.filter(p=>p.meter.startsWith('app-')&&p.ceiling>0))
    expect(p.reserved+p.work).toBeLessThan(p.ceiling);
});
