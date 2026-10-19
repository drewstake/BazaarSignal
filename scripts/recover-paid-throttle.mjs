// Explicit operator recovery after a contained repair deployment. Never called
// automatically by a runtime: budget, operator, expiry and unknown stops stay stopped.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyPaidReleaseBudget, verifyPaidContinuity, verifyLiveUpdate,
  verifySchedule, verifyRepairDailySchedule } from './private-trial-release.mjs';

const project='bazaarsignal-510305', root=`projects/${project}/locations/us-central1`;
const document=`projects/${project}/databases/(default)/documents/marketCache/paid-budget-october`;
const hash=value=>createHash('sha256').update(value).digest('hex');

export function recoveredPaidLedger(plan, ledger, now=Date.now()) {
  if (!plan.paidThrottleRepair) throw Error('Explicit inspected throttle repair required');
  verifyPaidReleaseBudget(plan,ledger,now);
  if (ledger.deployments?.[plan.releaseId]?.imageDigest !== plan.imageDigest ||
      ledger.deployments[plan.releaseId].reservedUsd !== .5) throw Error('Repair deployment hold missing');
  const next=structuredClone(ledger);
  delete next.stoppedAt; delete next.reason;
  if (next.recoveries !== undefined && (!next.recoveries || typeof next.recoveries !== 'object' ||
      Array.isArray(next.recoveries) || Object.keys(next.recoveries).length >= 16))
    throw Error('Invalid recovery history');
  next.recoveries ??= {};
  if (Object.hasOwn(next.recoveries,plan.releaseId)) throw Error('Repair already recovered');
  next.recoveries[plan.releaseId]={at:now,priorStoppedAt:ledger.stoppedAt,priorReason:ledger.reason,imageDigest:plan.imageDigest};
  verifyPaidContinuity(ledger,next);
  const activePlan={...plan}; delete activePlan.paidThrottleRepair;
  verifyPaidReleaseBudget(activePlan,next,now);
  return next;
}

async function main() {
  const [file, mode]=process.argv.slice(2);
  if (process.argv.length!==4 || !['--inspect','--apply'].includes(mode))
    throw Error('Usage: node scripts/recover-paid-throttle.mjs <repair-plan.json> --inspect|--apply');
  const plan=JSON.parse(readFileSync(file,'utf8'));
  const deployment=JSON.parse(readFileSync(`.local/private-release-${plan.releaseId}-apply.json`,'utf8'));
  if (deployment.result!=='throttle-repair-deployed-stopped-ledger-preserved' || deployment.error ||
      deployment.imageUploaded!==plan.imageDigest || !deployment.paidAfter || !plan.paidThrottleRepair)
    throw Error('Successful contained repair receipt required');
  const receiptPath=`.local/${plan.releaseId}-recovery-${mode.slice(2)}${mode==='--inspect'?`-${Date.now()}`:''}.json`;
  const receipt={at:new Date().toISOString(),calls:0,steps:[],before:{},after:{}};
  writeFileSync(receiptPath,JSON.stringify(receipt),{flag:'wx'});
  const save=()=>writeFileSync(receiptPath,JSON.stringify(receipt,null,2));
  const auth=createRequire(import.meta.url)('firebase-tools/lib/auth');
  const account=auth.getAllAccounts().find(a=>a.user.email==='drewstake3@gmail.com');
  if(!account)throw Error('Expected operator account unavailable');
  const token=(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token;
  async function call(url,method='GET',body) {
    if(++receipt.calls>30)throw Error('Recovery request bound reached');
    save();
    const response=await fetch(url,{method,redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const result=await response.json();
    if(!response.ok)throw Error(`Recovery HTTP ${response.status}: ${result.error?.status ?? 'unknown'}`);
    return result;
  }
  try {
    const doc=await call(`https://firestore.googleapis.com/v1/${document}`);
    const ledger=JSON.parse(doc.fields.value.stringValue);
    verifyPaidContinuity(deployment.paidAfter,ledger);
    const next=recoveredPaidLedger(plan,ledger);
    if(!doc.updateTime)throw Error('Missing ledger precondition');
    receipt.before.ledger=ledger;
    const jobs=['firebase-schedule-refreshMarket-us-central1','bazaar-daily-close'];
    for(const job of jobs) {
      const schedule=await call(`https://cloudscheduler.googleapis.com/v1/${root}/jobs/${job}`);
      (job==='bazaar-daily-close'?verifyRepairDailySchedule:verifySchedule)(plan,schedule);
      receipt.before[job]=schedule;
    }
    for(const name of ['marketapi','refreshmarket']) {
      const service=await call(`https://run.googleapis.com/v2/${root}/services/${name}`);
      verifyLiveUpdate(plan,ledger,service);
      const deployed=deployment.verified?.[name];
      if(!deployed || service.latestReadyRevision!==deployed.revision ||
          service.template.containers[0].image!==deployed.image || !deployed.image.endsWith(`@${plan.imageDigest}`))
        throw Error('Both repaired revisions must be ready before recovery');
      const policy=await call(`https://run.googleapis.com/v1/${root}/services/${name}:getIamPolicy?options.requestedPolicyVersion=3`);
      if(hash(JSON.stringify(policy))!==plan.policySha256[name] || !policy.etag ||
          policy.bindings?.some(b=>b.members?.some(m=>['allUsers','allAuthenticatedUsers'].includes(m))))
        throw Error('Contained invocation permissions changed');
      receipt.before[`${name}Iam`]=policy;
      receipt.after[name]={revision:deployed.revision,image:deployed.image};
    }
    save();
    if(mode==='--inspect') { receipt.result='verified-ready-to-recover';return; }
    await call(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:commit`,'POST',{
      writes:[{update:{name:document,fields:{value:{stringValue:JSON.stringify(next)}}},currentDocument:{updateTime:doc.updateTime}}]});
    receipt.steps.push('cleared-exact-technical-stop-with-CAS');receipt.after.ledger=next;save();
    // Resume the existing jobs with their existing schedules and private OIDC target.
    for(const job of jobs) {
      const result=await call(`https://cloudscheduler.googleapis.com/v1/${root}/jobs/${job}:resume`,'POST',{});
      if(result.state!=='ENABLED')throw Error(`Job did not resume: ${job}`);
      receipt.after[job]=result;receipt.steps.push(`resumed:${job}`);save();
    }
    // Restore only the prior public read API invoker. Collector remains private.
    const policy=structuredClone(receipt.before.marketapiIam);
    policy.bindings??=[];
    const binding=policy.bindings.find(b=>b.role==='roles/run.invoker'&&!b.condition);
    if(binding)binding.members.push('allUsers');
    else policy.bindings.push({role:'roles/run.invoker',members:['allUsers']});
    receipt.after.marketapiIam=await call(`https://run.googleapis.com/v1/${root}/services/marketapi:setIamPolicy`,'POST',{policy});
    receipt.steps.push('restored-public-read-api');save();
    const current=JSON.parse((await call(`https://firestore.googleapis.com/v1/${document}`)).fields.value.stringValue);
    verifyPaidContinuity(next,current);
    if(current.stoppedAt!==undefined)throw Error('Collector stopped again during recovery');
    receipt.result='both-existing-collectors-enabled-budget-and-history-preserved';
  } catch(error) { receipt.error=error.message;throw error; }
  finally {receipt.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({receiptPath,result:receipt.result,steps:receipt.steps,error:receipt.error,calls:receipt.calls}));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
