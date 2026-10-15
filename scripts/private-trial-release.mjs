import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDeploymentAccounting, verifyDeploymentAccounting } from './deployment-accounting.mjs';
import { validPaidBilling } from '../shared/paid-spending.ts';

const project = 'bazaarsignal-510305';
const root = `projects/${project}/locations/us-central1`;
const registry = 'https://us-central1-docker.pkg.dev';
const repository = `${project}/gcf-artifacts/market-trial`;
const baseImage = 'us-central1-docker.pkg.dev/serverless-runtimes/google-24-full/runtimes/nodejs24';
const job = `${root}/jobs/firebase-schedule-refreshMarket-us-central1`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const isPublic = policy => (policy.bindings ?? []).some(b =>
  b.members?.some(m => m === 'allUsers' || m === 'allAuthenticatedUsers'));
const paidEnd = '2026-11-01T07:00:00.000Z';
const safeId = value => /^[a-zA-Z0-9_-]{1,100}$/.test(value ?? '') && !['__proto__','constructor','prototype'].includes(value);
const counters = value => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.values(value).every(n => Number.isFinite(n) && n >= 0);

export function verifyActivePaidPlan(plan) {
  if (plan.activePaidUpdate !== true || plan.operatingMode !== 'paid-budget' || plan.updateExistingLive !== true ||
      plan.id !== 'paid-202610' || !safeId(plan.releaseId) || !safeId(plan.servicePeriodId) ||
      plan.pausedCodeOnly !== undefined || plan.keepCollectionPaused !== undefined || plan.pausedSchedule !== undefined ||
      plan.paidBudgetCodeOnly !== undefined || plan.recoverStopped !== undefined || plan.measurementCodeOnly !== undefined ||
      plan.activationGranted !== undefined || plan.paidRolloutReserveUsd !== .5 ||
      plan.budgetUsd !== 5 || plan.applicationStopUsd !== 4.5 || plan.fixedReserveUsd !== 1 || plan.expiresAt !== paidEnd)
    throw new Error('Invalid active paid code update; activation, recovery and renewal are forbidden');
}

export const releaseLedgerKey = plan => {
  if (plan.activePaidUpdate !== undefined) { verifyActivePaidPlan(plan); return 'paid-budget-october'; }
  return 'live-allowance';
};

export function verifyPaidReleaseBudget(plan, ledger, now = Date.now()) {
  verifyActivePaidPlan(plan);
  if (!ledger || ledger.version !== 1 || ledger.id !== plan.id ||
      !Number.isFinite(ledger.startsAt) || ledger.startsAt !== Date.parse(plan.startsAt) || ledger.startsAt > now ||
      ledger.expiresAt !== Date.parse(paidEnd) || now >= ledger.expiresAt || ledger.expiresAt <= ledger.startsAt ||
      ledger.expiresAt - ledger.startsAt > 32 * 86400000 || ledger.stoppedAt !== undefined || ledger.reason !== undefined ||
      ledger.limitUsd !== 5 || ledger.stopUsd !== 4.5 || !Number.isFinite(ledger.reservedUsd) ||
      ledger.reservedUsd < 1 || (ledger.billing && !validPaidBilling(ledger.billing, now)) ||
      (ledger.billing?.latest ? ledger.billing.latest.actualUsd >= 4.5 : ledger.reservedUsd > 4.5) ||
      !counters(ledger.reserved) || !counters(ledger.observed) ||
      !ledger.admissions || Array.isArray(ledger.admissions) || typeof ledger.admissions !== 'object' ||
      Object.keys(ledger.admissions).length >= 4000 || !/^[a-f0-9]{64}$/.test(ledger.legacyLedgerSha256) ||
      ledger.legacyLedgerSha256 !== plan.legacyLedgerSha256)
    throw new Error('Paid budget is missing, changed, stopped, exhausted or expired');
  const deployments = ledger.deployments ?? {};
  if (!deployments || typeof deployments !== 'object' || Array.isArray(deployments) || Object.keys(deployments).length > 16)
    throw new Error('Invalid retained paid deployments');
  const held = deployments[plan.releaseId];
  if (held && (held.reservedUsd !== .5 || held.imageDigest !== plan.imageDigest)) throw new Error('Paid rollout identity changed');
  if (!held && (Object.keys(deployments).length >= 16 || (!ledger.billing?.latest && ledger.reservedUsd + .5 > ledger.stopUsd)))
    throw new Error('Paid deployment lacks $0.50 reservation headroom');
}

/** Normal hourly/browser work can advance accounting during a rollout. It can
 * never remove an admission, shrink a counter or replace a retained hold. */
