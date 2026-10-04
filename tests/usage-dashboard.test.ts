import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { SqliteCache } from '../collector/cache-store';
import { allowanceMath, authorizedOwner, buildMeasurement, mailMeasurement, repositoryStorageMeasurement, missingMeasurement, cachedDashboard, collectionStatus, measureDashboard, MEASUREMENT_TTL, periods, summarizeSeries, usageHandler } from '../collector/usage-dashboard';
import { currentStatus, imageStorageEstimate, needsAttention, projectionStatus, sortResources } from '../shared/usage-presentation';
import type { UsageRow } from '../shared/usage-dashboard';
import { liveDailyMaximums, liveMaximums, pacificDay } from '../collector/allowance-live';
import type { UsageDashboard } from '../shared/usage-dashboard';
import { HOURLY_TRIAL_START, HOURLY_TRIAL_END } from '../shared/hourly-trial';
const now=Date.parse('2026-10-02T16:00:00Z');
const owner={sub:'owner',email:'drewstake3@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'},aud:'bazaarsignal',iss:'https://securetoken.google.com/bazaarsignal',exp:now/1000+3600};
const snapshot={generatedAt:now,nextMeasurementAt:now+MEASUREMENT_TTL,rows:[],spending:{month:null,total:null},collection:{state:'Active'}} as unknown as UsageDashboard;
const stores:SqliteCache[]=[];
it('reports the bounded hourly test, automatic fallback and hard stop without claiming low pressure',()=>{
  const ledger={version:1 as const,id:'free-test',startsAt:HOURLY_TRIAL_START-1,expiresAt:HOURLY_TRIAL_END+86400000,
    monthlyLimits:{...liveMaximums},monthlyReserved:{cpuSeconds:80000},dailyLimits:{...liveDailyMaximums},dailyReserved:{},
    day:pacificDay(HOURLY_TRIAL_START),observed:{},evidence:'offline fixture'};
  const active=collectionStatus(ledger,null,'ENABLED',HOURLY_TRIAL_START);
  expect(active.state).toBe('Hourly test');expect(active.hourlyTrialEndsAt).toBe(HOURLY_TRIAL_END);
  expect(active.pressure).toBeGreaterThan(.65);expect(active.reason).toContain('90%');
  const after=collectionStatus(ledger,null,'ENABLED',HOURLY_TRIAL_END);
  expect(after.state).toBe('Warning');expect(after.hourlyTrialEndsAt).toBeUndefined();
  expect(collectionStatus(ledger,null,'PAUSED',HOURLY_TRIAL_START).state).toBe('Paused');
  expect(collectionStatus({...ledger,stoppedAt:HOURLY_TRIAL_START},null,'ENABLED',HOURLY_TRIAL_START).hourlyTrialEndsAt).toBeUndefined();
});
afterEach(async()=>{for(const s of stores.splice(0))await s.close();});
function store(){const s=new SqliteCache(':memory:');stores.push(s);return s;}
it('requires a verified Google owner from the correct signed Firebase token',()=>{
  expect(authorizedOwner(owner,now)).toBe(true);
  for(const patch of [{email:'other@gmail.com'},{email_verified:false},{firebase:{sign_in_provider:'password'}},{aud:'another-project'},{iss:'https://accounts.google.com'},{sub:''},{exp:now/1000}])expect(authorizedOwner({...owner,...patch},now)).toBe(false);
});
it('rejects direct unsigned, expired, revoked, forged and non-owner requests before loading any dashboard data',async()=>{
  const dashboard=vi.fn(async()=>snapshot);let time=now;
  const verify=vi.fn(async(token:string)=>{
    if(token.includes('forged')||token.includes('revoked'))throw new Error('Invalid signature or revoked');
    return token.includes('other')?{...owner,email:'other@gmail.com'}:token.includes('expired')?{...owner,exp:now/1000-1}:owner;
  });
  const server=createServer(usageHandler({verify,dashboard,now:()=>time}));
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  const call=(token?:string,method='GET')=>fetch(base+'/?email=drewstake3@gmail.com&uid=owner',{method,headers:token?{Authorization:`Bearer ${token.padEnd(30,'a')}`}:{}});
  try {
    expect((await call()).status).toBe(401);
    expect((await call('forged')).status).toBe(401);
    expect((await call('revoked')).status).toBe(401);
    expect((await call('expired')).status).toBe(403);
    expect((await call('other')).status).toBe(403);
    expect((await call('owner','POST')).status).toBe(405);
    expect(dashboard).not.toHaveBeenCalled();
    const good=await call('owner');expect(good.status).toBe(200);expect(good.headers.get('cache-control')).toContain('no-store');
    expect(await good.json()).toEqual(snapshot);
    expect((await call('owner')).status).toBe(429);
    time+=60000;expect((await call('owner')).status).toBe(200);
    // Authentication is checked again even for cached responses.
    expect((await call('revoked')).status).toBe(401);
  } finally {await new Promise<void>(r=>server.close(()=>r()));}
});
it('preserves nulls for absent, partial, invalid or delayed counters and sums gauges only once per series',()=>{
  expect(summarizeSeries({},false).state).toBe('not-reported');
  expect(summarizeSeries({error:'denied'},false).value).toBeNull();
  expect(summarizeSeries({nextPageToken:'more'},false).value).toBeNull();
  const points=[{interval:{endTime:'2026-10-02T12:00:00Z'},value:{int64Value:'6'}},{interval:{endTime:'2026-10-02T11:00:00Z'},value:{int64Value:'4'}}];
  expect(summarizeSeries({timeSeries:[{points}]},true).value).toBe(6);
  expect(summarizeSeries({timeSeries:[{points}]},false).value).toBe(10);
  expect(summarizeSeries({timeSeries:[{points:[{...points[0],value:{}}]}]},false).value).toBeNull();
  expect(summarizeSeries({timeSeries:[{points:[{...points[0],value:{int64Value:'0'}}]}]},false).value).toBe(0);
});
it('calculates allowance percentage and projections without inventing missing consumption',()=>{
  expect(allowanceMath(null,100,0,7200000,3600000)).toEqual({percent:null,remaining:null,projected:null});
  expect(allowanceMath(30,100,0,7200000,3600000)).toEqual({percent:30,remaining:70,projected:60});
  expect(allowanceMath(120,100,0,7200000,3600000).remaining).toBe(0);
  expect(allowanceMath(30,100,0,7200000,3600000,true).projected).toBeNull();
  expect(allowanceMath(30,100,0,7200000,1000).projected).toBeNull();
});
it('uses Pacific daily and monthly reset boundaries including DST transitions',()=>{
  expect(periods(Date.parse('2026-10-02T06:59:00Z')).day[0]).toBe(Date.parse('2026-10-01T07:00:00Z'));
  expect(periods(Date.parse('2026-10-02T07:01:00Z')).day[0]).toBe(Date.parse('2026-10-02T07:00:00Z'));
  const fall=periods(Date.parse('2026-11-01T15:00:00Z')).day;
  expect(fall[1]-fall[0]).toBe(25*3600000);
});
it('coalesces concurrent refreshes and retains measurement throttle across process restarts without changing the market ledger',async()=>{
  const s=store();await s.commit('live-allowance',null,'existing-ledger');
  let time=now;const measure=vi.fn(async()=>({...snapshot,generatedAt:time,nextMeasurementAt:time+MEASUREMENT_TTL}));
  const first=cachedDashboard(s,measure,()=>time);
  await Promise.all(Array.from({length:20},()=>first()));expect(measure).toHaveBeenCalledOnce();
  time+=60001;await cachedDashboard(s,measure,()=>time)();expect(measure).toHaveBeenCalledOnce();
  expect(await s.read('live-allowance')).toBe('existing-ledger');
  time+=MEASUREMENT_TTL;await first();expect(measure).toHaveBeenCalledTimes(2);
});
it('reserves a failed measurement slot durably and never immediately retries after eviction',async()=>{
  const s=store(),measure=vi.fn(async()=>{throw new Error('upstream');});
  await expect(cachedDashboard(s,measure,()=>now)()).rejects.toThrow('upstream');
  await expect(cachedDashboard(s,measure,()=>now+60000)()).rejects.toThrow('progress');
  expect(measure).toHaveBeenCalledOnce();
});
it('one CAS lease wins across independent cache instances',async()=>{
  const s=store(),measure=vi.fn(async()=>snapshot);
  const result=await Promise.allSettled([cachedDashboard(s,measure,()=>now)(),cachedDashboard(s,measure,()=>now)()]);
  expect(result.some(x=>x.status==='fulfilled')).toBe(true);expect(measure).toHaveBeenCalledOnce();
});
it('reads status and reservations without resetting counters, collecting, or converting missing billing into zero',async()=>{
  const s=store();
  const ledger={version:1,id:'free-test',startsAt:now-1000,expiresAt:now+86400000,evidence:'fixture',monthlyLimits:liveMaximums,monthlyReserved:{cpuSeconds:110},dailyLimits:liveDailyMaximums,dailyReserved:{firestoreReads:12},day:pacificDay(now),observed:{}};
  const raw=JSON.stringify(ledger);await s.commit('live-allowance',null,raw);
  const network=vi.fn(async(url:any)=>{
    expect(String(url)).toMatch(/^https:\/\/(monitoring|cloudscheduler|firestore|cloudbuild|artifactregistry)\.googleapis\.com\//);
    const u=new URL(String(url));
    if(u.hostname==='monitoring.googleapis.com') {
      expect(u.searchParams.get('view')).toBe('FULL');
      if(u.searchParams.has('aggregation.perSeriesAligner'))expect(Date.parse(u.searchParams.get('interval.endTime')!)%3600000).toBe(0);
    }
    return new Response(JSON.stringify({}));
  });
  const d=await measureDashboard({store:s,network,token:async()=>'server-only-secret',now:()=>now});
  expect(d.spending.month).toBeNull();expect(d.spending.total).toBeNull();
  expect(JSON.stringify(d)).not.toContain('server-only-secret');
  expect(d.rows.find(r=>r.id==='run-cpu')?.reservation).toBe(110);
  expect(d.rows.find(r=>r.id==='run-cpu')?.measured).toBeNull();
  expect(await s.read('live-allowance')).toBe(raw);
  expect(network.mock.calls.length).toBeLessThan(35);
  expect(collectionStatus({...ledger,monthlyReserved:{cpuSeconds:80000}},null,'ENABLED',now).state).toBe('Warning');
  expect(collectionStatus({...ledger,stoppedAt:now,reason:'budget reached'},null,'PAUSED',now).state).toBe('Paused');
  expect(collectionStatus(ledger,null,'ENABLED',now+86400001).state).toBe('Expired');
});

it('distinguishes denied permissions, disabled APIs, no samples and bounded partial results',()=>{
  expect(missingMeasurement({error:'denied',status:403}).coverage).toBe('permission');
  expect(missingMeasurement({error:'disabled',status:403,reason:'SERVICE_DISABLED'}).coverage).toBe('setup');
  expect(missingMeasurement({nextPageToken:'more'}).coverage).toBe('incomplete');
  expect(missingMeasurement({}).coverage).toBe('delay');
  expect(missingMeasurement({error:'timeout'}).value).toBeNull();
});
it('reads saved MailApp remaining quota without inferring sends or resetting its unknown rolling window',()=>{
  const doc=(quota:unknown,at=now-300000)=>({fields:{json:{stringValue:JSON.stringify({monitor:{quota,lastAttempt:at},cursor:'PRIVATE-USER'})}}});
  expect(mailMeasurement(doc(87),now)).toMatchObject({state:'measured',value:13,at:now-300000});
  expect(mailMeasurement(doc(100),now).value).toBe(0);
  expect(mailMeasurement(doc(0),now).value).toBe(100);
  for(const value of [null,undefined,-1,101,'100',NaN])expect(mailMeasurement(doc(value),now).value).toBeNull();
  for(const at of [now-31*60000,now+1])expect(mailMeasurement(doc(100,at),now).value).toBeNull();
  expect(JSON.stringify(mailMeasurement(doc(87),now))).not.toContain('PRIVATE-USER');
});
it('counts completed and failed build durations only within the reporting period, refusing partial or in-progress totals',()=>{
  const start=now-3600000,build=(a:number,b:number,status='SUCCESS')=>({startTime:new Date(a).toISOString(),finishTime:new Date(b).toISOString(),status});
  expect(buildMeasurement([{builds:[build(start-60000,start+60000),build(start+60000,start+180000,'FAILURE')]}],start,now,now).value).toBe(3);
  expect(buildMeasurement([{},{}],start,now,now).value).toBe(0); // Successful empty inventory in explicitly named regions.
  expect(buildMeasurement([{error:'denied',status:403}],start,now,now).coverage).toBe('permission');
  expect(buildMeasurement([{nextPageToken:'more'}],start,now,now).value).toBeNull();
  expect(buildMeasurement([{builds:[{startTime:new Date(start).toISOString(),status:'WORKING'}]}],start,now,now).value).toBeNull();
  expect(buildMeasurement([{builds:[{...build(start,start+60000),options:{machineType:'E2_HIGHCPU_8'}}]}],start,now,now)).toMatchObject({value:1,comparable:false});
});
it('separates measured allowance status, projection risk, unknowns, and storage-only cost estimates',()=>{
  const row={id:'test',resource:'Test',state:'measured',measured:79,allowance:100,projected:110,kind:'monthly',periodLabel:'Monthly'} as UsageRow;
  expect(currentStatus(row)).toBe('Within allowance');expect(projectionStatus(row)).toBe('Over allowance');expect(needsAttention(row)).toBe(true);
  expect(currentStatus({...row,measured:80})).toBe('Getting close');expect(currentStatus({...row,measured:100})).toBe('Getting close');expect(currentStatus({...row,measured:101})).toBe('Over allowance');
  for(const patch of [{measured:null},{measured:NaN},{measured:-1},{allowance:0},{allowance:null},{allowance:Infinity},{allowanceComparable:false},{state:'not-reported'}])expect(currentStatus({...row,...patch} as UsageRow)).toBe('Unknown');
  expect(currentStatus(row,true)).toBe('Unknown');expect(needsAttention(row,true)).toBe(false);
  expect(projectionStatus({...row,kind:'rolling'})).toBe('Unknown');expect(projectionStatus({...row,kind:'capacity'})).toBe('Unknown');
  expect(sortResources([{...row,id:'healthy',projected:50},{...row,id:'unknown',measured:null},{...row,id:'over',measured:110},row]).map(r=>r.id)).toEqual(['over','healthy','test','unknown']);
  expect(imageStorageEstimate({...row,id:'images',measurementBasis:'artifact-registry-sizeBytes',measured:.75*1024**3})).toBeCloseTo(.025,5);
  expect(imageStorageEstimate({...row,id:'images',measured:null})).toBeNull();
  expect(allowanceMath(5,-10,0,7200000,3600000).percent).toBeNull();
});

it('sorts by reported percentage rather than raw usage or projected risk, with unknowns last',()=>{
  const base={resource:'Test',state:'measured',projected:null,kind:'monthly',periodLabel:'Monthly'} as UsageRow;
  const rows=[
    {...base,id:'low',measured:9000,allowance:100000,projected:200000},
    {...base,id:'high',measured:1,allowance:2},
    {...base,id:'unknown',measured:null,allowance:100},
    {...base,id:'zero',measured:0,allowance:100},
    {...base,id:'incomparable',measured:900,allowance:1,allowanceComparable:false},
  ];
  expect(sortResources(rows).map(r=>r.id)).toEqual(['high','low','zero','incomparable','unknown']);
  expect(rows[0].id).toBe('low');
});

it('uses repository storage-cost metadata, rejects missing/invalid totals and never falls back to the Monitoring image gauge',async()=>{
  expect(repositoryStorageMeasurement({sizeBytes:'284076588'},now)).toEqual({value:284076588,at:now,state:'measured'});
  expect(repositoryStorageMeasurement({sizeBytes:'0'},now).value).toBe(0);
  for(const sizeBytes of [null,undefined,'',' ','-1','1.5','Infinity','9007199254740992',0])expect(repositoryStorageMeasurement({sizeBytes},now).value).toBeNull();
  expect(repositoryStorageMeasurement({error:'denied',status:403},now).coverage).toBe('permission');
  const urls:string[]=[];
  const result=await measureDashboard({store:store(),token:async()=>'fixture',now:()=>now,network:async(url:any)=>{
    urls.push(String(url));return new Response(JSON.stringify(String(url).startsWith('https://artifactregistry.googleapis.com/')?{sizeBytes:'284076588'}:{}));
  }});
  const row=result.rows.find(r=>r.id==='images')!;
  expect(row).toMatchObject({measurementBasis:'artifact-registry-sizeBytes',measured:284076588,projected:null,resetAt:null});
  expect(row.percent).toBeCloseTo(52.9134,3);expect(currentStatus(row)).toBe('Within allowance');expect(imageStorageEstimate(row)).toBe(0);
  expect(urls.filter(u=>u.includes('artifactregistry.googleapis.com/v1/'))).toHaveLength(1);
  expect(urls.some(u=>u.includes('repository%2Fsize'))).toBe(false);
});

it('retires legacy image warnings on cached reads without collecting, rewriting the snapshot or shortening its lease',async()=>{
  const s=store(),legacy={...snapshot,rows:[{id:'images',state:'measured',measured:791515006,allowance:536870912,percent:147,remaining:0,projected:null} as UsageRow]};
  const stored=JSON.stringify({nextAttemptAt:now+MEASUREMENT_TTL,snapshot:legacy});
  await s.commit('usage-dashboard',null,stored);await s.commit('live-allowance',null,'existing-ledger');
  const measure=vi.fn(async()=>snapshot),result=await cachedDashboard(s,measure,()=>now)();
  expect(result.nextMeasurementAt).toBe(legacy.nextMeasurementAt);
  expect(result.rows[0]).toMatchObject({state:'unavailable',measured:null,percent:null,remaining:null,projected:null,measuredAt:null});
  expect(currentStatus(legacy.rows[0])).toBe('Unknown');expect(imageStorageEstimate(legacy.rows[0])).toBeNull();
  expect(await s.read('usage-dashboard')).toBe(stored);expect(await s.read('live-allowance')).toBe('existing-ledger');expect(measure).not.toHaveBeenCalled();
});
