import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {managementFixture} from './support/ledger-v2-management-fixture';
import {BILLING_ACCOUNT_ID,BILLING_SUBSCRIPTION,BILLING_INTERVAL_START} from '../shared/paid-spending';
import {PaidLedger,PAID_BUDGET_KEY} from '../collector/paid-budget';
import {trialGoogleStore} from '../collector/trial-google';
import {fixtureTime,paidRuntimeFixture,snapshotFixture} from './support/paid-runtime-fixture';
// @ts-expect-error local tooling
import {Migration,JOBS,END,digest,accountingHash,stateHash,rolloutHold} from '../scripts/ledger-v2-migration.mjs';
// @ts-expect-error isolated fixture
import {migrationFixture} from '../scripts/ledger-v2-fixture.mjs';
// @ts-expect-error local tooling
import {ProductionMigrationAdapter} from '../scripts/ledger-v2-production.mjs';
// @ts-expect-error local tooling
import {prepareDraft} from '../scripts/prepare-ledger-v2-migration.mjs';

const billing=(now:number)=>({accountId:BILLING_ACCOUNT_ID,subscription:BILLING_SUBSCRIPTION,
  budgetId:'fixture-budget',scope:'fixture-only',intervalStart:BILLING_INTERVAL_START,
  latest:{actualUsd:0,publishedAt:now,receivedAt:now,intervalStart:BILLING_INTERVAL_START}});
