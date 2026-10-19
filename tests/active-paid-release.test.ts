import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
// @ts-expect-error directly executable operator script
import { recoveredPaidLedger } from '../scripts/recover-paid-throttle.mjs';
// @ts-expect-error directly executable operator script
import { verifyReleasePlan, releaseLedgerKey, verifyPaidReleaseBudget, verifyPaidContinuity,
  reservePaidRelease, verifyLiveUpdate, releasePatch, verifySchedule, scheduleConfiguration, verifyPaidPreflight } from '../scripts/private-trial-release.mjs';

const now = Date.parse('2026-10-14T00:10:00Z');
const root = 'projects/bazaarsignal-510305/locations/us-central1';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
it('admits releases above the reservation threshold only with verified actual spending below the stop', () => {
  const b = budget(); b.reservedUsd = 6;
  b.billing = { accountId: '012803-EA91BE-8DCD32', budgetId: 'test-budget',
    subscription: 'projects/bazaarsignal-510305/subscriptions/bazaar-paid-spend-october',
    scope: 'BazaarSignal', intervalStart: Date.parse('2026-10-01T07:00:00Z'),
    latest: { actualUsd: 0, publishedAt: now - 60000, receivedAt: now, intervalStart: Date.parse('2026-10-01T07:00:00Z') } };
  expect(() => verifyPaidReleaseBudget(plan(), b, now)).not.toThrow();
  b.billing.latest.actualUsd = 4.5;
  expect(() => verifyPaidReleaseBudget(plan(), b, now)).toThrow();
  delete b.billing.latest;
  expect(() => verifyPaidReleaseBudget(plan(), b, now)).toThrow();
});
const legacy = '{"id":"free-20261001","stoppedAt":123,"monthlyReserved":{"cpuSeconds":10140}}';
const receipt = { imageDigest: `sha256:${'a'.repeat(64)}`, applicationOnly: true, localRuntimeSmokeVerified: true,
  requiredBaseImage: 'us-central1-docker.pkg.dev/serverless-runtimes/google-24-full/runtimes/nodejs24', cloudBuildMinutes: 0,
  artifactStorageHoldBytes: 84000000, registryUploadBytes: 13000000 };
const budget = (): any => ({ version: 1, id: 'paid-202610', startsAt: now - 86400000, expiresAt: Date.parse('2026-11-01T07:00:00.000Z'),
  limitUsd: 5, stopUsd: 4.5, reservedUsd: 1.03, reserved: { cpuSeconds: 100, firestoreReads: 200 }, observed: { firestoreReads: 100 },
  admissions: { initial: { at: now - 1, finished: true } }, lastCollectorAt: now - 60000, legacyLedgerSha256: hash(legacy) });
const plan = (): any => ({ project: 'bazaarsignal-510305', activePaidUpdate: true, operatingMode: 'paid-budget', updateExistingLive: true,
  id: 'paid-202610', releaseId: 'paid-cache-update', servicePeriodId: 'free-20261001', startsAt: new Date(budget().startsAt).toISOString(),
  expiresAt: '2026-11-01T07:00:00.000Z', shutdownGrantExpiresAt: '2026-11-01T08:00:00.000Z', legacyLedgerSha256: hash(legacy),
  services: ['marketapi'], budgetUsd: 5, applicationStopUsd: 4.5, fixedReserveUsd: 1, paidRolloutReserveUsd: .5,
  imageDigest: receipt.imageDigest, observedAt: now, scopeEvidence: 'fixture', capacityEvidence: 'fixture', counterEvidence: 'fixture',
  meters: { cpuSeconds: { used: 100, hold: 10000, headroom: 0, limit: 180000 },
    memoryGiBSeconds: { used: 100, hold: 10000, headroom: 0, limit: 360000 },
    artifactBytes: { used: 26000000, hold: receipt.artifactStorageHoldBytes, headroom: 0, limit: 1024 ** 3 },
    logBytes: { used: 100, hold: 16 * 1024 ** 2, headroom: 0, limit: 50 * 1024 ** 3 } } });