export function verifyPaidContinuity(before, after) {
  for (const key of ['version','id','startsAt','expiresAt','limitUsd','stopUsd','legacyLedgerSha256'])
    if (after[key] !== before[key]) throw new Error(`Paid identity changed: ${key}`);
  if (after.reservedUsd < before.reservedUsd || (after.lastCollectorAt ?? 0) < (before.lastCollectorAt ?? 0))
    throw new Error('Paid counters moved backwards');
  if (before.billing) {
    for (const key of ['accountId','budgetId','subscription','scope','intervalStart'])
      if (before.billing[key] !== after.billing?.[key]) throw new Error('Google billing identity changed');
    if (before.billing.latest && (!after.billing?.latest || after.billing.latest.publishedAt < before.billing.latest.publishedAt))
      throw new Error('Google spending observation moved backwards');
  }
  for (const group of ['reserved','observed']) {
    if (!counters(after[group])) throw new Error('Invalid paid counters');
    for (const [key, value] of Object.entries(before[group]))
      if (!(after[group][key] >= value)) throw new Error(`Paid counters moved backwards: ${group}.${key}`);
  }
  for (const [id, previous] of Object.entries(before.admissions)) {
    const current = after.admissions?.[id];
    if (!current || current.at !== previous.at || (previous.finished && !current.finished)) throw new Error('Paid admission lost');
  }
  for (const [id, hold] of Object.entries(before.deployments ?? {}))
    if (JSON.stringify(after.deployments?.[id]) !== JSON.stringify(hold)) throw new Error('Paid rollout hold lost');
}

/** A fresh updateTime precondition fences concurrent admissions and owner stops.
 * Failed/ambiguous attempts are never automatically retried with a new identity. */
export async function reservePaidRelease(plan, readDocument, commit, now = Date.now) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = await readDocument(), ledger = JSON.parse(doc.fields.value.stringValue);
    verifyPaidReleaseBudget(plan, ledger, now());
    if (!doc.updateTime || ledger.deployments?.[plan.releaseId]) throw new Error('Paid rollout already reserved or unversioned');
    const next = structuredClone(ledger);
    next.reservedUsd += .5;
    for (const [key, meter] of Object.entries(plan.meters)) next.reserved[key] = (next.reserved[key] ?? 0) + meter.hold;
    next.deployments ??= {};
    next.deployments[plan.releaseId] = { at: now(), reservedUsd: .5, imageDigest: plan.imageDigest };
    verifyPaidContinuity(ledger, next);
    if (await commit(doc, next)) return { before: ledger, after: next };
  }
  throw new Error('Paid rollout reservation contention; no upload admitted');
}

export const scheduleConfiguration = schedule => ({ name: schedule.name, state: schedule.state, schedule: schedule.schedule,
  timeZone: schedule.timeZone, httpTarget: schedule.httpTarget, retryConfig: schedule.retryConfig, attemptDeadline: schedule.attemptDeadline });

export function verifyPaidPreflight(plan, evidence, now = Date.now()) {
  verifyActivePaidPlan(plan);
  const r = evidence.resources, at = Date.parse(evidence.at);
  if (!r || evidence.errors?.length || !Number.isFinite(at) || at !== plan.observedAt || now < at || now - at > 1800000 ||
      evidence.calls > 24 || r.billing?.billingEnabled !== true || r.billing.projectId !== project ||
      r.database?.locationId !== 'us-central1' || r.repository?.name !== `${root}/repositories/gcf-artifacts` ||
      !Number.isFinite(Number(r.repository.sizeBytes)) || Number(r.repository.sizeBytes) > plan.meters.artifactBytes.used ||
      !r.hosting?.releases?.[0]?.version?.name?.startsWith('sites/bazaarsignal/versions/'))
    throw new Error('Paid preflight scope, rollback or freshness is incomplete');
  const ledger = JSON.parse(r.paid.fields.value.stringValue);
  verifyPaidReleaseBudget(plan, ledger, now);
  if (sha(r.legacy.fields.value.stringValue) !== ledger.legacyLedgerSha256) throw new Error('Legacy accounting changed');
  verifySchedule(plan, r.scheduler);
  const grant = (policy, role) => (policy.bindings ?? []).some(b => b.role === `projects/${project}/roles/${role}` &&
    b.condition?.expression === `request.time < timestamp('${plan.shutdownGrantExpiresAt}')` &&
    ['market-reader', 'market-collector'].every(a => b.members?.includes(`serviceAccount:${a}@${project}.iam.gserviceaccount.com`)));
  if (!grant(r.projectIam, 'marketTrialSchedulerStop') || !grant(r.marketapiIam, 'marketTrialApiStop') ||
      JSON.stringify([...(r.schedulerStopRole.includedPermissions ?? [])].sort()) !== JSON.stringify(['cloudscheduler.jobs.get','cloudscheduler.jobs.pause']) ||
      JSON.stringify([...(r.apiStopRole.includedPermissions ?? [])].sort()) !== JSON.stringify(['run.services.getIamPolicy','run.services.setIamPolicy']) ||
      r.schedulerStopRole.deleted || r.apiStopRole.deleted)
    throw new Error('Shutdown authority is missing or changed');
  for (const name of ['marketapi','refreshmarket']) {
    verifyLiveUpdate(plan, ledger, r[name], now);
    if (sha(JSON.stringify(r[`${name}Iam`])) !== plan.policySha256?.[name] || isPublic(r[`${name}Iam`]) !== (name === 'marketapi'))
      throw new Error('Paid invocation permissions changed');
  }
}

