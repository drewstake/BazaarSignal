// Local draft preparation only. Never grants execution or fabricates owner evidence.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadArtifacts,schedulerReviewHash} from './ledger-v2-production.mjs';
import {jsonValue} from './ledger-v2-observe.mjs';
import {digest,verifyRollbackHold,verifyInitialPaidCpu,PAID_CPU_ADMISSION} from './ledger-v2-migration.mjs';
import {observedRepositoryBytes,verifyPaidReleaseBudget} from './private-trial-release.mjs';
import {PROJECT,SCRIPT} from './ledger-v2-google-http.mjs';
export function prepareDraft(verified,evidence,releaseId,now=Date.now(),operation='rollout',cpuAdmission=undefined) {
  if(!['rollout','rollback'].includes(operation))throw Error('Unknown migration operation');
  if(cpuAdmission!==undefined&&(cpuAdmission!==PAID_CPU_ADMISSION||operation!=='rollout'))throw Error('Unknown initial CPU admission policy');
  if(!/^[a-z][a-z0-9-]{1,80}$/.test(releaseId)||evidence.readOnly!==true||now<evidence.at||now-evidence.at>1800000)throw Error('Invalid release ID or stale evidence');
  const r=evidence.resources,b=jsonValue(r.paid),env=Object.fromEntries(r.marketapi.template.containers[0].env.map(e=>[e.name,e.value]));
  const required=['paid','legacy','marketapi','refreshmarket','projectIam','jobs','billing','repositoryFiles','hostingFiles','workerSource','workerDeployment'];
  if(required.some(k=>!r[k])||evidence.errors.some(e=>e.key!=='workerProcesses')||r.paid.updateTime!==r.paidAfter.updateTime||!r.hostingFiles.complete||r.jobs.nextPageToken)
    throw Error('Incomplete or inconsistent management evidence');
  if(digest(r.legacy.fields.value.stringValue)!==b.legacyLedgerSha256||r.billing.billingEnabled!==true)throw Error('Legacy integrity or billing scope changed');
  const imageHold=[...new Map(Object.values(verified.artifacts).map(a=>[a.imageDigest,a.imageReceipt.artifactStorageHoldBytes??0])).values()].reduce((sum,n)=>sum+n,0);
  if(!Number.isFinite(imageHold)||imageHold<=0)throw Error('Missing artifact storage allowance');
  const plan={kind:'ledger-v2-maintenance',productionExecutionEnabled:false,...(operation==='rollback'?{operation}:{}),...(cpuAdmission?{cpuAdmission}:{}),project:PROJECT,activePaidUpdate:true,operatingMode:'paid-budget',updateExistingLive:true,
    services:['marketapi','refreshmarket'],id:b.id,releaseId,servicePeriodId:env.MARKET_LIVE_ID,startsAt:new Date(b.startsAt).toISOString(),expiresAt:new Date(b.expiresAt).toISOString(),
    legacyLedgerSha256:b.legacyLedgerSha256,budgetUsd:5,applicationStopUsd:4.5,fixedReserveUsd:1,paidRolloutReserveUsd:.5,
    imageDigest:verified.packet.artifacts.candidate.imageDigest,...verified.packet.artifacts,observedAt:evidence.at,
    remainingAdmissionsRequired:null,maxBillingAgeMs:24*3600000,
    meters:{cpuSeconds:{used:b.reserved.cpuSeconds??0,hold:10000,limit:180000},memoryGiBSeconds:{used:b.reserved.memoryGiBSeconds??0,hold:10000,limit:360000},
      artifactBytes:{used:Math.max(observedRepositoryBytes(r),b.reserved.artifactBytes??0),hold:imageHold,limit:1024**3},
      logBytes:{used:b.reserved.logBytes??0,hold:16*1024**2,limit:50*1024**3}}};
  verifyPaidReleaseBudget(plan,b,now);
  if(operation==='rollback') {
    // Refresh current usage, but preserve the original reviewed holds and caps.
    // Legacy holds without contemporaneous proof are never backfilled here.
    const prior=b.deployments?.[releaseId]?.recovery;
    if(prior?.version===2)plan.cpuAdmission=PAID_CPU_ADMISSION;
    for(const [key,m]of Object.entries(plan.meters))if(prior?.meters?.[key])
      Object.assign(m,{hold:prior.meters[key].hold,limit:prior.meters[key].limit});
    verifyRollbackHold(plan,b,now);
  } else if(cpuAdmission)verifyInitialPaidCpu(plan,b,now);
  const owner={project:PROJECT,scriptId:SCRIPT,exclusiveMaintenance:false,reviewer:null,at:null,expiresAt:null,evidenceReferences:[],
    projectPolicyHash:digest(r.projectIam),schedulerInventoryHash:schedulerReviewHash(r.jobs.jobs??[]),
    worker:{paused:null,otherPropertiesHash:null,triggerHash:null,activeExecutions:null},
    barrier:{unknownWriters:['UNVERIFIED'],effectiveAccessVerified:false,authenticatedCallersStopped:false,activeApi:null,activeCollector:null,activeAdmin:null,drainVerifiedAt:null}};
  return {plan,owner,approval:{approved:false,reviewer:null,releaseId,planSha256:null,packetSha256:verified.packetSha256,issuedAt:null,expiresAt:null,allow:[]},
    pending:[...(cpuAdmission?['Review explicit initial paid CPU admission and its retained $0.50 hold']:[]),'Review remaining admission demand and set remainingAdmissionsRequired','Fresh owner checkpoint for missing management evidence','Explicit future execution authorization bound to finalized plan']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [packetPath,evidencePath,releaseId,directory,option]=process.argv.slice(2);
  if(![6,7].includes(process.argv.length)||![undefined,'--rollback','--paid-cpu'].includes(option)||!/^\.local\/[a-z0-9/-]+$/.test(directory??'')||directory.includes('..'))throw Error('Usage: node scripts/prepare-ledger-v2-migration.mjs <packet.json> <evidence.json> <release-id> .local/<new-directory> [--rollback | --paid-cpu]');
  const prepared=prepareDraft(loadArtifacts(resolve(packetPath)),JSON.parse(readFileSync(evidencePath,'utf8')),releaseId,Date.now(),option==='--rollback'?'rollback':'rollout',option==='--paid-cpu'?PAID_CPU_ADMISSION:undefined);
  mkdirSync(directory,{recursive:false});for(const [name,value]of Object.entries(prepared))writeFileSync(join(directory,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({directory:resolve(directory),executionAuthorized:false,pending:prepared.pending}));
}