function service(name = 'marketapi'): any {
  return { name: `${root}/services/${name}`, etag: 'one', latestReadyRevision: 'old', latestCreatedRevision: 'old',
    terminalCondition: { state: 'CONDITION_SUCCEEDED' }, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }],
    scaling: { maxInstanceCount: 1 }, template: { revision: 'old', scaling: { maxInstanceCount: 1 }, timeout: name === 'marketapi' ? '15s' : '90s',
      maxInstanceRequestConcurrency: name === 'marketapi' ? 2 : 1,
      serviceAccount: `${name === 'marketapi' ? 'market-reader' : 'market-collector'}@bazaarsignal-510305.iam.gserviceaccount.com`,
      containers: [{ image: 'old-image', env: [{ name: 'MARKET_OPERATING_MODE', value: 'paid-budget' },
        { name: 'MARKET_LIVE_ID', value: 'free-20261001' }, { name: 'MARKET_LIVE_END', value: plan().expiresAt },
        { name: 'MARKET_TRIAL_START', value: 'original-unmodified-start' }, { name: 'OTHER', value: 'preserved' }],
        resources: { limits: { cpu: '1', memory: '1Gi' }, cpuIdle: true, startupCpuBoost: false }, startupProbe: { tcpSocket: { port: 8080 } } }] } };
}
const schedule = (): any => ({ name: `${root}/jobs/firebase-schedule-refreshMarket-us-central1`, state: 'ENABLED', schedule: '0 * * * *', timeZone: 'Etc/UTC',
  retryConfig: { retryCount: 0, maxRetryDuration: '0s' }, httpTarget: { httpMethod: 'POST', uri: 'https://refreshmarket-k5a64sgi2q-uc.a.run.app/',
    oidcToken: { serviceAccountEmail: 'market-collector@bazaarsignal-510305.iam.gserviceaccount.com', audience: 'https://refreshmarket-k5a64sgi2q-uc.a.run.app/' } } });

it('repairs only the inspected transient throttle while preserving the stop, holds, expiry and private rollout', async () => {
  const p = plan(); p.services = ['marketapi','refreshmarket']; p.dailyScheduleSha256 = 'd'.repeat(64);
  p.paidThrottleRepair = { code:429, stoppedAt:now-1000,
    message:'This database has exceeded their maximum request_rate/bandwidth/document_rate for writes, please retry with exponential backoff.' };
  const b = {...budget(), stoppedAt:p.paidThrottleRepair.stoppedAt, reason:p.paidThrottleRepair.message};
  const s = schedule(); s.state='PAUSED'; p.scheduleSha256=hash(JSON.stringify(scheduleConfiguration(s)));
  expect(()=>verifySchedule(p,s)).not.toThrow();
  expect(()=>verifySchedule(p,{...s,state:'ENABLED'})).toThrow();
  expect(()=>verifyLiveUpdate(p,b,service(),now)).not.toThrow();
  const patched=releasePatch(service(),'marketapi',p);
  expect(patched.template.containers[0].env).toEqual(service().template.containers[0].env);
  const result=await reservePaidRelease(p,async()=>({updateTime:'1',fields:{value:{stringValue:JSON.stringify(b)}}}),async()=>true,()=>now);
  expect(result.after).toMatchObject({stoppedAt:b.stoppedAt,reason:b.reason,expiresAt:b.expiresAt,reservedUsd:1.53,admissions:b.admissions});
  const active=recoveredPaidLedger(p,result.after,now);
  expect(active.stoppedAt).toBeUndefined();expect(active.reason).toBeUndefined();
  expect(active.recoveries).toEqual({[p.releaseId]:{at:now,priorStoppedAt:b.stoppedAt,priorReason:b.reason,imageDigest:p.imageDigest}});
  const prior={previous:{at:now-10000,priorReason:'old',priorStoppedAt:now-20000,imageDigest:'old'}};
  expect(recoveredPaidLedger(p,{...result.after,recoveries:prior},now).recoveries.previous).toEqual(prior.previous);
  const original=structuredClone(result.after); delete original.stoppedAt; delete original.reason;
  const withoutAudit=structuredClone(active);delete withoutAudit.recoveries;
  expect(withoutAudit).toEqual(original);
  expect(()=>recoveredPaidLedger(p,active,now)).toThrow();
  expect(()=>recoveredPaidLedger(p,b,now)).toThrow('hold missing');
  expect(()=>recoveredPaidLedger(p,result.after,b.expiresAt)).toThrow();
  for(const bad of [{...b,stoppedAt:b.stoppedAt+1},{...b,reason:'Quota exhausted'},{...b,reason:'Operator pause'},
    {...b,reservedUsd:5},{...b,expiresAt:now}]) expect(()=>verifyPaidReleaseBudget(p,bad,now)).toThrow();
  for(const bad of [{...p,services:['marketapi']},{...p,paidThrottleRepair:{...p.paidThrottleRepair,code:500}},
    {...p,paidThrottleRepair:{...p.paidThrottleRepair,message:'Quota exhausted'}}]) expect(()=>verifyReleasePlan(bad,receipt,now)).toThrow();
});

