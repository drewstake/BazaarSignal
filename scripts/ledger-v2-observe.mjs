// Read-only management evidence. No app endpoint, trigger, mail or user data.
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CLOUD_ROOT,SERVICES,JOBS,digest} from './ledger-v2-migration.mjs';
import {GoogleManagementHttp,localTokens,PROJECT,SCRIPT,DEPLOYMENT,DB} from './ledger-v2-google-http.mjs';
export const jsonValue=d=>JSON.parse(d.fields.value.stringValue);
export function receiptQuery() {
  return {structuredQuery:{from:[{collectionId:'marketCache'}],where:{compositeFilter:{op:'AND',filters:[
    {fieldFilter:{field:{fieldPath:'__name__'},op:'GREATER_THAN_OR_EQUAL',value:{referenceValue:`${DB}/marketCache/paid-receipt-`}}},
    {fieldFilter:{field:{fieldPath:'__name__'},op:'LESS_THAN',value:{referenceValue:`${DB}/marketCache/paid-receipt.`}}}]}},limit:4001}};
}
export async function observe(http,{now=Date.now,full=true}={}) {
  const result={at:now(),resources:{},errors:[],unknowns:[],readOnly:true};
  async function get(key,url,options) {
    try {const value=await http.json(url,options);result.resources[key]=value;return value;}
    catch(e){result.errors.push({key,message:e.message});return undefined;}
  }
  const r=result.resources;
  for(const name of SERVICES) {
    const service=await get(name,`https://run.googleapis.com/v2/${CLOUD_ROOT}/services/${name}`);
    await get(`${name}Iam`,`https://run.googleapis.com/v1/${CLOUD_ROOT}/services/${name}:getIamPolicy?options.requestedPolicyVersion=3`);
    if(service?.latestReadyRevision)await get(`${name}Revision`,`https://run.googleapis.com/v2/${service.latestReadyRevision}`);
  }
  for(const name of JOBS)await get(name,`https://cloudscheduler.googleapis.com/v1/${CLOUD_ROOT}/jobs/${name}`);
  await get('paid',`https://firestore.googleapis.com/v1/${DB}/marketCache/paid-budget-october`);
  await get('legacy',`https://firestore.googleapis.com/v1/${DB}/marketCache/live-allowance`);
  await get('control',`https://firestore.googleapis.com/v1/${DB}/marketCache/control`);
  await get('receipts',`https://firestore.googleapis.com/v1/${DB}:runQuery`,{method:'POST',body:receiptQuery()});
  await get('paidAfter',`https://firestore.googleapis.com/v1/${DB}/marketCache/paid-budget-october`);
  await get('workerSource',`https://script.googleapis.com/v1/projects/${SCRIPT}/content`);
  const deployment=await get('workerDeployment',`https://script.googleapis.com/v1/projects/${SCRIPT}/deployments/${DEPLOYMENT}`);
  if(deployment?.deploymentConfig?.versionNumber)await get('workerDeployedSource',`https://script.googleapis.com/v1/projects/${SCRIPT}/content?versionNumber=${deployment.deploymentConfig.versionNumber}`);
  await get('workerProcesses',`https://script.googleapis.com/v1/processes:listScriptProcesses?scriptId=${SCRIPT}&pageSize=100&scriptProcessFilter.statuses=RUNNING&scriptProcessFilter.statuses=DELAYED`);
  const hosting=await get('hosting',`https://firebasehosting.googleapis.com/v1beta1/sites/bazaarsignal/releases?pageSize=1`);
  const version=hosting?.releases?.[0]?.version?.name;
  if(version&&/^sites\/bazaarsignal\/versions\/[a-zA-Z0-9_-]+$/.test(version)) {
    await get('hostingVersion',`https://firebasehosting.googleapis.com/v1beta1/${version}`);
    const files=[];let pageToken,complete=false;
    for(let page=0;page<6;page++) {
      const data=await get(`hostingFiles${page}`,`https://firebasehosting.googleapis.com/v1beta1/${version}/files?pageSize=1000${pageToken?'&pageToken='+encodeURIComponent(pageToken):''}`);
      if(!data)break;files.push(...data.files??[]);pageToken=data.nextPageToken;if(!pageToken){complete=true;break;}
    }
    r.hostingFiles={files,complete};
  }
  if(full) {
    await get('project',`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}`);
    await get('projectIam',`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy`,{method:'POST',body:{options:{requestedPolicyVersion:3}}});
    await get('jobs',`https://cloudscheduler.googleapis.com/v1/${CLOUD_ROOT}/jobs?pageSize=100`);
    await get('repository',`https://artifactregistry.googleapis.com/v1/${CLOUD_ROOT}/repositories/gcf-artifacts`);
    await get('repositoryFiles',`https://artifactregistry.googleapis.com/v1/${CLOUD_ROOT}/repositories/gcf-artifacts/files?pageSize=1000`);
    await get('billing',`https://cloudbilling.googleapis.com/v1/projects/${PROJECT}/billingInfo`);
  }
  result.finishedAt=now();result.unknowns.push('Script properties and trigger inventory require owner inspection; no REST accessor',
    'Effective inherited/custom IAM and every authenticated writer require operator review',
    'Cloud Run in-flight requests cannot be proven absent from a service GET; drainage evidence required');
  if(r.paid&&r.paidAfter&&r.paid.updateTime!==r.paidAfter.updateTime)result.unknowns.push('Ledger changed during evidence collection; not a consistent maintenance snapshot');
  if(r.workerProcesses?.nextPageToken)result.unknowns.push('Worker process inventory truncated');
  if(r.jobs?.nextPageToken)result.unknowns.push('Scheduler inventory truncated');
  if(r.repositoryFiles?.nextPageToken)result.unknowns.push('Repository file inventory truncated');
  if(r.receipts?.filter(x=>x.document).length>4000)result.unknowns.push('Receipt inventory exceeded bound');
  return result;
}
export function summarize(observation) {
  const r=observation.resources,b=r.paid?jsonValue(r.paid):undefined;
  const receipts=r.receipts?.filter(x=>x.document).map(x=>x.document)??[];
  return {at:new Date(observation.at).toISOString(),finishedAt:new Date(observation.finishedAt).toISOString(),readOnly:true,
    services:Object.fromEntries(SERVICES.map(n=>[n,{revision:r[n]?.latestReadyRevision,image:r[`${n}Revision`]?.containers?.[0]?.image,
      traffic:r[n]?.traffic,trafficStatuses:r[n]?.trafficStatuses,public:r[`${n}Iam`]?.bindings?.some(b=>b.members?.includes('allUsers'))}])),
    jobs:JOBS.map(n=>({name:n,state:r[n]?.state,schedule:r[n]?.schedule,lastAttemptTime:r[n]?.lastAttemptTime,status:r[n]?.status})),
    ledger:b?{version:b.version,bytes:Buffer.byteLength(r.paid.fields.value.stringValue),admissionCount:b.admissionCount??Object.keys(b.admissions).length,
      externalReceipts:receipts.length,remainingAdmissions:4000-(b.admissionCount??Object.keys(b.admissions).length),reservedUsd:b.reservedUsd,
      actualBilling:b.billing?.latest??null,billingError:b.billing?.error??null,stoppedAt:b.stoppedAt,reason:b.reason,expiresAt:new Date(b.expiresAt).toISOString(),
      legacyUnchanged:r.legacy?digest(r.legacy.fields.value.stringValue)===b.legacyLedgerSha256:null,
      stableDuringRead:r.paid.updateTime===r.paidAfter?.updateTime}:null,
    worker:{version:r.workerDeployment?.deploymentConfig?.versionNumber,sourceFiles:r.workerSource?.files?.map(f=>({name:f.name,sha256:digest(f.source??'')})),
      activeProcesses:r.workerProcesses&&!r.workerProcesses.nextPageToken?r.workerProcesses.processes?.length??0:null,propertiesConfirmed:false},
    hosting:{version:r.hosting?.releases?.[0]?.version?.name,releaseTime:r.hosting?.releases?.[0]?.releaseTime,files:r.hostingFiles?.files.length,inventoryComplete:r.hostingFiles?.complete},
    errors:observation.errors,unknowns:observation.unknowns,productionReady:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [mode,directory]=process.argv.slice(2);
  if(mode!=='--observe'||process.argv.length!==4||!/^\.local\/[a-z0-9/-]+$/.test(directory??'')||directory.includes('..'))throw Error('Usage: node scripts/ledger-v2-observe.mjs --observe .local/<new-directory>');
  const out=resolve(directory);mkdirSync(out,{recursive:false});
  const save=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n');
  const token=await localTokens();const http=new GoogleManagementHttp({token,maxCalls:60,maxResponseBytes:16*1024**2,save:j=>save('http-journal.json',j)});
  const observation=await observe(http);save('evidence.json',observation);const summary=summarize(observation);save('summary.json',summary);
  console.log(JSON.stringify({directory:out,calls:http.journal.calls,bytes:http.journal.responseBytes,...summary},null,2));
}
