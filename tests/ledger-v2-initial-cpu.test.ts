import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {managementFixture} from './support/ledger-v2-management-fixture';
import {BILLING_ACCOUNT_ID,BILLING_SUBSCRIPTION,BILLING_INTERVAL_START} from '../shared/paid-spending';
import {PaidLedger,PAID_BUDGET_KEY} from '../collector/paid-budget';
import {trialGoogleStore} from '../collector/trial-google';
import {fixtureTime,paidRuntimeFixture,snapshotFixture} from './support/paid-runtime-fixture';
// @ts-expect-error local tooling
import {Migration,JOBS,END,digest,accountingHash,stateHash,rolloutHold,PAID_CPU_ADMISSION,validate} from '../scripts/ledger-v2-migration.mjs';
// @ts-expect-error isolated fixture
import {migrationFixture} from '../scripts/ledger-v2-fixture.mjs';
// @ts-expect-error local tooling
import {ProductionMigrationAdapter} from '../scripts/ledger-v2-production.mjs';
// @ts-expect-error local tooling
import {prepareDraft} from '../scripts/prepare-ledger-v2-migration.mjs';

const billing=(at:number,actualUsd=0)=>({accountId:BILLING_ACCOUNT_ID,subscription:BILLING_SUBSCRIPTION,
  budgetId:'fixture-budget',scope:'fixture-only',intervalStart:BILLING_INTERVAL_START,
  latest:{actualUsd,publishedAt:at,receivedAt:at,intervalStart:BILLING_INTERVAL_START}});
const management:ReturnType<typeof managementFixture>[]=[];
beforeEach(()=>vi.stubGlobal('fetch',()=>{throw Error('Network forbidden: isolated fixtures only');}));
afterEach(()=>{vi.unstubAllGlobals();for(const f of management.splice(0))f.cleanup();});
function funded() {
  const f=migrationFixture(),plan=structuredClone(f.plan),b=f.state.ledger.value;
  b.reserved.cpuSeconds=181100;b.reserved.memoryGiBSeconds=181100;b.reservedUsd=8.268515562;
  b.billing=billing(f.io.now());b.deployments={historical:{at:f.io.now()-1000,reservedUsd:.5,imageDigest:'sha256:'+'1'.repeat(64)}};
  plan.cpuAdmission=PAID_CPU_ADMISSION;plan.meters.cpuSeconds.used=181100;plan.meters.memoryGiBSeconds.used=181100;
  return {f,plan,c:new Migration(plan,f.io)};
}
it('admits the initial paid migration with no CPU or dollar refund, then rolls back after further runtime growth',async()=>{
  const {f,plan,c}=funded(),before=structuredClone(f.state.ledger.value);
  const strict=structuredClone(plan);delete strict.cpuAdmission;
  await expect(new Migration(strict,f.io).start()).rejects.toThrow('meter headroom');
  await c.contain();await c.deploy();
  const b=f.state.ledger.value,hold=b.deployments[plan.releaseId];
  expect(b.reserved.cpuSeconds).toBe(191100);expect(b.reservedUsd).toBe(before.reservedUsd+.5);
  for(const [k,m]of Object.entries(plan.meters) as any[])expect(b.reserved[k]).toBe((before.reserved[k]??0)+m.hold);
  expect(b.admissions).toEqual(before.admissions);expect(b.observed).toEqual(before.observed);
  expect(b.deployments.historical).toEqual(before.deployments.historical);expect(b.billing).toEqual(before.billing);
  expect(hold.recovery).toMatchObject({version:2,cpuUsed:181100,retainedCpuBefore:181100,
    paidCpu:{kind:PAID_CPU_ADMISSION,ledgerVersion:1,reservedUsdBefore:before.reservedUsd,billing:before.billing}});
  expect(hold.recovery.paidCpu.grossRolloutUsd).toBeLessThan(.5);
  await expect(c.rollback('original')).rejects.toThrow('v2-compatible fallback');
  await c.beginNaturalVerification({collection:true});await c.acceptNaturalEvidence(f.naturalEvidence());
  await c.reopen({api:true,daily:true});expect(f.state.worker.paused).toBe(true);
  f.advance(3*86400000);b.reserved.cpuSeconds=277960;b.reserved.memoryGiBSeconds=277960;b.billing=billing(f.io.now());
  f.state.worker.otherPropertiesHash=digest('later slots and delivery receipts');
  const rollback={...plan,operation:'rollback',observedAt:f.io.now()};
  rollback.meters.cpuSeconds.used=277960;rollback.meters.memoryGiBSeconds.used=277960;
  const accounting=accountingHash(f.state),worker=f.state.worker.otherPropertiesHash;
  const recovery=new Migration(rollback,f.io);await recovery.rollback();
  expect(accountingHash(f.state)).toBe(accounting);expect(f.state.worker.otherPropertiesHash).toBe(worker);
  expect(f.records.filter((a:any)=>a.kind==='reserve')).toHaveLength(1);
  expect(f.state.worker.sourceDigest).toBe(plan.fallback.appsScriptSha256);
  expect(JOBS.every((n:string)=>f.state.jobs[n].state==='PAUSED')).toBe(true);
  await expect(recovery.reopen({api:true,mail:true})).rejects.toThrow('Rollback-only');
});
it.each(['missing billing','missing cost','billing error','stale billing','future report','future receipt','wrong account','wrong subscription','wrong interval','invalid budget ID',
  'cost stop','no full hold headroom','recorded stop','expired','stale plan','relaxed freshness','changed budget','changed stop','changed expiry',
  'v2 ledger','prior migration','legacy same-ID hold','deployment limit','admissions','unknown writer','unknown CPU policy',
  'small CPU hold','raised CPU limit','raised memory limit','raised storage limit','raised log limit','unpriced meter','gross work cost','memory full','storage full','logs full'])
