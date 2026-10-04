import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import type { CacheStore } from './cache-store';
import { pacificDay, validateLive, livePressure, collectorBudgetDeferral, type LiveAllowanceState } from './allowance-live';
import { hourlyTrialActive, HOURLY_TRIAL_END } from '../shared/hourly-trial';
import type { UsageDashboard, UsageRow } from '../shared/usage-dashboard';
import { verifiedUsageSnapshot } from '../shared/usage-dashboard';
import { APP_BUDGET_PAUSE_DESCRIPTION } from '../shared/app-budget-policy';

export const OWNER_EMAIL = 'drewstake3@gmail.com';
export const MEASUREMENT_TTL = 30 * 60_000;
export function authorizedOwner(t: any, now = Date.now()) {
  return t?.email === OWNER_EMAIL && t.email_verified === true &&
    t.firebase?.sign_in_provider === 'google.com' && typeof t.sub === 'string' && t.sub.length > 0 &&
    t.aud === 'bazaarsignal' && t.iss === 'https://securetoken.google.com/bazaarsignal' &&
    Number.isFinite(t.exp) && t.exp * 1000 > now;
}
// Calendar boundaries follow Pacific billing/Firestore days, including DST.
export function pacificMidnight(date: string) {
  const target = Date.parse(`${date}T00:00:00Z`);
  let result = target + 8 * 3600_000;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles',
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(result);
    const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
    result += target - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  }
  return result;
}
export function periods(now: number) {
  const day = pacificDay(now), [y,m,d] = day.split('-').map(Number);
  const iso = (date: Date) => date.toISOString().slice(0,10);
  return {day:[pacificMidnight(day),pacificMidnight(iso(new Date(Date.UTC(y,m-1,d+1))))],
    month:[pacificMidnight(`${day.slice(0,7)}-01`),pacificMidnight(iso(new Date(Date.UTC(y,m,1))))]};
}
export function allowanceMath(value: number | null, allowance: number | null, start: number, end: number, at: number, gauge=false) {
  const valid = value !== null && Number.isFinite(value) && value >= 0;
  const limit = allowance !== null && Number.isFinite(allowance) && allowance > 0;
  return {percent:valid && limit ? value / allowance * 100 : null,
    remaining:valid && limit ? Math.max(0,allowance-value) : null,
    projected:valid && !gauge && end > start && at-start >= 3600_000 && at <= end ? value*(end-start)/(at-start) : null};
}

type Measurement = {value:number|null;at:number|null;state:UsageRow['state'];comparable?:boolean;coverage?:UsageRow['coverage'];coverageDetail?:string};
export function missingMeasurement(data:any):Measurement {
  const code=data?.status, reason=data?.reason;
  const coverage:UsageRow['coverage']=reason==='SERVICE_DISABLED'||code===404?'setup':code===401||code===403?'permission':data?.nextPageToken?'incomplete':data?.error?'error':'delay';
  return {value:null,at:null,state:coverage==='delay'?'not-reported':'unavailable',coverage,coverageDetail:{
    setup:'The API or measurement source is not configured. No service was enabled.',
    permission:'The reporting service lacks read permission for this source.',
    incomplete:'The response exceeded the bounded page limit; a partial total is not shown.',
    error:'The source could not be read. Retry after the shared cache interval.',
    delay:'Google returned no samples for this period. This can mean reporting delay or no recorded activity; it does not verify zero.',
    'not-exposed':'Google does not expose this quota through an API.',
  }[coverage]};
}

export function buildMeasurement(pages:any[],start:number,end:number,now:number):Measurement {
  for(const page of pages)if(page.error||page.nextPageToken)return missingMeasurement(page);
  let minutes=0,comparable=true;
  for(const build of pages.flatMap(p=>p.builds??[])) {
    const from=Date.parse(build.startTime),to=Date.parse(build.finishTime);
    if(!Number.isFinite(from)) {
      if(['QUEUED','PENDING','CANCELLED','EXPIRED'].includes(build.status)&&!build.finishTime)continue;
      return missingMeasurement({error:'Missing build timing'});
    }
    if(from>=end || (Number.isFinite(to)&&to<=start))continue;
    if(!Number.isFinite(to)||to<from)return missingMeasurement({error:'Incomplete build timing'});
    if(build.options?.pool?.name||build.options?.workerPool||!['UNSPECIFIED','E2_STANDARD_2'].includes(build.options?.machineType??'UNSPECIFIED'))comparable=false;
    minutes+=(Math.min(to,end)-Math.max(from,start))/60000;
  }
  return {value:minutes,at:now,state:'measured',comparable};
}

