// A transport-independent migration coordinator. Production transports require
// explicit authorization for the exact plan; rehearsal remains the default.
import { createHash } from 'node:crypto';
import { verifyPaidReleaseBudget, verifyPaidContinuity, verifyLiveUpdate, scheduleConfiguration } from './private-trial-release.mjs';
import { validPaidBilling } from '../shared/paid-spending.ts';

export const SERVICES = ['refreshmarket','marketapi'];
export const JOBS = ['firebase-schedule-refreshMarket-us-central1','bazaar-daily-close'];
export const CLOUD_ROOT = 'projects/bazaarsignal-510305/locations/us-central1';
export const END = Date.parse('2026-11-01T07:00:00.000Z');
export const PAID_CPU_ADMISSION = 'initial-paid-ledger-v2';
const clone = value => structuredClone(value);
export const digest = value => createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fail = message => { throw Error(message); };
const same = (a,b) => digest(a)===digest(b);
const publicPolicy = policy => policy.bindings?.some(b=>b.members?.some(m=>['allUsers','allAuthenticatedUsers'].includes(m)));
const bodyPolicy = policy => { const p=clone(policy); delete p.etag; return p; };
const jobConfig = job => { const config=scheduleConfiguration(job); delete config.state; return config; };
const cloudConfig = service => {
  const template=clone(service.template); delete template.revision; delete template.containers[0].image;
  return {name:service.name,template,scaling:service.scaling,invokerIamDisabled:service.invokerIamDisabled??false};
};
export const stateHash = state => { const s=clone(state); delete s.at; return digest(s); };
export const accountingHash = s => digest({ledger:s.ledger.value,control:s.controlHash,receipts:s.receiptsHash});

// Explicit incident recovery preserves the observed private/paused snapshot.
// Its only additional target is the pre-incident public price API and the two
// existing schedules. It never authorizes mail or changes schedule settings.
export function recoveryApiPolicy(plan, original) {
  const r=plan.shutdownRecovery;
  if(!r)return original.services.marketapi.iam;
  if(plan.operation==='rollback'||r.kind!=='automatic-ledger-read-shutdown'||
      !/^[a-f0-9]{64}$/.test(r.auditSha256??'')||r.keepMailPaused!==true||
      r.privateApiPolicySha256!==digest(bodyPolicy(original.services.marketapi.iam))||
      publicPolicy(original.services.marketapi.iam)||
      !same(r.jobConfigurationSha256,Object.fromEntries(JOBS.map(n=>[n,digest(jobConfig(original.jobs[n]))])))||
      JOBS.some(n=>original.jobs[n].state!=='PAUSED'))fail('Invalid automatic-shutdown recovery evidence');
  const policy=clone(original.services.marketapi.iam);
  policy.bindings??=[];policy.bindings.push({role:'roles/run.invoker',members:['allUsers']});
  return policy;
}

