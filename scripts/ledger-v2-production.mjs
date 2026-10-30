// Production management adapter. Construction is read-only. Writes require an
// explicit, short-lived authorization bound to the exact plan and packet.
import {readFileSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync,existsSync,mkdirSync,readdirSync,unlinkSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {verifyPacket} from './verify-ledger-v2-packet.mjs';
import {observe,jsonValue} from './ledger-v2-observe.mjs';
import {GoogleManagementHttp,localTokens,SCRIPT,DEPLOYMENT,DB,REGISTRY,REPOSITORY,PROJECT} from './ledger-v2-google-http.mjs';
import {Migration,CLOUD_ROOT,SERVICES,JOBS,digest,stateHash,accountingHash,validate,assertSnapshot,assertContained,rolloutHold,assertRollbackAction,rolloutGrossUsd,recoveryApiPolicy} from './ledger-v2-migration.mjs';
import {compileRequest,compilePinRequest} from './ledger-v2-requests.mjs';
import {scheduleConfiguration,uploadLocation} from './private-trial-release.mjs';
import {paidReceiptKey} from '../collector/paid-ledger-storage.ts';
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const managementDigest=value=>digest(canonical(value));
const same=(a,b)=>managementDigest(a)===managementDigest(b);
const fail=message=>{throw Error(message);};
const publicIam=p=>p.bindings?.some(b=>b.members?.some(m=>['allUsers','allAuthenticatedUsers'].includes(m)));
export function workerInventory(content) {
  if(!Array.isArray(content?.files)||content.files.length!==3)fail('Unexpected worker file inventory');
  return content.files.map(f=>{
    if(!['Backend','Entrypoints','appsscript'].includes(f.name)||f.type!==(f.name==='appsscript'?'JSON':'SERVER_JS')||typeof f.source!=='string')fail('Unexpected worker source');
    return {path:f.name+(f.type==='JSON'?'.json':'.js'),bytes:Buffer.byteLength(f.source),sha256:sha(f.source)};
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export const workerHash=content=>digest(workerInventory(content));
export const hostingHash=files=>digest(files.map(f=>({path:f.path,hash:f.hash})).sort((a,b)=>a.path.localeCompare(b.path)));
export const schedulerReviewHash=jobs=>digest(jobs.map(job=>{
  const config=scheduleConfiguration(job);if(JOBS.includes(job.name.split('/').at(-1)))delete config.state;
  return {name:job.name,config};
}).sort((a,b)=>a.name.localeCompare(b.name)));
const reservedHosting=new Set(['/__/firebase/init.js','/__/firebase/init.json']);
export function hostingUserFiles(files) {
  if(files.some(f=>f.path.startsWith('/__/')&&!reservedHosting.has(f.path)))fail('Unknown reserved Hosting file');
  return files.filter(f=>!reservedHosting.has(f.path));
}
export function readyService(service,revision,iam) {
  const s=structuredClone(service);
  if(revision?.name!==s.latestReadyRevision||!revision?.containers?.[0]?.image?.match(/@sha256:[a-f0-9]{64}$/))fail('Ready revision identity missing');
  s.iam=iam;s.readyDigest=revision.containers[0].image.split('@').at(-1);
  // Cloud Run traffic uses the short revision ID, while latestReadyRevision is
  // a fully qualified resource name. Normalize for the coordinator only.
  s.traffic=(s.traffic??[]).map(t=>({...t,...(t.revision?{revision:t.revision.includes('/')?t.revision:`${s.name}/revisions/${t.revision}`}:{})}));
  const actual=s.trafficStatuses;
  if(!Array.isArray(actual)||actual.length!==1||actual[0].percent!==100||actual[0].tag||
    actual[0].revision!==s.latestReadyRevision.split('/').at(-1))fail('Actual serving traffic is not fully on the ready revision');
  return s;
}
export function normalizeObservation(o,operator,artifacts,now=Date.now()) {
  const r=o.resources;
  if(now-o.at>60000||now<o.at||o.errors.some(e=>e.key!=='workerProcesses'))fail('Fresh complete management evidence required');
  if(!operator||operator.project!==PROJECT||operator.scriptId!==SCRIPT||operator.exclusiveMaintenance!==true||!operator.reviewer||!operator.evidenceReferences?.length||
    !Number.isFinite(operator.at)||!Number.isFinite(operator.expiresAt)||operator.at>now||now-operator.at>600000||operator.expiresAt>operator.at+600000||operator.expiresAt<=now)
    fail('Fresh owner checkpoint for properties, triggers, effective access and executions required');
  if(!r.projectIam||operator.projectPolicyHash!==digest(r.projectIam)||!r.jobs||r.jobs.nextPageToken||
    operator.schedulerInventoryHash!==schedulerReviewHash(r.jobs.jobs??[]))fail('Owner access review does not match current project IAM/inventory');
  if(r.projectIam.bindings?.some(b=>['roles/run.invoker','roles/owner','roles/editor'].includes(b.role)&&
    b.members?.some(m=>['allUsers','allAuthenticatedUsers'].includes(m))))fail('Inherited public invocation grant defeats containment');
  if(r.paid.updateTime!==r.paidAfter.updateTime||r.receipts.length>4000||r.workerProcesses?.nextPageToken||!r.hostingFiles.complete)
    fail('Incomplete or changing accounting/worker/Hosting inventory');
  const receipts=r.receipts.filter(x=>x.document).map(x=>x.document).sort((a,b)=>a.name.localeCompare(b.name));
  const paid=jsonValue(r.paid);
  for(const d of receipts) {
    if(!new RegExp(`^${DB.replace(/[()]/g,'\\$&')}/marketCache/paid-receipt-[a-p]{64}$`).test(d.name))fail('Invalid receipt inventory');
    const value=jsonValue(d);if(value.version!==1||value.budget!==paid.id||typeof value.invocation!=='string'||
      !Number.isFinite(value.at)||d.name.split('/').at(-1)!==paidReceiptKey(value.budget,value.invocation))fail('Receipt identity or budget mismatch');
  }
  const sourceDigest=workerHash(r.workerSource),deploymentDigest=workerHash(r.workerDeployedSource);
  const compressed=hostingHash(hostingUserFiles(r.hostingFiles.files));
  const matched=Object.values(artifacts).find(a=>a.compressedHostingHash===compressed);
  const active=r.workerProcesses?(r.workerProcesses.processes??[]).length:operator.worker.activeExecutions;
  if(!/^[a-f0-9]{64}$/.test(operator.worker.otherPropertiesHash??'')||!/^[a-f0-9]{64}$/.test(operator.worker.triggerHash??'')||typeof operator.worker.paused!=='boolean')fail('Incomplete owner worker evidence');
  return {at:o.at,ledger:{value:paid,version:r.paid.updateTime},legacyRaw:r.legacy.fields.value.stringValue,
    controlHash:digest(r.control.fields.value.stringValue),receiptsHash:digest(receipts),receiptCount:receipts.length,
    services:Object.fromEntries(SERVICES.map(n=>[n,readyService(r[n],r[`${n}Revision`],r[`${n}Iam`])])),
    jobs:Object.fromEntries(JOBS.map(n=>[n,r[n]])),
    worker:{paused:operator.worker.paused,otherPropertiesHash:operator.worker.otherPropertiesHash,triggerHash:operator.worker.triggerHash,
      activeExecutions:active,sourceDigest,deploymentDigest,etag:digest({sourceDigest,deploymentDigest,worker:operator.worker,deployment:r.workerDeployment})},
    hosting:{digest:matched?.hostingSha256??compressed,etag:managementDigest(r.hosting.releases[0])},
    barrier:structuredClone(operator.barrier)};
}
// Keep two fsynced snapshots containing the entire intent/operation history.
// This bounds disk use without losing history; a torn pointer is recoverable.
export function diskJournal(directory) {
  mkdirSync(directory,{recursive:true});const lock=join(directory,'writer.lock');
  if(existsSync(lock)) {
    const prior=JSON.parse(readFileSync(lock,'utf8'));
    if(!Number.isSafeInteger(prior.pid)||prior.pid<=0)fail('Unrecognized writer lock; inspect manually');
    try{process.kill(prior.pid,0);fail('Another migration writer owns the journal');}
    catch(e){if(e.code!=='ESRCH')throw e;}
    renameSync(lock,join(directory,`stale-lock-${randomUUID()}.json`));
  }
  const identity={pid:process.pid,nonce:randomUUID(),at:new Date().toISOString()};
  const fd=openSync(lock,'wx');writeFileSync(fd,JSON.stringify(identity));fsyncSync(fd);closeSync(fd);
  const existing=readdirSync(directory).filter(f=>/^\d{6}\.json$/.test(f)).sort();
  let sequence=existing.length?Number(existing.at(-1).slice(0,6))+1:0;
  const save=async data=>{
    const path=join(directory,`${String(sequence++).padStart(6,'0')}.json`),h=openSync(path,'wx');
    const encoded=JSON.stringify({format:'ledger-v2-production-journal',sequence:sequence-1,data},null,2);
    if(Buffer.byteLength(encoded)>64*1024**2){closeSync(h);fail('Journal size bound exceeded');}
    try{writeFileSync(h,encoded);fsyncSync(h);}finally{closeSync(h);}
    const pointer=join(directory,'latest.tmp');writeFileSync(pointer,JSON.stringify({path}));renameSync(pointer,join(directory,'latest.json'));
    const old=readdirSync(directory).filter(f=>/^\d{6}\.json$/.test(f)).sort().slice(0,-2);
    for(const file of old) {
      const target=join(directory,file);let record;
      try{record=JSON.parse(readFileSync(target,'utf8'));}catch{renameSync(target,target+'.incomplete');continue;}
      if(record.format!=='ledger-v2-production-journal')fail('Unrelated journal file; refusing removal');
      unlinkSync(target);
    }
  };
  save.close=()=>{if(same(JSON.parse(readFileSync(lock,'utf8')),identity))unlinkSync(lock);else fail('Journal lock changed');};
  return save;
}
export function readJournal(directory) {
  if(!existsSync(directory))return undefined;
  for(const file of readdirSync(directory).filter(f=>/^\d{6}\.json$/.test(f)).sort().reverse()) {
    let snapshot;try{snapshot=JSON.parse(readFileSync(join(directory,file),'utf8'));}catch{continue;}
    if(snapshot.format!=='ledger-v2-production-journal')fail('Unexpected journal format');return snapshot.data;
  }
  return undefined;
}
export function loadArtifacts(packetPath) {
  const verified=verifyPacket(packetPath),artifacts={};
  for(const [flavor,a]of Object.entries(verified.packet.artifacts)) {
    const outputs=JSON.parse(readFileSync(join(dirname(packetPath),`${flavor}-output-manifest.json`),'utf8'));
    const worker={files:outputs.appsScript.map(f=>({name:f.path.replace(/\.(js|json)$/,''),type:f.path.endsWith('.json')?'JSON':'SERVER_JS',
      source:readFileSync(join(a.sourceDirectory,'apps-script/build',f.path),'utf8')}))};
    if(workerHash(worker)!==a.appsScriptSha256)fail('Worker manifest mismatch');
    const files=outputs.hosting.map(f=>{const bytes=gzipSync(readFileSync(join(a.sourceDirectory,'dist',f.path)),{level:9});return {path:'/'+f.path,hash:sha(bytes),bytes};});
    const imageReceipt=JSON.parse(readFileSync(join(a.imageDirectory,'receipt.json'),'utf8'));
    artifacts[flavor]={...a,worker,files,imageReceipt,compressedHostingHash:hostingHash(files),
      hostingConfig:JSON.parse(readFileSync(join(a.sourceDirectory,'firebase.json'),'utf8')).hosting};
  }
  return {...verified,artifacts};
}
export class ProductionMigrationAdapter {
  constructor({plan,packetPath,token,authorization=null,operatorEvidence=async()=>null,
    fetchImpl=fetch,now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),save=async()=>{},journal={http:{calls:0,responseBytes:0,requests:[]},steps:{}}}) {
    this.verified=loadArtifacts(resolve(packetPath));this.plan=structuredClone(plan);this.authorization=authorization;
    this.operatorEvidence=operatorEvidence;this.now=now;this.wait=wait;this.save=save;this.journal=journal;
    this.kind='google-management';this.dataset=PROJECT;
    this.http=new GoogleManagementHttp({token,fetchImpl,now,authorize:()=>this.executionAuthorized(this.plan),journal:journal.http,
      save:async()=>this.persist()});
    for(const key of ['candidate','fallback'])if(!same(plan[key],this.verified.packet.artifacts[key]))fail('Plan artifact differs from verified packet');
    const imageHold=[...new Map(Object.values(this.verified.artifacts).map(a=>[a.imageDigest,a.imageReceipt.artifactStorageHoldBytes])).values()].reduce((sum,n)=>sum+n,0);
    if(!Number.isFinite(imageHold)||imageHold<=0||plan.meters?.artifactBytes?.hold<imageHold||plan.meters?.cpuSeconds?.hold<10000||
      plan.meters?.memoryGiBSeconds?.hold<10000||plan.meters?.logBytes?.hold<16*1024**2)fail('Rollout reservation does not cover the verified artifacts and work');
    const gross=rolloutGrossUsd(plan.meters);
    if(!Number.isFinite(gross)||gross>.5)fail('Rollout work exceeds its retained allowance');
  }
  executionAuthorized(plan) {
    const a=this.authorization;
    return !!a&&a.approved===true&&a.reviewer&&a.planSha256===digest(plan)&&a.packetSha256===this.verified.packetSha256&&
      a.releaseId===plan.releaseId&&a.issuedAt<=this.now()&&a.expiresAt>this.now()&&a.expiresAt<=a.issuedAt+1800000&&a.allow?.includes('maintenance');
  }
  async persist(){await this.save(structuredClone(this.journal));}
  async saveJournal(coordinator){this.journal.coordinator=structuredClone(coordinator);await this.persist();}
  async read() {
    const observation=await observe(this.http,{now:this.now,full:true});
    this.lastObservation=observation;
    const state=normalizeObservation(observation,await this.operatorEvidence(),this.verified.artifacts,this.now());
    state.barrier.productionEvidence=true;state.barrier.requiredDrainAfter=this.journal.requiredDrainAfter??this.plan.observedAt;
    this.lastState=state;return state;
  }
  permit(action) {
    if(!this.executionAuthorized(this.plan))fail('Production mutation is not authorized');
    assertRollbackAction(this.plan,action);
    const a=this.authorization.allow;
    if(action.kind==='job-state'&&action.value==='ENABLED'&&!a.includes(action.name===JOBS[0]?'collection':'daily'))fail('Schedule resumption not authorized');
    if(action.kind==='api-policy'&&publicIam(action.value)&&!a.includes('api'))fail('API reopening not authorized');
    if(action.kind==='worker-pause'&&!action.value&&!a.includes('mail'))fail('Mail resumption not authorized');
  }
  async step(id,request,verify) {
    const body=Buffer.isBuffer(request.body)?null:structuredClone(request.body);if(body)delete body.etag;
    const bodyHash=Buffer.isBuffer(request.body)?sha(request.body):digest(body??null);
    const signature=digest({url:request.url,method:request.method,bodyHash});
    let step=this.journal.steps[id];
    if(step&&step.signature!==signature)fail('Operation identity changed');
    if(step) {
      if(step.verified)return step.response;
      const recovered=await verify?.(step);
      if(recovered){step.verified=true;step.reconciled=true;step.response=recovered;await this.persist();return recovered;}
      fail('Operation remains uncertain; no blind mutation retry');
    }
    step=this.journal.steps[id]={signature,intentAt:this.now(),request:{url:request.url,method:request.method,bodyHash}};await this.persist();
    try {
      const response=await this.http.request(request.url,request);
      step.response=request.rawResponse?{status:response.status}:response.json();await this.persist();
      if(verify) {
        const result=await verify(step);if(!result)fail('Mutation verification incomplete');step.response=result;
      }
      step.verified=true;await this.persist();return step.response;
    }catch(e){step.failure={code:e.code??'UNCERTAIN',status:e.status};await this.persist();throw e;}
  }
  async operation(step) {
    const op=step.response;
    if(!op?.name?.startsWith(`${CLOUD_ROOT}/operations/`)||!/^[-a-zA-Z0-9_]+$/.test(op.name.split('/').at(-1)))return false;
    let current=op;
    for(let i=0;!current.done&&i<20;i++) {
      await this.wait(5000);current=await this.http.json(`https://run.googleapis.com/v2/${op.name}`);
      if(current.name!==op.name)fail('Operation identity changed');
      step.lastOperation=current;await this.persist();
    }
    if(!current.done||current.error)fail('Cloud operation failed or exceeded polling deadline; remain contained');
    return current;
  }
  async service(name) {
    const s=await this.http.json(`https://run.googleapis.com/v2/${CLOUD_ROOT}/services/${name}`);
    if(!s.latestReadyRevision?.startsWith(`${s.name}/revisions/`))fail('Unknown ready revision');
    const rev=await this.http.json(`https://run.googleapis.com/v2/${s.latestReadyRevision}`);
    return {...s,readyDigest:rev.containers?.[0]?.image?.split('@').at(-1),revision:rev};
  }
  async guard(s) {
    const latest=await this.read();validate(this.plan,latest,this.now());assertSnapshot(latest,this.now());assertContained(latest);
    if(accountingHash(s)!==accountingHash(latest)||s.worker.otherPropertiesHash!==latest.worker.otherPropertiesHash||s.worker.triggerHash!==latest.worker.triggerHash)
      fail('Accounting or worker state changed behind barrier');
    return latest;
  }
  async image(artifact,id) {
    const receipt=artifact.imageReceipt,blob=d=>{
      if(!/^sha256:[a-f0-9]{64}$/.test(d))fail('Invalid image blob');const b=readFileSync(join(artifact.imageDirectory,'oci/blobs/sha256',d.slice(7)));
      if('sha256:'+sha(b)!==d)fail('Image content changed');return b;
    };
    const manifestBytes=blob(artifact.imageDigest),manifest=JSON.parse(manifestBytes);
    const manifestUrl=`${REGISTRY}/v2/${REPOSITORY}/manifests/${artifact.imageDigest}`;
    // Artifact Registry can omit Docker-Content-Digest on a successful HEAD.
    // Verify exact bounded bytes in that case; never treat a missing header as
    // proof of failure or as permission to repeat an upload.
    const verified=async(url,descriptor)=>{
      const head=await this.http.request(url,{method:'HEAD',allowed:[404]});
      if(head.status===404)return false;
      const header=head.headers.get('docker-content-digest');
      if(header){if(header!==descriptor.digest)fail('Registry digest mismatch');return true;}
      const content=await this.http.request(url,{limit:descriptor.size});
      if(content.bytes.length!==descriptor.size||'sha256:'+sha(content.bytes)!==descriptor.digest)fail('Registry content digest mismatch');
      return true;
    };
    const manifestDescriptor={digest:artifact.imageDigest,size:manifestBytes.length};
    if(await verified(manifestUrl,manifestDescriptor))return;
    let uploaded=0;
    for(const descriptor of [manifest.config,...manifest.layers]) {
      const bytes=blob(descriptor.digest);if(bytes.length!==descriptor.size)fail('Image size changed');
      const url=`${REGISTRY}/v2/${REPOSITORY}/blobs/${descriptor.digest}`;
      if(await verified(url,descriptor))continue;
      // Upload-session creation cannot be retried after an unknown outcome.
      const key=`${id}:upload:${descriptor.digest}`,prior=this.journal.steps[key];
      if(prior&&!prior.location)fail('Upload session outcome unknown');
      if(!prior) {
        this.journal.steps[key]={intentAt:this.now()};await this.persist();
        const response=await this.http.request(`${REGISTRY}/v2/${REPOSITORY}/blobs/uploads/`,{method:'POST'});
        const location=uploadLocation(response.headers.get('location'));location.searchParams.set('digest',descriptor.digest);
        this.journal.steps[key].location=location.href;await this.persist();
      }
      const step=this.journal.steps[key];if(step.putStarted)fail('Upload outcome unknown; inspect blob before continuation');
      uploaded+=bytes.length;if(uploaded+manifestBytes.length>receipt.registryUploadBytes)fail('Upload size budget exceeded');
      step.putStarted=true;await this.persist();
      await this.http.request(step.location,{method:'PUT',body:bytes,contentType:'application/octet-stream'});
      if(!await verified(url,descriptor))fail('Uploaded blob verification incomplete');
      step.verified=true;await this.persist();
    }
    await this.step(`${id}:manifest`,{url:manifestUrl,method:'PUT',body:manifestBytes,contentType:manifest.mediaType},async()=>{
      return await verified(manifestUrl,manifestDescriptor)?{digest:artifact.imageDigest}:false;
    });
  }
  async deploy(action,s) {
    const artifact=Object.values(this.verified.artifacts).find(a=>a.imageDigest===action.value);
    if(!artifact)fail('Only verified v2 artifacts may be deployed by the production adapter');
    if(!artifact.imageReceipt.requiredBaseImage||s.services[action.name].template.containers[0].baseImageUri!==artifact.imageReceipt.requiredBaseImage)
      fail('Managed runtime base differs from the verified application image');
    if(!s.ledger.value.deployments?.[this.plan.releaseId])fail('Retained rollout reservation required before upload');
    await this.image(artifact,action.id);await this.guard(s);
    const request=compileRequest(action,s),desired=request.body.template;
    await this.step(`${action.id}:revision`,request,async step=>{
      if(step.response?.name)await this.operation(step);
      const service=await this.service(action.name);
      if(service.reconciling||service.latestReadyRevision!==service.latestCreatedRevision||service.terminalCondition?.state!=='CONDITION_SUCCEEDED'||
        service.readyDigest!==action.value||service.template.containers[0].image!==desired.containers[0].image)return false;
      const actual=structuredClone(service.template);delete actual.revision;
      if(!same(actual,desired))fail('Ready service configuration drift');return {revision:service.latestReadyRevision};
    });
    await this.guard(s);const ready=await this.service(action.name);
    const pin=compilePinRequest(action.name,action.value,ready);
    // REST traffic targets use a revision ID, not the full resource path.
    pin.body.traffic[0].revision=ready.latestReadyRevision.split('/').at(-1);
    await this.step(`${action.id}:pin`,pin,async step=>{
      if(step.response?.name)await this.operation(step);
      const current=await this.service(action.name),t=current.trafficStatuses??[];
      return !current.reconciling&&current.readyDigest===action.value&&same(current.traffic,pin.body.traffic)&&
        t.length===1&&t[0].percent===100&&!t[0].tag&&t[0].revision===pin.body.traffic[0].revision?{revision:current.latestReadyRevision}:false;
    });
  }
  async worker(action,s) {
    const artifact=Object.values(this.verified.artifacts).find(a=>a.appsScriptSha256===action.value);
    if(!artifact)fail('Unknown worker artifact');
    const url=`https://script.googleapis.com/v1/projects/${SCRIPT}`;
    const originalDeployment=this.journal.actions[action.id].workerDeployment;
    const old=await this.http.json(`${url}/content`),manifest=c=>c.files.find(f=>f.name==='appsscript')?.source;
    if(!same(JSON.parse(manifest(old)),JSON.parse(manifest(artifact.worker))))fail('Worker scopes or manifest changed');
    if(workerHash(old)!==s.worker.sourceDigest&&workerHash(old)!==action.value)fail('Concurrent worker edit');
    await this.step(`${action.id}:source`,{url:`${url}/content`,method:'PUT',body:artifact.worker},async()=>
      workerHash(await this.http.json(`${url}/content`))===action.value?{digest:action.value}:false);
    await this.guard(s);
    const version=await this.step(`${action.id}:version`,{url:`${url}/versions`,method:'POST',body:{description:this.plan.releaseId}},async step=>{
      // A lost POST can be recovered by one immutable version with this exact
      // release marker AND content hash. Never create another version blindly.
      let version=step.response;
      if(!version?.versionNumber) {
        const list=await this.http.json(`${url}/versions?pageSize=100`);
        const matches=list.versions?.filter(v=>v.description===this.plan.releaseId)??[];
        if(list.nextPageToken||matches.length!==1)return false;version=matches[0];
      }
      const content=await this.http.json(`${url}/content?versionNumber=${version.versionNumber}`);
      return workerHash(content)===action.value?version:false;
    });
    const deployment=await this.http.json(`${url}/deployments/${DEPLOYMENT}`);
    if(!same(deployment,originalDeployment)&&deployment.deploymentConfig.versionNumber!==version.versionNumber)fail('Concurrent web deployment edit');
    const config={...deployment.deploymentConfig,versionNumber:version.versionNumber};
    await this.step(`${action.id}:deployment`,{url:`${url}/deployments/${DEPLOYMENT}`,method:'PUT',body:{deploymentConfig:config}},async()=>{
      const current=await this.http.json(`${url}/deployments/${DEPLOYMENT}`);
      return same(current.deploymentConfig,config)?current:false;
    });
    if(workerHash(await this.http.json(`${url}/content`))!==action.value)fail('Saved worker code drifted');
  }
  async hosting(action,s) {
    const artifact=Object.values(this.verified.artifacts).find(a=>a.hostingSha256===action.value);
    if(!artifact)fail('Unknown Hosting artifact');
    const root='https://firebasehosting.googleapis.com/v1beta1';
    const before=this.journal.actions[action.id].hostingRelease;
    // Preserve the actual deployed serving configuration, not CLI-only fields.
    const config=this.lastObservation.resources.hostingVersion.config;
    const version=await this.step(`${action.id}:version`,{url:`${root}/sites/bazaarsignal/versions`,method:'POST',body:{config}},async step=>
      /^sites\/bazaarsignal\/versions\/[a-zA-Z0-9_-]+$/.test(step.response?.name??'')?step.response:false);
    const reserved=this.journal.actions[action.id].reservedHosting;
    const populated=await this.step(`${action.id}:populate`,{url:`${root}/${version.name}:populateFiles`,method:'POST',body:{files:Object.fromEntries([...artifact.files,...reserved].map(f=>[f.path,f.hash]))}});
    const expectedUpload=`https://upload-firebasehosting.googleapis.com/upload/${version.name}/files`;
    if(populated.uploadUrl!==expectedUpload)fail('Untrusted Hosting upload URL');
    for(const h of populated.uploadRequiredHashes??[]) {
      const f=artifact.files.find(f=>f.hash===h);if(!f)fail('Unrequested Hosting hash');
      await this.step(`${action.id}:file:${h}`,{url:`${expectedUpload}/${h}`,method:'POST',body:f.bytes,contentType:'application/octet-stream',rawResponse:true});
    }
    await this.step(`${action.id}:finalize`,{url:`${root}/${version.name}?updateMask=status`,method:'PATCH',body:{status:'FINALIZED'}},async()=>{
      const current=await this.http.json(`${root}/${version.name}`);return current.status==='FINALIZED'?current:false;
    });
    await this.guard(s);
    const current=await this.http.json(`${root}/sites/bazaarsignal/releases?pageSize=1`);
    if(!same(current.releases[0],before)&&current.releases[0]?.version?.name!==version.name)fail('Concurrent Hosting release; refusing overwrite');
    await this.step(`${action.id}:release`,{url:`${root}/sites/bazaarsignal/releases?versionName=${encodeURIComponent(version.name)}`,method:'POST',body:{message:this.plan.releaseId}},async()=>{
      const current=await this.http.json(`${root}/sites/bazaarsignal/releases?pageSize=1`);
      return current.releases?.[0]?.version?.name===version.name?current.releases[0]:false;
    });
  }
  async apply(action) {
    this.permit(action);
    const s=await this.read();if(stateHash(s)!==action.expectedStateHash)throw Object.assign(Error('Management state changed before mutation'),{code:'REJECTED'});
    validate(this.plan,s,this.now());assertSnapshot(s,this.now());
    if(action.kind==='reserve') {
      const expected=structuredClone(s.ledger.value),held=action.value?.deployments?.[this.plan.releaseId];
      if(expected.deployments?.[this.plan.releaseId]||!held||!Number.isFinite(held.at)||held.at<this.plan.observedAt||held.at>this.now())fail('Invalid or repeated reservation action');
      const retained=rolloutHold(this.plan,s.ledger.value,held.at);
      expected.reservedUsd+=.5;expected.deployments??={};expected.deployments[this.plan.releaseId]=retained;
      for(const[k,m]of Object.entries(this.plan.meters))expected.reserved[k]=(expected.reserved[k]??0)+m.hold;
      if(!same(expected,action.value))fail('Reservation may only add the exact retained rollout hold');
    }
    if(action.kind==='api-policy') {
      const clean=value=>{const p=structuredClone(value);delete p.etag;return p;};
      const current=clean(s.services.marketapi.iam),privatePolicy=structuredClone(current);
      privatePolicy.bindings=(privatePolicy.bindings??[]).map(b=>({...b,members:b.members.filter(m=>!['allUsers','allAuthenticatedUsers'].includes(m))})).filter(b=>b.members.length);
      const snapshot=this.journal.coordinator?.original;
      const original=snapshot?recoveryApiPolicy(this.plan,snapshot):null;
      if(!same(clean(action.value),privatePolicy)&&!(original&&same(clean(action.value),clean(original))&&['natural-verified','open'].includes(this.journal.coordinator.phase)))
        fail('IAM action changes more than the reviewed public-access barrier');
    }
    if(action.kind==='job-state'&&action.value==='ENABLED') {
      const phases=action.name===JOBS[0]?['deployed-contained']:['natural-verified','open'];
      if(!phases.includes(this.journal.coordinator?.phase))fail('Schedule resumption is out of sequence');
      const original=this.journal.coordinator.original;
      if(this.plan.shutdownRecovery)recoveryApiPolicy(this.plan,original);
      else if(original.jobs[action.name]?.state!=='ENABLED')fail('Originally paused job must remain paused');
    }
    if(this.plan.shutdownRecovery&&action.kind==='worker-pause'&&action.value===false)fail('Shutdown recovery cannot resume mail');
    this.journal.actions??={};
    if(this.journal.actions[action.id])fail('Action already attempted; use reconciliation');
    this.journal.actions[action.id]={action:structuredClone(action),before:structuredClone(s),
      workerDeployment:this.lastObservation.resources.workerDeployment,hostingRelease:this.lastObservation.resources.hosting.releases[0],
      reservedHosting:this.lastObservation.resources.hostingFiles.files.filter(f=>reservedHosting.has(f.path))};await this.persist();
    if(action.kind==='worker-pause') {
      if(action.value)this.journal.requiredDrainAfter=this.now();
      this.journal.manualCheckpoint={action,required:'Owner changes only MARKET_UPDATES_PAUSED, preserves other properties/triggers, drains executions, refreshes owner evidence.'};await this.persist();
      throw Object.assign(Error('Owner checkpoint required; no script-properties REST API'),{code:'MANUAL_CHECKPOINT'});
    }
    if(['reserve','deploy','worker-code','hosting'].includes(action.kind))assertContained(s);
    if(action.kind==='deploy')await this.deploy(action,s);
    else if(action.kind==='worker-code')await this.worker(action,s);
    else if(action.kind==='hosting')await this.hosting(action,s);
    else {
      if(action.kind==='job-state'){
        const current=scheduleConfiguration(s.jobs[action.name]);delete current.state;
        if(!same(current,action.expectedConfiguration))fail('Scheduler configuration changed');
      }
      const request=compileRequest(action,s);
      await this.step(action.id,request,async()=>{
        if(action.kind==='reserve') {const d=await this.http.json(`https://firestore.googleapis.com/v1/${DB}/marketCache/paid-budget-october`);return same(jsonValue(d),action.value)?{updateTime:d.updateTime}:false;}
        if(action.kind==='job-state') {const d=await this.http.json(`https://cloudscheduler.googleapis.com/v1/${CLOUD_ROOT}/jobs/${action.name}`);return d.state===action.value?d:false;}
        if(action.kind==='api-policy') {const d=await this.http.json(`https://run.googleapis.com/v1/${CLOUD_ROOT}/services/marketapi:getIamPolicy?options.requestedPolicyVersion=3`);const a={...action.value},b={...d};delete a.etag;delete b.etag;return same(a,b)?d:false;}
        return false;
      });
    }
    if((action.kind==='job-state'&&action.value==='PAUSED')||(action.kind==='api-policy'&&!publicIam(action.value))) {
      this.journal.requiredDrainAfter=this.now();await this.persist();
    }
    return {done:true,name:`management-action:${action.id}`};
  }
  async reconcileAction(action) {
    this.permit(action);const saved=this.journal.actions?.[action.id];
    // A read-only rejection can safely close its intent. Any durable mutation
    // intent or HTTP write keeps the normal fail-closed reconciliation path.
    const intent=this.journal.coordinator?.steps.find(s=>s.id===action.id);
    if(!saved&&intent?.error==='Management state changed before mutation'&&
        !Object.keys(this.journal.steps).some(k=>k===action.id||k.startsWith(action.id+':'))&&
        this.http.journal.requests.filter(r=>r.at>=intent.at).every(r=>r.readOnly===true))
      return {rejectedBeforeMutation:true};
    if(!saved||!same(saved.action,action))fail('Missing durable production action');
    // A compound action can have a completed image/source update and a pending
    // pin/version/release. Continue verified substeps, never replay unknown POSTs.
    if(['deploy','worker-code','hosting'].includes(action.kind)) {
      await this.guard(saved.before);
      if(action.kind==='deploy')await this.deploy(action,saved.before);
      if(action.kind==='worker-code')await this.worker(action,saved.before);
      if(action.kind==='hosting')await this.hosting(action,saved.before);
    }
  }
  async naturalEvidence(coordinator) {
    if(coordinator.journal.phase!=='awaiting-natural-run')fail('Not awaiting natural collection');
    const state=await this.read(),r=this.lastObservation.resources,owner=await this.operatorEvidence(),proof=owner.naturalExecution;
    const before=coordinator.journal.beforeNatural;
    if(!proof||proof.scheduled!==true||proof.snapshotComplete!==true||!proof.logEvidenceReference||
      !/^[a-f0-9]{64}$/.test(proof.logEvidenceSha256??'')||proof.verifiedAt<before.at||proof.verifiedAt>this.now()||this.now()-proof.verifiedAt>60000||
      proof.revision!==state.services.refreshmarket.latestReadyRevision)fail('Fresh owner-reviewed natural execution log and complete snapshot evidence required');
    const receipt=r.receipts.filter(x=>x.document).map(x=>jsonValue(x.document)).find(v=>v.invocation===proof.eventId);
    // Firebase's deployed Scheduler wrapper can supply the short job name
    // and an RFC3339 offset. Both identities name this exact configured job;
    // compare the parsed instant against its actual Scheduler attempt below.
    const prefix=[`${CLOUD_ROOT}/jobs/${JOBS[0]}:`,`${JOBS[0]}:`].find(p=>typeof proof.eventId==='string'&&proof.eventId.startsWith(p));
    const scheduledAt=prefix?Date.parse(proof.eventId.slice(prefix.length)):NaN;
    const job=state.jobs[JOBS[0]],lastAttempt=Date.parse(job.lastAttemptTime),control=jsonValue(r.control),bazaar=control.jobs?.bazaar;
    if(!receipt?.finished||!Number.isFinite(scheduledAt)||scheduledAt<before.at||scheduledAt%900000!==0||
      !Number.isFinite(lastAttempt)||lastAttempt<scheduledAt||lastAttempt>scheduledAt+180000||job.status?.code||
      !bazaar||bazaar.error||bazaar.snapshotVersion!==proof.snapshotVersion||!Number.isFinite(bazaar.upstreamAt)||
      !Number.isFinite(bazaar.lastCheckedAt)||bazaar.lastCheckedAt<scheduledAt||bazaar.lastCheckedAt>this.now()||
      this.now()-bazaar.lastCheckedAt>180000||this.now()-bazaar.upstreamAt>180000)fail('Natural receipt, Scheduler attempt or snapshot evidence does not match');
    return {kind:'natural-schedule',job:JOBS[0],revision:proof.revision,eventId:proof.eventId,receipt,
      at:bazaar.lastCheckedAt,sampleAt:bazaar.upstreamAt,snapshotComplete:true};
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [mode,packetPath,planPath,approvalPath,ownerPath,directory,command]=process.argv.slice(2);
  const commands=['contain','deploy','rollback','reconcile','resume-collection','verify-natural','reopen-api','resume-daily','resume-mail'];
  if(mode!=='--execute'||process.argv.length!==9||!commands.includes(command)||!/^\.local\/[a-z0-9/-]+$/.test(directory??'')||directory.includes('..'))
    fail('Default is no execution. For a separately authorized window: --execute <packet.json> <plan.json> <approval.json> <owner-evidence.json> .local/<journal-directory> <command>');
  const json=p=>JSON.parse(readFileSync(resolve(p),'utf8')),plan=json(planPath),approval=json(approvalPath);
  // Check before credential discovery or management calls.
  const verified=verifyPacket(packetPath);
  if(approval.approved!==true||approval.planSha256!==digest(plan)||approval.packetSha256!==verified.packetSha256||approval.expiresAt<=Date.now())fail('Explicit matching execution authorization required');
  const save=diskJournal(resolve(directory));
  try {
    const journal=readJournal(resolve(directory)),adapter=new ProductionMigrationAdapter({plan,packetPath,authorization:approval,
      operatorEvidence:async()=>json(ownerPath),token:await localTokens(),save,...(journal?{journal}:{})});
    const coordinator=new Migration(plan,adapter,journal?.coordinator);
    if(command==='reconcile')await coordinator.reconcile();
    else if(command==='contain')await coordinator.contain();
    else if(command==='deploy')await coordinator.deploy();
    else if(command==='rollback')await coordinator.rollback();
    else if(command==='resume-collection')await coordinator.beginNaturalVerification({collection:true});
    else if(command==='verify-natural')await coordinator.acceptNaturalEvidence(await adapter.naturalEvidence(coordinator));
    else if(command==='reopen-api')await coordinator.reopen({api:true});
    else if(command==='resume-daily')await coordinator.reopen({daily:true});
    else if(command==='resume-mail')await coordinator.reopen({mail:true});
    console.log(JSON.stringify({phase:coordinator.journal.phase,journalDirectory:resolve(directory),calls:adapter.http.journal.calls}));
  }finally{save.close();}
}
