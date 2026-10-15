// Offline assessment by default. Execute only an already deployed, exact-image
// private collector after complete evidence passes. No scheduler/IAM mutation.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { measurementCapacity, measurementControl, type MeasurementPlan } from '../collector/measurement-capacity';
import { armMeasurement, ledgerHash, verifyMeasurementContainment, type MeasurementState } from '../collector/measurement';
import { trialGoogleStore } from '../collector/trial-google';
import { assertMeasurementPolicy } from './measurement-policy-transition';
const [file, action='--inspect',tokenFlag,tokenFile]=process.argv.slice(2);
if(!file||!['--inspect','--execute'].includes(action)||process.argv.length>6||
  (tokenFlag!==undefined&&(action!=='--execute'||tokenFlag!=='--identity-token-file'||!tokenFile)))
  throw new Error('run-private-measurement <plan.json> [--inspect|--execute [--identity-token-file <private file>]]');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const input=read(file),plan=input.plan as MeasurementPlan;
const output=`.local/${plan.id}-${action.slice(2)}.json`;
if(!/^measure-[a-zA-Z0-9_-]{1,80}$/.test(plan.id))throw new Error('Invalid measurement identity');
const report:any={at:new Date().toISOString(),action,planFile:file,plan,requests:0,invocations:0,errors:[],
  measurements:null,reservations:measurementControl,uncertain:'Provider billing reports are delayed; holds are never refunded'};
writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
const save=()=>writeFileSync(output,JSON.stringify(report,null,2));
const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
let token:()=>Promise<string>;
const root='projects/bazaarsignal-510305/locations/us-central1',project='bazaarsignal-510305';
async function call(url:string,init:RequestInit={}) {
  if(++report.requests>32)throw new Error('Operator request bound reached');save();
  const r=await fetch(url,{...init,redirect:'error',headers:{Authorization:`Bearer ${await token()}`,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error(`Control-plane HTTP ${r.status}`);
  return r.json();
}
try {
  for(const ref of input.evidenceFiles??[])if(hash(readFileSync(ref.path))!==ref.sha256)throw new Error(`Changed evidence: ${ref.path}`);
  if(!input.evidenceFiles?.length)throw new Error('Hash-checked evidence files required');
  const captured=read(input.stateFile),state:MeasurementState=JSON.parse(captured.resources.ledger.fields.value.stringValue);
  if(ledgerHash(state)!==plan.ledgerSha256)throw new Error('Captured ledger differs');
  const {loadDeploymentAccounting}=await import(pathToFileURL(resolve('scripts/deployment-accounting.mjs')).href);
  const balance=loadDeploymentAccounting(input.periodStart,input.periodEnd);
  report.retainedDeployment=balance;
  for(const [key,legacy]of Object.entries({cpuSeconds:'cpuSeconds',memoryGiBSeconds:'memoryGiBSeconds',artifactByteMonths:'artifactBytes',logBytes:'logBytes'})) {
    if((plan.retainedDeployment[key]??-1)<(balance.unresolved[legacy]??0)+(balance.uncertainty[legacy]??0) ||
       (plan.meters[key as keyof typeof plan.meters]?.measured??-1)<(balance.observed[legacy]??0))
      report.errors.push(`Missing retained deployment or settled usage: ${key}`);
  }
  report.decision=measurementCapacity(plan,state,Date.now());
  report.errors.push(...report.decision.problems);
  if(report.errors.length) { report.result='blocked-before-deployment-and-collection';process.exitCode=2; }
  else if(action==='--inspect')report.result='capacity-ready; exact deployed image and existing authentication still required';
  else {
    if(!tokenFile)throw new Error('A Cloud Run-compatible owner ID token file is required. The existing Firebase login token was rejected by Cloud Run; do not reserve another grant with that token.');
    const image=read(resolve(input.imageDirectory,'receipt.json'));
    if(!image.localRuntimeSmokeVerified || image.sourceSha256!==plan.isolation.sourceSha256 || image.imageDigest!==input.imageDigest ||
       hash(readFileSync('market-functions/lib/index.cjs'))!==image.sourceSha256)throw new Error('Unverified or changed measurement image');
    const auth=createRequire(resolve('package.json'))('firebase-tools/lib/auth');
    const account=auth.getAllAccounts().find((a:any)=>a.user.email==='drewstake3@gmail.com');
    if(!account)throw new Error('Existing owner login unavailable');
    const credential=await auth.getAccessToken(account.tokens.refresh_token,[]);
    token=async()=>credential.access_token;
    // A user can supply an ID token from an already authorized gcloud session.
    // Never copy the credential into the plan, log, receipt, or cloud ledger.
    const idToken=readFileSync(tokenFile,'utf8').trim();
    const claims=idToken?JSON.parse(Buffer.from(idToken.split('.')[1],'base64url').toString()):null;
    if(!claims||claims.exp*1000<plan.deadline||claims.email!=='drewstake3@gmail.com')throw new Error('Existing user ID token unavailable through deadline; no new scopes requested');
    const boundedNetwork:typeof fetch=async(input,init)=>{
      if(++report.requests>32)throw new Error('Operator request bound reached');save();return fetch(input,init);
    };
    await verifyMeasurementContainment(project,token,boundedNetwork);
    const iam=await call(`https://run.googleapis.com/v1/${root}/services/refreshmarket:getIamPolicy`);
    if(iam.bindings?.some((b:any)=>b.members?.some((m:string)=>['allUsers','allAuthenticatedUsers'].includes(m))))throw new Error('Collector is public');
    const service=await call(`https://run.googleapis.com/v2/${root}/services/refreshmarket`);
    const c=service.template?.containers?.[0],env=Object.fromEntries((c?.env??[]).map((e:any)=>[e.name,e.value]));
    if(service.reconciling||service.invokerIamDisabled||service.latestReadyRevision!==service.latestCreatedRevision||
       !c?.image.endsWith(`@${input.imageDigest}`)||env.MARKET_OPERATING_MODE!=='measurement'||
       env.MARKET_LIVE_ID!==state.id||Date.parse(env.MARKET_LIVE_END)!==state.expiresAt||service.template.timeout!=='90s'||
       service.template.scaling?.maxInstanceCount!==1||service.template.scaling?.minInstanceCount>0||
       c.resources?.limits?.cpu!=='1'||c.resources?.limits?.memory!=='1Gi'||c.resources?.cpuIdle!==true||c.resources?.startupCpuBoost===true)
      throw new Error('Collector is not ready on the exact bounded measurement release');
    const counters:Record<string,number>={};
    const store=trialGoogleStore({project,bucket:`${project}-market-cache`,token,onAttempt:costs=>{
      for(const[k,n]of Object.entries(costs)){counters[k]=(counters[k]??0)+n;if(counters[k]>(measurementControl[k]??0))throw new Error(`Operator accounting cap: ${k}`);}
    }});
    const control=await store.read('control');
    if(!control)throw new Error('Shared collector control is missing; no grant installed');
    assertMeasurementPolicy(JSON.parse(control),!!plan.upstream.publicOneShot);
    report.armAttemptedAt=new Date().toISOString();save();
    await armMeasurement(store,plan);report.armed=true;save();
    const uri=new URL(service.uri);
    if(uri.protocol!=='https:'||!uri.hostname.endsWith('.run.app'))throw new Error('Unexpected private invocation URL');
    // The only invocation. Never retry an ambiguous response or create browser activity.
    report.invocations=1;report.invocationStartedAt=new Date().toISOString();save();
    try {
      const response=await fetch(uri,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${idToken}`,
        'X-CloudScheduler-JobName':`measurement:${plan.id}`},signal:AbortSignal.timeout(95000)});
      report.invocationStatus=response.status;
      if(!response.ok)report.errors.push(`Invocation HTTP ${response.status}; no retry`);
    }catch(e){report.errors.push(`Invocation outcome uncertain: ${(e as Error).message}`);}
    const after:MeasurementState=JSON.parse((await store.read('live-allowance'))!);
    report.measurements=after.measurementRuns?.[plan.id]??null;report.remainingReservations={monthly:after.monthlyReserved,daily:after.dailyReserved,measurements:after.measurementRuns};
    await verifyMeasurementContainment(project,token,boundedNetwork);
    report.scheduler='PAUSED';report.ownerStopPreserved=after.stoppedAt===state.stoppedAt&&after.reason===state.reason;
    report.periodPreserved=after.id===state.id&&after.expiresAt===state.expiresAt&&after.startsAt===state.startsAt;
    report.result=report.measurements?.status==='complete'&&!report.errors.length?'completed-once-and-stopped':'stopped-or-ambiguous; grant cannot replay; preserve all holds';
    report.operatorDocumentAttempts=counters;
  }
}catch(e){report.errors.push((e as Error).message);report.result='blocked-or-failed; preserve all reservations';process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({output,result:report.result,errors:report.errors,invocations:report.invocations},null,2));}
