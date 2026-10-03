// Explicit operator recovery after a verified private repair deployment. Never
// renews a period, clears usage, changes limits or replays an ambiguous attempt.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { trialGoogleStore } from '../collector/trial-google';
import { LiveLedger, validateLive } from '../collector/allowance-live';
import { stopTrialInfrastructure } from '../collector/trial-shutdown';
// Keep the executable utility outside the bundle so its main-module guard
// cannot mistake this recovery entry point for a release invocation.
const { verifyStoppedUpdate, verifyReleasePlan } = await import(pathToFileURL(resolve('scripts/private-trial-release.mjs')).href);

const [file, action='--inspect'] = process.argv.slice(2);
if (!file || !['--inspect','--apply'].includes(action) || process.argv.length>4) throw new Error('Pass repair plan and --inspect or --apply');
const plan=JSON.parse(readFileSync(file,'utf8'));
const receipt=JSON.parse(readFileSync(resolve(plan.imageDirectory,'receipt.json'),'utf8'));
verifyReleasePlan(plan,receipt);
const deployment=JSON.parse(readFileSync(`.local/private-release-${plan.releaseId}-apply.json`,'utf8'));
if(deployment.error || Object.keys(deployment.verified??{}).length!==2 || deployment.imageUploaded!==plan.imageDigest)
  throw new Error('Both repaired services must be deployed and verified first');
const require=createRequire(resolve('package.json')),auth=require('firebase-tools/lib/auth');
const account=auth.getAllAccounts().find((a:any)=>a.user.email==='drewstake3@gmail.com');
if(!account)throw new Error('Expected deployment account unavailable');
const token=async()=>(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token as string;
const root=`projects/${plan.project}/locations/us-central1`,job=`${root}/jobs/firebase-schedule-refreshMarket-us-central1`;
const api=`https://run.googleapis.com/v1/${root}/services/marketapi`;
const report:any={at:new Date().toISOString(),releaseId:plan.releaseId,action,changes:[]};
const reportFile=`.local/recovery-${plan.releaseId}-${action.slice(2)}.json`;
writeFileSync(reportFile,JSON.stringify(report,null,2),{flag:'wx'});
const save=()=>writeFileSync(reportFile,JSON.stringify(report,null,2));
async function call(url:string,method='GET',body?:unknown) {
  const r=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${await token()}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json();if(!r.ok)throw new Error(`Recovery HTTP ${r.status}: ${data.error?.message}`);return data;
}
const store=trialGoogleStore({project:plan.project,bucket:`${plan.project}-market-cache`,token});
let attempted=false;
try {
  const raw=await store.read('live-allowance');if(!raw)throw new Error('Missing stopped ledger');
  const ledger=JSON.parse(raw);
  const active={...ledger};delete active.stoppedAt;delete active.reason;
  validateLive(active,Date.now());
  const scheduled=await call(`https://cloudscheduler.googleapis.com/v1/${job}`);
  if(scheduled.state!=='PAUSED'||scheduled.schedule!=='0 * * * *'||scheduled.timeZone!=='Etc/UTC'||(scheduled.retryConfig?.retryCount??0)!==0)
    throw new Error('Expected unchanged paused hourly schedule without retries');
  const control=JSON.parse((await store.read('control'))??'null');
  if(!control||control.lease?.until>Date.now())throw new Error('Collector lease is still active');
  for(const name of ['marketapi','refreshmarket']) {
    const service=await call(`https://run.googleapis.com/v2/${root}/services/${name}`);
    verifyStoppedUpdate(plan,ledger,service);
    const revision=await call(`https://run.googleapis.com/v2/${service.latestReadyRevision}`);
    if(service.reconciling||service.latestReadyRevision!==service.latestCreatedRevision||service.invokerIamDisabled||
      service.latestReadyRevision!==deployment.verified[name].revision||
      !revision.containers[0].image.endsWith(`@${plan.imageDigest}`)||
      revision.timeout!==(name==='marketapi'?'15s':'90s')||revision.scaling?.maxInstanceCount!==1||revision.scaling?.minInstanceCount>0||
      revision.containers[0].resources?.cpuIdle!==true||revision.containers[0].resources?.startupCpuBoost===true)
      throw new Error('Repaired revision settings differ');
    const policy=await call(`https://run.googleapis.com/v1/${root}/services/${name}:getIamPolicy?options.requestedPolicyVersion=3`);
    if((policy.bindings??[]).some((b:any)=>b.members?.some((m:string)=>['allUsers','allAuthenticatedUsers'].includes(m))))
      throw new Error('Repair must remain private until recovery');
  }
  report.before=ledger;
  report.after=active;
  report.preservedLedgerSha256=createHash('sha256').update(JSON.stringify(active)).digest('hex');save();
  if(action==='--apply') {
    attempted=true;
    // CAS changes ONLY the two stop markers. No accounting or scheduling fields.
    if(!await store.commit('live-allowance',raw,JSON.stringify(active)))throw new Error('Stopped ledger changed during recovery');
    report.changes.push('Removed verified repair stop markers; all other ledger fields preserved');save();
    if(await store.read('live-allowance')!==JSON.stringify(active))throw new Error('Recovered ledger verification failed');
    const policy=await call(`${api}:getIamPolicy?options.requestedPolicyVersion=3`);
    policy.bindings??=[];policy.bindings.push({role:'roles/run.invoker',members:['allUsers']});
    await call(`${api}:setIamPolicy`,'POST',{policy});
    report.changes.push('Restored public cache-only API access');save();
    const after=await call(`${api}:getIamPolicy?options.requestedPolicyVersion=3`);
    if(!after.bindings.some((b:any)=>b.role==='roles/run.invoker'&&!b.condition&&b.members.includes('allUsers')))throw new Error('API access restoration unverified');
    await call(`https://cloudscheduler.googleapis.com/v1/${job}:resume`,'POST',{});
    report.changes.push('Resumed unchanged hourly schedule');save();
    await call(`https://cloudscheduler.googleapis.com/v1/${job}:run`,'POST',{});
    report.changes.push('Requested one recovery collection, subject to existing hourly admission');save();
  }
  report.success=true;
} catch(error:any) {
  report.error=error.message;
  if(attempted) {
    const result=await Promise.allSettled([new LiveLedger(store).stop('Recovery failed; inspect operator receipt'),stopTrialInfrastructure({project:plan.project,token})]);
    report.rollback=result.map(r=>r.status);
  }
  throw error;
} finally {report.finishedAt=new Date().toISOString();save();await store.close();console.log(JSON.stringify({reportFile,success:report.success,changes:report.changes,error:report.error},null,2));}
