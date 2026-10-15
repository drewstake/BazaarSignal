import { describe, expect, it } from 'vitest';
import { capacityFixture } from './support/capacity-fixture';
import { SqliteCache } from '../collector/cache-store';
import { armMeasurement, createMeasurementRuntime, ledgerHash, MeasurementLedger, oneShotPublicNetwork, type MeasurementState } from '../collector/measurement';
import { addCosts, measurementCapacity, measurementControl, measurementExcluded, measurementMeters, measurementWork, publicMeasurementEndpoints, type MeasurementPlan } from '../collector/measurement-capacity';
import { trialGoogleStore } from '../collector/trial-google';
import { offlineGoogle } from './support/offline-google';
import { readFileSync } from 'node:fs';

const now=Date.parse('2026-10-13T02:00:00Z');
function fixture() {
  const state:MeasurementState={...capacityFixture(now,19),stoppedAt:now-1000,reason:'Owner stop',
    monthlyReserved:{cpuSeconds:8340,collectorInvocations:39,browserRequests:222},
    dailyReserved:{firestoreReads:1996,firestoreWrites:776},day:'2026-10-04'};
  const capacity=state.capacity!;delete state.capacity;
  const p:MeasurementPlan={version:1,kind:'private-bazaar-measurement',id:'measure-offline',allowanceId:state.id,
    startsAt:now,deadline:now+600000,verifiedAt:now,ledgerSha256:ledgerHash(state),evidence:'SYNTHETIC ONLY',
    isolation:{sourceSha256:'a'.repeat(64),evidence:'SYNTHETIC ONLY',verifiedAt:now,schedulerPaused:true,privateApi:true,privateCollector:true,
      ongoingCollectionDisabled:true,auctionsDisabled:true,ownerServicesUnused:true,emailDisabled:true,evaluationDisabled:true,backgroundJobsDisabled:true,
      authenticatedInvocation:'SYNTHETIC',ingressBound:'SYNTHETIC'},
    meters:Object.fromEntries(measurementMeters.map(key=>[key,{...capacity.meters[key],reserved:state.monthlyReserved[key]??state.dailyReserved[key]??0}])),
    exclusions:Object.fromEntries(measurementExcluded.map(key=>[key,'Synthetic non-use proof'])),
    upstream:{source:'Synthetic entitlement',scopeComplete:true,verifiedAt:now,availableRequests:120,sharedUsageBound:10,reserve:.2},
    retainedDeployment:{cpuSeconds:0,memoryGiBSeconds:0,artifactByteMonths:0,logBytes:0},
    deployment:{cpuSeconds:10000,memoryGiBSeconds:10000,artifactByteMonths:84000000,logBytes:16777216},deploymentEvidence:'Synthetic retained reservations'};
  return {state,p};
}
describe('bounded measurement capacity',()=>{
  it('accepts dated provider reports only with fresh, funded and complete tail bounds',()=>{
    const{state,p}=fixture(),m=p.meters.cpuSeconds!;
    m.measuredAt=now-86400000;
    m.periodStart=m.measuredAt;
    m.coverage={verifiedAt:now,coveredThrough:m.measuredAt,tailThrough:p.deadline,tailBound:1234,source:'Synthetic inventory and bounded reporting tail'};
    m.uncertainty=1234;
    expect(measurementCapacity(p,state,now).ready).toBe(true);
    expect(m.measuredAt).toBe(now-86400000);
    for(const mutate of [()=>{m.uncertainty=1233;},()=>{m.coverage!.verifiedAt=now-900001;},()=>{m.coverage!.tailThrough=p.deadline-1;}]){
      const copy=structuredClone(m);mutate();expect(measurementCapacity(p,state,now).ready).toBe(false);Object.assign(m,copy);
    }
    m.measured=null;expect(measurementCapacity(p,state,now).ready).toBe(false);
  });
  it('proves an unused dimension without inventing its historical usage and cannot hide retained costs',()=>{
    const{state,p}=fixture(),m=p.meters.firestoreDeletes!;
    Object.assign(m,{measured:null,measuredAt:0,reserved:0,fixedRemaining:0,uncertainty:0,
      nonUse:{verifiedAt:now,source:'No delete path or TTL; exclusive database writer'}});
    expect(measurementCapacity(p,state,now).nonUse).toContain('firestoreDeletes');
    expect(measurementCapacity(p,state,now).ready).toBe(true);expect(m.measured).toBeNull();
    state.dailyReserved.firestoreDeletes=1;expect(measurementCapacity(p,state,now).ready).toBe(false);
    state.dailyReserved.firestoreDeletes=0;p.deployment.firestoreDeletes=1;expect(measurementCapacity(p,state,now).ready).toBe(false);
  });
  it('allows only the documented public one-shot scope without claiming numerical entitlement',()=>{
    const{state,p}=fixture();Object.assign(p.upstream,{availableRequests:null,sharedUsageBound:null,
      publicOneShot:{maxAttempts:3,retries:0,endpoints:publicMeasurementEndpoints,exclusiveUseEvidence:'Synthetic exclusive operator'}});
    expect(measurementCapacity(p,state,now).ready).toBe(true);
    p.upstream.publicOneShot!.endpoints=[...publicMeasurementEndpoints,'https://api.hypixel.net/v2/player'];
    expect(measurementCapacity(p,state,now).ready).toBe(false);
  });
  it('validates one collection without readers, cadence or unrelated Apps Script evidence',()=>{
    const {state,p}=fixture(),d=measurementCapacity(p,state,now);
    expect(d.problems).toEqual([]);expect(d.work.hypixelRequests).toBe(9);
    expect(d.total.cpuSeconds).toBe(10600);expect(d.total.collectorInvocations).toBe(1);
    expect(d.projections.some(r=>r.meter==='scriptFetches')).toBe(false);
  });
  it.each(measurementMeters)('refuses unknown accounting for shared allowance %s',key=>{
    const {state,p}=fixture();p.meters[key]!.measured=null;
    expect(measurementCapacity(p,state,now).ready).toBe(false);
  });
  it('cannot exempt shared costs, invent zero reports, omit deployment holds or weaken margins',()=>{
    for(const mutate of [
      (p:MeasurementPlan)=>{p.exclusions.cpuSeconds='collector disabled';},
      (p:MeasurementPlan)=>{p.meters.cpuSeconds!.safetyFraction=.1;},
      (p:MeasurementPlan)=>{p.meters.firestoreReads!.fixedRemaining=null;},
      (p:MeasurementPlan)=>{p.meters.cpuSeconds!.reserved=0;},
      (p:MeasurementPlan)=>{p.retainedDeployment.cpuSeconds=50000;},
      (p:MeasurementPlan)=>{p.meters.artifactByteMonths!.measured=400000000;},
      (p:MeasurementPlan)=>{delete p.exclusions.scriptFetches;},
      (p:MeasurementPlan)=>{p.isolation.privateApi=false;},
      (p:MeasurementPlan)=>{p.upstream.availableRequests=null;},
      (p:MeasurementPlan)=>{p.meters.cpuSeconds!.measuredAt=now-900001;},
    ]){const{state,p}=fixture();mutate(p);expect(measurementCapacity(p,state,now).ready).toBe(false);}
  });
});
describe('single-use grant and stopped ledger',()=>{
  it('preserves stop, period, daily bucket and all old fields while adding every hold',async()=>{
    const{state,p}=fixture(),store=new SqliteCache(':memory:');
    await store.commit('live-allowance',null,JSON.stringify(state));
    const result=await armMeasurement(store,p,()=>now),costs=addCosts(measurementWork(),measurementControl);
    for(const key of ['id','startsAt','expiresAt','stoppedAt','reason','day','observed','lastCollectorAt'] as const)expect(result[key]).toEqual(state[key]);
    expect(result.dailyReserved.firestoreReads).toBe(1996+costs.firestoreReads);
    expect(result.monthlyReserved.cpuSeconds).toBe(8340+costs.cpuSeconds);
    expect(result.monthlyReserved.browserRequests).toBe(222);
    expect(result.measurementRuns![p.id].priorStop).toEqual({stoppedAt:state.stoppedAt,reason:state.reason});
    await expect(armMeasurement(store,p,()=>now)).rejects.toThrow('Ledger changed');
    await store.close();
  });
  it('racing claims admit exactly once; crashes, retries and finish never refund',async()=>{
    const{state,p}=fixture(),store=new SqliteCache(':memory:');await store.commit('live-allowance',null,JSON.stringify(state));
    await armMeasurement(store,p,()=>now);
    const results=await Promise.all(Array.from({length:20},()=>new MeasurementLedger(store,()=>now).claim(p.id)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const before=JSON.parse((await store.read('live-allowance'))!);
    await new MeasurementLedger(store,()=>now).finish(p.id,{hypixelRequests:1},['timeout']);
    await new MeasurementLedger(store,()=>now).finish(p.id,{hypixelRequests:1},[]);
    const after=JSON.parse((await store.read('live-allowance'))!);
    expect(after.monthlyReserved).toEqual(before.monthlyReserved);expect(after.dailyReserved).toEqual(before.dailyReserved);
    expect(after.measurementRuns[p.id].status).toBe('failed');expect(after.observed.hypixelRequests).toBe(1);
    expect(await new MeasurementLedger(store,()=>now).claim(p.id)).toBeNull();await store.close();
  });
  it('refuses late admission and changed owner stop without erasing history',async()=>{
    const{state,p}=fixture(),store=new SqliteCache(':memory:');await store.commit('live-allowance',null,JSON.stringify(state));
    await armMeasurement(store,p,()=>now);
    expect(await new MeasurementLedger(store,()=>p.deadline).claim(p.id)).toBeNull();
    const raw=(await store.read('live-allowance'))!,changed=JSON.parse(raw);changed.reason='New owner stop';
    await store.commit('live-allowance',raw,JSON.stringify(changed));
    await expect(new MeasurementLedger(store,()=>now).claim(p.id)).rejects.toThrow('stop');await store.close();
  });
  it('does not overwrite a concurrent counter update on installation',async()=>{
    const{state,p}=fixture(),store=new SqliteCache(':memory:');await store.commit('live-allowance',null,JSON.stringify(state));
    const wrapper={...store,read:store.read.bind(store),close:store.close.bind(store),commit:async()=>false};
    await expect(armMeasurement(wrapper,p,()=>now)).rejects.toThrow('conflict');
    expect(JSON.parse((await store.read('live-allowance'))!)).toEqual(state);await store.close();
  });
});
describe('measurement runtime',()=>{
  it('public one-shot makes each network request once and stops after throttling or an error',async()=>{
    let calls=0;const n=oneShotPublicNetwork(async()=>{calls++;return Response.json({});});
    for(const url of publicMeasurementEndpoints)await n(url);
    await expect(n(publicMeasurementEndpoints[0])).rejects.toThrow('exhausted');expect(calls).toBe(3);
    const throttled=oneShotPublicNetwork(async()=>{calls++;return new Response('',{status:429});});
    await throttled(publicMeasurementEndpoints[0]);
    await expect(throttled(publicMeasurementEndpoints[1])).rejects.toThrow('exhausted');expect(calls).toBe(4);
    const failed=oneShotPublicNetwork(async()=>{throw new Error('transport');});
    await expect(failed(publicMeasurementEndpoints[0])).rejects.toThrow('transport');
    await expect(failed(publicMeasurementEndpoints[1])).rejects.toThrow('exhausted');
  });
  const network:typeof fetch=async input=>{
    const path=String(input);
    if(path.endsWith('/items'))return Response.json({success:true,items:[{id:'TEST',name:'Test'}]});
    if(path.endsWith('/election'))return Response.json({success:true,mayor:{name:'Unknown',perks:[]}});
    return Response.json({success:true,lastUpdated:now,products:{TEST:{product_id:'TEST',buy_summary:[{amount:10,pricePerUnit:10,orders:2}],sell_summary:[{amount:10,pricePerUnit:11,orders:2}],quick_status:{buyPrice:10,sellPrice:11,buyVolume:10,sellVolume:10}}}});
  };
  it('collects once through real bounded Google transport, with no presence or cleanup',async()=>{
    const{state,p}=fixture(),g=offlineGoogle(()=>now);g.seed('live-allowance',JSON.stringify(state));
    Object.assign(p.upstream,{availableRequests:null,sharedUsageBound:null,
      publicOneShot:{maxAttempts:3,retries:0,endpoints:publicMeasurementEndpoints,exclusiveUseEvidence:'Synthetic exclusive operator'}});
    const factory=(session?:any,onAttempt?:any)=>trialGoogleStore({project:'offline',bucket:'offline',token:async()=>'offline',network:g.network,inlineSmallSnapshots:true,onAttempt},session);
    // GoogleCacheStore uses the test response's server clock; keep it consistent.
    await armMeasurement(factory(),p,()=>now);
    const receipts:any[]=[];let checks=0;
    const runtime=createMeasurementRuntime({id:p.id,store:factory,network,now:()=>now,verifyContained:async()=>{checks++;},report:r=>receipts.push(r)});
    await runtime.collect('ordinary-scheduler-job');expect(checks).toBe(0);
    await runtime.collect(`measurement:${p.id}`);
    await runtime.collect(`measurement:${p.id}`);
    const after=JSON.parse(g.read('live-allowance')!);
    expect(after.measurementRuns[p.id].status).toBe('complete');expect(after.stoppedAt).toBe(state.stoppedAt);
    expect(receipts).toHaveLength(1);expect(receipts[0].observed.bazaarRefreshesCompleted).toBe(1);
    expect(receipts[0].observed.hypixelRequests).toBe(3);expect(g.counts.uploads??0).toBe(0);
    expect(after.visible).toBeUndefined();expect(g.read('cleanup')).toBeUndefined();
  });
  it('source gates stay false and the special handler has a 90 second timeout',()=>{
    const source=readFileSync('market-functions/src/index.ts','utf8');
    expect(source).toContain("if (measurement) { await measurementRuntime.collect(event.jobName ?? ''); return; }");
    expect(source).toContain('timeoutSeconds: live || paid || measurement ? 90 : 180');
    expect(readFileSync('shared/companion/portfolio-policy.ts','utf8')).toContain('PORTFOLIO_COLLECTION_ENABLED = false');
  });
  it('throttling consumes the grant, preserves the owner stop and cannot start another cycle',async()=>{
    const{state,p}=fixture(),store=new SqliteCache(':memory:');await store.commit('live-allowance',null,JSON.stringify(state));
    await armMeasurement(store,p,()=>now);let requests=0;
    const runtime=createMeasurementRuntime({store:()=>store,now:()=>now,verifyContained:async()=>{},network:async()=>{
      requests++;return Response.json({success:false},{status:429,headers:{'Retry-After':'60'}});
    }});
    await expect(runtime.collect(`measurement:${p.id}`)).rejects.toThrow('did not complete');
    await runtime.collect(`measurement:${p.id}`);
    const saved=JSON.parse((await store.read('live-allowance'))!);
    expect(requests).toBe(1);expect(saved.measurementRuns[p.id].status).toBe('failed');
    expect(saved.stoppedAt).toBe(state.stoppedAt);expect(saved.monthlyReserved.cpuSeconds).toBe(8940);await store.close();
  });
  it('aborts further upstream work at the work deadline and retains its full hold',async()=>{
    const{state,p}=fixture(),store=new SqliteCache(':memory:');let clock=now,requests=0;
    await store.commit('live-allowance',null,JSON.stringify(state));await armMeasurement(store,p,()=>clock);
    const runtime=createMeasurementRuntime({store:()=>store,now:()=>clock,verifyContained:async()=>{},network:async()=>{
      requests++;clock+=61000;return Response.json({success:true,items:[]});
    }});
    await expect(runtime.collect(`measurement:${p.id}`)).rejects.toThrow(/deadline|lease/);
    expect(requests).toBe(1);
    const saved=JSON.parse((await store.read('live-allowance'))!);
    expect(saved.measurementRuns[p.id].status).toBe('failed');expect(saved.monthlyReserved.cpuSeconds).toBe(8940);await store.close();
  });
});