const management:ReturnType<typeof managementFixture>[]=[];
beforeEach(()=>vi.stubGlobal('fetch',()=>{throw Error('Network forbidden: isolated fixtures only');}));
afterEach(()=>{vi.unstubAllGlobals();for(const f of management.splice(0))f.cleanup();});
async function grown() {
  const f=migrationFixture();f.state.ledger.value.reserved.cpuSeconds=146440;
  await f.coordinator.contain();await f.coordinator.deploy();
  await f.coordinator.beginNaturalVerification({collection:true});
  await f.coordinator.acceptNaturalEvidence(f.naturalEvidence());await f.coordinator.reopen({api:true,daily:true,mail:true});
  f.advance(3*86400000);
  f.state.ledger.value.reserved.cpuSeconds=277960;f.state.ledger.value.reserved.memoryGiBSeconds=277960;
  f.state.ledger.value.reservedUsd=7.3;f.state.ledger.value.billing=billing(f.io.now());
  f.state.worker.otherPropertiesHash=digest('newer mail slot and delivery receipts');
  const plan={...structuredClone(f.plan),operation:'rollback',observedAt:f.io.now()};
  plan.meters.cpuSeconds.used=277960;plan.meters.memoryGiBSeconds.used=277960;
  return {f,plan};
}
it('reuses the original reserved CPU for a fresh rollback after days of runtime growth, preserving every counter and receipt',async()=>{
  const {f,plan}=await grown(),before=accountingHash(f.state),worker=f.state.worker.otherPropertiesHash;
  const strict={...plan};delete strict.operation;
  await expect(new Migration(strict,f.io).start()).rejects.toThrow('meter headroom');
  const c=new Migration(plan,f.io);await c.rollback();
  expect(accountingHash(f.state)).toBe(before);expect(f.state.worker.otherPropertiesHash).toBe(worker);
  expect(f.records.filter((x:any)=>x.kind==='reserve')).toHaveLength(1);
  expect(f.state.services.marketapi.readyDigest).toBe(plan.fallback.imageDigest);
  expect(f.state.worker.sourceDigest).toBe(plan.fallback.appsScriptSha256);
  expect(f.state.hosting.digest).toBe(plan.fallback.hostingSha256);
  expect(f.state.worker.paused).toBe(true);expect(JOBS.every((n:string)=>f.state.jobs[n].state==='PAUSED')).toBe(true);
  expect(f.state.services.marketapi.iam.bindings.flatMap((b:any)=>b.members)).not.toContain('allUsers');
  expect(c.journal.phase).toBe('deployed-contained');
  const proof=f.state.ledger.value.deployments[plan.releaseId].recovery;
  expect(proof).toMatchObject({cpuUsed:146440,retainedCpuBefore:146440,meters:{cpuSeconds:{hold:10000,limit:180000}}});
});
it.each(['new release','unreserved legacy hold','missing proof','missing meters','wrong artifacts','changed CPU cap','changed CPU hold','unfunded proof','over-limit original allowance'])('rejects unsupported rollback allowance: %s',async(problem)=>{
  const {f,plan}=await grown(),held=f.state.ledger.value.deployments[plan.releaseId];
  if(problem==='new release')plan.releaseId='different-release';
  if(problem==='unreserved legacy hold')delete f.state.ledger.value.deployments;
  if(problem==='missing proof')delete held.recovery;
  if(problem==='missing meters')delete held.recovery.meters;
  if(problem==='wrong artifacts')plan.fallback.appsScriptSha256='9'.repeat(64);
  if(problem==='changed CPU cap')plan.meters.cpuSeconds.limit++;
  if(problem==='changed CPU hold')plan.meters.cpuSeconds.hold++;
  if(problem==='unfunded proof')f.state.ledger.value.reserved.cpuSeconds=held.recovery.retainedCpuBefore;
  if(problem==='over-limit original allowance')held.recovery.cpuUsed=180000;
  const before=f.records.length;await expect(new Migration(plan,f.io).rollback()).rejects.toThrow('rollback CPU allowance');
  expect(f.records).toHaveLength(before);
});
it.each(['cost stop','recorded stop','expired pilot','stale plan','stale billing','failed billing','missing billing','relaxed billing age','admissions','unknown writer','memory','storage','logs'])('retains rollback protection: %s',async(problem)=>{
  const {f,plan}=await grown(),b=f.state.ledger.value;
  if(problem==='cost stop')b.billing.latest.actualUsd=4.5;
  if(problem==='recorded stop')b.stoppedAt=f.io.now();
  if(problem==='expired pilot'){f.advance(END-f.io.now());plan.observedAt=f.io.now();b.billing=billing(f.io.now());}
  if(problem==='stale plan')plan.observedAt-=1800001;
  if(problem==='stale billing')b.billing.latest.publishedAt-=86400001;
  if(problem==='failed billing')b.billing.error='Unavailable';
  if(problem==='missing billing')delete b.billing;
  if(problem==='relaxed billing age')plan.maxBillingAgeMs=86400001;
  if(problem==='admissions'){b.admissionCount=3999;f.state.receiptCount=3998;}
  if(problem==='unknown writer')f.state.barrier.unknownWriters=['unverified'];
  if(problem==='memory')b.reserved.memoryGiBSeconds=360001;
  if(problem==='storage')b.reserved.artifactBytes=1024**3+1;
  if(problem==='logs')b.reserved.logBytes=50*1024**3+1;
  const before=f.records.length;await expect(new Migration(plan,f.io).rollback()).rejects.toThrow();expect(f.records).toHaveLength(before);
});
it('keeps a new rollout blocked by the CPU cap even with fresh reported spending of zero',async()=>{
  const {f,plan}=await grown();delete plan.operation;plan.releaseId='new-rollout';
  await expect(new Migration(plan,f.io).contain()).rejects.toThrow('meter headroom');
  expect(f.records.filter((a:any)=>a.kind==='reserve')).toHaveLength(1);
});
it('does not turn a rollback plan into permission to deploy candidates, downgrade, reopen or resume work',async()=>{
  const {f,plan}=await grown(),c=new Migration(plan,f.io);await c.rollback();const count=f.records.length;
  await expect(c.deploy()).rejects.toThrow('Rollback-only');
  await expect(c.rollback('original')).rejects.toThrow('Rollback-only');
  await expect(c.beginNaturalVerification({collection:true})).rejects.toThrow('Rollback-only');
  await expect(c.acceptNaturalEvidence({})).rejects.toThrow('Rollback-only');
  await expect(c.reopen({api:true,daily:true,mail:true})).rejects.toThrow('Rollback-only');
  expect(f.records).toHaveLength(count);
});
it('refuses active executions and late accounting writes before falling back at high retained CPU',async()=>{
  const {f,plan}=await grown();f.state.barrier.activeApi=1;
  const count=f.records.filter((a:any)=>a.kind==='deploy').length,c=new Migration(plan,f.io);
  await expect(c.rollback()).rejects.toThrow('drained');
  expect(f.records.filter((a:any)=>a.kind==='deploy')).toHaveLength(count);
  f.state.barrier.activeApi=0;let waits=0;f.hooks.onWait=(s:any)=>{if(++waits===2)s.ledger.value.reservedUsd+=.01;};
  await expect(c.rollback()).rejects.toThrow('during drainage');
  expect(f.records.filter((a:any)=>a.kind==='deploy')).toHaveLength(count);
});
it('the real paid runtime retains rollback evidence while admitting and finishing a v2 receipt',async()=>{
  const f=paidRuntimeFixture(snapshotFixture('offline-rollback',fixtureTime,1));
  const b=JSON.parse(f.f.read(PAID_BUDGET_KEY)!),plan=migrationFixture().plan;
  b.reserved.cpuSeconds=146440;b.billing=billing(fixtureTime);
  const held=rolloutHold(plan,b,fixtureTime);b.deployments={[plan.releaseId]:held};
  b.reserved.cpuSeconds+=10000;b.reservedUsd+=.5;f.f.seed(PAID_BUDGET_KEY,JSON.stringify(b));
  const store=trialGoogleStore(f.f.config),ledger=new PaidLedger(store,()=>fixtureTime);
  try {
    const session=await ledger.admit('browser','offline-after-reservation');await session!.finish();
    const after=JSON.parse(f.f.read(PAID_BUDGET_KEY)!);
    expect(after.version).toBe(2);expect(after.deployments[plan.releaseId]).toEqual(held);
    expect(after.reserved.cpuSeconds).toBe(156460);expect(after.reservedUsd).toBeGreaterThan(b.reservedUsd);
    expect(f.receipts()).toMatchObject([{invocation:'offline-after-reservation',finished:true}]);
  } finally {await store.close();}
});

