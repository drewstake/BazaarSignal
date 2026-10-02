import {
  assessUsage,
  googleMeters,
  type Meter,
  type UsageState,
  type InactiveOperationMeter,
} from "./usage";
import {
  TrialStopped,
  TRIAL_MAX_MS,
  trialLimits,
  type TrialState,
} from "./trial";

export interface TrialPreflight {
  id: string;
  startsAt: number;
  expiresAt: number;
  baseline: UsageState;
  /** Verified bounds for deployment, admission, shutdown and delayed reporting,
   * additional to each meter's baseline headroom and the entire trial envelope. */
  overhead: Record<Meter, number>;
  /** Trusted operator evidence references, not client-submitted attestations. */
  evidence: Record<Meter, { source: string; verifiedAt: number }>;
  deploymentVerified: boolean;
  shutdownPermissionsVerified: boolean;
  allowanceScopesVerified: boolean;
  transferEligibilityVerified: boolean;
}

/** Preflight the WHOLE trial, not just its first cheap request. This function has
 * no cloud side effects. Only a trusted launcher may persist its returned ledger. */
export function prepareTrial(
  plan: TrialPreflight,
  now = Date.now(),
): TrialState {
  if (
    !plan.deploymentVerified ||
    !plan.shutdownPermissionsVerified ||
    !plan.allowanceScopesVerified ||
    !plan.transferEligibilityVerified
  )
    throw new TrialStopped(
      "Deployment, shutdown permissions, allowance scope or transfer eligibility is unverified",
    );
  if (
    !/^[a-zA-Z0-9_-]{1,100}$/.test(plan.id) ||
    ![now, plan.startsAt, plan.expiresAt].every(Number.isFinite) ||
    plan.expiresAt <= now ||
    plan.expiresAt <= plan.startsAt ||
    plan.expiresAt - plan.startsAt > TRIAL_MAX_MS
  )
    throw new TrialStopped("Invalid bounded trial plan");
  const baseline = structuredClone(plan.baseline);
  for (const key of googleMeters) {
    const meter = baseline.meters[key],
      excluded = baseline.noAdditionalUsage?.[key as InactiveOperationMeter],
      accounting = meter ?? excluded,
      evidence = plan.evidence[key],
      overhead = plan.overhead[key];
    if (
      !accounting ||
      !evidence?.source ||
      !Number.isFinite(evidence.verifiedAt) ||
      evidence.verifiedAt > now ||
      evidence.verifiedAt !== accounting.verifiedAt ||
      now - evidence.verifiedAt > 60_000 ||
      plan.expiresAt - evidence.verifiedAt > TRIAL_MAX_MS ||
      accounting.periodEnd <= plan.expiresAt ||
      !Number.isFinite(overhead) ||
      overhead < 0
    )
      throw new TrialStopped(`Missing or stale whole-trial evidence: ${key}`);
    if (excluded && (overhead !== 0 || trialLimits[key] !== 0))
      throw new TrialStopped(`No-additional-usage evidence cannot cover trial or overhead consumption: ${key}`);
    if (meter) meter.reserved += overhead;
  }
  const pessimistic = Object.fromEntries(
    googleMeters.map((key) => [key, trialLimits[key]]),
  );
  if (assessUsage(baseline, now, pessimistic).mode === "paused")
    throw new TrialStopped(
      "The entire trial and overhead do not fit verified allowance headroom",
    );
  return {
    version: 1,
    id: plan.id,
    startsAt: plan.startsAt,
    expiresAt: plan.expiresAt,
    baseline,
    limits: { ...trialLimits },
    reserved: {},
    observed: {},
    admissions: {},
  };
}