export function mailMeasurement(doc:any,now:number):Measurement {
  if(doc.error)return missingMeasurement(doc);
  let worker:any;try{worker=JSON.parse(doc.fields?.json?.stringValue);}catch{return missingMeasurement({status:404});}
  const at=worker.monitor?.lastAttempt,remaining=worker.monitor?.quota;
  if(typeof at!=='number'||at>now||now-at>30*60000)return {...missingMeasurement({}),coverageDetail:'The saved MailApp reading is missing or older than 30 minutes. The existing alert worker will update it; dashboard refresh never runs the worker.'};
  if(typeof remaining!=='number'||!Number.isInteger(remaining)||remaining<0||remaining>100)return missingMeasurement({error:'Invalid quota'});
  return {value:100-remaining,at,state:'measured'};
}

export function repositoryStorageMeasurement(data:any,now:number):Measurement {
  if(data.error)return missingMeasurement(data);
  // REST int64 fields are strings. Missing/invalid storage must never become zero.
  if(typeof data.sizeBytes !== 'string' || !/^\d+$/.test(data.sizeBytes) || !Number.isSafeInteger(Number(data.sizeBytes)))
    return {...missingMeasurement({error:'Invalid repository storage'}),coverageDetail:'Google did not return a valid repository storage total. Missing storage is not zero.'};
  return {value:Number(data.sizeBytes),at:now,state:'measured'};
}

interface Spec { id:string; project:string; resource:string; purpose:string; unit:string;
  metric?:string; gauge?:boolean; daily?:boolean; limit?:number; scope?:string; allowance?:string;
  key?:string; filter?:string; divisor?:number; note?:string; url?:string }
