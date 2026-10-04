import type { Counters } from './trial';
import { APP_BUDGET_PAUSE_FRACTION } from '../shared/app-budget-policy';

/** Each entry is a separate allowance, including the two independent databases.
 * Byte-months must be integrated; a storage gauge is not a monthly measurement.
 * No published allowance or missing measurement is an application grant. */
export const capacityMeters = {
  runRequests: 'requests', cpuSeconds: 'vCPU-seconds', memoryGiBSeconds: 'GiB-seconds',
  egressBytes: 'eligible bytes', firestoreReads: 'documents/day', firestoreWrites: 'documents/day',
  firestoreDeletes: 'documents/day', firestoreStorageBytes: 'bytes', firestoreEgressBytes: 'bytes/month',
  ownerReads: 'documents/day', ownerWrites: 'documents/day', ownerDeletes: 'documents/day',
  ownerStorageBytes: 'bytes', ownerEgressBytes: 'bytes/month',
  storageClassA: 'operations/month', storageClassB: 'operations/month', storageByteMonths: 'byte-months',
  storageEgressBytes: 'eligible bytes/month', schedulerJobMonths: 'job-months', buildMinutes: 'minutes/month',
  artifactByteMonths: 'byte-months', artifactEgressBytes: 'bytes/month', logBytes: 'bytes/month',
  ownerLogBytes: 'bytes/month', logRetentionByteMonths: 'byte-months', monitoringReads: 'time series/month',
  hostingStorageBytes: 'bytes', hostingTransferBytes: 'bytes/day', hostingMonthlyTransferBytes: 'bytes/month', authUsers: 'users/period',
  scriptFetches: 'calls/24h', scriptRuntimeSeconds: 'seconds/24h', scriptRecipients: 'recipients/24h',
  scriptProperties: 'operations/24h', scriptStorageBytes: 'bytes', scriptTriggers: 'triggers', scriptConcurrency: 'executions',
} as const;
export type CapacityMeter = keyof typeof capacityMeters;
/** Official maxima checked 2026-10-04, plus conservative decimal byte bounds
 * where the public table says GB. These are ceilings, never automatic grants.
 * Non-free/exempt paths get zero and require explicit evidence. */