('fails closed before mutation for %s under paid initial admission',async(problem)=>{
  const {f,plan}=funded(),b=f.state.ledger.value;
  if(problem==='missing billing')delete b.billing;
  if(problem==='missing cost')delete b.billing.latest;
  if(problem==='billing error')b.billing.error='unavailable';
  if(problem==='stale billing')b.billing.latest.publishedAt-=86400001;
  if(problem==='future report')b.billing.latest.publishedAt++;
  if(problem==='future receipt')b.billing.latest.receivedAt++;
  if(problem==='wrong account')b.billing.accountId='wrong';
  if(problem==='wrong subscription')b.billing.subscription='wrong';
  if(problem==='wrong interval')b.billing.intervalStart++;
  if(problem==='invalid budget ID')b.billing.budgetId='';
  if(problem==='cost stop')b.billing.latest.actualUsd=4.5;
  if(problem==='no full hold headroom')b.billing.latest.actualUsd=4;
  if(problem==='recorded stop')b.stoppedAt=f.io.now();
  if(problem==='expired'){f.advance(END-f.io.now());plan.observedAt=f.io.now();b.billing=billing(f.io.now());}
  if(problem==='stale plan')plan.observedAt-=1800001;
  if(problem==='relaxed freshness')plan.maxBillingAgeMs=86400001;
  if(problem==='changed budget')plan.budgetUsd=6;
  if(problem==='changed stop')plan.applicationStopUsd=5;
  if(problem==='changed expiry')plan.expiresAt='2026-11-02T07:00:00.000Z';
  if(problem==='v2 ledger'){b.version=2;b.admissionCount=1;}
  if(problem==='prior migration')b.deployments.historical.recovery={version:1};
  if(problem==='legacy same-ID hold')b.deployments[plan.releaseId]={at:f.io.now(),reservedUsd:.5,imageDigest:plan.imageDigest};
  if(problem==='deployment limit')b.deployments=Object.fromEntries(Array.from({length:16},(_,i)=>['old-'+i,{...b.deployments.historical}]));
  if(problem==='admissions')plan.remainingAdmissionsRequired=4000;
  if(problem==='unknown writer')f.state.barrier.unknownWriters=['unverified'];
  if(problem==='unknown CPU policy')plan.cpuAdmission='anything';
  if(problem==='small CPU hold')plan.meters.cpuSeconds.hold=9999;
  if(problem==='raised CPU limit')plan.meters.cpuSeconds.limit++;
  if(problem==='raised memory limit')plan.meters.memoryGiBSeconds.limit++;
  if(problem==='raised storage limit')plan.meters.artifactBytes.limit++;
  if(problem==='raised log limit')plan.meters.logBytes.limit++;
  if(problem==='unpriced meter')plan.meters.extra={used:0,hold:100,limit:100};
  if(problem==='gross work cost')plan.meters.cpuSeconds.hold=30000;
  if(problem==='memory full')b.reserved.memoryGiBSeconds=360000;
  if(problem==='storage full')b.reserved.artifactBytes=1024**3;
  if(problem==='logs full')b.reserved.logBytes=50*1024**3;
  await expect(new Migration(plan,f.io).contain()).rejects.toThrow();expect(f.records).toHaveLength(0);
});
it('keeps the entire half-dollar margin even when the packaged work estimate is smaller',async()=>{
  const {f,plan}=funded();f.state.ledger.value.billing.latest.actualUsd=3.99;
  await expect(new Migration(plan,f.io).start()).resolves.toBeTruthy();
  f.state.ledger.value.billing.latest.actualUsd=4.01;
  await expect(new Migration(plan,f.io).start()).rejects.toThrow('reported-cost headroom');
});
it('refuses billing deterioration or a late write after containment',async()=>{
  const {f,c}=funded();await c.contain();f.state.ledger.value.billing.latest.actualUsd=4.1;
  await expect(c.deploy()).rejects.toThrow('reported-cost headroom');expect(f.records.some((a:any)=>a.kind==='reserve')).toBe(false);
  const next=funded();let waits=0;next.f.hooks.onWait=(s:any)=>{if(++waits===2)s.ledger.value.reservedUsd+=.01;};
  await expect(next.c.contain()).rejects.toThrow('during drainage');expect(next.f.records.some((a:any)=>a.kind==='reserve')).toBe(false);
});
it.each(['original billing','current cost headroom','billing identity','original gross','original version','CPU refund','memory refund','USD refund','artifact mismatch','different release','missing proof','relaxed age'])
('rejects invalid retained paid recovery evidence: %s',async(problem)=>{
  const {f,plan,c}=funded();await c.contain();await c.deploy();
  f.advance(86400000);const b=f.state.ledger.value;b.billing=billing(f.io.now());
  const p={...structuredClone(plan),operation:'rollback',observedAt:f.io.now()},proof=b.deployments[plan.releaseId].recovery;
  if(problem==='original billing')proof.paidCpu.billing.latest.actualUsd=4;
  if(problem==='current cost headroom')b.billing.latest.actualUsd=4;
  if(problem==='billing identity')b.billing.budgetId='changed-budget';
  if(problem==='original gross')proof.paidCpu.grossRolloutUsd=0;
  if(problem==='original version')proof.paidCpu.ledgerVersion=2;
  if(problem==='CPU refund')b.reserved.cpuSeconds--;
  if(problem==='memory refund')b.reserved.memoryGiBSeconds--;
  if(problem==='USD refund')b.reservedUsd-=.1;
  if(problem==='artifact mismatch')p.fallback.appsScriptSha256='9'.repeat(64);
  if(problem==='different release')p.releaseId='unreserved';
  if(problem==='missing proof')delete b.deployments[plan.releaseId].recovery;
  if(problem==='relaxed age')p.maxBillingAgeMs=86400001;
  const count=f.records.length;await expect(new Migration(p,f.io).rollback()).rejects.toThrow();expect(f.records).toHaveLength(count);
});
it('cannot obtain another paid migration hold after the first one, before or after v2 activation',async()=>{
  const {f,plan,c}=funded();await c.contain();await c.deploy();
  for(const version of [1,2]){
    f.state.ledger.value.version=version;if(version===2)f.state.ledger.value.admissionCount=1;
    await expect(new Migration({...plan,releaseId:'second-release'},f.io).start()).rejects.toThrow('initial v1-to-v2');
  }
  expect(f.records.filter((a:any)=>a.kind==='reserve')).toHaveLength(1);
});
it('recovers a process crash after the paid hold CAS without backfilling proof or reserving twice',async()=>{
  const {f,plan,c}=funded();await c.contain();
  f.hooks.afterApply=(a:any)=>{if(a.kind==='reserve')f.hooks.onRead=()=>{throw Error('Isolated process interruption');};};
  await expect(c.reserve()).rejects.toThrow('process interruption');
  const journal=structuredClone(f.journals.at(-1)),held=structuredClone(f.state.ledger.value.deployments[plan.releaseId]);
  expect(journal.pending).toBeTruthy();f.hooks.afterApply=undefined;f.hooks.onRead=undefined;
  const restart=new Migration(plan,f.io,journal);await restart.start();await restart.deploy();
  expect(f.records.filter((a:any)=>a.kind==='reserve')).toHaveLength(1);
  expect(f.state.ledger.value.deployments[plan.releaseId]).toEqual(held);
  expect(f.state.ledger.value.reserved.cpuSeconds).toBe(191100);
});
it('the real paid runtime preserves the new recovery proof through admission and completion',async()=>{
  const f=paidRuntimeFixture(snapshotFixture('paid-cpu-proof',fixtureTime,1));
  const b=JSON.parse(f.f.read(PAID_BUDGET_KEY)!),{plan}=funded();
  plan.startsAt=new Date(b.startsAt).toISOString();plan.legacyLedgerSha256=b.legacyLedgerSha256;
  b.reserved.cpuSeconds=181100;b.reservedUsd=8.268515562;b.billing=billing(fixtureTime);
  const proof=rolloutHold(plan,b,fixtureTime);b.deployments={[plan.releaseId]:proof};
  for(const [key,m]of Object.entries(plan.meters) as any[])b.reserved[key]=(b.reserved[key]??0)+m.hold;
  b.reservedUsd+=.5;f.f.seed(PAID_BUDGET_KEY,JSON.stringify(b));
  const store=trialGoogleStore(f.f.config);
  try{const ledger=new PaidLedger(store,()=>fixtureTime),session=await ledger.admit('browser','offline-initial-paid-cpu');await session!.finish();
    const after=JSON.parse(f.f.read(PAID_BUDGET_KEY)!);expect(after.deployments[plan.releaseId]).toEqual(proof);
    expect(after.reserved.cpuSeconds).toBe(191120);expect(after.version).toBe(2);
  }finally{await store.close();}
});