const main='bazaarsignal', cloud='bazaarsignal-510305', GiB=1024**3;
const free='https://docs.cloud.google.com/free/docs/free-cloud-features#free-tier-usage-limits';
const run='https://cloud.google.com/run/pricing';
export function usageSpecs():Spec[] {
  const specs:Spec[] = [
    {id:'run-requests',project:cloud,resource:'Cloud Run requests',purpose:'Shared cache API and scheduled collector',unit:'requests',metric:'run.googleapis.com/request_count',limit:2_000_000,key:'runRequests',url:run},
    {id:'run-cpu',project:cloud,resource:'Cloud Run CPU',purpose:'Collector and API allocated compute time',unit:'vCPU-s',metric:'run.googleapis.com/container/cpu/allocation_time',limit:180_000,key:'cpuSeconds',url:run,note:'Operational allocation time; billing rounding, startup and credits can differ. Request-based free tier.'},
    {id:'run-memory',project:cloud,resource:'Cloud Run memory',purpose:'Collector and API allocated memory time',unit:'GiB-s',metric:'run.googleapis.com/container/memory/allocation_time',limit:360_000,key:'memoryGiBSeconds',url:run,note:'Operational allocation time in GiB-seconds; not a cost record.'},
    {id:'run-network',project:cloud,resource:'Cloud Run bandwidth',purpose:'Cache responses and outgoing provider requests',unit:'bytes',metric:'run.googleapis.com/container/network/sent_bytes_count',limit:GiB,key:'egressBytes',url:run,note:'All observed sent bytes compared conservatively with 1 GiB eligible North American Internet transfer. Destination eligibility is unverified; internal traffic may be free.'},
    {id:'storage-a',project:cloud,resource:'Cloud Storage Class A',purpose:'Snapshot uploads and cleanup listings',unit:'operations',metric:'storage.googleapis.com/api/request_count',filter:'metric.labels.method = one_of("WriteObject", "ListObjects")',limit:5000,key:'storageClassA',note:'Measured WriteObject + ListObjects calls; other Class A methods and other account projects are not included. Remaining is an upper bound.'},
    {id:'storage-b',project:cloud,resource:'Cloud Storage Class B',purpose:'Read cached snapshots',unit:'operations',metric:'storage.googleapis.com/api/request_count',filter:'metric.labels.method = one_of("ReadObject", "GetObject", "GetBucket")',limit:50000,key:'storageClassB',note:'Measured read/get calls; other Class B methods and other account projects are not included. Remaining is an upper bound.'},
    {id:'storage-capacity',project:cloud,resource:'Cloud Storage capacity',purpose:'Private compressed market snapshots and retained objects',unit:'bytes',metric:'storage.googleapis.com/storage/total_bytes',gauge:true,limit:5*GiB,allowance:'5 GiB-month eligible regional Standard storage',note:'Latest capacity, not integrated GiB-month billing. Eligible US regions only; soft-deleted storage may be reported separately.'},
    {id:'storage-transfer',project:cloud,resource:'Cloud Storage transfer',purpose:'Snapshot downloads to the collector and API',unit:'bytes',metric:'storage.googleapis.com/network/sent_bytes_count',limit:100*GiB,key:'storageEgressBytes',note:'Gross sent bytes, not billed Internet egress. Same-region bucket-to-Run transfer is internal. 100 GiB applies to eligible North America destinations, excluding China/Australia. The app reserves internal gross reads separately.'},
    {id:'scheduler',project:cloud,resource:'Cloud Scheduler',purpose:'Existing scheduled collector job',unit:'jobs',gauge:true,limit:3,note:'Regional inventory; billing allowance covers 3 jobs across the billing account. Paused jobs still count.'},
    {id:'builds',project:cloud,resource:'Cloud Build',purpose:'Build time in the deployment regions',unit:'minutes',limit:2500,url:'https://cloud.google.com/build/pricing',note:'Measured elapsed build time in us-central1 and global, including failed builds and period overlaps. Other regions/projects are not covered. The 2,500-minute allowance applies only to eligible e2-standard-2 default-pool builds; billing rounding and machine eligibility can differ. No usage-rate projection for irregular builds.'},
    {id:'images',project:cloud,resource:'Container images',purpose:'Artifact Registry deployment images',unit:'bytes',gauge:true,limit:.5*GiB,allowance:'0.5 GiB-month storage',url:'https://cloud.google.com/artifact-registry/pricing',note:'Repository gcf-artifacts in us-central1. Google documents repository sizeBytes as the storage total used to calculate storage costs. Includes retained image layers and build caches; shared layers are not summed per image. Current capacity is not month-average storage or an actual charge.'},
    {id:'hosting-storage',project:main,resource:'Hosting storage',purpose:'Website assets and retained releases',unit:'bytes',metric:'firebasehosting.googleapis.com/storage/total_bytes',gauge:true,limit:10*1000**3,scope:'Per Firebase project',url:'https://firebase.google.com/pricing'},
    {id:'hosting-transfer',project:main,resource:'Hosting transfer',purpose:'Website page and asset downloads',unit:'bytes',metric:'firebasehosting.googleapis.com/network/sent_bytes_count',limit:10*GiB,scope:'Per Firebase project · Spark',url:'https://firebase.google.com/docs/hosting/usage-quotas-pricing',note:'10 GiB monthly Spark enforcement limit verified with the project monthly_sent_limit metric. Published Blaze no-cost pricing uses 360 MB/day; this project has billing disabled.'},
    {id:'auth',project:main,resource:'Google authentication',purpose:'Signed-in accounts and private access',unit:'new active users',metric:'identitytoolkit.googleapis.com/usage/monthly_new_signin_count',scope:'Per Firebase project',allowance:'Google sign-in is no-cost; provider/rate quotas also apply',note:'Monthly new-active-user events where reported. Not a count of stored users.',url:'https://firebase.google.com/pricing'},
  ];
  for (const project of [main,cloud]) {
    for (const [kind,limit,key] of [['read',50000,'firestoreReads'],['write',20000,'firestoreWrites'],['delete',20000,'firestoreDeletes']] as const)
      specs.push({id:`${project}-${kind}`,project,resource:`Firestore ${kind}s`,purpose:project===main?'Private saved items, preferences and alert records':'Collector coordination, allowance ledger and snapshot pointers',unit:'operations',metric:`firestore.googleapis.com/document/${kind}_ops_count`,daily:true,limit,scope:'Per project, one eligible database',key:project===cloud?key:undefined});
    specs.push({id:`${project}-db`,project,resource:'Firestore storage',purpose:project===main?'Private user data and alerts':'Shared coordination and cache pointers',unit:'bytes',metric:'firestore.googleapis.com/storage/data_and_index_storage_bytes',gauge:true,limit:GiB,scope:'Per project, one eligible database',note:'Latest reported documents and indexes; typically delayed.'});
    specs.push({id:`${project}-logs`,project,resource:'Cloud Logging',purpose:'Application and infrastructure logs',unit:'bytes',metric:'logging.googleapis.com/billing/bytes_ingested',limit:50*GiB,scope:'Per project',key:project===cloud?'logBytes':undefined});
  }
  for (const [id,resource,unit,limit,note] of [
    ['script-runtime','Apps Script trigger runtime','minutes',90,'Consumer account quota resets 24 hours after the first request. The existing 70-minute/day worker safeguard excludes lightweight off-slot ticks. Total Google runtime is not available through this API.'],
    ['script-fetch','Apps Script URL Fetch','calls',20000,'Consumer sender account, shared across its scripts. Google provides no remaining URL Fetch quota API.'],
    ['script-mail','Apps Script email recipients','recipients',100,'Allowance consumed is 100 minus the remaining recipient quota reported by MailApp and saved by the existing worker. Shared across the consumer sender account. Google does not expose the exact quota reset time.'],
  ] as const) specs.push({id,project:main,resource,purpose:'Email alert backend',unit,limit,daily:true,scope:'Per sender account; rolling 24-hour reset',note,url:'https://developers.google.com/apps-script/guides/services/quotas'});
  return specs;
}

