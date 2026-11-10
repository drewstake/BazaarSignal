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
import { pacificMidnight, periods, allowanceMath, missingMeasurement, buildMeasurement, mailMeasurement, repositoryStorageMeasurement, usageSpecs, summarizeSeries } from '../shared/usage-measurements';
export { pacificMidnight, periods, allowanceMath, missingMeasurement, buildMeasurement, mailMeasurement, repositoryStorageMeasurement, usageSpecs, summarizeSeries } from '../shared/usage-measurements';

const main='bazaarsignal', cloud='bazaarsignal-510305';
const free='https://docs.cloud.google.com/free/docs/free-cloud-features#free-tier-usage-limits';
type Measurement = ReturnType<typeof summarizeSeries>;

export function collectionStatus(ledger:LiveAllowanceState|null, control:any, scheduler:string, now:number):UsageDashboard['collection'] {
  let state='Unavailable',reason='Allowance ledger could not be read.',pressure:number|null=null,budgetRetryAt:number|null=null;
  if (ledger) {
    try {
      validateLive(ledger,now);
      pressure=livePressure(ledger,now);
      state=hourlyTrialActive(now)?'Hourly test':pressure>=.5?'Warning':'Active';
      reason=(hourlyTrialActive(now)?'Hourly collection opportunities and browser checks during the temporary test. ':'Collection cadence follows resource capacity; only Bazaar collection is supported. ')+APP_BUDGET_PAUSE_DESCRIPTION;
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
