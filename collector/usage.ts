import type { CacheStore } from "./cache-store";

/** Complete, scope-aware reports are required. These are conservative application
 * controls, NEVER billing caps: the request/startup/accounting I/O already costs
 * resources, monitoring is delayed, and storage continues while work is paused.
 */
export const googleMeters = [
  "runRequests", "cpuSeconds", "memoryGiBSeconds", "egressBytes",
  "firestoreReads", "firestoreWrites", "firestoreDeletes", "firestoreStorageBytes", "firestoreEgressBytes",
  "storageClassA", "storageClassB", "storageByteMonths", "storageEgressBytes",
  "schedulerJobMonths", "buildMinutes", "artifactByteMonths", "logBytes", "monitoringReads",
] as const;
export type Meter = typeof googleMeters[number];
// Only discrete operations which this workflow can entirely avoid qualify.
// Retained storage, compute, bandwidth and other ongoing meters never qualify.
export const inactiveOperationMeters = ["monitoringReads", "firestoreDeletes"] as const;
export type InactiveOperationMeter = typeof inactiveOperationMeters[number];
export const usagePhases = ["deployment", "admission", "trial", "shutdown", "reporting"] as const;
export interface NoAdditionalUsage {
  scope: string;
  periodStart: number;
  periodEnd: number;
  verifiedAt: number;
  /** Unknown past use is retained explicitly; this is not a zero baseline. */
  historicalUsed: null;
  phases: Record<typeof usagePhases[number], { maximum: 0; source: string }>;
}
export interface Allowance {
  scope: string;
  periodStart: number;
  periodEnd: number;
  verifiedAt: number;
  limit: number;
  used: number;
  reserved: number;
  headroom: number;
  projectedRemaining: number;
}
export interface UsageState {
  meters: Partial<Record<Meter, Allowance>>;
  /** Trusted whole-workflow evidence, normally installed by trial preflight.
   * Any attempted nonzero reservation invalidates this route to admission. */
  noAdditionalUsage?: Partial<Record<InactiveOperationMeter, NoAdditionalUsage>>;
  pausedUntil?: number;
  reason?: string;
}
export type UsageDecision = { mode: "normal" | "warning" | "slow" | "paused"; pollMs: number; reason?: string };
const pause = (reason: string): UsageDecision => ({ mode: "paused", pollMs: 0, reason });
export function assessUsage(state: UsageState | null, now: number, costs: Partial<Record<Meter, number>> = {}): UsageDecision {
  if (!state) return pause("Complete usage accounting is unavailable");
  if (state.pausedUntil) return pause(state.reason ?? "Allowance pause requires verified reset");
  if (Object.keys(state.noAdditionalUsage ?? {}).some(key =>
      !(inactiveOperationMeters as readonly string[]).includes(key)))
    return pause("No-additional-usage evidence cannot exempt an ongoing meter");
  let peak = 0;
  for (const key of googleMeters) {
    const m = state.meters[key], cost = costs[key] ?? 0;
    const excluded = state.noAdditionalUsage?.[key as InactiveOperationMeter];
    if (excluded) {
      if (m || cost !== 0 || excluded.historicalUsed !== null || !excluded.scope ||
          ![excluded.periodStart, excluded.periodEnd, excluded.verifiedAt].every(Number.isFinite) ||
          excluded.periodStart > now || excluded.periodEnd <= now ||
          excluded.verifiedAt < excluded.periodStart || excluded.verifiedAt > now ||
          now - excluded.verifiedAt > 15 * 60_000 ||
          usagePhases.some(phase => excluded.phases?.[phase]?.maximum !== 0 ||
            typeof excluded.phases[phase].source !== "string" || !excluded.phases[phase].source.trim()))
        return pause(`Unverified zero additional usage or attempted usage: ${key}`);
      continue;
    }
    if (!m || !m.scope || ![m.periodStart,m.periodEnd,m.verifiedAt,m.limit,m.used,m.reserved,m.headroom,m.projectedRemaining,cost].every(Number.isFinite) ||
        m.limit <= 0 || Math.min(m.used,m.reserved,m.headroom,m.projectedRemaining,cost) < 0 ||
        m.periodStart > now || m.periodEnd <= now || m.verifiedAt < m.periodStart || m.verifiedAt > now || now - m.verifiedAt > 15 * 60_000)
      return pause(`Missing, expired or inconsistent accounting: ${key}`);
    const consumed = m.used + m.reserved + cost + m.headroom;
    if (consumed / m.limit >= .75 || (consumed + m.projectedRemaining) / m.limit >= .75)
      return pause(`Allowance or projected headroom exhausted: ${key}`);
    peak = Math.max(peak, consumed / m.limit);
  }
  return peak >= .65 ? { mode: "slow", pollMs: 60_000 }
    : peak >= .5 ? { mode: "warning", pollMs: 20_000 }
    : { mode: "normal", pollMs: 20_000 };
}

