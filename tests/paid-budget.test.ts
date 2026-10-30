import { expect,it,vi } from 'vitest';
import { PaidLedger, paidCost, paidEnvelope, PAID_BUDGET_KEY, validatePaid, createPaidRuntime, type PaidBudget } from '../collector/paid-budget';
import { SqliteCache } from '../collector/cache-store';
import { trialGoogleStore } from '../collector/trial-google';
import { offlineGoogle } from './support/offline-google';
import { livePolicy } from '../collector/allowance-live';
import { paidPilotActive,paidPilotAlertWindow,PAID_PILOT_INTERVAL } from '../shared/paid-pilot';
import { paidReceiptKey } from '../collector/paid-ledger-storage';

const now = Date.parse('2026-10-13T21:00:00Z');
const state = (): PaidBudget => ({version:1,id:'paid-202610',startsAt:now-1000,expiresAt:Date.parse('2026-11-01T07:00:00Z'),limitUsd:5,stopUsd:4.5,reservedUsd:1,reserved:{},observed:{},legacyLedgerSha256:'a'.repeat(64),admissions:{}});
it('reserves gross costs without assuming free quota and keeps fixed headroom',()=>{
  expect(paidCost({cpuSeconds:100000,memoryGiBSeconds:100000})).toBeCloseTo(2.65);
  expect(()=>paidCost({egressBytes:NaN})).toThrow();
  const monthly=1+744*paidCost(paidEnvelope('collector'))+2000*paidCost(paidEnvelope('browser'));
  expect(monthly).toBeLessThan(4.5);
  for(const patch of [{limitUsd:6},{stopUsd:5},{reservedUsd:0},{expiresAt:now},{stoppedAt:now}])expect(()=>validatePaid({...state(),...patch},now)).toThrow();
});
it('deduplicates concurrent collection, keeps old ledger untouched, and never refunds failed holds',async()=>{
  const store=new SqliteCache(':memory:');
  const legacy='{"monthlyReserved":{"cpuSeconds":10140},"stoppedAt":123}';
  await store.commit('live-allowance',null,legacy);await store.commit(PAID_BUDGET_KEY,null,JSON.stringify(state()));
  const ledger=new PaidLedger(store,()=>now);
  const sessions=await Promise.all([ledger.admit('collector','a'),ledger.admit('collector','b')]);
  expect(sessions.filter(Boolean)).toHaveLength(1);
  expect(await store.read('live-allowance')).toBe(legacy);
  const reserved=JSON.parse((await store.read(PAID_BUDGET_KEY))!).reservedUsd;
  await sessions.find(Boolean)!.finish();await sessions.find(Boolean)!.finish();
  expect(JSON.parse((await store.read(PAID_BUDGET_KEY))!).reservedUsd).toBe(reserved);
  await ledger.stop('owner stop');await expect(ledger.admit('browser','c')).rejects.toThrow('owner stop');await store.close();
});
it('stops before a reservation crosses $4.50 and rejects unbudgeted extension',async()=>{
  const store=new SqliteCache(':memory:');await store.commit(PAID_BUDGET_KEY,null,JSON.stringify({...state(),reservedUsd:4.4999}));
  const ledger=new PaidLedger(store,()=>now);await expect(ledger.admit('collector','expensive')).rejects.toThrow('$4.50');
  expect(JSON.parse((await store.read(PAID_BUDGET_KEY))!).admissions).toEqual({});await store.close();
});
it('runs real collector/accounting adapters offline within the paid envelope and stops on expiry',async()=>{
  const f=offlineGoogle(()=>now);f.seed(PAID_BUDGET_KEY,JSON.stringify(state()));
  const shutdown=vi.fn(async()=>{}),network=vi.fn(async(input:any)=>{
    const url=String(input);
    if(url.includes('items'))return Response.json({success:true,items:[{id:'TEST',name:'Test'}]});
    if(url.includes('election'))return Response.json({success:true,mayor:{name:'Diana',perks:[]},current:{mayor:{name:'Diana',perks:[]}}});
    return Response.json({success:true,lastUpdated:now,products:{TEST:{product_id:'TEST',sell_summary:[{amount:100,pricePerUnit:10,orders:2}],buy_summary:[{amount:100,pricePerUnit:11,orders:2}],quick_status:{sellPrice:10,buyPrice:11,sellVolume:100,buyVolume:100,sellMovingWeek:1000,buyMovingWeek:1000}}}});
  });
  f.seed('control',JSON.stringify({revision:1,policy:livePolicy,lease:null,requests:[],totalRequests:2045,blockedUntil:0,header:null,jobs:{}}));
  const runtime=createPaidRuntime({expiresAt:state().expiresAt,store:s=>trialGoogleStore({...f.config,inlineSmallSnapshots:true},s),shutdown,network,now:()=>now});
  await runtime.collect('scheduled-one');expect(network).toHaveBeenCalledTimes(3);expect(shutdown).not.toHaveBeenCalled();
  await runtime.collect('scheduled-duplicate');expect(network).toHaveBeenCalledTimes(3);
  const budget=JSON.parse(f.read(PAID_BUDGET_KEY)!);expect(budget.observed.hypixelRequests).toBe(3);
  expect(JSON.parse(f.read(paidReceiptKey(budget.id,'scheduled-one'))!).finished).toBe(true);
  const expired=createPaidRuntime({expiresAt:now,store:s=>trialGoogleStore(f.config,s),shutdown,network,now:()=>now});
  await expect(expired.collect('expired')).rejects.toThrow('expired');expect(shutdown).toHaveBeenCalledTimes(1);
});
it('paid notification clock checks each quarter hour and never renews November automatically',()=>{
  for (let quarter=0;quarter<4;quarter++) {
    const at=now+quarter*PAID_PILOT_INTERVAL;
    expect(paidPilotAlertWindow(at+89_999)).toBe(false);
    expect(paidPilotAlertWindow(at+90_000)).toBe(true);
    expect(paidPilotAlertWindow(at+120_000)).toBe(true);
    expect(paidPilotAlertWindow(at+150_000)).toBe(false);
  }
  expect(paidPilotActive('paid-budget',now)).toBe(true);expect(paidPilotActive('free-tier',now)).toBe(false);
  expect(paidPilotActive('paid-budget',Date.parse('2026-11-01T07:00:00Z'))).toBe(false);
});
it('admits one collection in each quarter-hour slot without resetting previous hourly admissions',async()=>{
  const store=new SqliteCache(':memory:');
  const old={...state(),lastCollectorAt:now,admissions:{hourly:{at:now,finished:true}}};
  await store.commit(PAID_BUDGET_KEY,null,JSON.stringify(old));
  let at=now+PAID_PILOT_INTERVAL-1;
  const ledger=new PaidLedger(store,()=>at);
  expect(await ledger.admit('collector','early')).toBeNull();
  for(let quarter=1;quarter<=4;quarter++) {
    at=now+quarter*PAID_PILOT_INTERVAL;
    const attempts=await Promise.all([ledger.admit('collector',`quarter-${quarter}`),ledger.admit('collector',`duplicate-${quarter}`)]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    await attempts.find(Boolean)!.finish();
  }
  const saved=JSON.parse((await store.read(PAID_BUDGET_KEY))!);
  expect(saved.admissions.hourly).toEqual(old.admissions.hourly);
  expect(saved.admissionCount).toBe(5);
  expect(Object.keys(saved.admissions)).toHaveLength(1);
  expect(saved.reservedUsd).toBeGreaterThan(old.reservedUsd);
  expect(saved.expiresAt).toBe(old.expiresAt);
  await store.close();
});
