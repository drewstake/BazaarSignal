import {afterEach,expect,it,vi} from 'vitest';
// @ts-expect-error locally executable ESM tooling
import {Migration,JOBS,digest,accountingHash} from '../scripts/ledger-v2-migration.mjs';
// @ts-expect-error isolated fixture transport
import {migrationFixture} from '../scripts/ledger-v2-fixture.mjs';
// @ts-expect-error offline management request compiler
import {compileRequest,compilePinRequest} from '../scripts/ledger-v2-requests.mjs';
afterEach(()=>vi.unstubAllGlobals());
async function deployed(f=migrationFixture()) {
  await f.coordinator.start();await f.coordinator.contain();await f.coordinator.deploy();return f;
}
it('contains every writer before cloud changes and reopens only after natural evidence with explicit mail permission',async()=>{
  const network=vi.fn(()=>{throw Error('No network');});vi.stubGlobal('fetch',network);
  const f=await deployed();
  expect(f.records.slice(0,4).map((a:any)=>a.kind)).toEqual(['worker-pause','job-state','job-state','api-policy']);
  expect(f.records.filter((a:any)=>a.kind==='deploy').map((a:any)=>a.name)).toEqual(['refreshmarket','marketapi']);
  expect(f.state.ledger.value.version).toBe(1);
  expect(f.state.ledger.value.reservedUsd).toBe(1.5);
  await expect(f.coordinator.reopen({api:true})).rejects.toThrow('Natural collection');
  await expect(f.coordinator.beginNaturalVerification()).rejects.toThrow('authorized');
  await f.coordinator.beginNaturalVerification({collection:true});
  const evidence=f.naturalEvidence();await f.coordinator.acceptNaturalEvidence(evidence);
  await f.coordinator.reopen({api:true,daily:true});
  expect(f.state.worker.paused).toBe(true);
  await f.coordinator.reopen({mail:true});
  expect(f.state.worker.paused).toBe(false);
  expect(f.state.ledger.value.admissionCount).toBe(2);
  expect(f.state.receiptCount).toBe(1);expect(network).not.toHaveBeenCalled();
});
it.each(['candidate','fallback'])('never discards accounting or receipts in %s deployment',async(flavor)=>{
  const f=await deployed();await f.coordinator.beginNaturalVerification({collection:true});
  await f.coordinator.acceptNaturalEvidence(f.naturalEvidence());
  const before=accountingHash(f.state);
  await f.coordinator.rollback(flavor==='candidate'?'fallback':'original').then(
    ()=>expect(flavor).toBe('candidate'), e=>{expect(flavor).toBe('fallback');expect(e.message).toMatch('v1-only');});
  expect(accountingHash(f.state)).toBe(before);
  expect(f.state.worker.paused).toBe(true);
  expect(JOBS.every((n:string)=>f.state.jobs[n].state==='PAUSED')).toBe(true);
});
it('restores original behavior before migration without refunding the rollout hold',async()=>{
  const f=await deployed();await f.coordinator.rollback('original');
  expect(f.state.ledger.value.version).toBe(1);expect(f.state.ledger.value.reservedUsd).toBe(1.5);
  expect(f.coordinator.journal.phase).toBe('original-restored-contained');
  expect(f.state.services.marketapi.readyDigest).toBe('sha256:'+'0'.repeat(64));
});
it.each(['refreshmarket','marketapi'])('keeps a failed %s deployment contained and allows a fallback without a second hold',async(name)=>{
  const f=migrationFixture();await f.coordinator.start();await f.coordinator.contain();
  f.hooks.beforeApply=(a:any)=>{if(a.kind==='deploy'&&a.name===name)throw Object.assign(Error('Rejected deployment'),{code:'REJECTED'});};
  await expect(f.coordinator.deploy()).rejects.toThrow('Rejected deployment');
  expect(f.state.worker.paused).toBe(true);expect(f.state.jobs[JOBS[0]].state).toBe('PAUSED');
  f.hooks.beforeApply=undefined;await f.coordinator.rollback();
  expect(f.records.filter((a:any)=>a.kind==='reserve')).toHaveLength(1);
  expect(f.state.services.marketapi.readyDigest).toBe(f.plan.fallback.imageDigest);
});
it.each(['reserve','deploy','worker-code','hosting'])('reconciles a lost %s acknowledgement without repeating the mutation',async(kind)=>{
  const f=migrationFixture();await f.coordinator.start();await f.coordinator.contain();
  let once=true;f.hooks.afterApply=(a:any)=>{if(once&&a.kind===kind){once=false;throw Error('Lost response');}};
  await f.coordinator.deploy();
  expect(f.coordinator.journal.steps.some((s:any)=>s.action.kind===kind&&s.status==='reconciled')).toBe(true);
  expect(f.records.filter((a:any)=>a.kind==='reserve')).toHaveLength(1);
});
it('leaves an ambiguous unapplied operation pending, persists its intent and refuses blind retries',async()=>{
  const f=migrationFixture();await f.coordinator.start();await f.coordinator.contain();
  f.hooks.beforeApply=(a:any)=>{if(a.kind==='reserve')throw Error('Timeout, outcome unknown');};
  await expect(f.coordinator.deploy()).rejects.toThrow('outcome unknown');
  const j=f.journals.at(-1);expect(j.pending).toBeTruthy();
  const resumed=new Migration(f.plan,f.io,j);
  await expect(resumed.reconcile()).rejects.toThrow('unresolved');
  expect(f.records.filter((a:any)=>a.kind==='reserve')).toHaveLength(0);
});
it.each(['expired','capacity','legacy','unknown-writer','tag','iam-disabled','mixed-traffic','daily-target','budget','unverified-fallback'])('rejects unsafe preflight: %s',async(problem)=>{
  const f=migrationFixture();
  if(problem==='expired')f.advance(1800001);
  if(problem==='capacity')f.plan.remainingAdmissionsRequired=4000;
  if(problem==='legacy')f.state.legacyRaw+=' ';
  if(problem==='unknown-writer')f.state.barrier.unknownWriters=['another-job'];
  if(problem==='tag')f.state.services.marketapi.traffic[0].tag='old';
  if(problem==='iam-disabled')f.state.services.marketapi.invokerIamDisabled=true;
  if(problem==='mixed-traffic')f.state.services.marketapi.traffic.push({percent:1});
  if(problem==='daily-target')f.state.jobs[JOBS[1]].httpTarget.uri='https://wrong.invalid';
  if(problem==='budget')f.state.ledger.value.reservedUsd=4.4;
  if(problem==='unverified-fallback')f.plan.fallback.ledgerFormats=[1];
  const c=new Migration(f.plan,f.io);await expect(c.start()).rejects.toThrow();expect(f.records).toHaveLength(0);
});
it.each(['activeApi','activeCollector','activeAdmin'])('refuses migration with an unfinished %s execution',async(field)=>{
  const f=migrationFixture();f.state.barrier[field]=1;
  await expect(f.coordinator.contain()).rejects.toThrow('drained');
  expect(f.records.some((a:any)=>a.kind==='deploy')).toBe(false);
});
it('rejects a late accounting write during drainage and another after deployment starts',async()=>{
  const f=migrationFixture();await f.coordinator.start();
  let waits=0;f.hooks.onWait=(s:any)=>{if(++waits===2)s.ledger.value.reservedUsd+=.1;};
  await expect(f.coordinator.contain()).rejects.toThrow('during drainage');
  f.hooks.onWait=undefined;await f.coordinator.contain();
  f.hooks.afterApply=(a:any,s:any)=>{if(a.kind==='deploy')s.ledger.value.reservedUsd+=.1;};
  await expect(f.coordinator.deploy()).rejects.toThrow('behind barrier');
  expect(f.records.filter((a:any)=>a.kind==='deploy')).toHaveLength(1);
});
it('detects service, worker receipt, and IAM drift instead of overwriting unrelated changes',async()=>{
  for(const change of [
    (s:any)=>s.services.marketapi.template.containers[0].env.push({name:'OTHER',value:'changed'}),
    (s:any)=>s.worker.otherPropertiesHash=digest('changed-slot'),
    (s:any)=>s.services.marketapi.iam.bindings.push({role:'roles/editor',members:['user:extra@example.invalid']})]) {
    const f=migrationFixture();await f.coordinator.start();await f.coordinator.contain();change(f.state);
    await expect(f.coordinator.deploy()).rejects.toThrow(/drift|changed/);
  }
});
it.each(['wrong-revision','duplicate-count','unfinished','stale-sample','manual-run'])('does not reopen for %s evidence',async(problem)=>{
  const f=await deployed();await f.coordinator.beginNaturalVerification({collection:true});const e=f.naturalEvidence();
  if(problem==='wrong-revision')e.revision='old';
  if(problem==='duplicate-count')f.state.ledger.value.admissionCount++;
  if(problem==='unfinished')e.receipt.finished=false;
  if(problem==='stale-sample')e.sampleAt-=900000;
  if(problem==='manual-run')e.kind='manual';
  await expect(f.coordinator.acceptNaturalEvidence(e)).rejects.toThrow(/evidence|Receipt count/);
  expect(f.state.worker.paused).toBe(true);
});
it('preserves originally paused jobs and prevents an unapproved production adapter',async()=>{
  const f=migrationFixture();f.state.jobs[JOBS[0]].state='PAUSED';await deployed(f);
  await expect(f.coordinator.beginNaturalVerification({collection:true})).rejects.toThrow('Originally paused');
  expect(()=>new Migration(f.plan,{...f.io,kind:'google-cloud'})).toThrow('Production execution');
});
it('preserves newer worker receipts on rollback after normal execution has resumed',async()=>{
  const f=await deployed();await f.coordinator.beginNaturalVerification({collection:true});
  await f.coordinator.acceptNaturalEvidence(f.naturalEvidence());await f.coordinator.reopen({api:true,mail:true});
  const latest=digest('new natural mail slot and sent receipt');f.state.worker.otherPropertiesHash=latest;
  await f.coordinator.rollback();expect(f.state.worker.otherPropertiesHash).toBe(latest);
});
it('resumes a saved journal without duplicating a verified reservation',async()=>{
  const f=migrationFixture();await f.coordinator.start();await f.coordinator.contain();await f.coordinator.reserve();
  const resumed=new Migration(f.plan,f.io,structuredClone(f.journals.at(-1)));
  await resumed.start();await resumed.contain();await resumed.deploy();
  expect(f.records.filter((a:any)=>a.kind==='reserve')).toHaveLength(1);
});
it('rejects lost receipt counts and forbids v1 rollback for oversized retained inline history',async()=>{
  const f=migrationFixture();f.state.ledger.value.version=2;f.state.ledger.value.admissionCount=2;
  await expect(f.coordinator.start()).rejects.toThrow('Receipt count');
  const large=await deployed();
  Object.assign(large.state.ledger.value.admissions,Object.fromEntries(Array.from({length:1000},(_,i)=>['x'.repeat(90)+i,{at:large.io.now(),finished:true}])));
  await expect(large.coordinator.rollback('original')).rejects.toThrow('v1-only');
});
it('compiles exact guarded management requests without invoking handlers or changing schedules',async()=>{
  const f=await deployed();
  expect(f.requests.every((r:any)=>r.executionEnabled===false&&r.automaticRetries===0)).toBe(true);
  const images=f.requests.filter((r:any)=>r.url?.endsWith('updateMask=template'));
  expect(images).toHaveLength(2);
  for(const r of images) {
    expect(r.body.etag).toBeTruthy();expect(r.body.template.containers[0].image).toMatch(/@sha256:/);
    expect(r.body.template.containers[0].env).toEqual(f.state.services.marketapi.template.containers[0].env);
    expect(r.body).not.toHaveProperty('traffic');
  }
  expect(f.requests.filter((r:any)=>r.url?.endsWith('updateMask=traffic'))).toHaveLength(2);
  const reservation=f.requests.find((r:any)=>r.url?.endsWith('documents:commit'));
  expect(reservation.body.writes).toHaveLength(1);
  expect(reservation.body.writes[0].currentDocument).toEqual({updateTime:'ledger-1'});
  expect(f.requests.some((r:any)=>/run\.app|:run$|:runJob/.test(r.url??''))).toBe(false);
});
it('rejects wrong targets, stale etags and an unready image before compiling an operation',()=>{
  const f=migrationFixture();
  expect(()=>compileRequest({kind:'deploy',name:'other',value:f.plan.imageDigest},f.state)).toThrow();
  expect(()=>compileRequest({kind:'api-policy',etag:'old',value:{}},f.state)).toThrow();
  expect(()=>compilePinRequest('marketapi',f.plan.imageDigest,f.state.services.marketapi)).toThrow();
  expect(()=>compileRequest({kind:'job-state',name:JOBS[0],value:'RUN_NOW'},f.state)).toThrow();
});
it('rejects paid HTTP probes and unknown execution counts; the persisted call limit survives a restart',async()=>{
  for(const mutate of [(s:any)=>{s.services.marketapi.template.containers[0].startupProbe={httpGet:{path:'/'}};},
    (s:any)=>{delete s.barrier.activeCollector;}]) {
    const f=migrationFixture();mutate(f.state);await expect(f.coordinator.start()).rejects.toThrow();expect(f.records).toHaveLength(0);
  }
  const f=migrationFixture(), c=new Migration(f.plan,f.io,{version:1,steps:[],calls:200});
  await expect(c.start()).rejects.toThrow('call limit');expect(f.records).toHaveLength(0);
});
it('recovers a process crash immediately after reservation without losing its anchor or reserving twice',async()=>{
  const f=migrationFixture();await f.coordinator.start();await f.coordinator.contain();
  f.hooks.afterApply=(a:any)=>{if(a.kind==='reserve')f.hooks.onRead=()=>{throw Error('Synthetic process interruption');};};
  await expect(f.coordinator.reserve()).rejects.toThrow('interruption');
  const journal=structuredClone(f.journals.at(-1));expect(journal.pending).toBeTruthy();
  f.hooks.afterApply=undefined;f.hooks.onRead=undefined;
  const resumed=new Migration(f.plan,f.io,journal);await resumed.start();await resumed.deploy();
  expect(f.records.filter((a:any)=>a.kind==='reserve')).toHaveLength(1);
  expect(resumed.journal.accounting).toBe(accountingHash(f.state));
});
it('persists observation calls before issuing them, including a failed observation',async()=>{
  const f=migrationFixture();f.hooks.onRead=()=>{throw Error('Failed observation');};
  await expect(f.coordinator.start()).rejects.toThrow('Failed observation');
  expect(f.journals.at(-1).calls).toBe(1);
});