/** Shared CAS reservations are never refunded on a crash, timeout, retry or
 * ambiguous result. Every physical retry needs its own pre-operation reservation.
 * No per-instance memory is authoritative. Persist reports only from a trusted
 * operator that has checked all projects in each meter's actual allowance scope.
 */
export class UsageLedger {
  constructor(private store: CacheStore, private clock = Date.now) {}
  private async now() { return this.store.time ? this.store.time() : this.clock(); }
  async status() {
    try {
      const raw = await this.store.read("usage");
      return assessUsage(raw ? JSON.parse(raw) : null, await this.now());
    } catch { return pause("Usage accounting is unavailable"); }
  }
  async reserve(costs: Partial<Record<Meter, number>>) {
    try {
      for (let i = 0; i < 100; i++) {
        const now = await this.now(), raw = await this.store.read("usage");
        const state: UsageState | null = raw ? JSON.parse(raw) : null;
        const decision = assessUsage(state, now, costs);
        if (!state) return decision;
        if (decision.mode === "paused") {
          state.pausedUntil ||= Math.max(now, ...Object.values(state.meters).map(m=>m?.periodEnd ?? now));
          state.reason = decision.reason;
        } else {
          for (const key of googleMeters) {
            const meter = state.meters[key];
            if (meter) meter.reserved += costs[key] ?? 0;
          }
        }
        if (await this.store.commit("usage", raw, JSON.stringify(state))) return decision;
      }
      return pause("Concurrent usage accounting did not settle");
    } catch { return pause("Usage reservation failed; optional work stopped"); }
  }
  async installVerifiedReports(meters: UsageState["meters"]) {
    for (let i = 0; i < 100; i++) {
      const now = await this.now(), raw = await this.store.read("usage");
      const previous: UsageState | null = raw ? JSON.parse(raw) : null;
      if (previous?.pausedUntil && now < previous.pausedUntil + 180_000)
        throw new Error("Wait for every affected allowance reset and in-flight headroom");
      const next: UsageState = { meters: structuredClone(meters) };
      for (const key of googleMeters) {
        const old = previous?.meters[key], m = next.meters[key];
        if (!m) throw new Error(`Missing accounting: ${key}`);
        if (old && m.periodStart === old.periodStart) {
          if (m.scope !== old.scope || m.periodEnd !== old.periodEnd || m.limit !== old.limit || m.verifiedAt < old.verifiedAt)
            throw new Error("Allowance configuration changed inside its period");
          m.used = Math.max(m.used, old.used);
          m.reserved = Math.max(m.reserved, old.reserved);
        } else if (old && (m.periodStart < old.periodEnd || now < old.periodEnd + 180_000))
          throw new Error("Unverified reset or work may still be in flight");
      }
      if (assessUsage(next, now).mode === "paused") throw new Error("Verified reports lack sufficient headroom");
      if (await this.store.commit("usage", raw, JSON.stringify(next))) return;
    }
    throw new Error("Usage reports busy; no reset applied");
  }
}
