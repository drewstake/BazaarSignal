import {afterEach,expect,it} from 'vitest';
import {join} from 'node:path';
import {readdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {managementFixture} from './support/ledger-v2-management-fixture';
// @ts-expect-error local tooling
import {Migration,JOBS,CLOUD_ROOT,digest,stateHash} from '../scripts/ledger-v2-migration.mjs';
// @ts-expect-error local tooling
import {ProductionMigrationAdapter,normalizeObservation,hostingUserFiles,diskJournal,readJournal} from '../scripts/ledger-v2-production.mjs';
// @ts-expect-error local tooling
import {DB} from '../scripts/ledger-v2-google-http.mjs';
// @ts-expect-error local tooling
import {prepareDraft} from '../scripts/prepare-ledger-v2-migration.mjs';
import {paidReceiptKey} from '../collector/paid-ledger-storage';
const fixtures:ReturnType<typeof managementFixture>[]=[];
const fixture=()=>{const f=managementFixture();fixtures.push(f);return f;};
afterEach(()=>{for(const f of fixtures.splice(0))f.cleanup();});
async function contained(){const f=fixture();await f.coordinator.start();await f.coordinator.contain();return f;}
it('runs the real adapter through isolated REST responses: CAS, ready operations, pinned traffic, source/version/deployment and Hosting',async()=>{
  const f=await contained();await f.coordinator.deploy();
  expect(f.state.ledger.version).toBe(1);expect(f.state.ledger.reservedUsd).toBe(1.5);
  expect(f.state.services.marketapi.traffic[0].revision).not.toContain('/');
  expect(f.state.services.marketapi.trafficStatuses[0].percent).toBe(100);
  expect(f.workerHash(f.state.source)).toBe(f.packet.artifacts.candidate.appsScriptSha256);
  expect(f.workerHash(f.state.versions[f.state.deployment.deploymentConfig.versionNumber])).toBe(f.packet.artifacts.candidate.appsScriptSha256);
  expect(f.state.hostingRelease.version.name).not.toBe('sites/bazaarsignal/versions/old');
  expect(f.state.uploadedFiles.size).toBe(1);
  expect(JOBS.every((n:string)=>f.state.jobs[n].state==='PAUSED')).toBe(true);
  expect(f.calls.some(c=>/run\.app|script.google.com|:run$/.test(c.url))).toBe(false);
});
it('has no default write permission and binds explicit authorization to the plan and packet',async()=>{
  const f=fixture();f.adapter.authorization=null;
  expect(()=>new Migration(f.plan,f.adapter)).toThrow('authorization');
  await expect(f.adapter.apply({kind:'reserve'})).rejects.toThrow('not authorized');expect(f.calls).toHaveLength(0);
  f.adapter.authorization={...f.authorization,packetSha256:'0'.repeat(64)};
  expect(f.adapter.executionAuthorized(f.plan)).toBe(false);
});
it('requires an explicit owner checkpoint for the worker pause instead of invoking a script function',async()=>{
  const f=fixture();f.operator.worker.paused=false;
  await expect(f.coordinator.contain()).rejects.toThrow('checkpoint');
  expect(f.calls.every(c=>c.method==='GET'||c.url.endsWith(':runQuery')||c.url.endsWith(':getIamPolicy'))).toBe(true);
  f.operator.worker.paused=true;await f.coordinator.contain();expect(f.state.jobs[JOBS[0]].state).toBe('PAUSED');
});
it.each(['operationError','operationNeverCompletes'])('leaves writers contained after %s',async(problem)=>{
  const f=await contained();f.hooks[problem]=true;
  await expect(f.coordinator.deploy()).rejects.toThrow(/operation|deadline/);
  expect(f.coordinator.journal.pending).toBeTruthy();expect(f.operator.worker.paused).toBe(true);
  expect(f.calls.filter(c=>c.method==='PATCH'&&c.url.endsWith('updateMask=template'))).toHaveLength(1);
});
it('reconciles a lost revision response and finishes pinning without repeating the template mutation',async()=>{
  const f=await contained();let once=true;
  f.hooks.after=(c:any)=>{if(once&&c.method==='PATCH'&&c.url.endsWith('updateMask=template')){once=false;throw Error('Lost response');}};
  await expect(f.coordinator.deploy()).rejects.toThrow('outcome unknown');
  f.hooks.after=undefined;await f.coordinator.reconcile();await f.coordinator.deploy();
  expect(f.calls.filter(c=>c.method==='PATCH'&&c.url.includes('services/refreshmarket?updateMask=template'))).toHaveLength(1);
});
it('does not duplicate a reservation after a lost successful CAS response',async()=>{
  const f=await contained();let once=true;
  f.hooks.after=(c:any)=>{if(once&&c.url.endsWith(':commit')){once=false;throw Error('Lost response');}};
  await f.coordinator.deploy();expect(f.state.ledger.reservedUsd).toBe(1.5);
  expect(f.calls.filter(c=>c.url.endsWith(':commit'))).toHaveLength(1);
});
it('blocks unapproved collection, API, daily and mail resumption',async()=>{
  const f=await contained();await f.coordinator.deploy();
  for(const action of [{kind:'job-state',name:JOBS[0],value:'ENABLED'},{kind:'job-state',name:JOBS[1],value:'ENABLED'},
    {kind:'api-policy',value:{bindings:[{members:['allUsers']}]}},{kind:'worker-pause',value:false}])
    expect(()=>f.adapter.permit(action)).toThrow('not authorized');
});
it('rejects stale owner evidence and unknown reserved Hosting files',async()=>{
  const f=fixture();f.operator.expiresAt=f.adapter.now()-1;await expect(f.coordinator.start()).rejects.toThrow('owner checkpoint');
  expect(()=>hostingUserFiles([{path:'/__/unexpected',hash:'x'}])).toThrow('Unknown');
});
it('retains accounting and resumes v2-compatible fallback without a second reservation',async()=>{
  const f=await contained();await f.coordinator.deploy();const before=digest(f.state.ledger);
  await f.coordinator.rollback();expect(digest(f.state.ledger)).toBe(before);
  expect(f.workerHash(f.state.source)).toBe(f.packet.artifacts.fallback.appsScriptSha256);
  expect(f.state.jobs[JOBS[0]].state).toBe('PAUSED');
});
it('uploads only verified OCI blobs within the retained allowance',async()=>{
  const f=await contained();f.state.imagePresent=false;await f.coordinator.deploy();
  expect(f.calls.some(c=>c.url.includes('/blobs/uploads/')&&c.method==='POST')).toBe(true);
  expect(f.state.imagePresent).toBe(true);expect(f.state.ledger.reservedUsd).toBe(1.5);
});
it('rejects an unrelated registry upload location without forwarding credentials',async()=>{
  const f=await contained();f.state.imagePresent=false;f.hooks.uploadLocation='https://untrusted.invalid/upload';
  await expect(f.coordinator.deploy()).rejects.toThrow('Untrusted registry');
  expect(f.calls.some(c=>c.url.includes('untrusted.invalid'))).toBe(false);
});
it.each(['version','deployment','hosting-release'])('reconciles or safely stops a lost %s response without duplicating it',async(kind)=>{
  const f=await contained();let once=true;
  const matches=(c:any)=>kind==='version'?c.method==='POST'&&c.url.includes('script.googleapis.com')&&c.url.endsWith('/versions'):
    kind==='deployment'?c.method==='PUT'&&c.url.includes('/deployments/'):c.method==='POST'&&c.url.includes('/releases?versionName=');
  f.hooks.after=(c:any)=>{if(once&&matches(c)){once=false;throw Error('Lost acknowledgement');}};
  try{await f.coordinator.deploy();}catch(e){expect((e as Error).message).toContain('outcome unknown');}
  f.hooks.after=undefined;
  await f.coordinator.reconcile();await f.coordinator.deploy();
  expect(f.calls.filter(matches)).toHaveLength(1);expect(f.state.jobs[JOBS[0]].state).toBe('PAUSED');
});
it('rejects a changed ledger or etag before issuing an action',async()=>{
  const f=await contained(),before=await f.adapter.read();
  f.state.ledger.reservedUsd+=.1;
  await expect(f.adapter.apply({kind:'reserve',id:'wrong',expectedStateHash:stateHash(before),value:before.ledger.value,updateTime:before.ledger.version})).rejects.toThrow('changed');
  expect(f.calls.some(c=>c.url.endsWith(':commit'))).toBe(false);
});
it('keeps a bounded durable journal, rejects a second writer, and recovers an interrupted snapshot',async()=>{
  const f=fixture(),dir=join(f.root,'journal'),save=diskJournal(dir);
  expect(()=>diskJournal(dir)).toThrow('writer');
  for(let i=0;i<4;i++)await save({calls:i,history:['intent','verified']});
  expect(readdirSync(dir).filter(x=>x.endsWith('.json')&&/^\d/.test(x))).toHaveLength(2);
  expect(readJournal(dir).calls).toBe(3);save.close();
  writeFileSync(join(dir,'000004.json'),'{');expect(readJournal(dir).calls).toBe(3);
  const next=diskJournal(dir);await next({calls:5});expect(readJournal(dir).calls).toBe(5);next.close();
});
it.each(['full','short-offset','other-job'])('requires actual receipt and fresh operator-reviewed natural execution proof before reopening (%s)',async(format)=>{
  const f=await contained();await f.coordinator.deploy();
  f.authorization.allow.push('collection');await f.coordinator.beginNaturalVerification({collection:true});
  const at=Math.ceil(f.adapter.now()/900000)*900000;f.advance(at-f.adapter.now()+7000);
  f.operator.at=f.adapter.now();f.operator.expiresAt=f.adapter.now()+600000;
  const eventId=format==='short-offset'?`${JOBS[0]}:${new Date(at-7*3600000).toISOString().replace('Z','-07:00')}`:
    `${format==='other-job'?'other-job':`${CLOUD_ROOT}/jobs/${JOBS[0]}`}:${new Date(at).toISOString()}`;
  f.state.ledger.version=2;f.state.ledger.admissionCount=2;f.state.ledgerVersion='natural-2';
  f.state.receipts=[{name:`${DB}/marketCache/${paidReceiptKey(f.plan.id,eventId)}`,fields:{value:{stringValue:JSON.stringify({version:1,budget:f.plan.id,invocation:eventId,at,finished:true})}}}];
  f.state.control=JSON.stringify({jobs:{bazaar:{upstreamAt:at,lastCheckedAt:at+1000,snapshotVersion:'fixture-complete',error:null}}});
  f.state.jobs[JOBS[0]].lastAttemptTime=new Date(at+1000).toISOString();
  await expect(f.adapter.naturalEvidence(f.coordinator)).rejects.toThrow('owner-reviewed');
  f.operator.naturalExecution={eventId,revision:f.state.services.refreshmarket.latestReadyRevision,verifiedAt:f.adapter.now(),scheduled:true,
    snapshotComplete:true,snapshotVersion:'fixture-complete',logEvidenceReference:'isolated-log',logEvidenceSha256:'a'.repeat(64)};
  if(format==='other-job'){await expect(f.adapter.naturalEvidence(f.coordinator)).rejects.toThrow('does not match');return;}
  await f.coordinator.acceptNaturalEvidence(await f.adapter.naturalEvidence(f.coordinator));
  expect(f.coordinator.journal.phase).toBe('natural-verified');expect(f.operator.worker.paused).toBe(true);
});
it('CLI rejects missing execution approval before any credential lookup',()=>{
  const result=spawnSync(process.execPath,['scripts/ledger-v2-production.mjs'],{encoding:'utf8',windowsHide:true});
  expect(result.status).toBe(1);expect(result.stderr).toContain('Default is no execution');
});
it('prepares local drafts without inventing capacity, owner evidence or execution permission',async()=>{
  const f=fixture();await f.adapter.read();
  const draft=prepareDraft(f.verified,f.adapter.lastObservation,'fixture-release',f.adapter.now());
  expect(draft.plan.remainingAdmissionsRequired).toBeNull();expect(draft.approval.approved).toBe(false);
  expect(draft.owner.worker.paused).toBeNull();expect(draft.plan.imageDigest).toBe(f.plan.imageDigest);
  expect(()=>prepareDraft(f.verified,f.adapter.lastObservation,'fixture-release',f.adapter.now()+1800001)).toThrow('stale');
});
it('independently rejects a ledger reset and extra IAM grants even when given a matching state hash',async()=>{
  const f=await contained(),s=await f.adapter.read(),value=structuredClone(s.ledger.value);
  value.reservedUsd=0;value.deployments={[f.plan.releaseId]:{at:f.adapter.now(),reservedUsd:.5,imageDigest:f.plan.imageDigest}};
  await expect(f.adapter.apply({kind:'reserve',id:'tamper-ledger',expectedStateHash:stateHash(s),value,updateTime:s.ledger.version})).rejects.toThrow('exact retained');
  const policy=structuredClone(s.services.marketapi.iam);policy.bindings.push({role:'roles/owner',members:['user:fixture@example.invalid']});
  await expect(f.adapter.apply({kind:'api-policy',id:'tamper-iam',expectedStateHash:stateHash(s),value:policy,etag:policy.etag})).rejects.toThrow('reviewed');
  expect(f.calls.some(c=>c.url.endsWith(':commit'))).toBe(false);
});
it('requires exclusive maintenance evidence and refuses an incompatible managed runtime base',async()=>{
  const f=fixture();f.operator.exclusiveMaintenance=false;await expect(f.coordinator.start()).rejects.toThrow('checkpoint');
  f.operator.exclusiveMaintenance=true;f.state.services.refreshmarket.template.containers[0].baseImageUri='unreviewed-base';
  await f.coordinator.start();await f.coordinator.contain();await expect(f.coordinator.deploy()).rejects.toThrow('runtime base');
  expect(f.calls.some(c=>c.method==='PATCH')).toBe(false);
});
it('rejects a plan that under-reserves packaged image storage',()=>{
  const f=fixture(),plan=structuredClone(f.plan);plan.meters.artifactBytes.hold=1;
  expect(()=>new ProductionMigrationAdapter({plan,packetPath:f.packetPath,token:async()=>'unused'})).toThrow('does not cover');
});
it('rejects pre-containment zero-count evidence until the owner verifies completion after the barrier changes',async()=>{
  const f=fixture();f.adapter.wait=async(ms:number)=>{f.advance(ms);};
  await expect(f.coordinator.contain()).rejects.toThrow('Fresh completion evidence');
  expect(f.calls.some(c=>c.url.endsWith(':commit')||c.method==='PATCH')).toBe(false);
});