it('admits a live paid release using its own ledger without renewing the service period', () => {
  const p = plan(), s = service();
  expect(releaseLedgerKey(p)).toBe('paid-budget-october');
  expect(releaseLedgerKey({ operatingMode: 'free-tier' })).toBe('live-allowance');
  expect(() => verifyReleasePlan(p, receipt, now)).not.toThrow();
  expect(() => verifyLiveUpdate(p, budget(), s, now)).not.toThrow();
  expect(() => verifyLiveUpdate(p, JSON.parse(legacy), s, now)).toThrow();
  const before = structuredClone(s), patched = releasePatch(s, 'marketapi', p);
  expect(s).toEqual(before);
  const expected = structuredClone(before.template); delete expected.revision;
  expected.containers[0].image = `us-central1-docker.pkg.dev/bazaarsignal-510305/gcf-artifacts/market-trial@${receipt.imageDigest}`;
  expect(patched.template).toEqual(expected);
  expect(patched.traffic).toEqual(before.traffic); expect(patched.scaling).toEqual(before.scaling);
});

it('rejects activation/recovery flags, renewal, invalid evidence and excessive rollout holds', () => {
  for (const patch of [{ activePaidUpdate: false }, { updateExistingLive: false }, { updateExistingLive: 1 }, { id: 'free-20261001' },
    { pausedCodeOnly: true }, { keepCollectionPaused: true }, { paidBudgetCodeOnly: true }, { recoverStopped: true },
    { measurementCodeOnly: true }, { activationGranted: true }, { expiresAt: '2026-12-01T07:00:00.000Z' },
    { paidRolloutReserveUsd: 0 }, { releaseId: '__proto__' }, { shutdownGrantExpiresAt: 'invalid' }, { observedAt: now - 1800001 }])
    expect(() => verifyReleasePlan({ ...plan(), ...patch }, receipt, now)).toThrow();
  const p = plan(); p.meters.cpuSeconds.hold = 100000;
  expect(() => verifyReleasePlan(p, receipt, now)).toThrow('$0.50');
});

it('rejects missing, stopped, exhausted, malformed and expired paid budgets', () => {
  for (const ledger of [null, {}, { ...budget(), stoppedAt: now }, { ...budget(), reservedUsd: 4.001 },
    { ...budget(), reason: 'owner stop' }, { ...budget(), expiresAt: now }, { ...budget(), startsAt: now + 1 },
    { ...budget(), reservedUsd: NaN }, { ...budget(), reserved: { cpuSeconds: -1 } }, { ...budget(), legacyLedgerSha256: 'b'.repeat(64) }])
    expect(() => verifyPaidReleaseBudget(plan(), ledger, now)).toThrow();
  expect(() => verifyPaidReleaseBudget(plan(), budget(), budget().expiresAt)).toThrow();
});

it('retains every previous counter and admission across concurrent accounting', () => {
  const before = budget(), after = budget(); after.reservedUsd += .1; after.reserved.cpuSeconds++; after.observed.firestoreReads++;
  after.admissions.new = { at: now }; expect(() => verifyPaidContinuity(before, after)).not.toThrow();
  for (const change of [(s: any) => s.reservedUsd--, (s: any) => delete s.reserved.cpuSeconds,
    (s: any) => delete s.admissions.initial, (s: any) => s.admissions.initial.finished = false,
    (s: any) => s.lastCollectorAt = 0, (s: any) => s.expiresAt++]) {
    const bad = structuredClone(after); change(bad); expect(() => verifyPaidContinuity(before, bad)).toThrow();
  }
});

it('reserves once with a fresh CAS after contention, keeps observed data and never refunds uncertain holds', async () => {
  let state = budget(), attempts = 0;
  const result = await reservePaidRelease(plan(), async () => ({ updateTime: String(attempts), fields: { value: { stringValue: JSON.stringify(state) } } }),
    async (doc: any, next: any) => {
      expect(doc.updateTime).toBe(String(attempts));
      if (attempts++ === 0) { state.reservedUsd += .01; state.reserved.firestoreReads++; return false; }
      state = next; return true;
    }, () => now);
  expect(state.reservedUsd).toBeCloseTo(1.54);
  expect(state.observed).toEqual(budget().observed); expect(state.admissions).toEqual(budget().admissions);
  expect(state.reserved.firestoreReads).toBe(201); expect(state.reserved.cpuSeconds).toBe(10100);
  expect(result.after.deployments['paid-cache-update'].reservedUsd).toBe(.5);
  await expect(reservePaidRelease(plan(), async () => ({ updateTime: '3', fields: { value: { stringValue: JSON.stringify(state) } } }), () => { throw Error('unexpected write'); }, () => now)).rejects.toThrow('already reserved');
  const lost = structuredClone(state); lost.deployments = {}; expect(() => verifyPaidContinuity(state, lost)).toThrow('hold lost');
});

