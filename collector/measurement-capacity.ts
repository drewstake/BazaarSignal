import { capacityMeters, publishedCapacityCeilings, type CapacityEvidence, type CapacityMeter } from './capacity-plan';
import { liveInvocationCharge, validateLive, type LiveAllowanceState } from './allowance-live';
import type { Counters } from './trial';
import { APP_BUDGET_PAUSE_FRACTION } from '../shared/app-budget-policy';

// These allowances have no path in the measurement handler. This does NOT
// exempt other consumers of the cloud/account allowances below.
export const measurementExcluded = [
  'ownerReads', 'ownerWrites', 'ownerDeletes', 'ownerStorageBytes', 'ownerEgressBytes', 'ownerLogBytes',
  'hostingStorageBytes', 'hostingTransferBytes', 'hostingMonthlyTransferBytes', 'authUsers',
  'scriptFetches', 'scriptRuntimeSeconds', 'scriptRecipients', 'scriptProperties', 'scriptStorageBytes', 'scriptTriggers', 'scriptConcurrency',
] as const satisfies readonly CapacityMeter[];
export const measurementMeters = (Object.keys(capacityMeters) as CapacityMeter[])
  .filter(key => !(measurementExcluded as readonly string[]).includes(key));
export const measurementWork = () => liveInvocationCharge('collector', 'bazaar-inline');
// Pre-admission/finish contention, startup, rejected ingress, local inspection,
// monitoring, durable receipt and shutdown. Retained even when unused.
export const measurementControl: Counters = {
  runRequests: 4, cpuSeconds: 500, memoryGiBSeconds: 500,
  firestoreReads: 200, firestoreWrites: 80, firestoreDeletes: 0,
  // Raw admission/finish transport has bounded 8 MiB commit replies. Include
  // losing CAS attempts and operator reads, not just the tiny expected replies.
  firestoreEgressBytes: 256 * 1024 ** 2, firestoreStorageBytes: 256 * 1024,
  storageClassA: 16, storageClassB: 16, monitoringReads: 40000,
  egressBytes: 1024 ** 2, logBytes: 2 * 1024 ** 2,
};
export const addCosts = (...costs: Counters[]): Counters => {
  const result: Counters = {};
  for (const values of costs) for (const [key, n] of Object.entries(values)) result[key] = (result[key] ?? 0) + n;
  return result;
};
export interface MeasurementEvidence extends CapacityEvidence {
  // A report remains dated when it was measured. A fresh scope review can
  // bound its reporting gap, but must reserve that bound in uncertainty.
  coverage?: { verifiedAt:number; coveredThrough:number; tailThrough:number; tailBound:number; source:string };
  // Only dimensions with no new use or retained cost can use this proof.
  // Historical consumption remains unknown, rather than becoming zero.
  nonUse?: { verifiedAt:number; source:string };
}
export const measurementNonUseMeters = ['firestoreDeletes','buildMinutes','artifactEgressBytes','logRetentionByteMonths'] as const;
export interface MeasurementPlan {
  version: 1; kind: 'private-bazaar-measurement'; id: string;
  allowanceId: string; startsAt: number; deadline: number; verifiedAt: number;
  ledgerSha256: string; evidence: string;
  isolation: {
    sourceSha256: string; evidence: string; verifiedAt: number;
    schedulerPaused: boolean; privateApi: boolean; privateCollector: boolean;
    ongoingCollectionDisabled: boolean; auctionsDisabled: boolean; ownerServicesUnused: boolean;
    emailDisabled: boolean; evaluationDisabled: boolean; backgroundJobsDisabled: boolean;
    authenticatedInvocation: string; ingressBound: string;
  };
  meters: Partial<Record<CapacityMeter, MeasurementEvidence>>;
  exclusions: Partial<Record<CapacityMeter, string>>;
  upstream: { source: string; verifiedAt: number; scopeComplete: boolean;
    availableRequests: number | null; sharedUsageBound: number | null; reserve: number;
    publicOneShot?: { maxAttempts:3; retries:0; endpoints:string[]; exclusiveUseEvidence:string } };
  // Hash-checked deployment accounting is reconstructed by the operator CLI.
  // Existing market holds are checked independently against the live ledger.
  retainedDeployment: Counters;
  deployment: Counters;
  deploymentEvidence: string;
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const fresh = (n: number, now: number) => finite(n) && n <= now && now - n <= 900000;
export const publicMeasurementEndpoints = [
  'https://api.hypixel.net/v2/resources/skyblock/items',
  'https://api.hypixel.net/v2/resources/skyblock/election',
  'https://api.hypixel.net/v2/skyblock/bazaar',
];
export const measurementEvidenceExpiry = (m:MeasurementEvidence) =>
  (m.nonUse?.verifiedAt ?? m.coverage?.verifiedAt ?? m.measuredAt)+900000;
export function measurementCapacity(plan: MeasurementPlan, state: LiveAllowanceState, now: number) {
  const problems: string[] = [], nonUse: string[] = [], projections: { meter: string; total: number; ceiling: number; remaining: number }[] = [];
  try { validateLive({...state,stoppedAt:undefined,reason:undefined},now); }
  catch(error) { problems.push((error as Error).message); }
  const work = addCosts(measurementWork(), measurementControl), all = addCosts(work, plan.deployment ?? {});
  if (plan.version !== 1 || plan.kind !== 'private-bazaar-measurement' || !/^measure-[a-zA-Z0-9_-]{1,80}$/.test(plan.id) ||
      !plan.evidence || !plan.deploymentEvidence || !fresh(plan.verifiedAt, now) ||
      !finite(plan.startsAt) || !finite(plan.deadline) || plan.startsAt > now || plan.deadline <= now + 90000 ||
      plan.deadline - plan.startsAt > 900000 || plan.deadline > state.expiresAt ||
      plan.allowanceId !== state.id || state.startsAt > now || !finite(state.stoppedAt) || !state.reason ||
      !/^[a-f0-9]{64}$/.test(plan.ledgerSha256)) problems.push('Invalid measurement window, identity or retained owner stop');
  const isolation = plan.isolation;
  if (!isolation || !fresh(isolation.verifiedAt, now) || !isolation.evidence ||
      !/^[a-f0-9]{64}$/.test(isolation.sourceSha256) || !isolation.authenticatedInvocation || !isolation.ingressBound ||
      ['schedulerPaused','privateApi','privateCollector','ongoingCollectionDisabled','auctionsDisabled','ownerServicesUnused',
        'emailDisabled','evaluationDisabled','backgroundJobsDisabled'].some(k => isolation[k as keyof typeof isolation] !== true))
    problems.push('Private invocation, bounded ingress and disabled-feature non-use require current evidence');
  for (const key of measurementExcluded) if (!plan.exclusions?.[key] || plan.meters?.[key])
    problems.push(`Non-use must be established explicitly: ${key}`);
  for (const key of Object.keys(plan.exclusions ?? {})) if (!(measurementExcluded as readonly string[]).includes(key))
    problems.push(`Shared allowance cannot be excluded: ${key}`);
  for (const key of Object.keys(plan.meters ?? {})) if (!Object.hasOwn(capacityMeters, key)) problems.push(`Unclassified meter: ${key}`);
  for (const key of measurementMeters) {
    const m = plan.meters?.[key];
    const priorRuns=(state as LiveAllowanceState & {measurementRuns?:Record<string,{reserved:Counters}>}).measurementRuns;
    const old = Object.hasOwn(state.monthlyLimits,key) || Object.hasOwn(state.dailyLimits,key)
      ? Math.max(state.monthlyReserved?.[key] ?? 0, state.dailyReserved?.[key] ?? 0)
      : Object.values(priorRuns??{}).reduce((n,run)=>n+(run.reserved[key]??0),0);
    if(m?.nonUse) {
      if(!(measurementNonUseMeters as readonly string[]).includes(key)||!fresh(m.nonUse.verifiedAt,now)||!m.nonUse.source||
        !m.scopeComplete||!m.eligible||m.unit!==capacityMeters[key]||!m.scope||!m.source||
        !finite(m.periodStart)||!finite(m.periodEnd)||m.periodStart>now||m.periodEnd<plan.deadline||
        (all[key]??0)!==0||old!==0||(plan.retainedDeployment?.[key]??0)!==0||m.reserved!==0||m.fixedRemaining!==0||m.uncertainty!==0)
        problems.push(`Unproven non-use or retained cost: ${key}`);
      else nonUse.push(key);
      continue;
    }
    const c=m?.coverage;
    const coverageValid=!!c&&fresh(c.verifiedAt,now)&&!!c.source&&[c.coveredThrough,c.tailThrough,c.tailBound].every(finite)&&
      c.coveredThrough>=m!.measuredAt&&c.coveredThrough<=now&&c.tailThrough>=plan.deadline&&
      c.tailThrough>=c.coveredThrough&&m!.uncertainty>=c.tailBound;
    if (!m || m.unit !== capacityMeters[key] || !m.scope || !m.source || !m.scopeComplete || !m.eligible ||
        ![m.periodStart,m.periodEnd,m.measuredAt].every(finite) || m.periodStart > now || m.periodEnd < plan.deadline ||
        m.measuredAt < m.periodStart || m.measuredAt>now || (c?!coverageValid:!fresh(m.measuredAt, now)) ||
        ![m.allowance,m.measured,m.reserved,m.fixedRemaining,m.uncertainty].every(finite) ||
        m.allowance > publishedCapacityCeilings[key] || !finite(m.safetyFraction) || m.safetyFraction < .25 || m.safetyFraction >= 1 ||
        (m.allowance === 0 && (!m.exemption || m.measured !== 0 || m.reserved !== 0 || m.fixedRemaining !== 0 || m.uncertainty !== 0))) {
      problems.push(`Missing, stale, incomplete or ineligible measurement accounting: ${key}`); continue;
    }
    // No netting observations against reservations, including an old daily bucket.
    if (m.reserved < old + (plan.retainedDeployment?.[key] ?? 0)) problems.push(`Omitted retained reservation: ${key}`);
    const total = m.measured! + m.reserved + m.fixedRemaining! + m.uncertainty + (all[key] ?? 0);
    const ceiling = m.allowance * (1 - m.safetyFraction);
    projections.push({ meter: key, total, ceiling, remaining: ceiling - total });
    if (total > ceiling) problems.push(`Measurement exceeds protected allowance: ${key}`);
  }
  for (const costs of [plan.deployment, plan.retainedDeployment]) {
    if (!costs || ['cpuSeconds','memoryGiBSeconds','artifactByteMonths','logBytes'].some(k => !finite(costs[k])))
      problems.push('Deployment and retained deployment accounting must be explicit');
    for (const [key, n] of Object.entries(costs ?? {})) if (!finite(n) || !measurementMeters.includes(key as CapacityMeter))
      problems.push(`Unclassified deployment cost: ${key}`);
  }
  for (const [limits, used] of [[state.monthlyLimits,state.monthlyReserved], [state.dailyLimits,state.dailyReserved]]) {
    if (!limits || !used) { problems.push('Missing application counters'); continue; }
    for (const [key, limit] of Object.entries(limits)) {
      const n = used[key] ?? 0, total = n + (work[key] ?? 0), ceiling = limit * APP_BUDGET_PAUSE_FRACTION;
      if (!finite(limit) || !finite(n) || (limit === 0 ? total > 0 : total >= ceiling)) problems.push(`Application reservation exhausted: ${key}`);
    }
  }
  const u = plan.upstream;
  const one=u?.publicOneShot;
  const publicValid=!!one&&one.maxAttempts===3&&one.retries===0&&!!one.exclusiveUseEvidence&&
    JSON.stringify([...one.endpoints].sort())===JSON.stringify([...publicMeasurementEndpoints].sort())&&
    u.availableRequests===null&&u.sharedUsageBound===null;
  if (!u || !u.source || !fresh(u.verifiedAt, now) || !u.scopeComplete || (one?!publicValid:(!finite(u.availableRequests) ||
      !finite(u.sharedUsageBound) || !finite(u.reserve) || u.reserve < .2 || u.reserve > .8 ||
      u.sharedUsageBound + (work.hypixelRequests ?? 0) > u.availableRequests * (1 - u.reserve))))
    problems.push('Nine physical upstream attempts require verified entitlement and shared usage headroom');
  return { ready: !problems.length, problems, projections, nonUse, work, total: all };
}
