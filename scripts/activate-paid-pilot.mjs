// Explicit $5 October pilot activation. Old allowance/stop history is immutable.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),auth=require('firebase-tools/lib/auth');
const [file,action='--inspect']=process.argv.slice(2);
if(!file||!['--inspect','--apply'].includes(action)||process.argv.length>4)throw Error('Pass paid release plan and --inspect or --apply');
const plan=JSON.parse(readFileSync(file,'utf8'));
if(plan.operatingMode!=='paid-budget'||plan.budgetUsd!==5||plan.applicationStopUsd!==4.5||plan.fixedReserveUsd!==1||plan.expiresAt!=='2026-11-01T07:00:00.000Z')throw Error('Invalid paid plan');
const project='bazaarsignal-510305',root=`projects/${project}/locations/us-central1`,db=`projects/${project}/databases/(default)/documents`,job=`${root}/jobs/firebase-schedule-refreshMarket-us-central1`;
const account=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');if(!account)throw Error('Owner login missing');
const credential=await auth.getAccessToken(account.tokens.refresh_token,[]);
const receipt={at:new Date().toISOString(),action,calls:0,changes:[]};
const output=`.local/paid-activation-${Date.now()}-${action.slice(2)}.json`;
writeFileSync(output,JSON.stringify(receipt,null,2),{flag:'wx'});
const save=()=>writeFileSync(output,JSON.stringify(receipt,null,2));
async function call(url,method='GET',body) {
  if(++receipt.calls>50)throw Error('Operator call bound');save();
  const r=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${credential.access_token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json();if(!r.ok)throw Error(`Operator HTTP ${r.status}: ${data.error?.message}`);return data;
}
const hash=value=>createHash('sha256').update(value).digest('hex');
const publicPolicy=p=>(p.bindings??[]).some(b=>b.members?.some(m=>['allUsers','allAuthenticatedUsers'].includes(m)));
let opening=false;
try {
  const deployment=JSON.parse(readFileSync(`.local/private-release-${plan.releaseId}-apply.json`,'utf8'));
  if(deployment.error||Object.keys(deployment.verified??{}).length!==2)throw Error('Paid deployment incomplete');
  const ledger=await call(`https://firestore.googleapis.com/v1/${db}/marketCache/live-allowance`);
  const raw=ledger.fields.value.stringValue,old=JSON.parse(raw);
  if(hash(raw)!==plan.stoppedLedgerSha256||!old.stoppedAt||old.expiresAt!==Date.parse(plan.expiresAt))throw Error('Old ledger changed');
  if(Object.values(old.measurementRuns??{}).some(r=>['armed','claimed'].includes(r.status)))throw Error('Ambiguous measurement still exists');
  const control=await call(`https://firestore.googleapis.com/v1/${db}/marketCache/control`);
  const c=JSON.parse(control.fields.value.stringValue);if(c.lease?.until>Date.now())throw Error('Collection lease active');
  const schedule=await call(`https://cloudscheduler.googleapis.com/v1/${job}`);
  if(schedule.state!=='PAUSED'||schedule.schedule!=='*/5 * * * *'||schedule.httpTarget.oidcToken.serviceAccountEmail!==`market-collector@${project}.iam.gserviceaccount.com`)throw Error('Unexpected paused scheduler');
  const policies={};
  for(const name of ['marketapi','refreshmarket']) {
    const service=await call(`https://run.googleapis.com/v2/${root}/services/${name}`);
    const t=service.template,container=t.containers[0],env=Object.fromEntries(container.env.map(e=>[e.name,e.value]));
    if(service.reconciling||service.latestReadyRevision!==deployment.verified[name].revision||service.latestCreatedRevision!==service.latestReadyRevision||service.invokerIamDisabled||
      env.MARKET_OPERATING_MODE!=='paid-budget'||env.MARKET_LIVE_END!==plan.expiresAt||!container.image.endsWith(`@${plan.imageDigest}`)||
      t.scaling?.maxInstanceCount!==1||(t.scaling?.minInstanceCount??0)!==0||t.timeout!==(name==='marketapi'?'15s':'90s')||
      container.resources?.cpuIdle!==true||container.resources?.startupCpuBoost===true)throw Error('Paid service configuration mismatch');
    policies[name]=await call(`https://run.googleapis.com/v1/${root}/services/${name}:getIamPolicy?options.requestedPolicyVersion=3`);
    if(publicPolicy(policies[name]))throw Error('Expected private services before activation');
  }
  const paid={version:1,id:'paid-202610',startsAt:Date.now(),expiresAt:old.expiresAt,limitUsd:5,stopUsd:4.5,reservedUsd:1,
    reserved:{},observed:{},legacyLedgerSha256:hash(raw),admissions:{}};
  receipt.plan={budget:paid,legacyPreserved:true,schedule:'0 * * * *',emails:'Configured separately in sender Apps Script; existing user opt-ins only'};save();
  if(action==='--apply') {
    // Atomic fences prevent a concurrent owner stop or policy update from being lost.
    await call(`https://firestore.googleapis.com/v1/${db}:commit`,'POST',{writes:[
      {verify:ledger.name,currentDocument:{updateTime:ledger.updateTime}},
      {verify:control.name,currentDocument:{updateTime:control.updateTime}},
      {update:{name:`${db}/marketCache/paid-budget-october`,fields:{value:{stringValue:JSON.stringify(paid)}}},currentDocument:{exists:false}},
    ]});
    receipt.changes.push('Installed separate paid ledger; previous ledger unchanged');save();
    await call(`https://cloudscheduler.googleapis.com/v1/${job}?updateMask=schedule,timeZone,retryConfig`,'PATCH',{schedule:'0 * * * *',timeZone:'Etc/UTC',retryConfig:{retryCount:0,maxRetryDuration:'0s'}});
    receipt.changes.push('Existing paused scheduler set to hourly with no retries');save();
    opening=true;
    const policy=policies.marketapi;policy.bindings??=[];policy.bindings.push({role:'roles/run.invoker',members:['allUsers']});
    await call(`https://run.googleapis.com/v1/${root}/services/marketapi:setIamPolicy`,'POST',{policy});
    receipt.changes.push('Enabled public cache-only price delivery; collector remains private');save();
    await call(`https://cloudscheduler.googleapis.com/v1/${job}:resume`,'POST',{});
    await call(`https://cloudscheduler.googleapis.com/v1/${job}:run`,'POST',{});
    receipt.changes.push('Resumed hourly collection and requested initial run');save();
    const after=await call(`https://firestore.googleapis.com/v1/${db}/marketCache/live-allowance`);
    if(after.fields.value.stringValue!==raw)throw Error('Legacy accounting unexpectedly changed');
  }
  receipt.success=true;
} catch(e) {
  receipt.error=e.message;
  if(opening) {
    const results=await Promise.allSettled([
      call(`https://cloudscheduler.googleapis.com/v1/${job}:pause`,'POST',{}),
      (async()=>{const p=await call(`https://run.googleapis.com/v1/${root}/services/marketapi:getIamPolicy?options.requestedPolicyVersion=3`);
        p.bindings=(p.bindings??[]).map(b=>({...b,members:(b.members??[]).filter(m=>!['allUsers','allAuthenticatedUsers'].includes(m))})).filter(b=>b.members.length);
        await call(`https://run.googleapis.com/v1/${root}/services/marketapi:setIamPolicy`,'POST',{policy:p});})(),
    ]);receipt.rollback=results.map(r=>r.status);
  }
  throw e;
} finally {receipt.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({output,...receipt},null,2));}