export function summarizeSeries(data:any, gauge:boolean, divisor=1):Measurement {
  if (data.error || data.nextPageToken) return missingMeasurement(data);
  const series=data.timeSeries;
  if (!Array.isArray(series) || !series.length) return missingMeasurement({});
  let value=0, at=Infinity;
  for (const s of series) {
    const points=[...(s.points??[])].sort((a,b)=>Date.parse(b.interval.endTime)-Date.parse(a.interval.endTime));
    if (!points.length) return missingMeasurement({});
    at=Math.min(at,Date.parse(points[0].interval.endTime));
    for (const p of gauge?points.slice(0,1):points) {
      const n=Number(p.value?.int64Value??p.value?.doubleValue??NaN);
      if (!Number.isFinite(n) || n<0 || !Number.isFinite(at)) return missingMeasurement({error:'Invalid sample'});
      value+=n/divisor;
    }
  }
  return {value,at,state:'measured'};
}
export function collectionStatus(ledger:LiveAllowanceState|null, control:any, scheduler:string, now:number):UsageDashboard['collection'] {
  let state='Unavailable',reason='Allowance ledger could not be read.',pressure:number|null=null,budgetRetryAt:number|null=null;
  if (ledger) {
    try {
      validateLive(ledger,now);
      pressure=livePressure(ledger,now);
      state=hourlyTrialActive(now)?'Hourly test':pressure>=.5?'Warning':'Active';
      reason=(hourlyTrialActive(now)?'Hourly collection opportunities and browser checks during the temporary test. ':'Collection cadence follows resource capacity; auction collection is disabled. ')+APP_BUDGET_PAUSE_DESCRIPTION;
      const wait=collectorBudgetDeferral(ledger,now);
      if(wait){budgetRetryAt=wait.retryAt;state='Paused';reason=`The next collection reservation would reach the app budget pause threshold for ${wait.key}. No counters were cleared. ${APP_BUDGET_PAUSE_DESCRIPTION}`;}
    } catch { state=ledger.expiresAt<=now?'Expired':'Paused'; reason=ledger.reason??'Application allowance is missing, invalid, stopped or expired.'; }
  }
  if (scheduler==='PAUSED') {state='Paused';reason='Cloud Scheduler is paused.';}
  const jobs=Object.values(control?.jobs??{}) as any[];
  return {state,reason,pressure,reviewAt:ledger?.expiresAt??null,
    ...(['Hourly test','Waiting for budget'].includes(state)&&hourlyTrialActive(now)?{hourlyTrialEndsAt:HOURLY_TRIAL_END}:{}),
    lastSuccessAt:Math.max(0,...jobs.map(j=>j.lastCheckedAt??j.observedAt??0))||null,
    nextCollectionAt:budgetRetryAt??(jobs.length?Math.min(...jobs.map(j=>j.nextAt).filter(Number.isFinite))||null:null),
    scheduler,cleanup:'Once daily, at most four listing pages; unchanged',measuredAt:now};
}