export const publishedCapacityCeilings: Record<CapacityMeter,number> = {
  runRequests:2_000_000,cpuSeconds:180_000,memoryGiBSeconds:360_000,egressBytes:1024**3,
  firestoreReads:50000,firestoreWrites:20000,firestoreDeletes:20000,firestoreStorageBytes:1024**3,firestoreEgressBytes:10*1024**3,
  ownerReads:50000,ownerWrites:20000,ownerDeletes:20000,ownerStorageBytes:1024**3,ownerEgressBytes:10*1024**3,
  storageClassA:5000,storageClassB:50000,storageByteMonths:5e9,storageEgressBytes:100e9,
  schedulerJobMonths:3,buildMinutes:2500,artifactByteMonths:.5*1024**3,artifactEgressBytes:0,
  logBytes:50*1024**3,ownerLogBytes:50*1024**3,logRetentionByteMonths:0,monitoringReads:1_000_000,
  hostingStorageBytes:10e9,hostingTransferBytes:360e6,hostingMonthlyTransferBytes:10e9,authUsers:50000,
  scriptFetches:20000,scriptRuntimeSeconds:5400,scriptRecipients:100,scriptProperties:50000,scriptStorageBytes:500000,
  scriptTriggers:20,scriptConcurrency:30,
};
export interface CapacityEvidence {
  unit: string;
  scope: string;
  /** Includes formerly linked projects, all regions, services and other scripts. */
  scopeComplete: boolean;
  eligible: boolean;
  source: string;
  periodStart: number;
  periodEnd: number;
  measuredAt: number;
  allowance: number;
  measured: number | null;
  /** Never refunded or netted against delayed provider measurements. */
  reserved: number;
  /** Other consumers, retained capacity, idle wakes, rejected admissions,
   * rollout, renewal, accounting, monitoring and shutdown through periodEnd. */
  fixedRemaining: number | null;
  uncertainty: number;
  safetyFraction: number;
  /** Explicit current evidence for a non-metered/exempt path, not a null zero. */
  exemption?: string;
}
export interface CapacityPlan {
  version: 1;
  evidence: string;
  verifiedAt: number;
  validUntil: number;
  /** Bounded authenticated visible-tab leases, not a guess at user count.
   * Duplicate price GETs can share browser caches, but no saving is assumed. */
  readerGroups: number;
  /** Enforced wire-response bound including 2 KiB header allowance. */
  browserResponseBytes: number;
  /** All rejected/unauthenticated traffic and wake/accounting work has a bound. */
  ingressBoundEvidence: string;
  meters: Record<CapacityMeter, CapacityEvidence>;
  upstream: {
    source: string; verifiedAt: number; scopeComplete: boolean;
    requestLimit: number; windowMs: number; reserve: number;
    bazaarSourceMs: number; bazaarDurationMs: number;
    /** Older plans can retain these historical measurements; no auction work is admitted. */
    auctionSourceMs?: number; auctionDurationMs?: number; auctionPages?: number;
  };
}
export interface LegacyCapacity {
  expiresAt: number;
  monthlyLimits: Counters; monthlyReserved: Counters;
  dailyLimits: Counters; dailyReserved: Counters;
  dailyEnd: number;
}
export interface CadenceDecision {
  mode: 'normal' | 'slow' | 'paused';
  bazaarMs: number; auctionMs: number; pollMs: number;
  reasons: string[];
  projections: { meter: string; measured: number; reserved: number; fixed: number; work: number; ceiling: number }[];
}
export const cadenceCandidates = [60, 90, 120, 180, 300, 600, 900, 1800, 3600, 5400, 7200, 10800, 21600, 43200, 86400].map(s => s * 1000);
const nonnegative = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
export function capacityProblems(p: CapacityPlan | undefined, now: number): string[] {
  if (!p || p.version !== 1 || !p.evidence || !p.ingressBoundEvidence ||
    !Number.isSafeInteger(p.readerGroups) || p.readerGroups < 1 || p.readerGroups > 1000 ||
    !Number.isSafeInteger(p.browserResponseBytes) || p.browserResponseBytes<16384 || p.browserResponseBytes>8*1024**2+2048 ||
    !Number.isFinite(p.verifiedAt) || p.verifiedAt > now || now - p.verifiedAt > 900_000 ||
    !Number.isFinite(p.validUntil) || p.validUntil <= now || p.validUntil > p.verifiedAt + 900_000)
    return ['Fresh, complete scope evidence and bounded ingress are required'];
  const issues: string[] = [];
  for (const [key, unit] of Object.entries(capacityMeters)) {
    const m = p.meters?.[key as CapacityMeter];
    if (!m || m.unit !== unit || !m.scope || !m.source || !m.scopeComplete || !m.eligible ||
      ![m.periodStart,m.periodEnd,m.measuredAt].every(Number.isFinite) ||
      m.periodStart > now || m.periodEnd <= now || m.measuredAt < m.periodStart || m.measuredAt > now ||
      now - m.measuredAt > 900_000 ||
      ![m.allowance,m.measured,m.reserved,m.fixedRemaining,m.uncertainty].every(nonnegative) ||
      m.allowance>publishedCapacityCeilings[key as CapacityMeter] ||
      !Number.isFinite(m.safetyFraction) || m.safetyFraction < .25 || m.safetyFraction >= 1 ||
      (m.allowance === 0 && (!m.exemption || m.measured !== 0 || m.reserved !== 0 || m.fixedRemaining !== 0)))
      issues.push(`Missing, stale, incomplete or ineligible accounting: ${key}`);
  }
  if(Object.keys(p.meters??{}).some(key=>!Object.hasOwn(capacityMeters,key)))issues.push('Unclassified allowance dimension');
  const u = p.upstream;
  if (!u || !u.source || !u.scopeComplete || !Number.isFinite(u.verifiedAt) || u.verifiedAt > now || now-u.verifiedAt>900_000 ||
    ![u.requestLimit,u.windowMs,u.bazaarSourceMs,u.bazaarDurationMs].every(n => nonnegative(n) && n > 0) ||
    u.reserve < .2 || u.reserve > .8 || !Number.isFinite(u.reserve)) issues.push('Verified upstream entitlement, shared usage and source timing are required');
  return issues;
}

/** Full remaining periods, not an extrapolation of mostly-idle elapsed hours.
 * Each cycle reserves a GET, its potential OPTIONS, and a presence mutation plus
 * potential OPTIONS per reader group. Retried network work is in the envelopes.
 * Steady-state daily windows are independently checked over a 25-hour DST day. */
