import {describe,it,expect,afterEach} from 'vitest';
import {migrationFixture} from '../scripts/ledger-v2-fixture.mjs';
import {Migration,JOBS,digest,recoveryApiPolicy,stateHash,renewNaturalWaitWindow} from '../scripts/ledger-v2-migration.mjs';
import {BILLING_ACCOUNT_ID,BILLING_SUBSCRIPTION,BILLING_INTERVAL_START} from '../shared/paid-spending';
import {scheduleConfiguration} from '../scripts/private-trial-release.mjs';
import {managementFixture} from './support/ledger-v2-management-fixture';

function recovery(state:any) {
  const policy=structuredClone(state.services.marketapi.iam);delete policy.etag;
  return {kind:'automatic-ledger-read-shutdown',auditSha256:'a'.repeat(64),keepMailPaused:true,
    privateApiPolicySha256:digest(policy),jobConfigurationSha256:Object.fromEntries(JOBS.map((n:string)=>{
      const c=scheduleConfiguration(state.jobs[n]);delete c.state;return [n,digest(c)];}))};
}
function stopped() {
  const f=migrationFixture();f.state.worker.paused=true;
  f.state.services.marketapi.iam.bindings=f.state.services.marketapi.iam.bindings.filter((b:any)=>!b.members.includes('allUsers'));
  for(const n of JOBS)f.state.jobs[n].state='PAUSED';
  f.plan.shutdownRecovery=recovery(f.state);f.coordinator=new Migration(f.plan,f.io);return f;
}
describe('explicit automatic-shutdown recovery',()=>{
  it('restores only the prior API/cadence after a natural run and keeps mail paused, then contains fallback',async()=>{
    const f=stopped(),before=structuredClone(f.state.ledger.value);
    await f.coordinator.contain();await f.coordinator.deploy();
    await expect(f.coordinator.reopen({api:true})).rejects.toThrow('Natural');
    await f.coordinator.beginNaturalVerification({collection:true});
    expect(f.state.jobs[JOBS[1]].state).toBe('PAUSED');
    await f.coordinator.acceptNaturalEvidence(f.naturalEvidence());
    await f.coordinator.reopen({api:true,daily:true});
    expect(f.state.services.marketapi.iam.bindings.at(-1)).toEqual({role:'roles/run.invoker',members:['allUsers']});
    expect(JOBS.every((n:string)=>f.state.jobs[n].state==='ENABLED')).toBe(true);
    expect(f.coordinator.journal.original.jobs[JOBS[0]].state).toBe('PAUSED');
    expect(f.state.worker.paused).toBe(true);expect(f.state.ledger.value.reservedUsd).toBeGreaterThan(before.reservedUsd);
    await expect(f.coordinator.reopen({mail:true})).rejects.toThrow('cannot resume mail');
    await f.coordinator.rollback();expect(f.state.worker.paused).toBe(true);
    expect(JOBS.every((n:string)=>f.state.jobs[n].state==='PAUSED')).toBe(true);
  });
  it('preserves originally paused jobs without an explicit incident plan',async()=>{
    const f=stopped();delete f.plan.shutdownRecovery;f.coordinator=new Migration(f.plan,f.io);
    await f.coordinator.contain();await f.coordinator.deploy();
    await expect(f.coordinator.beginNaturalVerification({collection:true})).rejects.toThrow('Originally paused');
  });
  it.each(['audit','iam','job','mail','rollback','public','enabled'])('rejects incorrect %s evidence before writes',async(kind)=>{
    const f=stopped();
    if(kind==='audit')f.plan.shutdownRecovery.auditSha256='invalid';
    if(kind==='iam')f.plan.shutdownRecovery.privateApiPolicySha256='0'.repeat(64);
    if(kind==='job')f.state.jobs[JOBS[0]].attemptDeadline='60s';
    if(kind==='mail')f.plan.shutdownRecovery.keepMailPaused=false;
    if(kind==='rollback')f.plan.operation='rollback';
    if(kind==='public')f.state.services.marketapi.iam.bindings.push({role:'roles/run.invoker',members:['allUsers']});
    if(kind==='enabled')f.state.jobs[JOBS[1]].state='ENABLED';
    expect(()=>recoveryApiPolicy(f.plan,f.state)).toThrow();expect(f.records).toHaveLength(0);
  });
});