export async function measureDashboard(deps:{store:CacheStore;token:()=>Promise<string>;network?:typeof fetch;now?:()=>number}):Promise<UsageDashboard> {
  const now=(deps.now??Date.now)(), period=periods(now), network=deps.network??fetch;
  // Anchor DELTA bins to clock hours. A sliding end time can include data before
  // the period boundary and make a month-to-date counter decrease on refresh.
  const counterEnd=Math.floor(now/3600_000)*3600_000;
  const access=await deps.token();
  const get=async(url:string) => { try {
    const r=await network(url,{headers:{Authorization:`Bearer ${access}`},redirect:'error',signal:AbortSignal.timeout(5000)});
    if (!r.ok) {const body=await r.json().catch(()=>({}));return {error:`HTTP ${r.status}`,status:r.status,reason:body.error?.details?.find((d:any)=>d.reason)?.reason};}
    const text=await r.text(); if(text.length>2_000_000)return {error:'Measurement too large'};
    return JSON.parse(text);
  } catch {return {error:'Measurement unavailable'};} };
  const [raw,controlRaw,jobs,worker,...builds]=await Promise.all([
    deps.store.read('live-allowance').catch(()=>null),deps.store.read('control').catch(()=>null),
    get(`https://cloudscheduler.googleapis.com/v1/projects/${cloud}/locations/us-central1/jobs?pageSize=100`),
    get(`https://firestore.googleapis.com/v1/projects/${main}/databases/(default)/documents/backend/worker`),
    ...['us-central1','global'].map(region=>get(`https://cloudbuild.googleapis.com/v1/projects/${cloud}/locations/${region}/builds?${new URLSearchParams({pageSize:'100',filter:`create_time>="${new Date(period.month[0]-86400_000).toISOString()}"`})}`)),
  ]);
  const parse=(v:string|null)=>{try{return v?JSON.parse(v):null;}catch{return null;}};
  const ledger:LiveAllowanceState|null=parse(raw),control=parse(controlRaw);
  const rows=await Promise.all(usageSpecs().map(async(spec):Promise<UsageRow>=>{
    const [start,end]=spec.daily?period.day:period.month;
    let measure:Measurement={value:null,at:null,state:'unavailable',coverage:'not-exposed',coverageDetail:spec.id==='script-runtime'?'Google does not expose total account trigger-runtime consumption. The existing padded worker budget is available in details; it is not measured Google usage.':'Google does not expose remaining URL Fetch quota. Calls from other scripts also share this allowance.'};
    if (spec.metric) {
      const q=new URLSearchParams({filter:`metric.type="${spec.metric}" AND resource.labels.project_id="${spec.project}"${spec.filter?` AND ${spec.filter}`:''}`,view:'FULL',
        'interval.startTime':new Date(spec.gauge?now-3*86400_000:start).toISOString(),'interval.endTime':new Date(spec.gauge?now:counterEnd).toISOString(),pageSize:spec.gauge?'10000':'1000'});
      if(!spec.gauge) {
        q.set('aggregation.alignmentPeriod','3600s');q.set('aggregation.perSeriesAligner','ALIGN_SUM');q.set('aggregation.crossSeriesReducer','REDUCE_SUM');
      }
      measure=counterEnd<=start&&!spec.gauge?missingMeasurement({}):summarizeSeries(await get(`https://monitoring.googleapis.com/v3/projects/${spec.project}/timeSeries?${q}`),!!spec.gauge,spec.divisor);
    } else if (spec.id==='scheduler') measure=jobs.error||jobs.nextPageToken?missingMeasurement(jobs):{value:(jobs.jobs??[]).length,at:now,state:'measured'};
    else if (spec.id==='builds') measure=buildMeasurement(builds,start,now,now);
    else if (spec.id==='script-mail') measure=mailMeasurement(worker,now);
    else if (spec.id==='images') measure=repositoryStorageMeasurement(await get(`https://artifactregistry.googleapis.com/v1/projects/${cloud}/locations/us-central1/repositories/gcf-artifacts`),now);
    const workerState=parse(worker.fields?.json?.stringValue??null);
    const workerBudget=workerState&&Number.isFinite(workerState.runtimeMs)&&workerState.runtimeMs>=0&&Number.isFinite(workerState.runtimeWindow)&&now-workerState.runtimeWindow<86400_000?workerState.runtimeMs/60000:null;
    const limits=spec.daily?ledger?.dailyLimits:ledger?.monthlyLimits;
    const reserved=spec.daily?ledger?.dailyReserved:ledger?.monthlyReserved;
    return {id:spec.id,project:spec.project,resource:spec.resource,purpose:spec.purpose,unit:spec.unit,
      measured:measure.value,state:measure.state,measuredAt:measure.at,coverage:measure.coverage,coverageDetail:measure.coverageDetail,allowanceComparable:measure.comparable,
      ...(spec.id==='images'?{measurementBasis:'artifact-registry-sizeBytes' as const}:{}),
      allowance:spec.limit??null,allowanceLabel:spec.allowance??`${spec.limit?.toLocaleString('en-US')??'No published allowance'} ${spec.unit}`,
      scope:spec.scope??'Across billing account; this project only is measured',periodStart:start,periodEnd:end,
      periodLabel:spec.id.startsWith('script-')?'Rolling 24 hours · Google account; reset time unavailable':spec.gauge?'Latest capacity · no counter reset':spec.daily?'Daily · Pacific midnight':'Monthly · Pacific calendar',
      kind:spec.id.startsWith('script-')?'rolling':spec.gauge?'capacity':spec.daily?'daily':'monthly',resetAt:spec.gauge||spec.id.startsWith('script-')?null:end,
      ...allowanceMath(measure.value,spec.limit??null,start,end,counterEnd,spec.gauge||spec.id.startsWith('script-')||spec.id==='builds'),
      reservation:spec.key&&reserved?reserved[spec.key]??0:spec.id==='script-runtime'?workerBudget:null,budget:spec.key&&limits?limits[spec.key]??null:spec.id==='script-runtime'?70:null,
      reservationPeriod:spec.id.startsWith('script-')?'Alert worker rolling 24-hour window; reset time unavailable':spec.daily?`Ledger day ${ledger?.day??'unavailable'} (Pacific)`:`Fixed allowance through ${ledger?.expiresAt?new Date(ledger.expiresAt).toISOString():'unavailable'}`,
      source:spec.metric?`Cloud Monitoring · ${spec.metric}`:spec.id==='images'?'Artifact Registry repository metadata · sizeBytes':spec.id==='scheduler'?'Cloud Scheduler regional inventory':spec.id==='builds'?'Cloud Build history · us-central1 + global (up to 100 records each)':spec.id==='script-mail'?'MailApp.getRemainingDailyQuota · saved alert worker record':'Google quota API not available',sourceUrl:spec.url??free,
      note:[spec.note,spec.scope?null:'Other billing-account projects may consume the same allowance; remaining is an upper bound.',spec.gauge?'Capacity is not projected from a single observation.':null,spec.metric&&!spec.gauge?`Complete clock hours through ${new Date(counterEnd).toISOString()}; last measurement is the latest reported aligned interval. Missing/delayed events may understate consumption. Projections use the entire elapsed window, including idle hours.`:null].filter(Boolean).join(' ')};
  }));
  return {generatedAt:now,nextMeasurementAt:now+MEASUREMENT_TTL,rows,
    spending:{state:'unavailable',month:null,total:null,coverage:'Unavailable — no actual cost records connected; history start and end are unknown.',
      reason:'Read-only inspection found no visible BigQuery datasets in either project or the currently linked billing-account projects. Cloud Billing account/project APIs expose billing configuration, not actual spend. Main Firebase billing was disabled at inspection; that does not prove historical $0 costs.',
      setup:'Connect an existing Cloud Billing standard or detailed BigQuery usage-cost export (dataset, table and location), with read access to that table and bounded query permission. If none exists, the billing-account administrator must separately configure export. No export, billing change or paid dependency was created. Include cost + signed credits, retain adjustments and currency, and display only the verified export date range; empty or delayed rows must remain Not yet reported.',
      sourceUrl:'https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery',checkedAt:'2026-10-02T04:37:34.764Z'},
    collection:collectionStatus(ledger,control,(jobs.jobs??[]).find((j:any)=>j.name?.endsWith('/firebase-schedule-refreshMarket-us-central1'))?.state??'Unavailable',now)};
}