/** Successful and uncertain attempts both retain their holds. Measurements are
 * separate evidence; a smaller repository or compute sample never refunds them. */
export function retainedReleaseHolds(receipts, periodStart, periodEnd) {
  const start = Date.parse(periodStart), end = Date.parse(periodEnd);
  if (!Number.isFinite(start + end) || end <= start || end - start > 32 * 86400000)
    throw new Error('Invalid deployment accounting period');
  const held = {};
  for (const receipt of receipts) {
    if (!receipt.apply || !receipt.reservations) continue;
    const at = Date.parse(receipt.at);
    if (!Number.isFinite(at)) throw new Error('Prior rollout has unknown reservation time');
    if (at < start || at >= end) continue;
    for (const [key, meter] of Object.entries(receipt.reservations)) {
      if (!Number.isFinite(meter.hold) || meter.hold < 0) throw new Error('Invalid retained rollout hold');
      held[key] = (held[key] ?? 0) + meter.hold;
    }
  }
  return held;
}

/** Bounded image release, optionally updating an already-active live period.
 * Cannot activate a period, invoke a handler, reset accounting, create a build/job,
 * or change billing/IAM. Existing-live updates must preserve identity and expiry. */
export function verifyReleasePlan(plan, receipt, now = Date.now()) {
  const paid = plan.operatingMode === 'paid-budget';
  if (plan.activePaidUpdate !== undefined) verifyActivePaidPlan(plan);
  if (paid && !plan.activePaidUpdate && (!plan.pausedCodeOnly || !plan.keepCollectionPaused || !plan.paidBudgetCodeOnly ||
      plan.budgetUsd !== 5 || plan.applicationStopUsd !== 4.5 || plan.fixedReserveUsd !== 1 ||
      plan.expiresAt !== '2026-11-01T07:00:00.000Z'))
    throw new Error('Invalid $5 paid pilot release');
  if (!paid && plan.pausedCodeOnly && (plan.existingImageOverageDisclosed || !plan.deploymentScopeComplete))
    throw new Error('Paused code release requires complete deployment scope within every allowance');
  if (plan.project !== project || plan.imageDigest !== receipt.imageDigest ||
      !/^sha256:[a-f0-9]{64}$/.test(receipt.imageDigest) ||
      !receipt.applicationOnly || !receipt.localRuntimeSmokeVerified ||
      receipt.requiredBaseImage !== baseImage || receipt.cloudBuildMinutes !== 0)
    throw new Error('Unverified local application-only image');
  const start = Date.parse(plan.startsAt), end = Date.parse(plan.expiresAt);
  const live = plan.operatingMode === 'free-tier' || paid;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(plan.id) || !Number.isFinite(start + end) ||
      end <= start || end - start > (live ? 32 * 86400000 : 900000) || (live ? now >= end : now >= start) ||
      !Number.isFinite(Date.parse(plan.shutdownGrantExpiresAt)) || Date.parse(plan.shutdownGrantExpiresAt) < end + 180000)
    throw new Error('Invalid fixed release/trial window or shutdown margin');
  if (!Number.isFinite(plan.observedAt) || now < plan.observedAt || now - plan.observedAt > 1800000 ||
      !plan.scopeEvidence || !plan.capacityEvidence || !plan.counterEvidence)
    throw new Error('Missing or stale deployment evidence');
  const required = ['cpuSeconds', 'memoryGiBSeconds', 'artifactBytes', 'logBytes'];
  for (const key of required) {
    const m = plan.meters?.[key];
    // Existing-live reporting releases may honestly disclose an already-exceeded
    // image free allowance. This bounded exception does not alter runtime budgets,
    // enable billing, delete rollback images, or claim that storage is free.
    const disclosedImageOverage = key === 'artifactBytes' && plan.updateExistingLive === true &&
      plan.operatingMode === 'free-tier' && plan.existingImageOverageDisclosed === true &&
      m?.used >= m?.limit && m.limit === .5 * 1024 ** 3 &&
      plan.artifactCapacityCeilingBytes === 1024 ** 3 &&
      m.used + m.hold + m.headroom < plan.artifactCapacityCeilingBytes;
    if (!m || ![m.used, m.hold, m.headroom, m.limit].every(Number.isFinite) ||
        Math.min(m.used, m.hold, m.headroom) < 0 || m.limit <= 0 ||
        (!paid && (m.used + m.hold + m.headroom) / m.limit >= .75 && !disclosedImageOverage))
      throw new Error(`Private deployment lacks allowance headroom: ${key}`);
  }
  if (plan.meters.artifactBytes.hold < receipt.artifactStorageHoldBytes ||
      plan.meters.cpuSeconds.hold < 10000 || plan.meters.memoryGiBSeconds.hold < 10000 ||
      plan.meters.logBytes.hold < 16 * 1024 ** 2 ||
      receipt.registryUploadBytes > 20 * 1024 ** 2)
    throw new Error('Insufficient rollout/image/log allowance reservation');
  if (paid) {
    const m=plan.meters;
    const gross=m.cpuSeconds.hold*.000024+m.memoryGiBSeconds.hold*.0000025+
      m.artifactBytes.hold/1024**3*.10+m.logBytes.hold/1024**3*.5;
    if(gross>.5 || m.artifactBytes.used+m.artifactBytes.hold>1024**3)
      throw new Error('Paid deployment exceeds its $0.50 rollout reserve');
  }
  return { start, end };
}

