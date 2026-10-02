import { expect, it } from "vitest";
import { googleMeters, usagePhases, type NoAdditionalUsage } from "../collector/usage";
import {
  prepareTrial,
  type TrialPreflight,
} from "../collector/trial-preflight";
const now = 1_800_000_000_000;
function plan(): TrialPreflight {
  return {
    id: "verified-fixture",
    startsAt: now,
    expiresAt: now + 900000,
    deploymentVerified: true,
    shutdownPermissionsVerified: true,
    allowanceScopesVerified: true,
    transferEligibilityVerified: true,
    overhead: Object.fromEntries(
      googleMeters.map((key) => [key, 100]),
    ) as TrialPreflight["overhead"],
    evidence: Object.fromEntries(
      googleMeters.map((key) => [
        key,
        { source: "fixture-only", verifiedAt: now },
      ]),
    ) as TrialPreflight["evidence"],
    baseline: {
      meters: Object.fromEntries(
        googleMeters.map((key) => [
          key,
          {
            scope: "fixture-account",
            periodStart: now - 1000,
            periodEnd: now + 86400_000,
            verifiedAt: now,
            limit: 1e15,
            used: 1,
            reserved: 0,
            headroom: 1,
            projectedRemaining: 0,
          },
        ]),
      ),
    },
  };
}
it("requires headroom for the entire trial, including overhead, before its first admission", () => {
  const p = plan();
  p.baseline.meters.cpuSeconds!.limit = 10000;
  expect(() => prepareTrial(p, now)).toThrow("entire trial");
  const valid = plan(),
    saved = prepareTrial(valid, now);
  expect(saved.baseline.meters.cpuSeconds!.reserved).toBe(100);
  expect(valid.baseline.meters.cpuSeconds!.reserved).toBe(0);
});
it("rejects missing permission verification, unknown meters, stale evidence and trials spanning a reset", () => {
  for (const alter of [
    (p: TrialPreflight) => {
      p.shutdownPermissionsVerified = false;
    },
    (p: TrialPreflight) => {
      delete p.baseline.meters.monitoringReads;
    },
    (p: TrialPreflight) => {
      p.evidence.egressBytes.source = "";
    },
    (p: TrialPreflight) => {
      p.evidence.cpuSeconds.verifiedAt = now - 61000;
    },
    (p: TrialPreflight) => {
      p.baseline.meters.firestoreReads!.periodEnd = now + 1000;
    },
    (p: TrialPreflight) => {
      p.overhead.buildMinutes = NaN;
    },
  ]) {
    const p = plan();
    alter(p);
    expect(() => prepareTrial(p, now)).toThrow();
  }
});

it("can admit a verified zero-increment workflow while leaving historical totals unknown", () => {
  const p = plan();
  for (const key of ["monitoringReads", "firestoreDeletes"] as const) {
    const meter = p.baseline.meters[key]!;
    p.baseline.noAdditionalUsage ??= {};
    p.baseline.noAdditionalUsage[key] = {
      scope: meter.scope, periodStart: meter.periodStart, periodEnd: meter.periodEnd,
      verifiedAt: now, historicalUsed: null,
      phases: Object.fromEntries(usagePhases.map(phase =>
        [phase, { maximum: 0, source: `fixture-only:${phase}` }])) as NoAdditionalUsage["phases"],
    };
    delete p.baseline.meters[key];
    p.overhead[key] = 0;
  }
  const saved = prepareTrial(p, now);
  expect(saved.baseline.meters.monitoringReads).toBeUndefined();
  expect(saved.baseline.noAdditionalUsage!.monitoringReads!.historicalUsed).toBeNull();
  expect(saved.limits.monitoringReads).toBe(0);
  p.overhead.monitoringReads = 1;
  expect(() => prepareTrial(p, now)).toThrow("overhead consumption");
  p.overhead.monitoringReads = 0;
  p.baseline.noAdditionalUsage!.monitoringReads!.periodEnd = p.expiresAt;
  expect(() => prepareTrial(p, now)).toThrow("whole-trial evidence");
});