const cleanups:Array<()=>void>=[];afterEach(()=>{for(const fn of cleanups.splice(0))fn();});
it('the production adapter independently limits recovery IAM and schedule transitions',async()=>{
  const f=managementFixture();cleanups.push(f.cleanup);
  f.state.services.marketapi.iam.bindings=f.state.services.marketapi.iam.bindings.filter((b:any)=>!b.members.includes('allUsers'));
  for(const n of JOBS)f.state.jobs[n].state='PAUSED';
  const initial=await f.adapter.read();f.plan.shutdownRecovery=recovery(initial);
  f.adapter.plan=structuredClone(f.plan);f.authorization.planSha256=digest(f.plan);f.authorization.allow.push('api','collection','daily');
  const m=new Migration(f.plan,f.adapter);await m.contain();await m.deploy();
  let s=await f.adapter.read();const target=recoveryApiPolicy(f.plan,m.journal.original);
  await expect(f.adapter.apply({kind:'api-policy',value:target,etag:s.services.marketapi.iam.etag,id:'early',expectedStateHash:stateHash(s)})).rejects.toThrow('IAM action');
  await m.beginNaturalVerification({collection:true});
  m.journal.phase='natural-verified';await m.record();
  s=await f.adapter.read();const bad=structuredClone(target);bad.bindings.push({role:'roles/owner',members:['allUsers']});
  await expect(f.adapter.apply({kind:'api-policy',value:bad,id:'wide',expectedStateHash:stateHash(s)})).rejects.toThrow('IAM action');
  await m.reopen({api:true,daily:true});expect(f.operator.worker.paused).toBe(true);
});
it('ignores JSON map key ordering in Hosting metadata without ignoring content changes',async()=>{
  const f=managementFixture();cleanups.push(f.cleanup);
  f.state.hostingRelease.version.config={headers:{a:'one',b:'two'}};
  const a=await f.adapter.read();f.state.hostingRelease.version.config={headers:{b:'two',a:'one'}};
  const b=await f.adapter.read();expect(stateHash(a)).toBe(stateHash(b));
  f.state.hostingRelease.version.config.headers.a='changed';
  expect(stateHash(await f.adapter.read())).not.toBe(stateHash(a));
});
it.each([false,true])('reconciles a read-only rejection only without a write intent (%s)',async(writeIntent)=>{
  const f=managementFixture();cleanups.push(f.cleanup);await f.coordinator.contain();
  let reads=0;f.hooks.before=(c:any)=>{if(c.url.includes('/sites/bazaarsignal/releases?pageSize=1')&&++reads>=2)f.state.hostingRelease.message='changed metadata';};
  await expect(f.coordinator.deploy()).rejects.toThrow('Management state changed');
  f.hooks.before=undefined;expect(f.coordinator.journal.pending).toBeTruthy();
  if(writeIntent)f.adapter.journal.http.requests.push({at:f.adapter.now(),readOnly:false,status:'intent'});
  if(writeIntent){await expect(f.coordinator.reconcile()).rejects.toThrow('Missing durable');expect(f.coordinator.journal.pending).toBeTruthy();}
  else {await f.coordinator.reconcile();expect(f.coordinator.journal.pending).toBeUndefined();await f.coordinator.deploy();expect(f.state.ledger.reservedUsd).toBe(1.5);}
});
it.each([false,true])('verifies registry bytes when successful HEAD omits its digest (existing=%s)',async(existing)=>{
  const f=managementFixture();cleanups.push(f.cleanup);f.state.imagePresent=existing;f.hooks.omitRegistryDigest=true;
  await f.coordinator.contain();await f.coordinator.deploy();
  expect(f.calls.some((c:any)=>c.url.includes('docker.pkg.dev')&&c.method==='GET')).toBe(true);
  if(existing)expect(f.calls.some((c:any)=>c.url.includes('docker.pkg.dev')&&c.method==='PUT')).toBe(false);
  expect(f.state.ledger.reservedUsd).toBe(1.5);
});
it('rejects incorrect registry content and reconciles an already stored blob without uploading it twice',async()=>{
  const f=managementFixture();cleanups.push(f.cleanup);f.state.imagePresent=false;f.hooks.omitRegistryDigest=true;f.hooks.corruptRegistryContent=true;
  await f.coordinator.contain();await expect(f.coordinator.deploy()).rejects.toThrow(/bound|digest/);
  const uploaded=f.calls.filter((c:any)=>c.url.includes('/blobs/uploads/')&&c.method==='POST').length;
  expect(uploaded).toBe(1);f.hooks.corruptRegistryContent=false;
  await f.coordinator.reconcile();await f.coordinator.deploy();
  expect(f.calls.filter((c:any)=>c.url.includes('/blobs/uploads/')&&c.method==='POST')).toHaveLength(2);
  expect(f.state.ledger.reservedUsd).toBe(1.5);
});
async function waitingFixture(){
  const f=managementFixture();cleanups.push(f.cleanup);f.authorization.allow.push('collection');
  f.state.ledger.billing={accountId:BILLING_ACCOUNT_ID,subscription:BILLING_SUBSCRIPTION,budgetId:'fixture-budget',scope:'fixture-only',intervalStart:BILLING_INTERVAL_START,
    latest:{actualUsd:0,publishedAt:f.adapter.now(),receivedAt:f.adapter.now(),intervalStart:BILLING_INTERVAL_START}};
  await f.coordinator.contain();await f.coordinator.deploy();await f.coordinator.beginNaturalVerification({collection:true});return f;
}
it('renews only the observation clock while retaining the original hold, anchors and call counts',async()=>{
  const f=await waitingFixture(),s=await f.adapter.read(),ledger=digest(f.state.ledger),j=f.coordinator.journal;
  const result=renewNaturalWaitWindow(f.plan,j,s,f.adapter.now());
  expect({...result.plan,observedAt:f.plan.observedAt}).toEqual(f.plan);
  expect(result.journal.beforeNatural).toEqual(j.beforeNatural);expect(result.journal.calls).toBe(j.calls);
  expect(result.journal.reservation).toEqual(j.reservation);expect(digest(f.state.ledger)).toBe(ledger);
  expect(result.journal.windowRenewals).toHaveLength(1);
});
it.each(['pending','mail','api','daily','accounting','active','expired'])('blocks unsafe natural-wait renewal: %s',async(kind)=>{
  const f=await waitingFixture(),s=await f.adapter.read(),j=structuredClone(f.coordinator.journal);
  if(kind==='pending')j.pending='unresolved';if(kind==='mail')s.worker.paused=false;
  if(kind==='api')s.services.marketapi.iam.bindings.push({role:'roles/run.invoker',members:['allUsers']});
  if(kind==='daily')s.jobs[JOBS[1]].state='ENABLED';if(kind==='accounting')s.ledger.value.observed.firestoreReads++;
  if(kind==='active')s.barrier.activeCollector=1;
  expect(()=>renewNaturalWaitWindow(f.plan,j,s,kind==='expired'?f.plan.observedAt+1800001:f.adapter.now())).toThrow();
});