export function uploadLocation(location) {
  const url = new URL(location, registry);
  const scopedPath = url.pathname.startsWith(`/v2/${repository}/blobs/uploads/`) ||
    /^\/artifacts-uploads\/namespaces\/bazaarsignal-510305\/repositories\/gcf-artifacts\/uploads\/[a-zA-Z0-9_-]+$/.test(url.pathname);
  if (url.origin !== registry || !scopedPath ||
      url.username || url.password || url.hash)
    throw new Error('Untrusted registry upload destination');
  return url;
}

/** A code update may not renew an active period or reset its accounting. */
export function verifyLiveUpdate(plan, ledger, service, now = Date.now()) {
  const env=Object.fromEntries((service.template?.containers?.[0]?.env??[]).map(e=>[e.name,e.value]));
  if (plan.activePaidUpdate) {
    verifyPaidReleaseBudget(plan, ledger, now);
    const name = service.name?.split('/').at(-1), template = service.template, container = template?.containers?.[0];
    if (!['marketapi','refreshmarket'].includes(name) || env.MARKET_OPERATING_MODE !== 'paid-budget' ||
        env.MARKET_LIVE_ID !== plan.servicePeriodId || env.MARKET_LIVE_END !== plan.expiresAt ||
        service.invokerIamDisabled === true || service.reconciling || service.terminalCondition?.state !== 'CONDITION_SUCCEEDED' ||
        service.latestReadyRevision !== service.latestCreatedRevision || template.containers.length !== 1 ||
        template.serviceAccount !== `${name === 'marketapi' ? 'market-reader' : 'market-collector'}@${project}.iam.gserviceaccount.com` ||
        template.timeout !== (name === 'marketapi' ? '15s' : '90s') ||
        template.maxInstanceRequestConcurrency !== (name === 'marketapi' ? 2 : 1) ||
        template.scaling?.maxInstanceCount !== 1 || (template.scaling?.minInstanceCount ?? 0) !== 0 ||
        service.scaling?.maxInstanceCount !== 1 || (service.scaling?.minInstanceCount ?? 0) !== 0 ||
        container.resources?.limits?.cpu !== '1' || container.resources?.limits?.memory !== '1Gi' ||
        container.resources?.cpuIdle !== true || container.resources?.startupCpuBoost === true ||
        service.traffic?.length !== 1 || service.traffic[0].percent !== 100 || service.traffic[0].type !== 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST')
      throw new Error('Active paid service configuration changed');
    return;
  }
  const measurementMode = plan.measurementCodeOnly === true && service.name?.endsWith('/refreshmarket') &&
    env.MARKET_OPERATING_MODE === 'measurement';
  const paidMode = plan.operatingMode === 'paid-budget' && plan.paidBudgetCodeOnly === true;
  if((plan.operatingMode!=='free-tier' && !paidMode) || !/^[a-zA-Z0-9_-]{1,100}$/.test(plan.releaseId??'') ||
    ledger?.id!==plan.id || ledger?.startsAt!==Date.parse(plan.startsAt) || ledger?.expiresAt!==Date.parse(plan.expiresAt) ||
    ledger.stoppedAt!==undefined || env.MARKET_LIVE_ID!==plan.id || env.MARKET_LIVE_END!==plan.expiresAt ||
    (env.MARKET_OPERATING_MODE!=='free-tier' && !measurementMode && !(paidMode && ['measurement','paid-budget'].includes(env.MARKET_OPERATING_MODE))))throw new Error('Live update must preserve the existing active allowance');
}

/** A portfolio code release may keep the existing allowance and both services,
 * while requiring the scheduler to remain paused throughout the rollout. */
export function verifySchedule(plan, schedule) {
  if (plan.activePaidUpdate) {
    verifyActivePaidPlan(plan);
    if (schedule.state !== 'ENABLED' || schedule.schedule !== '0 * * * *' || schedule.timeZone !== 'Etc/UTC' ||
        (schedule.retryConfig?.retryCount ?? 0) !== 0 || (schedule.retryConfig?.maxRetryDuration ?? '0s') !== '0s' ||
        schedule.httpTarget?.httpMethod !== 'POST' ||
        schedule.httpTarget?.uri !== 'https://refreshmarket-k5a64sgi2q-uc.a.run.app/' ||
        schedule.httpTarget?.oidcToken?.audience !== schedule.httpTarget.uri ||
        schedule.httpTarget?.oidcToken?.serviceAccountEmail !== `market-collector@${project}.iam.gserviceaccount.com` ||
        sha(JSON.stringify(scheduleConfiguration(schedule))) !== plan.scheduleSha256)
      throw new Error('Active paid hourly schedule or target changed');
    return;
  }
  const paused = plan.recoverStopped === true || plan.keepCollectionPaused === true;
  if (plan.keepCollectionPaused !== undefined &&
      (plan.keepCollectionPaused !== true || plan.updateExistingLive !== true || plan.recoverStopped))
    throw new Error('Invalid paused portfolio release');
  const expected = plan.pausedSchedule ?? '0 * * * *';
  if (plan.pausedSchedule !== undefined && (!plan.keepCollectionPaused || expected !== '*/5 * * * *'))
    throw new Error('Five-minute release requires an explicit paused schedule');
  if (schedule.state !== (paused ? 'PAUSED' : 'ENABLED') || schedule.schedule !== expected)
    throw new Error('Existing hourly schedule or pause changed');
}

/** Explicit repair deployment keeps the inspected stopped ledger unchanged and
 * both services private. Activation is a separate compare-and-swap operation. */
export function verifyStoppedUpdate(plan, ledger, service) {
  const reason=plan.recoveryStopReason??'The operation was aborted due to timeout';
  if (plan.recoverStopped !== true || plan.updateExistingLive !== true ||
      !['The operation was aborted due to timeout','Free-tier operating budget reached: firestoreReads'].includes(reason)||
      !Number.isFinite(ledger?.stoppedAt) || ledger.reason !== reason ||
      plan.stoppedLedgerSha256 !== sha(JSON.stringify(ledger)) ||
      JSON.stringify([...plan.services].sort()) !== JSON.stringify(['marketapi','refreshmarket']))
    throw new Error('Recovery must preserve the inspected timeout-stopped ledger and update both services');
  const active = { ...ledger }; delete active.stoppedAt; delete active.reason;
  verifyLiveUpdate(plan, active, service);
}

/** Deploy code to the exact inspected operator-paused period. Never recovers,
 * restarts, resets, or authorizes collection; both invokers stay private. */
export function verifyPausedUpdate(plan, ledger, service) {
  const measurementOnly = plan.measurementCodeOnly === true && /^measure-[a-zA-Z0-9_-]{1,80}$/.test(plan.measurementId ?? '') &&
    JSON.stringify(plan.services) === JSON.stringify(['refreshmarket']);
  if (plan.pausedCodeOnly !== true || plan.keepCollectionPaused !== true || plan.recoverStopped ||
      plan.updateExistingLive !== true || !Number.isFinite(ledger?.stoppedAt) || !ledger.reason ||
      plan.stoppedLedgerSha256 !== sha(JSON.stringify(ledger)) ||
      (!measurementOnly && JSON.stringify([...plan.services].sort()) !== JSON.stringify(['marketapi', 'refreshmarket'])))
    throw new Error('Paused code release must preserve the exact stopped ledger and both private services');
  const active = { ...ledger }; delete active.stoppedAt; delete active.reason;
  verifyLiveUpdate(plan, active, service);
}

export function releasePatch(service, name, plan) {
  const liveMode = ['free-tier','paid-budget'].includes(plan.operatingMode);
  if (!['marketapi', 'refreshmarket'].includes(name) || service.name !== `${root}/services/${name}` ||
      !service.etag || service.reconciling || service.invokerIamDisabled === true ||
      service.template?.containers?.length !== 1)
    throw new Error('Unexpected existing service');
  const template = structuredClone(service.template);
  delete template.revision;
  const container = template.containers[0];
  container.image = `${registry.slice(8)}/${repository}@${plan.imageDigest}`;
  if (plan.activePaidUpdate) {
    verifyActivePaidPlan(plan);
    // Image-only update: retain every environment value, permission boundary,
    // timeout, account, limit, probe and traffic setting from the inspected service.
    return { name: service.name, etag: service.etag, template,
      traffic: structuredClone(service.traffic), scaling: structuredClone(service.scaling) };
  }
  container.baseImageUri = baseImage;
  delete container.command;
  delete container.args;
  container.resources = { limits: { cpu: '1', memory: '1Gi' }, cpuIdle: true, startupCpuBoost: false };
  const values = {
    GCLOUD_PROJECT: project, FUNCTION_TARGET: name === 'marketapi' ? 'marketApi' : 'refreshMarket',
    FUNCTION_SIGNATURE_TYPE: 'http', MARKET_TRIAL_ID: plan.id,
    MARKET_TRIAL_START: plan.startsAt, MARKET_TRIAL_END: plan.expiresAt,
    MARKET_OPERATING_MODE: liveMode ? plan.operatingMode : 'trial',
    ...(liveMode ? { MARKET_LIVE_ID: plan.id, MARKET_LIVE_END: plan.expiresAt } : {}),
  };
  if (plan.measurementCodeOnly) {
    if (name !== 'refreshmarket' || !plan.pausedCodeOnly || !/^measure-[a-zA-Z0-9_-]{1,80}$/.test(plan.measurementId ?? ''))
      throw new Error('Measurement code release is collector-only and must remain paused');
    values.MARKET_OPERATING_MODE = 'measurement';
  }
  container.env = (container.env ?? []).filter(e => !(e.name in values));
  container.env.push(...Object.entries(values).map(([name, value]) => ({ name, value })));
  template.scaling = { minInstanceCount: 0, maxInstanceCount: 1 };
  template.maxInstanceRequestConcurrency = name === 'marketapi' ? 2 : 1;
  template.timeout = liveMode ? (name === 'marketapi' ? '15s' : '90s') : (name === 'marketapi' ? '30s' : '180s');
  template.serviceAccount = `${name === 'marketapi' ? 'market-reader' : 'market-collector'}@${project}.iam.gserviceaccount.com`;
  return { name: service.name, etag: service.etag, template,
    traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }],
    scaling: { minInstanceCount: 0, maxInstanceCount: 1 } };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 3 || args.slice(1).some(a => !['--apply', '--resume-empty-upload'].includes(a)))
    throw new Error('Usage: node scripts/private-trial-release.mjs <release-plan.json> [--apply] [--resume-empty-upload]');
  const apply = args.includes('--apply'), plan = read(args[0]);
  const liveUpdate=plan.updateExistingLive===true;
  const targets=plan.services??['marketapi','refreshmarket'];
  if(!Array.isArray(targets)||!targets.length||new Set(targets).size!==targets.length||targets.some(n=>!['marketapi','refreshmarket'].includes(n))||
    (plan.services && !liveUpdate))throw new Error('Selective updates require an existing live period');
  if(liveUpdate && (!/^[a-zA-Z0-9_-]{1,100}$/.test(plan.releaseId??'') || !['free-tier','paid-budget'].includes(plan.operatingMode)))
    throw new Error('Invalid existing-live update identity');
  const receipt = read(resolve(plan.imageDirectory, 'receipt.json'));
  const deploymentBalance = plan.pausedCodeOnly && plan.operatingMode !== 'paid-budget' ? loadDeploymentAccounting(plan.deploymentPeriodStart, plan.deploymentPeriodEnd) : null;
  if (deploymentBalance) verifyDeploymentAccounting(plan, deploymentBalance);
  verifyReleasePlan(plan, receipt);
  if (plan.activePaidUpdate) {
    const bytes = readFileSync(plan.preflightPath);
    if (sha(bytes) !== plan.preflightSha256) throw new Error('Paid preflight evidence changed');
    verifyPaidPreflight(plan, JSON.parse(bytes));
  }
  if (plan.pausedCodeOnly) {
    for (const [file, gates] of [
      ['shared/companion/portfolio-policy.ts', ['PORTFOLIO_COLLECTION_ENABLED', 'PORTFOLIO_EVALUATION_ENABLED']],
      ['shared/automation-policy.ts', ['BACKGROUND_JOBS_ENABLED', 'EMAIL_DELIVERY_ENABLED']],
    ]) for (const gate of gates)
      if (!readFileSync(file, 'utf8').includes(`export const ${gate} = false;`))
        throw new Error(`Paused code release requires ${gate}=false`);
  }
  if (readFileSync('market-functions/lib/index.cjs', 'utf8').includes('skyblock/auctions'))
    throw new Error('Retired auction collection must not be included in the release');
  const blob = digest => {
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid blob digest');
    const bytes = readFileSync(resolve(receipt.layout, 'blobs/sha256', digest.slice(7)));
    if (`sha256:${sha(bytes)}` !== digest) throw new Error('Image content changed');
    return bytes;
  };
  const manifestBytes = blob(receipt.imageDigest), manifest = JSON.parse(manifestBytes);
  const descriptors = [manifest.config, ...manifest.layers];
  for (const d of descriptors) if (blob(d.digest).length !== d.size) throw new Error('Invalid descriptor size');
  if (sha(readFileSync('market-functions/lib/index.cjs')) !== receipt.sourceSha256 ||
      sha(readFileSync('market-functions/package-lock.json')) !== receipt.lockSha256)
    throw new Error('Image no longer matches tested source/dependencies');
  const reportPath = resolve(`.local/private-release-${liveUpdate ? plan.releaseId : plan.id}-${apply ? 'apply' : 'inspect'}.json`);
  const prior = existsSync(reportPath) ? read(reportPath) : undefined;
  if (prior && (!apply || !args.includes('--resume-empty-upload') || prior.resumedAt ||
      prior.error !== 'Untrusted registry upload destination' || prior.uploadedBytes !== 0 ||
      prior.imageUploaded || Object.keys(prior.operations).length !== 0))
    throw new Error('Release already attempted; inspect its receipt, never repeat blindly');
  const report = prior ? { ...prior, priorFailure: prior.error, error: undefined, resumedAt: new Date().toISOString() }
    : { at: new Date().toISOString(), id: plan.id, apply, calls: 0, uploadedBytes: 0, operations: {}, verified: {} };
  const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));
  writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: prior ? 'w' : 'wx' });
  const require = createRequire(import.meta.url), auth = require('firebase-tools/lib/auth');
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw new Error('Expected deployment account unavailable');
  const credential = await auth.getAccessToken(account.tokens.refresh_token, []);
  async function request(url, method = 'GET', body, type = 'application/json', allowed = []) {
    if (++report.calls > 100) throw new Error('Deployment control-plane call bound reached');
    save();
    const r = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${credential.access_token}`, 'Content-Type': type },
      ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
    if (!r.ok && !allowed.includes(r.status)) {
      const text = (await r.text()).slice(0, 1000);
      throw new Error(`${new URL(url).hostname} ${method} HTTP ${r.status}: ${text}`);
    }
    return r;
  }
  const json = async (...args) => (await request(...args)).json();
  async function contained() {
    const schedule=await json(`https://cloudscheduler.googleapis.com/v1/${job}`);
    if(liveUpdate) {
      verifySchedule(plan,schedule);
      const doc=await json(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/marketCache/${releaseLedgerKey(plan)}`);
      const ledger=JSON.parse(doc.fields.value.stringValue);
      if (plan.activePaidUpdate) {
        verifyPaidReleaseBudget(plan, ledger);
        if (report.paidReservation) verifyPaidContinuity(report.paidReservation.after, ledger);
        else if (report.paidBefore) verifyPaidContinuity(report.paidBefore, ledger);
        else report.paidBefore = ledger;
        const legacy = await json(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/marketCache/live-allowance`);
        if (sha(legacy.fields.value.stringValue) !== ledger.legacyLedgerSha256) throw new Error('Legacy ledger changed');
        report.paidAfter = ledger;
      }
      if (deploymentBalance) verifyDeploymentAccounting(plan, deploymentBalance, ledger.monthlyReserved);
      for(const name of ['marketapi','refreshmarket']) {
        const service=await json(`https://run.googleapis.com/v2/${root}/services/${name}`);
        if(plan.pausedCodeOnly)verifyPausedUpdate(plan,ledger,service);
        else if(plan.recoverStopped)verifyStoppedUpdate(plan,ledger,service);
        else verifyLiveUpdate(plan,ledger,service);
        const policy=await json(`https://run.googleapis.com/v1/${root}/services/${name}:getIamPolicy?options.requestedPolicyVersion=3`);
        if(isPublic(policy)!==(!plan.recoverStopped && !plan.pausedCodeOnly && name==='marketapi'))throw new Error('Live invocation permissions changed');
        if (plan.activePaidUpdate && sha(JSON.stringify(policy)) !== plan.policySha256?.[name]) throw new Error('Paid IAM policy changed');
      }
      return;
    }
    if (schedule.state !== 'PAUSED')
      throw new Error('Collector is not paused');
    for (const name of ['marketapi', 'refreshmarket'])
      if (isPublic(await json(`https://run.googleapis.com/v1/${root}/services/${name}:getIamPolicy?options.requestedPolicyVersion=3`)))
        throw new Error('A service has public access');
  }
  try {
    await contained();
    const services = {};
    for (const name of targets) {
      services[name] = await json(`https://run.googleapis.com/v2/${root}/services/${name}`);
      if (services[name].template?.containers?.[0]?.image?.endsWith(`@${receipt.imageDigest}`))
        throw new Error(`Refusing unchanged code redeployment: ${name}`);
      releasePatch(services[name], name, plan);
    }
    report.rollback = Object.fromEntries(Object.entries(services).map(([name, service]) => [name, {
      revision: service.latestReadyRevision, image: service.template.containers[0].image, service,
    }]));
    if (!apply) { report.result = liveUpdate ? 'existing-live-update-ready' : 'private-release-ready'; return; }
    verifyReleasePlan(plan, receipt);
    // Reserve the entire image before any upload. A failure never refunds it.
    report.reservations = plan.meters;
    save();
    if (plan.activePaidUpdate) {
      await contained();
      const document = `projects/${project}/databases/(default)/documents/marketCache/paid-budget-october`;
      report.paidReservation = await reservePaidRelease(plan,
        () => json(`https://firestore.googleapis.com/v1/${document}`),
        async (doc, ledger) => {
          const response = await request(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:commit`, 'POST', {
            writes: [{ update: { name: document, fields: { value: { stringValue: JSON.stringify(ledger) } } },
              currentDocument: { updateTime: doc.updateTime } }],
          }, 'application/json', [409, 412]);
          return response.ok;
        });
      save();
    }
    for (const d of descriptors) {
      const head = await request(`${registry}/v2/${repository}/blobs/${d.digest}`, 'HEAD', undefined, undefined, [404]);
      if (head.status === 404) {
        const response = await request(`${registry}/v2/${repository}/blobs/uploads/`, 'POST');
        const destination = uploadLocation(response.headers.get('location'));
        destination.searchParams.set('digest', d.digest);
        report.uploadedBytes += d.size;
        save();
        await request(destination.href, 'PUT', blob(d.digest), 'application/octet-stream');
      }
    }
    report.uploadedBytes += manifestBytes.length;
    if (report.uploadedBytes > receipt.registryUploadBytes) throw new Error('Registry payload bound exceeded');
    save();
    const uploaded = await request(`${registry}/v2/${repository}/manifests/${receipt.imageDigest}`, 'PUT', manifestBytes, manifest.mediaType);
    if (uploaded.headers.get('docker-content-digest') !== receipt.imageDigest) throw new Error('Uploaded digest unverified');
    report.imageUploaded = receipt.imageDigest;
    save();
    for (const name of targets) {
      await contained();
      verifyReleasePlan(plan, receipt);
      const current = await json(`https://run.googleapis.com/v2/${root}/services/${name}`);
      const operation = await json(`https://run.googleapis.com/v2/${current.name}?updateMask=template,traffic,scaling`, 'PATCH', releasePatch(current, name, plan));
      if (!operation.name?.startsWith(`${root}/operations/`)) throw new Error('Missing operation identity; inspect service before any retry');
      report.operations[name] = operation.name;
      save();
      let state = operation;
      for (let poll = 0; !state.done && poll < 20; poll++) {
        await new Promise(done => setTimeout(done, 10000));
        state = await json(`https://run.googleapis.com/v2/${operation.name}`);
      }
      if (!state.done || state.error) throw new Error(`Deployment incomplete for ${name}: ${JSON.stringify(state.error ?? { operation: operation.name })}`);
      const service = await json(`https://run.googleapis.com/v2/${current.name}`);
      if (service.reconciling || service.latestReadyRevision !== service.latestCreatedRevision ||
          service.terminalCondition?.state !== 'CONDITION_SUCCEEDED') throw new Error(`${name} revision not ready`);
      const revision = await json(`https://run.googleapis.com/v2/${service.latestReadyRevision}`);
      if (revision.containers?.[0]?.image !== `${registry.slice(8)}/${repository}@${receipt.imageDigest}`)
        throw new Error(`${name} serving digest differs`);
      report.verified[name] = { revision: revision.name, image: revision.containers[0].image, at: new Date().toISOString() };
      save();
    }
    await contained();
    report.result = plan.activePaidUpdate ? 'active-paid-code-updated-counters-preserved' : plan.pausedCodeOnly ? 'paused-code-updated-stopped-ledger-preserved' : liveUpdate ? 'existing-live-code-updated-counters-preserved' : 'privately-deployed-collector-paused';
  } catch (error) { report.error = error.message; throw error; }
  finally { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ reportPath, ...report }, null, 2)); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
