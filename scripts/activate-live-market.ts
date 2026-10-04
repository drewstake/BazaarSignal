import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { trialGoogleStore } from '../collector/trial-google';
import { livePolicy, validateLive, type LiveAllowanceState } from '../collector/allowance-live';
import { stopTrialInfrastructure } from '../collector/trial-shutdown';
import { MARKET_COLLECTION_SCHEDULE } from '../shared/market-schedule';
import { PORTFOLIO_COLLECTION_ENABLED } from '../shared/companion/portfolio-policy';
import { capacityProblems } from '../collector/capacity-plan';

const args=process.argv.slice(2),file=args[0],action=args[1]??'--inspect';
if(!file || args.length>2 || !['--inspect','--prepare','--activate'].includes(action))
  throw new Error('Usage: activate-live-market <reviewed-plan.json> [--inspect|--prepare|--activate]');
const plan=JSON.parse(readFileSync(file,'utf8')),state=plan.liveAllowance as LiveAllowanceState;
if(action!=='--inspect'&&!PORTFOLIO_COLLECTION_ENABLED)
  throw new Error('Local preparation only: production collection and activation remain disabled');
validateLive(state,Date.now());
if(action!=='--inspect'&&capacityProblems(state.capacity,Date.now()).length)
  throw new Error('Complete current allowance and shared-scope evidence required');
if(plan.project!=='bazaarsignal-510305'||plan.operatingMode!=='free-tier'||state.id!==plan.id || state.expiresAt!==Date.parse(plan.expiresAt))
  throw new Error('Wrong live release identity');
const require=createRequire(resolve('package.json')),auth=require('firebase-tools/lib/auth');
const account=auth.getAllAccounts().find((a:any)=>a.user.email==='drewstake3@gmail.com');
if(!account)throw new Error('Expected deployment account unavailable');
const token=async()=>(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token as string;
const root=`projects/${plan.project}/locations/us-central1`,job=`${root}/jobs/firebase-schedule-refreshMarket-us-central1`;
const report:any={at:new Date().toISOString(),id:plan.id,action,changes:[]};
const reportFile=`.local/live-activation-${plan.id}-${action.slice(2)}.json`;
if(action!=='--inspect')writeFileSync(reportFile,JSON.stringify(report,null,2),{flag:'wx'});
const save=()=>writeFileSync(reportFile,JSON.stringify(report,null,2));
async function call(url:string,method='GET',body?:unknown) {
  const r=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{Authorization:`Bearer ${await token()}`,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json();if(!r.ok)throw new Error(`Control-plane HTTP ${r.status}: ${data.error?.message}`);return data;
}
const store=trialGoogleStore({project:plan.project,bucket:`${plan.project}-market-cache`,token});
try {
  for(const name of ['marketapi','refreshmarket']) {
    const service=await call(`https://run.googleapis.com/v2/${root}/services/${name}`);
    const revision=await call(`https://run.googleapis.com/v2/${service.latestReadyRevision}`);
    const env=Object.fromEntries((revision.containers[0].env??[]).map((e:any)=>[e.name,e.value]));
    if(service.reconciling || service.invokerIamDisabled || service.latestReadyRevision!==service.latestCreatedRevision ||
      !revision.containers[0].image.endsWith(`@${plan.imageDigest}`)||env.MARKET_LIVE_ID!==plan.id ||
      env.MARKET_OPERATING_MODE!=='free-tier'||env.MARKET_LIVE_END!==plan.expiresAt||
      revision.timeout!==(name==='marketapi'?'15s':'90s') ||
      revision.scaling?.maxInstanceCount!==1||revision.scaling?.minInstanceCount>0)
      throw new Error('Serving revision does not match reviewed live configuration');
  }
  const scheduled=await call(`https://cloudscheduler.googleapis.com/v1/${job}`);
  if(scheduled.state!=='PAUSED')throw new Error('Expected paused collector before activation');
  if(action==='--inspect'){report.ready=true;}
  if(action==='--prepare') {
    if(await store.read('live-allowance'))throw new Error('An existing live ledger must be inspected; never replace its counters');
    const old=await store.read('control');if(!old)throw new Error('Existing provider ledger unavailable');
    const control=JSON.parse(old);
    if(control.lease?.until>Date.now())throw new Error('Collector lease is still active');
    // Preserve all provider charges, cooldown and snapshots. Only cadence changes.
    control.policy=livePolicy;
    for(const j of Object.values(control.jobs) as any[])j.nextAt=Math.max(Date.now(),control.blockedUntil??0);
    if(!await store.commit('control',old,JSON.stringify(control)))throw new Error('Provider policy update conflicted');
    report.changes.push('Five-minute Bazaar policy installed without resetting provider charges');save();
    if(!await store.commit('live-allowance',null,JSON.stringify(state)))throw new Error('Live ledger installation conflicted');
    report.changes.push('Live allowance ledger installed once');save();
    await call(`https://cloudscheduler.googleapis.com/v1/${job}?updateMask=schedule,timeZone,retryConfig`,'PATCH',
      {schedule:MARKET_COLLECTION_SCHEDULE,timeZone:'Etc/UTC',retryConfig:{retryCount:0,maxRetryDuration:'0s'}});
    report.changes.push('Existing paused job changed to five-minute slots, no retries');
  }
  if(action==='--activate') {
    const ledger=JSON.parse((await store.read('live-allowance'))??'null');validateLive(ledger,Date.now());
    if(capacityProblems(ledger.capacity,Date.now()).length)throw new Error('Persisted capacity evidence is missing or expired');
    if(ledger.id!==plan.id||scheduled.schedule!==MARKET_COLLECTION_SCHEDULE)throw new Error('Prepared ledger/schedule mismatch');
    await call(`https://cloudscheduler.googleapis.com/v1/${job}:resume`,'POST',{});
    report.changes.push('Five-minute schedule resumed');save();
    await call(`https://cloudscheduler.googleapis.com/v1/${job}:run`,'POST',{});
    report.changes.push('One initial scheduled collection requested');save();
    const api=`https://run.googleapis.com/v1/${root}/services/marketapi`;
    const policy=await call(`${api}:getIamPolicy?options.requestedPolicyVersion=3`);
    policy.bindings??=[];
    if(!policy.bindings.some((b:any)=>b.role==='roles/run.invoker'&&!b.condition&&b.members.includes('allUsers')))
      policy.bindings.push({role:'roles/run.invoker',members:['allUsers']});
    await call(`${api}:setIamPolicy`,'POST',{policy});
    const after=await call(`${api}:getIamPolicy?options.requestedPolicyVersion=3`);
    if(!after.bindings.some((b:any)=>b.role==='roles/run.invoker'&&!b.condition&&b.members.includes('allUsers')))
      throw new Error('Public API invocation was not verified');
    report.changes.push('Cache-only API public invocation verified');
  }
  report.success=true;
} catch(e:any) {
  report.error=e.message;
  if(action==='--activate') {
    try{await stopTrialInfrastructure({project:plan.project,token});report.rollback='Scheduler paused and API private';}
    catch(error:any){report.rollbackError=error.message;}
  }
  throw e;
} finally {report.finishedAt=new Date().toISOString();save();await store.close();console.log(JSON.stringify(report,null,2));}
