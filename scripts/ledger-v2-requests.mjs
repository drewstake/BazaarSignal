// Compile reviewable management requests. This module never sends them.
import {CLOUD_ROOT,SERVICES,JOBS,digest} from './ledger-v2-migration.mjs';
const registry='us-central1-docker.pkg.dev/bazaarsignal-510305/gcf-artifacts/market-trial';
const db='projects/bazaarsignal-510305/databases/(default)';
const requireValue=(condition,message)=>{if(!condition)throw Error(message);};
export function compileRequest(action,state) {
  const base={executionEnabled:false,actionId:action.id,timeoutMs:30000,automaticRetries:0,
    reconcile:'Observe the resource/operation and match the expected state before any further mutation.'};
  if(action.kind==='job-state') {
    requireValue(JOBS.includes(action.name)&&['PAUSED','ENABLED'].includes(action.value),'Unreviewed Scheduler action');
    return {...base,method:'POST',url:`https://cloudscheduler.googleapis.com/v1/${CLOUD_ROOT}/jobs/${action.name}:${action.value==='PAUSED'?'pause':'resume'}`,
      body:{},precondition:{configurationSha256:digest(action.expectedConfiguration),state:state.jobs[action.name].state}};
  }
  if(action.kind==='api-policy') {
    requireValue(action.etag===state.services.marketapi.iam.etag&&action.value.etag===action.etag,'IAM etag changed');
    return {...base,method:'POST',url:`https://run.googleapis.com/v1/${CLOUD_ROOT}/services/marketapi:setIamPolicy`,body:{policy:structuredClone(action.value)}};
  }
  if(action.kind==='reserve') {
    requireValue(action.updateTime===state.ledger.version,'Ledger update time changed');
    return {...base,method:'POST',url:`https://firestore.googleapis.com/v1/${db}/documents:commit`,body:{writes:[{
      update:{name:`${db}/documents/marketCache/paid-budget-october`,fields:{value:{stringValue:JSON.stringify(action.value)}}},
      currentDocument:{updateTime:action.updateTime}}]}};
  }
  if(action.kind==='deploy') {
    requireValue(SERVICES.includes(action.name)&&/^sha256:[a-f0-9]{64}$/.test(action.value),'Unreviewed service or image');
    const s=state.services[action.name];requireValue(s.etag===action.etag,'Service etag changed');
    const template=structuredClone(s.template);delete template.revision;template.containers[0].image=`${registry}@${action.value}`;
    return {...base,method:'PATCH',url:`https://run.googleapis.com/v2/${s.name}?updateMask=template`,body:{name:s.name,etag:s.etag,template},
      afterOperation:'Verify ready revision image; compilePinRequest with its fresh service etag. Keep all writers contained through both updates.'};
  }
  if(action.kind==='worker-pause')return {...base,operatorStep:'Set only MARKET_UPDATES_PAUSED on the existing Apps Script project',
    value:action.value?'true':'false',precondition:{workerEvidence:action.etag},
    preserve:['all other properties','trigger inventory','delivery state'],verify:'Read back the property; drain ongoing executions. Never run a handler.'};
  if(action.kind==='worker-code')return {...base,operatorStep:'Upload verified saved source and update the existing versioned web deployment',
    expectedBundleSha256:action.value,precondition:{workerEvidence:action.etag},
    preserve:['script/deployment IDs','manifest/scopes','trigger ownership','all properties','delivery state']};
  if(action.kind==='hosting')return {...base,operatorStep:'Publish or restore the exact verified Hosting artifact on the existing site',
    expectedManifestSha256:action.value,precondition:{hostingEvidence:action.etag},preserve:['site ID','Firestore rules','private user data']};
  throw Error('Unsupported migration action');
}
export function compilePinRequest(name,image,service) {
  requireValue(SERVICES.includes(name)&&service.name===`${CLOUD_ROOT}/services/${name}`&&service.etag&&
    !service.reconciling&&service.latestReadyRevision===service.latestCreatedRevision&&
    service.terminalCondition?.state==='CONDITION_SUCCEEDED'&&service.readyDigest===image&&
    service.template.containers[0].image.endsWith(`@${image}`),'Revision not verified for traffic pin');
  return {executionEnabled:false,method:'PATCH',url:`https://run.googleapis.com/v2/${service.name}?updateMask=traffic`,
    body:{name:service.name,etag:service.etag,traffic:[{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',revision:service.latestReadyRevision,percent:100}]},
    timeoutMs:30000,automaticRetries:0};
}