function assertImage(artifact) {
  if (!artifact || !/^sha256:[a-f0-9]{64}$/.test(artifact.imageDigest) ||
      artifact.localRuntimeSmokeVerified!==true || !same(artifact.ledgerFormats,[1,2]) || artifact.writesLedgerVersion!==2 ||
      !/^[a-f0-9]{64}$/.test(artifact.hostingSha256) || !/^[a-f0-9]{64}$/.test(artifact.appsScriptSha256))
    fail('Unverified or incompatible release artifact');
}
export function rolloutGrossUsd(m) {
  return m.cpuSeconds.hold*.000024+m.memoryGiBSeconds.hold*.0000025+
    m.artifactBytes.hold/1024**3*.10+m.logBytes.hold/1024**3*.5;
}
// Paid releases already price bounded rollout work inside a retained $0.50
// hold. Cumulative *reservations* are not consumption of the CPU free tier.
// This explicit mode is limited to the first ledger migration; ordinary
// rollouts keep their existing cumulative CPU gate.
function paidCpuPlan(plan) {
  const bounds={cpuSeconds:[10000,180000],memoryGiBSeconds:[10000,360000],
    artifactBytes:[1,1024**3],logBytes:[16*1024**2,50*1024**3]};
  if(plan.cpuAdmission!==PAID_CPU_ADMISSION || plan.paidRolloutReserveUsd!==.5 ||
      !same(Object.keys(plan.meters??{}).sort(),Object.keys(bounds).sort()))fail('Invalid paid migration CPU policy');
  for(const [key,[minimum,ceiling]]of Object.entries(bounds)) {
    const m=plan.meters[key];
    if(![m.used,m.hold,m.limit].every(Number.isFinite)||m.used<0||m.hold<minimum||m.limit<=0||m.limit>ceiling||m.hold>m.limit)
      fail('Paid migration meter limits or holds changed');
  }
  const gross=rolloutGrossUsd(plan.meters);
  if(!Number.isFinite(gross)||gross>.5)fail('Paid migration work exceeds its $0.50 hold');
  return gross;
}
function freshPaidBilling(plan,billing,now,additionalUsd=0) {
  if(!billing?.latest || !validPaidBilling(billing,now) || billing.error ||
      !Number.isFinite(plan.maxBillingAgeMs)||plan.maxBillingAgeMs<=0||plan.maxBillingAgeMs>86400000 ||
      now-billing.latest.publishedAt>plan.maxBillingAgeMs)
    fail('Fresh Google billing evidence required for paid migration CPU admission');
  // Do not use credits to enlarge the allowance or spend the stop margin.
  if(Math.max(0,billing.latest.actualUsd)+additionalUsd>=4.5)
    fail('Paid migration lacks reported-cost headroom for its $0.50 hold');
}
export function verifyInitialPaidCpu(plan,ledger,now) {
  const gross=paidCpuPlan(plan);
  verifyPaidReleaseBudget(plan,ledger,now);
  if(plan.operation==='rollback'||ledger.version!==1||
      ledger.deployments?.[plan.releaseId]||Object.values(ledger.deployments??{}).some(d=>d.recovery))
    fail('Paid CPU admission is only for an unreserved initial v1-to-v2 migration');
  freshPaidBilling(plan,ledger.billing,now,.5);
  return {kind:PAID_CPU_ADMISSION,ledgerVersion:1,billing:clone(ledger.billing),maxBillingAgeMs:plan.maxBillingAgeMs,
    grossRolloutUsd:gross,reservedUsdBefore:ledger.reservedUsd,
    reservedMetersBefore:Object.fromEntries(Object.keys(plan.meters).map(k=>[k,ledger.reserved[k]??0]))};
}
// This evidence is added with the original CAS, never reconstructed from a
// later, larger counter or used to reduce any retained reservation.
export function rolloutHold(plan, ledger, at) {
  const cpu=plan.meters.cpuSeconds;
  const paid=plan.cpuAdmission===PAID_CPU_ADMISSION?verifyInitialPaidCpu(plan,ledger,at):null;
  return {at,reservedUsd:.5,imageDigest:plan.imageDigest,recovery:{version:paid?2:1,
    artifactsSha256:digest({candidate:plan.candidate,fallback:plan.fallback}),
    cpuUsed:Math.max(cpu.used,ledger.reserved.cpuSeconds??0),
    retainedCpuBefore:ledger.reserved.cpuSeconds??0,
    meters:Object.fromEntries(Object.entries(plan.meters).map(([key,m])=>[key,{hold:m.hold,limit:m.limit}])),
    ...(paid?{paidCpu:paid}:{})}};
}
export function verifyRollbackHold(plan, ledger, now) {
  const held=ledger.deployments?.[plan.releaseId],proof=held?.recovery,cpu=plan.meters?.cpuSeconds;
  const paid=plan.cpuAdmission===PAID_CPU_ADMISSION;
  if(!held||held.reservedUsd!==.5||held.imageDigest!==plan.imageDigest||
      !Number.isFinite(held.at)||held.at<ledger.startsAt||held.at>now||proof?.version!==(paid?2:1)||
      proof.artifactsSha256!==digest({candidate:plan.candidate,fallback:plan.fallback})||!proof.meters||
      !same(proof.meters,Object.fromEntries(Object.entries(plan.meters??{}).map(([k,m])=>[k,{hold:m.hold,limit:m.limit}])))||
      !Number.isFinite(proof.cpuUsed)||!Number.isFinite(proof.retainedCpuBefore)||
      proof.retainedCpuBefore<0||proof.cpuUsed<proof.retainedCpuBefore||
      !cpu||!Number.isFinite(cpu.hold)||cpu.hold<10000||!Number.isFinite(cpu.limit)||cpu.limit<=0||cpu.limit>180000||
      (!paid&&proof.cpuUsed+cpu.hold>cpu.limit)||
      !Number.isFinite(ledger.reserved.cpuSeconds)||ledger.reserved.cpuSeconds<proof.retainedCpuBefore+cpu.hold)
    fail('Missing or mismatched retained rollback CPU allowance');
  if(paid) {
    const gross=paidCpuPlan(plan),p=proof.paidCpu;
    if(!p||p.kind!==PAID_CPU_ADMISSION||p.ledgerVersion!==1||p.grossRolloutUsd!==gross||
        !Number.isFinite(p.reservedUsdBefore)||p.reservedUsdBefore<1||ledger.reservedUsd<p.reservedUsdBefore+.5||
        !p.reservedMetersBefore||p.reservedMetersBefore.cpuSeconds!==proof.retainedCpuBefore||
        !same(Object.keys(p.reservedMetersBefore).sort(),Object.keys(plan.meters).sort())||
        !Number.isFinite(p.maxBillingAgeMs)||p.maxBillingAgeMs<=0||p.maxBillingAgeMs>86400000||plan.maxBillingAgeMs>p.maxBillingAgeMs)
      fail('Missing or mismatched retained paid CPU admission');
    for(const [key,m]of Object.entries(plan.meters))if(!Number.isFinite(p.reservedMetersBefore[key])||p.reservedMetersBefore[key]<0||
        !Number.isFinite(ledger.reserved[key])||ledger.reserved[key]<p.reservedMetersBefore[key]+m.hold)
      fail('Paid migration reservation is no longer fully retained');
    freshPaidBilling({...plan,maxBillingAgeMs:p.maxBillingAgeMs},p.billing,held.at,.5);
    for(const key of ['accountId','budgetId','subscription','scope','intervalStart'])
      if(p.billing[key]!==ledger.billing?.[key])fail('Retained paid billing identity changed');
    if(!ledger.billing?.latest||ledger.billing.latest.publishedAt<p.billing.latest.publishedAt)
      fail('Paid billing observation moved backwards');
    // Reserve the full spending margin even for fallback work. This is an
    // eligibility check, never a second ledger reservation or a refund.
    freshPaidBilling(plan,ledger.billing,now,.5);
  }
  // A reservation-only ledger cannot establish current spending after runtime
  // growth. The usual cost, freshness, stop and expiry checks still apply.
  if(!ledger.billing?.latest)fail('Fresh Google billing evidence required for retained rollback');
  if(!Number.isFinite(plan.maxBillingAgeMs)||plan.maxBillingAgeMs<=0||plan.maxBillingAgeMs>86400000)
    fail('Rollback billing evidence may be at most 24 hours old');
  return proof;
}
export function assertRollbackAction(plan, action) {
  if(plan.operation!=='rollback')return;
  const fallback=plan.fallback;
  if((action.kind==='worker-pause'&&action.value===true)||
      (action.kind==='job-state'&&JOBS.includes(action.name)&&action.value==='PAUSED')||
      (action.kind==='api-policy'&&!publicPolicy(action.value))||
      (action.kind==='deploy'&&SERVICES.includes(action.name)&&action.value===fallback.imageDigest)||
      (action.kind==='worker-code'&&action.value===fallback.appsScriptSha256)||
      (action.kind==='hosting'&&action.value===fallback.hostingSha256))return;
  fail('Rollback-only plan permits containment and the retained fallback only');
}
export function validate(plan, state, now) {
  if (plan.kind!=='ledger-v2-maintenance' || plan.productionExecutionEnabled!==false ||
      ![undefined,'rollout','rollback'].includes(plan.operation) || ![undefined,PAID_CPU_ADMISSION].includes(plan.cpuAdmission) ||
      !same(plan.services,['marketapi','refreshmarket']) || plan.paidThrottleRepair || plan.expiresAt!==new Date(END).toISOString() ||
      !Number.isFinite(plan.observedAt) || now<plan.observedAt || now-plan.observedAt>1800000 ||
      !Number.isSafeInteger(plan.remainingAdmissionsRequired) || plan.remainingAdmissionsRequired<1)
    fail('Invalid, stale or uncontained migration plan');
  assertImage(plan.candidate); assertImage(plan.fallback);
  if(plan.imageDigest!==plan.candidate.imageDigest)fail('Reservation image differs from candidate');
  verifyPaidReleaseBudget(plan,state.ledger.value,now);
  if(digest(state.legacyRaw)!==plan.legacyLedgerSha256)fail('Legacy ledger changed');
  const count=state.ledger.value.admissionCount??Object.keys(state.ledger.value.admissions).length;
  if(!Number.isSafeInteger(state.receiptCount)||state.receiptCount<0 ||
      count!==Object.keys(state.ledger.value.admissions).length+state.receiptCount ||
      (state.ledger.value.version===1&&state.receiptCount!==0))fail('Receipt count does not match the ledger');
  if(count+plan.remainingAdmissionsRequired>4000)fail('Insufficient admission headroom');
  if(Buffer.byteLength(JSON.stringify(state.ledger.value))>1000000)fail('Ledger lacks document headroom');
  if(state.ledger.value.billing?.latest && (state.ledger.value.billing.error ||
      !Number.isFinite(plan.maxBillingAgeMs) || plan.maxBillingAgeMs<=0 ||
      now-state.ledger.value.billing.latest.publishedAt>plan.maxBillingAgeMs))fail('Billing evidence unavailable or stale');
  const paid=plan.cpuAdmission===PAID_CPU_ADMISSION;
  const recovery=plan.operation==='rollback'||(paid&&state.ledger.value.deployments?.[plan.releaseId])?
    verifyRollbackHold(plan,state.ledger.value,now):null;
  if(paid&&!recovery)verifyInitialPaidCpu(plan,state.ledger.value,now);
  for(const [key,meter] of Object.entries(plan.meters??{})) {
    // In the explicit initial-paid mode the complete work hold is admitted by
    // the dollar policy above. Retained CPU is still recorded, never reduced.
    // Other meters and ordinary new rollouts retain their cumulative gates.
    const used=key==='cpuSeconds'&&paid?meter.hold:key==='cpuSeconds'&&recovery?recovery.cpuUsed+meter.hold:
      Math.max(meter.used,state.ledger.value.reserved[key]??0)+(state.ledger.value.deployments?.[plan.releaseId]?0:meter.hold);
    if(![meter.used,meter.hold,meter.limit].every(Number.isFinite) || meter.used<0 || meter.hold<0 ||
        used>meter.limit)fail('Rollout meter headroom exceeded');
  }
  if(!['cpuSeconds','memoryGiBSeconds','artifactBytes','logBytes'].every(k=>plan.meters?.[k]))fail('Missing rollout meters');
}
export function assertSnapshot(state, now) {
  if(!Number.isFinite(state.at)||state.at>now||now-state.at>60000 || !state.ledger.version || !state.worker.etag ||
      !state.hosting.etag || !state.controlHash || !state.receiptsHash ||
      !same(Object.keys(state.services).sort(),[...SERVICES].sort()) || !same(Object.keys(state.jobs).sort(),[...JOBS].sort()))
    fail('Incomplete or stale snapshot');
  if(!Array.isArray(state.barrier.unknownWriters) || state.barrier.unknownWriters.length || state.barrier.effectiveAccessVerified!==true ||
      !['activeApi','activeCollector','activeAdmin'].every(k=>Number.isSafeInteger(state.barrier[k])&&state.barrier[k]>=0) ||
      !Number.isSafeInteger(state.worker.activeExecutions)||state.worker.activeExecutions<0)
    fail('Unknown writers or unverified effective access');
  for(const name of SERVICES) {
    const service=state.services[name];
    if(!service.etag || !service.iam?.etag || service.name!==`${CLOUD_ROOT}/services/${name}` ||
        service.invokerIamDisabled===true || service.traffic.some(t=>t.tag) ||
        service.traffic.length!==1 || service.traffic[0].percent!==100 ||
        (service.traffic[0].type!=='TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST' &&
         !(service.traffic[0].type==='TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION' &&
           service.traffic[0].revision===service.latestReadyRevision)))fail('Unsafe service routing or IAM');
    if(service.template.containers.some(c=>c.startupProbe?.httpGet||c.livenessProbe?.httpGet))fail('HTTP probes may invoke paid handlers');
    if(service.iam.bindings?.some(b=>b.role!=='roles/run.invoker'&&b.members?.some(m=>['allUsers','allAuthenticatedUsers'].includes(m))))
      fail('Unexpected public IAM grant');
    if(name==='refreshmarket' && publicPolicy(service.iam))fail('Collector is public');
  }
  for(const name of JOBS) {
    const job=state.jobs[name];
    if(job.name!==`${CLOUD_ROOT}/jobs/${name}` || !['PAUSED','ENABLED'].includes(job.state) ||
        job.schedule!==(name===JOBS[0]?'*/15 * * * *':'59 4 * * *') || job.timeZone!=='Etc/UTC' ||
        job.httpTarget?.uri!=='https://refreshmarket-k5a64sgi2q-uc.a.run.app/' || job.httpTarget.httpMethod!=='POST' ||
        job.httpTarget.oidcToken?.audience!==job.httpTarget.uri ||
        job.httpTarget.oidcToken?.serviceAccountEmail!=='market-collector@bazaarsignal-510305.iam.gserviceaccount.com' ||
        (job.retryConfig?.retryCount??0)!==0 || (job.retryConfig?.maxRetryDuration??'0s')!=='0s')fail('Scheduler configuration changed');
  }
}
export function assertContained(s) {
  if(!s.worker.paused || JOBS.some(n=>s.jobs[n].state!=='PAUSED') || publicPolicy(s.services.marketapi.iam) ||
      s.barrier.authenticatedCallersStopped!==true || s.barrier.activeApi || s.barrier.activeCollector ||
      s.worker.activeExecutions || s.barrier.activeAdmin) fail('Writers are not contained and drained');
  if(s.barrier.productionEvidence && (!Number.isFinite(s.barrier.drainVerifiedAt)||s.barrier.drainVerifiedAt<=s.barrier.requiredDrainAfter||s.barrier.drainVerifiedAt>s.at))
    fail('Fresh completion evidence after the containment changes is required');
}
function assertArtifact(s, artifact) {
  for(const n of SERVICES) {
    const service=s.services[n], traffic=service.traffic[0];
    if(service.reconciling || service.latestReadyRevision!==service.latestCreatedRevision ||
        service.terminalCondition?.state!=='CONDITION_SUCCEEDED' || service.template.containers[0].image.split('@').at(-1)!==artifact.imageDigest ||
        service.readyDigest!==artifact.imageDigest || traffic.type!=='TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION' ||
        traffic.revision!==service.latestReadyRevision) fail('Both pinned compatible revisions must be ready');
  }
}
// A scheduling boundary may outlast a reviewed 30-minute execution window.
// Renew only that observation clock before expiry, with fresh stable evidence.
// This retains every reservation, artifact, cap, phase, receipt anchor and call
// counter. The caller must separately bind authorization to the returned plan.
export function renewNaturalWaitWindow(plan,journal,state,now) {
  validate(plan,state,now);assertSnapshot(state,now);
  if(journal.planHash!==digest(plan)||journal.pending||journal.phase!=='awaiting-natural-run'||
      plan.operation==='rollback'||!journal.beforeNatural||!journal.reservation||
      state.worker.paused!==true||publicPolicy(state.services.marketapi.iam)||
      state.jobs[JOBS[0]].state!=='ENABLED'||state.jobs[JOBS[1]].state!=='PAUSED'||
      !state.barrier.authenticatedCallersStopped||state.barrier.activeApi||state.barrier.activeCollector||
      state.barrier.activeAdmin||state.worker.activeExecutions||
      accountingHash(state)!==journal.accounting||accountingHash(state)!==accountingHash(journal.beforeNatural))
    fail('Natural-wait renewal requires a stable, drained, unopened release');
  assertArtifact(state,plan[journal.flavor]);verifyRollbackHold(plan,state.ledger.value,now);
  const nextPlan={...clone(plan),observedAt:state.at},nextJournal=clone(journal);
  nextJournal.windowRenewals??=[];
  nextJournal.windowRenewals.push({at:now,previousPlanHash:digest(plan),nextPlanHash:digest(nextPlan),stateHash:stateHash(state),reason:'Awaiting the next natural scheduled run'});
  nextJournal.planHash=digest(nextPlan);
  return {plan:nextPlan,journal:nextJournal};
}
function expectedAction(s,a) {
  switch(a.kind) {
    case 'worker-pause': return s.worker.paused===a.value;
    case 'job-state': return s.jobs[a.name].state===a.value;
    case 'api-policy': return same(bodyPolicy(s.services.marketapi.iam),bodyPolicy(a.value));
    case 'reserve': return same(s.ledger.value,a.value);
    case 'deploy': {
      const v=s.services[a.name]; return !v.reconciling && v.latestReadyRevision===v.latestCreatedRevision &&
        v.readyDigest===a.value && v.template.containers[0].image.split('@').at(-1)===a.value &&
        v.traffic[0].type==='TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION' && v.traffic[0].revision===v.latestReadyRevision;
    }
    case 'worker-code': return s.worker.sourceDigest===a.value && s.worker.deploymentDigest===a.value;
    case 'hosting': return s.hosting.digest===a.value;
    default: return false;
  }
}