async function productionFixture() {
  const f=managementFixture();management.push(f);const b=f.state.ledger;
  b.reserved.cpuSeconds=181100;b.reserved.memoryGiBSeconds=181100;b.reservedUsd=8.268515562;b.billing=billing(f.adapter.now());
  await f.adapter.read();
  const draft=prepareDraft(f.verified,f.adapter.lastObservation,f.plan.releaseId,f.adapter.now(),'rollout',PAID_CPU_ADMISSION);
  draft.plan.remainingAdmissionsRequired=1000;
  const authorization={...f.authorization,planSha256:digest(draft.plan)};
  const makeAdapter=(plan=draft.plan,journal?:any)=>new ProductionMigrationAdapter({plan,packetPath:f.packetPath,
    authorization:{...authorization,planSha256:digest(plan),issuedAt:f.adapter.now(),expiresAt:f.adapter.now()+1800000},
    token:async()=>'fixture-only',fetchImpl:f.adapter.http.fetchImpl,now:f.adapter.now,wait:f.adapter.wait,
    operatorEvidence:async()=>f.operator,save:async(j:any)=>{f.journals.push(j);},...(journal?{journal}:{})});
  const adapter=makeAdapter();return {f,draft,adapter,makeAdapter,c:new Migration(draft.plan,adapter)};
}
it('keeps paid admission opt-in and local drafts unapproved; old approvals cannot authorize the new policy',async()=>{
  const {f,draft,c}=await productionFixture();
  expect(draft.plan.cpuAdmission).toBe(PAID_CPU_ADMISSION);expect(draft.plan.meters.cpuSeconds.used).toBe(181100);
  expect(draft.plan.meters.cpuSeconds.limit).toBe(180000);expect(draft.owner.exclusiveMaintenance).toBe(false);expect(draft.approval.approved).toBe(false);
  expect(f.adapter.executionAuthorized(draft.plan)).toBe(false);
  const strict=prepareDraft(f.verified,f.adapter.lastObservation,f.plan.releaseId,f.adapter.now()).plan;
  strict.remainingAdmissionsRequired=1000;expect(strict.cpuAdmission).toBeUndefined();
  expect(()=>validate(strict,{ledger:{value:f.state.ledger},legacyRaw:f.adapter.lastObservation.resources.legacy.fields.value.stringValue,receiptCount:0},f.adapter.now())).toThrow('meter headroom');
  await c.contain();await c.deploy();expect(f.state.ledger.reserved.cpuSeconds).toBe(191100);
  expect(f.calls.filter(x=>x.url.endsWith(':commit'))).toHaveLength(1);
  expect(f.calls.some(x=>/run\.app|script.google.com|:run$/.test(x.url))).toBe(false);
},15000);
it('the production adapter independently refuses missing billing and insufficient dollar headroom',async()=>{
  const {f,adapter,c}=await productionFixture();await c.contain();
  for(const value of [undefined,billing(adapter.now(),4.01)]) {
    f.state.ledger.billing=value;const s=await adapter.read();
    await expect(adapter.apply({kind:'reserve',id:'budget-block',expectedStateHash:stateHash(s),value:s.ledger.value,updateTime:s.ledger.version})).rejects.toThrow(/billing|budget|headroom/);
  }
  expect(f.calls.some(x=>x.url.endsWith(':commit'))).toBe(false);
},15000);
it('reconstructs the paid proof at the production boundary and refuses forged billing or a refund',async()=>{
  const {f,draft,c,adapter}=await productionFixture();await c.contain();const s=await adapter.read();
  for(const mutate of [(v:any)=>{v.deployments[draft.plan.releaseId].recovery.paidCpu.billing.latest.actualUsd=-100;},
    (v:any)=>{v.reserved.cpuSeconds=10000;},(v:any)=>{v.reservedUsd=1.5;}]){
    const value=structuredClone(s.ledger.value);value.reservedUsd+=.5;value.deployments={[draft.plan.releaseId]:rolloutHold(draft.plan,s.ledger.value,adapter.now())};
    for(const[k,m]of Object.entries(draft.plan.meters) as any[])value.reserved[k]=(value.reserved[k]??0)+m.hold;
    mutate(value);await expect(adapter.apply({kind:'reserve',id:'forged-paid',expectedStateHash:stateHash(s),value,updateTime:s.ledger.version})).rejects.toThrow('exact retained');
  }
  expect(f.calls.some(x=>x.url.endsWith(':commit'))).toBe(false);
},15000);
it('reconciles a lost paid reservation response and supports a fresh rollback-only draft without reserving twice',async()=>{
  const {f,draft,c,adapter,makeAdapter}=await productionFixture();await c.contain();let once=true;
  f.hooks.after=(x:any)=>{if(once&&x.url.endsWith(':commit')){once=false;throw Error('Lost reservation response');}};
  await c.deploy();f.hooks.after=undefined;expect(f.calls.filter(x=>x.url.endsWith(':commit'))).toHaveLength(1);
  f.advance(86400000);f.state.ledger.reserved.cpuSeconds=277960;f.state.ledger.reserved.memoryGiBSeconds=277960;f.state.ledger.billing=billing(f.adapter.now());
  f.operator.at=f.adapter.now();f.operator.expiresAt=f.adapter.now()+600000;f.operator.barrier.drainVerifiedAt=f.adapter.now();
  await adapter.read();const recovery=prepareDraft(f.verified,adapter.lastObservation,draft.plan.releaseId,f.adapter.now(),'rollback');
  recovery.plan.remainingAdmissionsRequired=1000;expect(recovery.plan.cpuAdmission).toBe(PAID_CPU_ADMISSION);expect(recovery.approval.approved).toBe(false);
  const before=digest(f.state.ledger),rollback=new Migration(recovery.plan,makeAdapter(recovery.plan));await rollback.rollback();
  expect(digest(f.state.ledger)).toBe(before);expect(f.calls.filter(x=>x.url.endsWith(':commit'))).toHaveLength(1);
  await expect(rollback.beginNaturalVerification({collection:true})).rejects.toThrow('Rollback-only');
},15000);