/** Separate private cache; no collector construction, ledger mutation, cleanup, or shutdown calls. */
export function cachedDashboard(store:CacheStore, measure:()=>Promise<UsageDashboard>, now=Date.now) {
  let memory:{until:number;value:UsageDashboard}|undefined, pending:Promise<UsageDashboard>|undefined;
  return async():Promise<UsageDashboard>=>{
    if(memory&&now()<memory.until)return memory.value;
    if(pending)return pending;
    pending=(async()=>{
      const raw=await store.read('usage-dashboard');
      const previous=raw?JSON.parse(raw):null;
      if(previous?.nextAttemptAt>now()) {
        if(!previous.snapshot)throw new Error('Measurement in progress; retry after the cache interval.');
        const value=verifiedUsageSnapshot({...previous.snapshot,stale:previous.snapshot.nextMeasurementAt<=now()});
        memory={until:Math.min(now()+60_000,previous.nextAttemptAt),value};return value;
      }
      // CAS lease persists even if the process fails. Eviction/restarts cannot force remeasurement.
      const claim=JSON.stringify({nextAttemptAt:now()+MEASUREMENT_TTL,snapshot:previous?.snapshot??null});
      if(!await store.commit('usage-dashboard',raw,claim))throw new Error('Measurement already in progress.');
      const snapshot=await measure();
      if(!await store.commit('usage-dashboard',claim,JSON.stringify({nextAttemptAt:snapshot.nextMeasurementAt,snapshot})))throw new Error('Measurement cache changed.');
      memory={until:now()+60_000,value:snapshot};return snapshot;
    })();
    try{return await pending;}finally{pending=undefined;}
  };
}
export function usageHandler(deps:{verify:(token:string)=>Promise<unknown>;dashboard:()=>Promise<UsageDashboard>;now?:()=>number}) {
  const now=deps.now??Date.now; let lastRequest=-Infinity;
  return async(req:IncomingMessage,res:ServerResponse)=>{
    res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Content-Type','application/json');
    res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
    const origin=req.headers.origin;
    if(origin==='https://bazaarsignal.web.app')res.setHeader('Access-Control-Allow-Origin',origin);
    const send=(status:number,body:unknown)=>{
      const text=JSON.stringify(body);
      const gzip=status===200 && /\bgzip\b/.test(String(req.headers['accept-encoding']??''));
      const bytes=gzip?gzipSync(text):Buffer.from(text);
      if(gzip)res.setHeader('Content-Encoding','gzip');
      res.setHeader('Vary','Origin, Accept-Encoding');res.setHeader('Content-Length',bytes.length);
      return res.writeHead(status).end(bytes);
    };
    if(origin&&origin!=='https://bazaarsignal.web.app')return send(403,{error:'Access denied.'});
    if(req.method==='OPTIONS') {res.setHeader('Access-Control-Allow-Methods','GET');res.setHeader('Access-Control-Allow-Headers','Authorization');return res.writeHead(204).end();}
    if(req.method!=='GET')return send(405,{error:'Method not allowed.'});
    const header=req.headers.authorization;
    if(!header||!/^Bearer [A-Za-z0-9._-]{20,12000}$/.test(header))return send(401,{error:'Sign in required.'});
    let identity:unknown;
    try{identity=await deps.verify(header.slice(7));}catch{return send(401,{error:'Sign in again.'});}
    if(!authorizedOwner(identity,now()))return send(403,{error:'Access denied.'});
    if(now()-lastRequest<60_000){res.setHeader('Retry-After','60');return send(429,{error:'Please wait before refreshing.'});}
    lastRequest=now();
    try{return send(200,await deps.dashboard());}catch{return send(503,{error:'Usage measurements are temporarily unavailable. Retry after the measurement cache interval.'});}
  };
}