export function chooseCadence(p: CapacityPlan | undefined, legacy: LegacyCapacity,
  collector: Counters, browser: Counters, now: number): CadenceDecision {
  const reasons = capacityProblems(p, now);
  const paused = (why: string[]): CadenceDecision => ({mode:'paused',bazaarMs:0,auctionMs:0,pollMs:0,reasons:why,projections:[]});
  if (reasons.length) return paused(reasons);
  const plan=p!, u=plan.upstream;
  const perCycle = (key: string) => (collector[key] ?? 0) + 4*plan.readerGroups*(key==='egressBytes'?Math.max(browser[key]??0,plan.browserResponseBytes):browser[key] ?? 0);
  let failures: string[] = [];
  for (const interval of cadenceCandidates) {
    // No invented provider allowance: the existing conservative rolling cap is
    // an additional maximum, and every probe/retry/metadata request is included.
    const upstreamCalls = Math.ceil(Math.max(300_000,u.windowMs)/interval) * (collector.hypixelRequests ?? 0);
    if (interval < Math.max(60_000,u.bazaarSourceMs,u.bazaarDurationMs+5000) ||
      upstreamCalls > Math.min(96,Math.floor(u.requestLimit*(1-u.reserve)))) continue;
    const projections: CadenceDecision['projections'] = [];
    failures=[];
    for (const [key,m] of Object.entries(plan.meters)) {
      const cycles=Math.ceil((m.periodEnd-now)/interval);
      const work=cycles*perCycle(key);
      const ceiling=m.allowance*(1-m.safetyFraction);
      projections.push({meter:key,measured:m.measured!,reserved:m.reserved,fixed:m.fixedRemaining!+m.uncertainty,work,ceiling});
      if (m.measured!+m.reserved+m.fixedRemaining!+m.uncertainty+work > ceiling ||
        (m.allowance===0 && work>0)) failures.push(key);
    }
    for (const [period,limits,used,end] of [
      ['monthly',legacy.monthlyLimits,legacy.monthlyReserved,legacy.expiresAt],
      ['daily',legacy.dailyLimits,legacy.dailyReserved,legacy.dailyEnd],
    ] as const) for (const [key,limit] of Object.entries(limits)) {
      const ceiling=limit*APP_BUDGET_PAUSE_FRACTION;
      const work=Math.ceil((end-now)/interval)*perCycle(key);
      projections.push({meter:`app-${period}-${key}`,measured:0,reserved:used[key]??0,fixed:0,work,ceiling});
      const total=(used[key]??0)+work, fullDay=Math.ceil(25*3600_000/interval)*perCycle(key);
      if ((limit===0?total>0:total>=ceiling) || (period==='daily' && (limit===0?fullDay>0:fullDay>=ceiling))) failures.push(`app-${period}-${key}`);
    }
    if (!failures.length) return {mode:interval<=90_000?'normal':'slow',bazaarMs:interval,
      auctionMs:0,pollMs:interval,reasons:interval>90_000?['Slower cadence required by separate allowance projections']:[],projections};
  }
  return paused(failures.length?failures.map(k=>`No sustainable cadence: ${k}`):['Upstream limits do not support a reviewed cadence']);
}

/** Call in the SAME CAS transaction as the old ledger hold. Unknown new meters
 * are refused. Observations can never refund a reservation. No reset function. */
export function reserveCapacity(p: CapacityPlan | undefined, costs: Counters, now: number) {
  const problems=capacityProblems(p,now); if(problems.length)throw new Error(problems.join('; '));
  const invocationOnly=new Set(['collectorInvocations','browserRequests','snapshotUploads','hypixelRequests','sellerRequests','storageListPages','cleanupRuns','upstreamResponseBytes']);
  for(const [key,n]of Object.entries(costs))
    if(!nonnegative(n)||(!Object.hasOwn(capacityMeters,key)&&!invocationOnly.has(key)))throw new Error(`Unclassified capacity cost: ${key}`);
  for(const [key,m] of Object.entries(p!.meters)) {
    const n=costs[key]??0;
    if(!nonnegative(n)||m.measured!+m.reserved+m.fixedRemaining!+m.uncertainty+n>m.allowance*(1-m.safetyFraction))
      throw new Error(`Capacity exhausted: ${key}`);
  }
  for(const [key,m] of Object.entries(p!.meters))m.reserved+=costs[key]??0;
}