it('a concurrent owner stop or persistent contention prevents upload admission', async () => {
  let state = budget(), calls = 0;
  const read = async () => ({ updateTime: 'one', fields: { value: { stringValue: JSON.stringify(state) } } });
  await expect(reservePaidRelease(plan(), read, async () => { state.stoppedAt = now; return false; }, () => now)).rejects.toThrow('stopped');
  state = budget();
  await expect(reservePaidRelease(plan(), read, async () => { calls++; return false; }, () => now)).rejects.toThrow('contention');
  expect(calls).toBe(3); expect(state.reservedUsd).toBe(1.03);
});

it('preserves the exact hourly target, no retries and service runtime limits', () => {
  const p = plan(), s = schedule(); p.scheduleSha256 = hash(JSON.stringify(scheduleConfiguration(s)));
  expect(() => verifySchedule(p, s)).not.toThrow();
  for (const patch of [{ state: 'PAUSED' }, { schedule: '*/5 * * * *' }, { timeZone: 'America/New_York' }, { retryConfig: { retryCount: 1 } }])
    expect(() => verifySchedule(p, { ...s, ...patch })).toThrow();
  for (const change of [(s: any) => s.invokerIamDisabled = true, (s: any) => s.template.scaling.maxInstanceCount = 2,
    (s: any) => s.template.containers[0].resources.cpuIdle = false, (s: any) => s.template.serviceAccount = 'other',
    (s: any) => s.template.timeout = '300s', (s: any) => s.template.containers[0].env[0].value = 'measurement']) {
    const bad = service(); change(bad); expect(() => verifyLiveUpdate(p, budget(), bad, now)).toThrow();
  }
});

it('requires fresh complete scope, original legacy accounting, rollback and shutdown authority', () => {
  const p = plan(), s = schedule(); p.scheduleSha256 = hash(JSON.stringify(scheduleConfiguration(s)));
  const grant = (role: string) => ({ role: `projects/bazaarsignal-510305/roles/${role}`,
    members: ['market-reader','market-collector'].map(a => `serviceAccount:${a}@bazaarsignal-510305.iam.gserviceaccount.com`),
    condition: { expression: `request.time < timestamp('${p.shutdownGrantExpiresAt}')` } });
  const resources: any = { paid: { fields: { value: { stringValue: JSON.stringify(budget()) } } }, legacy: { fields: { value: { stringValue: legacy } } },
    billing: { billingEnabled: true, projectId: 'bazaarsignal-510305' }, database: { locationId: 'us-central1' },
    repository: { name: `${root}/repositories/gcf-artifacts`, sizeBytes: '26000000' }, hosting: { releases: [{ version: { name: 'sites/bazaarsignal/versions/rollback' } }] },
    scheduler: s, marketapi: service(), refreshmarket: service('refreshmarket'),
    marketapiIam: { bindings: [grant('marketTrialApiStop'), { role: 'roles/run.invoker', members: ['allUsers'] }] },
    refreshmarketIam: { bindings: [] }, projectIam: { bindings: [grant('marketTrialSchedulerStop')] },
    schedulerStopRole: { includedPermissions: ['cloudscheduler.jobs.get','cloudscheduler.jobs.pause'] },
    apiStopRole: { includedPermissions: ['run.services.getIamPolicy','run.services.setIamPolicy'] } };
  p.policySha256 = Object.fromEntries(['marketapi','refreshmarket'].map(n => [n, hash(JSON.stringify(resources[`${n}Iam`]))]));
  const evidence = { at: new Date(now).toISOString(), calls: 15, errors: [], resources };
  expect(() => verifyPaidPreflight(p, evidence, now)).not.toThrow();
  for (const change of [(r: any) => r.hosting.releases = [], (r: any) => r.projectIam.bindings = [],
    (r: any) => r.billing.billingEnabled = false, (r: any) => r.legacy.fields.value.stringValue += ' ',
    (r: any) => r.marketapiIam.bindings.pop(), (r: any) => r.schedulerStopRole.includedPermissions.push('cloudscheduler.jobs.resume')]) {
    const bad = structuredClone(evidence); change(bad.resources); expect(() => verifyPaidPreflight(p, bad, now)).toThrow();
  }
  expect(() => verifyPaidPreflight(p, evidence, now + 1800001)).toThrow();
});
