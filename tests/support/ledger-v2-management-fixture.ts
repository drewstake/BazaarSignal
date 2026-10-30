import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
// @ts-expect-error local tooling
import {migrationFixture} from '../../scripts/ledger-v2-fixture.mjs';
// @ts-expect-error local tooling
import {loadArtifacts,ProductionMigrationAdapter,workerHash,schedulerReviewHash} from '../../scripts/ledger-v2-production.mjs';
// @ts-expect-error local tooling
import {CLOUD_ROOT,JOBS,digest,Migration} from '../../scripts/ledger-v2-migration.mjs';
// @ts-expect-error local tooling
import {SCRIPT,DEPLOYMENT,PROJECT,DB} from '../../scripts/ledger-v2-google-http.mjs';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export function managementFixture() {
  const root=mkdtempSync(join(tmpdir(),'bazaar-management-'));
  const put=(path:string,value:any)=>{mkdirSync(dirname(path),{recursive:true});const b=typeof value==='string'?value:JSON.stringify(value);writeFileSync(path,b);return hash(b);};
  const packet:any={version:1,productionExecutionEnabled:false,provenance:{liveStateRevalidated:false},expiry:'2026-11-01T07:00:00.000Z',artifacts:{}};
  for(const flavor of ['candidate','fallback']) {
    const source=join(root,flavor),image=join(source,'.local/image');
    const sourceHash=put(join(source,'market-functions/lib/index.cjs'),'synthetic cloud');
    const lockHash=put(join(source,'market-functions/package-lock.json'),'{}');
    const sourceManifest=[{path:'fixture.ts',sha256:put(join(source,'fixture.ts'),'synthetic')}];
    put(join(source,'firebase.json'),{hosting:{public:'dist',rewrites:[{source:'**',destination:'/index.html'}]}});
    const files:any={hosting:{'index.html':`<html>${flavor}</html>`},appsScript:{'Backend.js':`var fixture='${flavor}';`,'Entrypoints.js':'function fixture() {}','appsscript.json':'{"timeZone":"Etc/UTC"}'}};
    const outputs:any={};
    for(const [group,dir]of [['hosting','dist'],['appsScript','apps-script/build']])outputs[group]=Object.keys(files[group]).sort().map(path=>({path,bytes:Buffer.byteLength(files[group][path]),sha256:put(join(source,dir,path),files[group][path])}));
    const blob=(v:any)=>{const b=JSON.stringify(v),h=hash(b);put(join(image,'oci/blobs/sha256',h),b);return {digest:'sha256:'+h,size:Buffer.byteLength(b)};};
    const config=blob({architecture:'amd64'}),layer=blob('synthetic-layer'),manifest=blob({mediaType:'application/vnd.oci.image.manifest.v1+json',config,layers:[layer]});
    const receipt={imageDigest:manifest.digest,applicationOnly:true,requiredBaseImage:'fixture-managed-base',localRuntimeSmokeVerified:true,cloudBuildMinutes:0,uploaded:false,registryUploadBytes:10000,artifactStorageHoldBytes:10000,
      localRuntimeSmoke:{outboundConnections:'blocked',handlerRequests:0},sourceSha256:sourceHash,lockSha256:lockHash};
    packet.artifacts[flavor]={sourceDirectory:source,ledgerFormats:[1,2],writesLedgerVersion:2,localRuntimeSmokeVerified:true,uploaded:false,
      sourceManifestSha256:put(join(root,`${flavor}-source-manifest.json`),sourceManifest),outputManifestSha256:put(join(root,`${flavor}-output-manifest.json`),outputs),
      hostingSha256:hash(JSON.stringify(outputs.hosting)),appsScriptSha256:hash(JSON.stringify(outputs.appsScript)),imageDirectory:image,imageDigest:manifest.digest,
      imageReceiptSha256:put(join(image,'receipt.json'),receipt)};
  }
  const packetPath=join(root,'packet.json');put(packetPath,packet);
  const verified=loadArtifacts(packetPath),f=migrationFixture(packet.artifacts),plan=f.plan;
  const services=structuredClone(f.state.services);
  const jobs=structuredClone(f.state.jobs);
  const projectIam={etag:'project-iam',bindings:[]};
  const workerSource=structuredClone(verified.artifacts.fallback.worker);
  const state:any={services,jobs,ledger:f.state.ledger.value,ledgerVersion:'ledger-1',control:'{}',receipts:[],source:workerSource,
    versions:{23:structuredClone(workerSource)},versionDescriptions:{23:'old'},deployment:{deploymentId:DEPLOYMENT,deploymentConfig:{scriptId:SCRIPT,versionNumber:23,manifestFileName:'appsscript',description:'preserve'}},
    hostingRelease:{name:'sites/bazaarsignal/releases/old',version:{name:'sites/bazaarsignal/versions/old'}},
    hostingVersions:{old:{name:'sites/bazaarsignal/versions/old',status:'FINALIZED',config:{rewrites:[{glob:'**',path:'/index.html'}]},files:verified.artifacts.fallback.files.map((x:any)=>({path:x.path,hash:x.hash}))}},
    operations:{},imagePresent:true,blobs:new Set(),uploadedFiles:new Set()};
  for(const s of Object.values(services) as any[]) {
    s.template.containers[0].baseImageUri='fixture-managed-base';
    s.trafficStatuses=[{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',revision:s.latestReadyRevision.split('/').at(-1),percent:100}];
  }
  const operator:any={project:PROJECT,scriptId:SCRIPT,exclusiveMaintenance:true,reviewer:'fixture-owner',evidenceReferences:['isolated-test'],at:f.io.now(),expiresAt:f.io.now()+600000,
    projectPolicyHash:digest(projectIam),schedulerInventoryHash:schedulerReviewHash(Object.values(jobs)),worker:{paused:true,otherPropertiesHash:digest('properties'),triggerHash:digest('triggers'),activeExecutions:0},
    barrier:{...structuredClone(f.state.barrier),drainVerifiedAt:f.io.now()}};
  const calls:any[]=[],journals:any[]=[],hooks:any={};let n=100;
  const response=(body:any,status=200,headers:any={})=>new Response(body===null?null:JSON.stringify(body),{status,headers});
  async function fetchImpl(url:string,options:any) {
    const u=new URL(url),p=decodeURIComponent(u.pathname),method=options.method,body=Buffer.isBuffer(options.body)?options.body:options.body?JSON.parse(options.body):undefined;
    const call={url,method,body};calls.push(call);hooks.before?.(call,state);
    let value:any={};
    if(u.hostname==='us-central1-docker.pkg.dev') {
      if(method==='HEAD')return response(null,state.imagePresent||state.blobs.has(p.split('/').at(-1))?200:404,hooks.omitRegistryDigest?{}:{'docker-content-digest':p.split('/').at(-1)});
      if(method==='GET'){
        const digest=p.split('/').at(-1)!,file=Object.values(verified.artifacts).map((a:any)=>join(a.imageDirectory,'oci/blobs/sha256',digest.slice(7))).find(existsSync);
        if(!file)return response({},404);
        return new Response(hooks.corruptRegistryContent?Buffer.from('wrong'):readFileSync(file),{status:200});
      }
      if(method==='POST')return response(null,202,{location:hooks.uploadLocation??'https://us-central1-docker.pkg.dev/artifacts-uploads/namespaces/bazaarsignal-510305/repositories/gcf-artifacts/uploads/test'});
      if(method==='PUT'){if(p.includes('/manifests/'))state.imagePresent=true;else state.blobs.add(u.searchParams.get('digest'));}
    } else if(u.hostname==='run.googleapis.com') {
      const name=p.includes('/services/marketapi')?'marketapi':'refreshmarket',s=services[name];
      if(p.includes('/operations/'))value={name:p.slice(4),done:!hooks.operationNeverCompletes,...(hooks.operationError?{error:{code:13}}:{})};
      else if(p.endsWith(':getIamPolicy'))value=s.iam;
      else if(p.endsWith(':setIamPolicy')){s.iam={...body.policy,etag:`iam-${++n}`};value=s.iam;}
      else if(method==='PATCH'){
        if(body.etag!==s.etag)return response({},412);
        if(u.searchParams.get('updateMask')==='template') {
          s.template=structuredClone(body.template);s.latestReadyRevision=`${s.name}/revisions/${name}-${++n}`;s.latestCreatedRevision=s.latestReadyRevision;
          s.readyDigest=s.template.containers[0].image.split('@').at(-1);s.template.revision=s.latestReadyRevision;
          if(s.traffic[0].type==='TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST')s.trafficStatuses=[{...s.traffic[0],revision:s.latestReadyRevision.split('/').at(-1)}];
        }else{s.traffic=body.traffic;s.trafficStatuses=structuredClone(body.traffic);}
        s.etag=`service-${++n}`;value={name:`${CLOUD_ROOT}/operations/fixture-${n}`,done:false};
      }else if(p.includes('/revisions/'))value={name:s.latestReadyRevision,containers:[{image:s.template.containers[0].image}]};
      else {value=structuredClone(s);delete value.iam;delete value.readyDigest;}
    }else if(u.hostname==='cloudscheduler.googleapis.com') {
      if(p.endsWith('/jobs'))value={jobs:Object.values(jobs)};
      else {const name=p.split('/').at(-1)!.split(':')[0];if(p.endsWith(':pause'))jobs[name].state='PAUSED';if(p.endsWith(':resume'))jobs[name].state='ENABLED';value=jobs[name];}
    }else if(u.hostname==='firestore.googleapis.com') {
      if(p.endsWith(':runQuery'))value=state.receipts.map((document:any)=>({document}));
      else if(p.endsWith(':commit')) {
        if(body.writes[0].currentDocument.updateTime!==state.ledgerVersion)return response({},412);
        state.ledger=JSON.parse(body.writes[0].update.fields.value.stringValue);state.ledgerVersion=`ledger-${++n}`;value={writeResults:[{updateTime:state.ledgerVersion}]};
      }else if(p.endsWith('/paid-budget-october'))value={updateTime:state.ledgerVersion,fields:{value:{stringValue:JSON.stringify(state.ledger)}}};
      else if(p.endsWith('/live-allowance'))value={fields:{value:{stringValue:f.state.legacyRaw}}};
      else value={fields:{value:{stringValue:state.control}}};
    }else if(u.hostname==='script.googleapis.com') {
      if(p.includes('/processes:'))value={processes:[]};
      else if(p.endsWith('/content')){
        if(method==='PUT')state.source=structuredClone(body);
        value=u.searchParams.has('versionNumber')?state.versions[u.searchParams.get('versionNumber')!]:state.source;
      }else if(p.endsWith('/versions')){
        if(method==='POST'){const versionNumber=++n;state.versions[versionNumber]=structuredClone(state.source);state.versionDescriptions[versionNumber]=body.description;value={versionNumber};}
        else value={versions:Object.keys(state.versions).map(versionNumber=>({versionNumber:Number(versionNumber),description:state.versionDescriptions[versionNumber]}))};
      }
      else if(p.includes('/deployments/')){if(method==='PUT')state.deployment={...state.deployment,...body};value=state.deployment;}
    }else if(u.hostname==='firebasehosting.googleapis.com') {
      if(p.endsWith('/releases')){
        if(method==='POST')state.hostingRelease={name:`sites/bazaarsignal/releases/r${++n}`,version:{name:u.searchParams.get('versionName')}};
        value=method==='POST'?state.hostingRelease:{releases:[state.hostingRelease]};
      }else if(p.endsWith('/versions')){const id=`v${++n}`;value=state.hostingVersions[id]={name:`sites/bazaarsignal/versions/${id}`,status:'CREATED',config:body.config,files:[]};}
      else {
        const id=p.match(/\/versions\/([^/:]+)/)![1],v=state.hostingVersions[id];
        if(p.endsWith(':populateFiles')){v.files=Object.entries(body.files).map(([path,hash])=>({path,hash}));value={uploadUrl:`https://upload-firebasehosting.googleapis.com/upload/${v.name}/files`,uploadRequiredHashes:v.files.map((f:any)=>f.hash)};}
        else if(p.endsWith('/files'))value={files:v.files};
        else {if(method==='PATCH')v.status=body.status;value=v;}
      }
    }else if(u.hostname==='upload-firebasehosting.googleapis.com'){state.uploadedFiles.add(p.split('/').at(-1));return new Response('OK');}
    else if(p.endsWith(':getIamPolicy'))value=projectIam;
    else if(p.endsWith('/billingInfo'))value={projectId:PROJECT,billingEnabled:true};
    else if(p.endsWith('/files'))value={files:[]};
    hooks.after?.(call,state);return response(value);
  }
  const authorization={approved:true,reviewer:'fixture-owner',releaseId:plan.releaseId,planSha256:digest(plan),packetSha256:verified.packetSha256,
    issuedAt:f.io.now(),expiresAt:f.io.now()+1800000,allow:['maintenance']};
  const adapter=new ProductionMigrationAdapter({plan,packetPath,authorization,token:async()=>'fixture-token',fetchImpl,now:f.io.now,
    wait:async(ms:number)=>{f.advance(ms);operator.at=f.io.now();operator.expiresAt=f.io.now()+600000;operator.barrier.drainVerifiedAt=f.io.now();},operatorEvidence:async()=>operator,save:async(j:any)=>{journals.push(j);}});
  const coordinator=new Migration(plan,adapter);
  const cleanup=()=>{if(dirname(root)!==resolve(tmpdir())||!root.split(/[\\/]/).at(-1)?.startsWith('bazaar-management-'))throw Error('Unsafe cleanup');rmSync(root,{recursive:true});};
  return {root,packetPath,packet,verified,plan,adapter,coordinator,state,operator,calls,hooks,journals,authorization,advance:f.advance,cleanup,workerHash};
}