async function grownManagement() {
  const f=managementFixture();management.push(f);f.state.ledger.reserved.cpuSeconds=146440;
  await f.coordinator.contain();await f.coordinator.deploy();f.advance(3*86400000);
  f.state.ledger.reserved.cpuSeconds=277960;f.state.ledger.reserved.memoryGiBSeconds=277960;
  f.state.ledger.reservedUsd=7.3;f.state.ledger.billing=billing(f.adapter.now());
  f.operator.at=f.adapter.now();f.operator.expiresAt=f.adapter.now()+600000;f.operator.barrier.drainVerifiedAt=f.adapter.now();
  await f.adapter.read();
  const draft=prepareDraft(f.verified,f.adapter.lastObservation,f.plan.releaseId,f.adapter.now(),'rollback');
  draft.plan.remainingAdmissionsRequired=1000;
  const authorization={...f.authorization,planSha256:digest(draft.plan),issuedAt:f.adapter.now(),expiresAt:f.adapter.now()+1800000};
  const makeAdapter=(journal?:any)=>new ProductionMigrationAdapter({plan:draft.plan,packetPath:f.packetPath,authorization,
    token:async()=>'fixture-token',fetchImpl:f.adapter.http.fetchImpl,now:f.adapter.now,wait:f.adapter.wait,
    operatorEvidence:async()=>f.operator,save:async(j:any)=>{f.journals.push(j);},...(journal?{journal}:{})});
  const adapter=makeAdapter();
  return {f,draft,adapter,makeAdapter,authorization};
}
it('prepares a fresh unapproved rollback draft and exercises the real adapter with only isolated REST responses',async()=>{
  const {f,draft,adapter}=await grownManagement(),before=digest(f.state.ledger);
  expect(draft.plan.operation).toBe('rollback');expect(draft.plan.meters.cpuSeconds.used).toBe(277960);
  expect(draft.approval.approved).toBe(false);expect(draft.owner.exclusiveMaintenance).toBe(false);
  expect(draft.plan.meters.cpuSeconds.limit).toBe(180000);
  expect(f.adapter.executionAuthorized(draft.plan)).toBe(false); // Old approval does not transfer.
  const c=new Migration(draft.plan,adapter);await c.rollback();
  expect(digest(f.state.ledger)).toBe(before);expect(f.calls.filter(x=>x.url.endsWith(':commit'))).toHaveLength(1);
  expect(f.workerHash(f.state.source)).toBe(draft.plan.fallback.appsScriptSha256);
  expect(JOBS.every((n:string)=>f.state.jobs[n].state==='PAUSED')).toBe(true);
  expect(f.calls.some(x=>/run\.app|script.google.com|:run$/.test(x.url))).toBe(false);
});
it('the adapter independently rejects spending or reopening actions under a rollback-only plan',async()=>{
  const {f,draft,adapter}=await grownManagement(),count=f.calls.length;
  // Even granting every old capability cannot widen this plan's purpose.
  adapter.authorization.allow.push('collection','daily','api','mail');
  for(const action of [{kind:'reserve'},{kind:'worker-code',value:draft.plan.candidate.appsScriptSha256},
    {kind:'hosting',value:draft.plan.candidate.hostingSha256},{kind:'job-state',name:JOBS[0],value:'ENABLED'},
    {kind:'job-state',name:JOBS[1],value:'ENABLED'},{kind:'api-policy',value:{bindings:[{members:['allUsers']}]}},
    {kind:'worker-pause',value:false}])await expect(adapter.apply(action)).rejects.toThrow('Rollback-only');
  expect(f.calls).toHaveLength(count);
});
it('rejects forged reservation evidence at the production boundary',async()=>{
  const f=managementFixture();management.push(f);f.state.ledger.reserved.cpuSeconds=146440;
  await f.coordinator.contain();const s=await f.adapter.read(),value=structuredClone(s.ledger.value);
  value.reservedUsd+=.5;value.deployments={[f.plan.releaseId]:rolloutHold(f.plan,s.ledger.value,f.adapter.now())};
  for(const [key,m]of Object.entries(f.plan.meters) as any[])value.reserved[key]=(value.reserved[key]??0)+m.hold;
  value.deployments[f.plan.releaseId].recovery.cpuUsed=1;
  await expect(f.adapter.apply({kind:'reserve',id:'forged-proof',expectedStateHash:stateHash(s),value,updateTime:s.ledger.version})).rejects.toThrow('exact retained');
  expect(f.calls.some(x=>x.url.endsWith(':commit'))).toBe(false);
});
it('reconciles an interrupted high-CPU fallback after restart without repeating source writes or adding a hold',async()=>{
  const {f,draft,adapter,makeAdapter}=await grownManagement(),before=digest(f.state.ledger);
  const c=new Migration(draft.plan,adapter);let once=true;
  const sourceWrite=(x:any)=>x.method==='PUT'&&x.url.includes('script.googleapis.com')&&x.url.endsWith('/content');
  f.hooks.after=(x:any)=>{if(once&&sourceWrite(x)){once=false;throw Error('Lost source response');}};
  await expect(c.rollback()).rejects.toThrow('outcome unknown');
  const saved=structuredClone(f.journals.at(-1));expect(saved.coordinator.pending).toBeTruthy();f.hooks.after=undefined;
  const restarted=new Migration(draft.plan,makeAdapter(saved),saved.coordinator);await restarted.reconcile();await restarted.rollback();
  // One original candidate write and one fallback write, despite the lost reply.
  expect(f.calls.filter(sourceWrite)).toHaveLength(2);expect(digest(f.state.ledger)).toBe(before);
  expect(f.calls.filter(x=>x.url.endsWith(':commit'))).toHaveLength(1);
},15000);
it('cannot prepare a rollback draft from a legacy hold without reservation-time evidence',async()=>{
  const {f}=await grownManagement();delete f.state.ledger.deployments[f.plan.releaseId].recovery;
  await f.adapter.read();expect(()=>prepareDraft(f.verified,f.adapter.lastObservation,f.plan.releaseId,f.adapter.now(),'rollback')).toThrow('rollback CPU allowance');
});