export class Migration {
  constructor(plan, io, journal={version:1,steps:[]}) {
    const fixture=io?.kind==='isolated-fixture'&&/^fixture-/.test(io.dataset??'');
    const production=io?.kind==='google-management'&&io.dataset==='bazaarsignal-510305'&&io.executionAuthorized?.(plan)===true;
    if(!fixture&&!production)fail('Production execution is disabled without explicit plan-bound authorization');
    this.plan=clone(plan); this.io=io; this.journal=journal; this.calls=journal.calls??0;
    if(!Number.isSafeInteger(this.calls)||this.calls<0)fail('Invalid persisted call count');
    if(journal.planHash && journal.planHash!==digest(plan))fail('Journal belongs to another plan');
    journal.planHash=digest(plan);
  }
  async read() {
    if(++this.calls>200)fail('Control-plane call limit reached');
    this.journal.calls=this.calls;
    await this.record();
    const s=await this.io.read(); assertSnapshot(s,this.io.now()); return s;
  }
  async record() { await this.io.saveJournal(clone(this.journal)); }
  async action(s, action) {
    assertRollbackAction(this.plan,action);
    if(this.journal.pending)fail('Unresolved operation; reconcile before another mutation');
    const record={id:`${this.plan.releaseId}:${this.journal.steps.length}`,at:this.io.now(),action:clone(action),
      expectedStateHash:stateHash(s),status:'intent'};
    this.journal.steps.push(record);this.journal.pending=record.id;await this.record();
    let error;
    try {
      if(++this.calls>200)fail('Control-plane call limit reached');
      this.journal.calls=this.calls;
      await this.record();
      record.operation=await this.io.apply({...action,id:record.id,expectedStateHash:record.expectedStateHash});
    } catch(e) { error=e; record.error=e.message; }
    const after=await this.read();
    if(!expectedAction(after,action)) {
      if(error?.code==='REJECTED' && stateHash(after)===record.expectedStateHash) {
        record.status='rejected';delete this.journal.pending;await this.record();throw error;
      }
      record.status=error?'uncertain':'verification-failed'; await this.record();
      throw error??Error('Mutation verification failed');
    }
    record.status=error?'reconciled':'verified';record.verifiedAt=this.io.now();
    delete this.journal.pending;await this.record();return after;
  }
  async reconcile() {
    if(!this.journal.pending)return;
    const step=this.journal.steps.find(s=>s.id===this.journal.pending);
    const result=step&&this.io.reconcileAction?await this.io.reconcileAction({...step.action,id:step.id,expectedStateHash:step.expectedStateHash}):null;
    const state=await this.read();
    if(result?.rejectedBeforeMutation===true) {
      assertContained(state);this.assertPreserved(state);validate(this.plan,state,this.io.now());
      if(accountingHash(state)!==this.journal.accounting||state.hosting.digest!==this.journal.contained.hosting.digest||
          state.worker.sourceDigest!==this.journal.contained.worker.sourceDigest||state.worker.deploymentDigest!==this.journal.contained.worker.deploymentDigest)
        fail('Accounting or release changed after read-only rejection');
      step.status='rejected';delete this.journal.pending;await this.record();return;
    }
    if(!step || !expectedAction(state,step.action))fail('Operation remains unresolved; no automatic retry');
    // Recover a crash after the CAS succeeded but before reserve() could save
    // the new accounting anchor. Match the entire intended ledger first.
    if(step.action.kind==='reserve') {
      assertContained(state);this.assertPreserved(state);
      if(state.controlHash!==this.journal.contained?.controlHash || state.receiptsHash!==this.journal.contained?.receiptsHash)
        fail('Unexpected accounting write while reconciling reservation');
      this.journal.accounting=accountingHash(state);
      this.journal.reservation=clone(state.ledger.value.deployments[this.plan.releaseId]);
    }
    step.status='reconciled'; delete this.journal.pending; await this.record();
  }
  async start() {
    await this.reconcile(); const s=await this.read(); validate(this.plan,s,this.io.now());
    if(this.plan.shutdownRecovery&&!this.journal.original&&s.ledger.value.version!==1)fail('Shutdown recovery must start on the observed v1 incident');
    recoveryApiPolicy(this.plan,this.journal.original??s);
    for(const n of SERVICES)verifyLiveUpdate(this.plan,s.ledger.value,
      {...s.services[n],traffic:[{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',percent:100}]},this.io.now());
    if(!this.journal.original) {this.journal.original=clone(s);await this.record();}
    this.assertPreserved(s);return s;
  }
  assertPreserved(s) {
    const before=this.journal.original;
    if(!before)fail('Missing original snapshot');
    verifyPaidContinuity(before.ledger.value,s.ledger.value);
    if(s.legacyRaw!==before.legacyRaw || s.worker.triggerHash!==before.worker.triggerHash)
      fail('Legacy data or triggers changed');
    // Normal worker execution may advance slots/receipts after reopening. Never
    // restore those old values. Freeze only the current drained snapshot.
    if(this.journal.contained && !['open','containing'].includes(this.journal.phase) &&
        s.worker.otherPropertiesHash!==this.journal.contained.worker.otherPropertiesHash)
      fail('Worker receipts/properties changed behind barrier');
    for(const n of JOBS)if(!same(jobConfig(before.jobs[n]),jobConfig(s.jobs[n])))fail('Job configuration drift');
    for(const n of SERVICES)if(!same(cloudConfig(before.services[n]),cloudConfig(s.services[n])))fail('Service configuration drift');
    if(!same(bodyPolicy(before.services.refreshmarket.iam),bodyPolicy(s.services.refreshmarket.iam)))fail('Collector IAM drift');
    const expected=bodyPolicy(before.services.marketapi.iam), actual=bodyPolicy(s.services.marketapi.iam);
    const privatePolicy=clone(expected);
    privatePolicy.bindings=(privatePolicy.bindings??[]).map(b=>({...b,members:b.members.filter(m=>!['allUsers','allAuthenticatedUsers'].includes(m))})).filter(b=>b.members.length);
    const recovered=this.plan.shutdownRecovery&&this.journal.natural&&
      same(actual,bodyPolicy(recoveryApiPolicy(this.plan,before)));
    if(!same(actual,expected)&&!same(actual,privatePolicy)&&!recovered)fail('Unreviewed API IAM drift');
    if(this.plan.shutdownRecovery&&!s.worker.paused)fail('Shutdown recovery requires mail to remain paused');
  }
  async contain() {
    if(!this.journal.original)await this.start();
    await this.reconcile();this.journal.phase='containing';await this.record();
    let s=await this.read();this.assertPreserved(s);
    if(!s.worker.paused)s=await this.action(s,{kind:'worker-pause',value:true,etag:s.worker.etag});
    for(const n of JOBS)if(s.jobs[n].state!=='PAUSED')s=await this.action(s,{kind:'job-state',name:n,value:'PAUSED',expectedConfiguration:jobConfig(s.jobs[n])});
    if(publicPolicy(s.services.marketapi.iam)) {
      const policy=clone(s.services.marketapi.iam);
      policy.bindings=(policy.bindings??[]).map(b=>({...b,members:b.members.filter(m=>!['allUsers','allAuthenticatedUsers'].includes(m))})).filter(b=>b.members.length);
      s=await this.action(s,{kind:'api-policy',value:policy,etag:policy.etag});
    }
    // Virtual time in rehearsal. Production drainage requires completion evidence,
    // not merely this minimum quiet interval.
    await this.io.wait(180000); const first=await this.read();assertContained(first);this.assertPreserved(first);
    await this.io.wait(30000);s=await this.read();assertContained(s);this.assertPreserved(s);
    if(accountingHash(first)!==accountingHash(s))fail('Accounting changed during drainage');
    this.journal.contained=clone(s);this.journal.accounting=accountingHash(s);this.journal.phase='contained';await this.record();return s;
  }
  async checkedContained() {
    const s=await this.read();assertContained(s);this.assertPreserved(s);validate(this.plan,s,this.io.now());
    if(accountingHash(s)!==this.journal.accounting)fail('Unexpected accounting write behind barrier');return s;
  }
  async reserve() {
    let s=await this.checkedContained(); const b=s.ledger.value;
    const held=b.deployments?.[this.plan.releaseId];
    if(held) {if(held.reservedUsd!==.5||held.imageDigest!==this.plan.imageDigest)fail('Conflicting rollout hold');return;}
    const value=clone(b);value.reservedUsd+=.5;value.deployments??={};
    value.deployments[this.plan.releaseId]=rolloutHold(this.plan,b,this.io.now());
    for(const[k,m]of Object.entries(this.plan.meters))value.reserved[k]=(value.reserved[k]??0)+m.hold;
    if(Buffer.byteLength(JSON.stringify(value))>1000000)fail('Rollout hold exceeds document headroom');
    verifyPaidContinuity(b,value);
    s=await this.action(s,{kind:'reserve',value,updateTime:s.ledger.version});
    this.journal.accounting=accountingHash(s);this.journal.reservation=clone(value.deployments[this.plan.releaseId]);await this.record();
  }
  async deploy(flavor='candidate') {
    if(this.plan.operation==='rollback'&&flavor!=='fallback')fail('Rollback-only plan cannot deploy a candidate');
    if(!['candidate','fallback'].includes(flavor))fail('Unknown release flavor');
    const artifact=this.plan[flavor];assertImage(artifact);
    await this.reserve();
    for(const n of SERVICES) {
      const s=await this.checkedContained();
      if(!expectedAction(s,{kind:'deploy',name:n,value:artifact.imageDigest}))
        await this.action(s,{kind:'deploy',name:n,value:artifact.imageDigest,etag:s.services[n].etag});
    }
    let s=await this.checkedContained();assertArtifact(s,artifact);
    if(!expectedAction(s,{kind:'worker-code',value:artifact.appsScriptSha256}))
      s=await this.action(s,{kind:'worker-code',value:artifact.appsScriptSha256,etag:s.worker.etag});
    s=await this.checkedContained();
    if(!expectedAction(s,{kind:'hosting',value:artifact.hostingSha256}))
      s=await this.action(s,{kind:'hosting',value:artifact.hostingSha256,etag:s.hosting.etag});
    await this.checkedContained();this.journal.flavor=flavor;this.journal.phase='deployed-contained';await this.record();
  }
  async beginNaturalVerification({collection=false}={}) {
    if(this.plan.operation==='rollback')fail('Rollback-only plan cannot resume collection');
    if(!collection)fail('Collection resumption not authorized');
    if(this.journal.phase!=='deployed-contained')fail('Both releases must be deployed before resuming');
    const s=await this.checkedContained();assertArtifact(s,this.plan[this.journal.flavor]);
    if(this.plan.shutdownRecovery)recoveryApiPolicy(this.plan,this.journal.original);
    else if(this.journal.original.jobs[JOBS[0]].state!=='ENABLED')fail('Originally paused collector must remain paused');
    this.journal.beforeNatural=clone(s);await this.record();
    await this.action(s,{kind:'job-state',name:JOBS[0],value:'ENABLED',expectedConfiguration:jobConfig(s.jobs[JOBS[0]])});
    this.journal.phase='awaiting-natural-run';await this.record();
  }
  async acceptNaturalEvidence(evidence) {
    if(this.plan.operation==='rollback')fail('Rollback-only plan cannot accept reopening evidence');
    if(this.journal.phase!=='awaiting-natural-run')fail('Not awaiting a natural run');
    const s=await this.read(), before=this.journal.beforeNatural;validate(this.plan,s,this.io.now());this.assertPreserved(s);
    assertArtifact(s,this.plan[this.journal.flavor]);
    if(!evidence || evidence.kind!=='natural-schedule' || evidence.job!==JOBS[0] ||
        evidence.revision!==s.services.refreshmarket.latestReadyRevision || !evidence.eventId ||
        evidence.receipt?.invocation!==evidence.eventId || evidence.receipt?.budget!==s.ledger.value.id ||
        evidence.receipt?.version!==1 || evidence.receipt?.finished!==true ||
        !Number.isFinite(evidence.at)||evidence.at<before.at||evidence.at>this.io.now()||
        !Number.isFinite(evidence.sampleAt)||evidence.sampleAt>evidence.at||evidence.at-evidence.sampleAt>180000 ||
        !evidence.snapshotComplete || s.controlHash===before.controlHash || s.receiptsHash===before.receiptsHash ||
        s.ledger.value.version!==2 || s.ledger.value.admissionCount!==(before.ledger.value.admissionCount??Object.keys(before.ledger.value.admissions).length)+1 ||
        s.receiptCount!==before.receiptCount+1 || publicPolicy(s.services.marketapi.iam) || !s.worker.paused || s.jobs[JOBS[1]].state!=='PAUSED')
      fail('Natural run evidence is incomplete or accounting is inconsistent');
    verifyPaidContinuity(before.ledger.value,s.ledger.value);
    this.journal.natural=clone(evidence);this.journal.phase='natural-verified';await this.record();
  }
  async reopen({api=false,daily=false,mail=false}={}) {
    if(this.plan.operation==='rollback')fail('Rollback-only plan cannot reopen services');
    if(mail&&this.plan.shutdownRecovery)fail('Shutdown recovery cannot resume mail');
    if(!['natural-verified','open'].includes(this.journal.phase))fail('Natural collection must verify before reopening');
    let s=await this.read();validate(this.plan,s,this.io.now());this.assertPreserved(s);assertArtifact(s,this.plan[this.journal.flavor]);
    const targetPolicy=recoveryApiPolicy(this.plan,this.journal.original);
    if(api && !same(bodyPolicy(s.services.marketapi.iam),bodyPolicy(targetPolicy))) {
      const value={...clone(targetPolicy),etag:s.services.marketapi.iam.etag};
      s=await this.action(s,{kind:'api-policy',value,etag:value.etag});
    }
    if(daily && (this.plan.shutdownRecovery||this.journal.original.jobs[JOBS[1]].state==='ENABLED') && s.jobs[JOBS[1]].state!=='ENABLED')
      s=await this.action(s,{kind:'job-state',name:JOBS[1],value:'ENABLED',expectedConfiguration:jobConfig(s.jobs[JOBS[1]])});
    if(mail && !this.journal.original.worker.paused) {
      if(!same(bodyPolicy(s.services.marketapi.iam),bodyPolicy(this.journal.original.services.marketapi.iam)) || this.io.now()-this.journal.natural.sampleAt>180000)
        fail('API access and fresh evidence required before mail resumption');
      if(s.worker.paused)s=await this.action(s,{kind:'worker-pause',value:false,etag:s.worker.etag});
    }
    this.journal.phase='open';await this.record();return s;
  }
  async rollback(target='fallback') {
    if(this.plan.operation==='rollback'&&target!=='fallback')fail('Rollback-only plan requires the retained fallback');
    if(this.plan.cpuAdmission===PAID_CPU_ADMISSION&&target==='original')fail('Paid migration requires the v2-compatible fallback');
    // Rollback is contained by default. Nothing automatically reopens afterward.
    await this.contain();let s=await this.read();
    if(target==='original') {
      if(s.ledger.value.version!==1 || s.receiptCount!==0 || Buffer.byteLength(JSON.stringify(s.ledger.value))*2+4096>128*1024)
        fail('Original v1-only rollback is unsafe after migration or for this ledger size');
      for(const n of SERVICES) {
        s=await this.checkedContained();
        await this.action(s,{kind:'deploy',name:n,value:this.journal.original.services[n].readyDigest,etag:s.services[n].etag});
      }
      s=await this.checkedContained();
      s=await this.action(s,{kind:'worker-code',value:this.journal.original.worker.sourceDigest,etag:s.worker.etag});
      await this.action(s,{kind:'hosting',value:this.journal.original.hosting.digest,etag:s.hosting.etag});
      this.journal.phase='original-restored-contained';await this.record();return;
    }
    if(target!=='fallback')fail('Unknown rollback target');
    await this.deploy('fallback');
  }
}
