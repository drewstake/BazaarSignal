import { afterEach, expect, it, vi } from "vitest";
import { SqliteCache } from "../collector/cache-store";
import { googleMeters, usagePhases, type NoAdditionalUsage } from "../collector/usage";
import {
  TrialLedger,
  TrialStopped,
  trialLimits,
  TRIAL_MAX_MS,
  type TrialState,
} from "../collector/trial";

const stores: SqliteCache[] = [];
const start = 1_800_000_000_000;
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});
export function trialState(now = start): TrialState {
  return {
    version: 1,
    id: "measured-trial",
    startsAt: now,
    expiresAt: now + TRIAL_MAX_MS,
    limits: { ...trialLimits },
    reserved: {},
    observed: {},
    admissions: {},
    baseline: {
      meters: Object.fromEntries(
        googleMeters.map((key) => [
          key,
          {
            scope: `fixture:${key}`,
            periodStart: now - 1000,
            periodEnd: now + 86400_000,
            verifiedAt: now,
            limit: 1e15,
            used: 10,
            reserved: 0,
            headroom: 100,
            projectedRemaining: 0,
          },
        ]),
      ),
    },
  };
}
async function setup(state = trialState(), clock = () => start) {
  const store = new SqliteCache(":memory:");
  stores.push(store);
  await store.commit("trial", null, JSON.stringify(state));
  return { store, ledger: new TrialLedger(store, clock) };
}
it("100 competing collectors share one durable admission; redelivery and restarts cannot repeat it", async () => {
  let now = start;
  const { store, ledger } = await setup(trialState(), () => now);
  const results = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      new TrialLedger(store, () => now).admit("collector", `event-${i}`),
    ),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  const winner = results.find(Boolean)!;
  now += 60_000;
  expect(
    await new TrialLedger(store, () => now).admit(
      "collector",
      winner.invocationId,
    ),
  ).toBeNull();
  expect(await ledger.admit("collector", "next-minute")).not.toBeNull();
  expect((await ledger.read())!.reserved.collectorInvocations).toBe(2);
});
it("contention, crash and ambiguous commits never refund envelopes or overspend the global ceiling", async () => {
  const state = trialState();
  state.limits.browserRequests = 3;
  const { store, ledger } = await setup(state);
  const results = await Promise.allSettled(
    Array.from({ length: 30 }, (_, i) =>
      new TrialLedger(store, () => start).admit("browser", `read-${i}`),
    ),
  );
  expect(
    results.filter((r) => r.status === "fulfilled" && r.value),
  ).toHaveLength(3);
  expect((await ledger.read())!.reserved.browserRequests).toBe(3);
  await expect(
    new TrialLedger(store, () => start).admit("browser", "after-crash"),
  ).rejects.toThrow("limit");
});
it("missing/stale reports, oversized ceilings, overlong duration and corrupt identities fail closed", async () => {
  for (const mutate of [
    (s: TrialState) => {
      delete s.baseline.meters.cpuSeconds;
    },
    (s: TrialState) => {
      s.baseline.meters.cpuSeconds!.verifiedAt = start - 900001;
    },
    (s: TrialState) => {
      s.limits.snapshotUploads = 1e9;
    },
    (s: TrialState) => {
      s.expiresAt++;
    },
  ]) {
    const state = trialState();
    mutate(state);
    const { ledger } = await setup(state);
    await expect(ledger.admit("collector", "event")).rejects.toThrow(
      TrialStopped,
    );
  }
  const { ledger } = await setup();
  await expect(ledger.admit("browser", "__proto__")).rejects.toThrow(
    "identity",
  );
});
it("the deadline stops existing sessions, restarted admissions, extensions and upstream I/O", async () => {
  let now = start;
  const { ledger, store } = await setup(trialState(), () => now);
  const session = (await ledger.admit("collector", "event"))!;
  now += TRIAL_MAX_MS;
  const fetcher = vi.fn();
  await expect(
    session.network(fetcher)("https://api.hypixel.net/v2/skyblock/bazaar"),
  ).rejects.toThrow("deadline");
  await expect(session.extend({ storageClassA: 1 })).rejects.toThrow(
    "deadline",
  );
  await expect(
    new TrialLedger(store, () => now).admit("collector", "restart"),
  ).rejects.toThrow("expired");
  expect(fetcher).not.toHaveBeenCalled();
  await session.finish();
  expect((await ledger.read())!.admissions.event.finished).toBe(true);
});

it("keeps zero-increment accounting across restart and rejects an attempted operation before I/O", async () => {
  const state = trialState();
  const meter = state.baseline.meters.monitoringReads!;
  delete state.baseline.meters.monitoringReads;
  state.baseline.noAdditionalUsage = { monitoringReads: {
    scope: meter.scope, periodStart: meter.periodStart, periodEnd: meter.periodEnd,
    verifiedAt: start, historicalUsed: null,
    phases: Object.fromEntries(usagePhases.map(phase =>
      [phase, { maximum: 0, source: `fixture-only:${phase}` }])) as NoAdditionalUsage["phases"],
  } };
  const { ledger, store } = await setup(state);
  const session = (await ledger.admit("browser", "read"))!;
  expect(() => session.take({ monitoringReads: 1 })).toThrow();
  const saved = await new TrialLedger(store, () => start).read();
  expect(saved!.baseline.meters.monitoringReads).toBeUndefined();
  expect(saved!.baseline.noAdditionalUsage!.monitoringReads!.historicalUsed).toBeNull();
  await expect(new TrialLedger(store, () => start).add(state.id, { monitoringReads: 1 })).rejects.toThrow();
});
it("each physical retry is counted, conservative byte holds are not reported as actual transfer", async () => {
  const { ledger } = await setup();
  const session = (await ledger.admit("collector", "event"))!;
  const transport = vi.fn(async () => new Response('{"ok":true}'));
  for (let i = 0; i < 3; i++)
    await (
      await session.network(transport)(
        "https://api.hypixel.net/v2/skyblock/bazaar",
      )
    ).json();
  session.take({ storageEgressBytes: 8 * 1024 ** 2 }, false);
  expect(session.observed.hypixelRequests).toBe(3);
  expect(session.observed.upstreamResponseBytes).toBe(33);
  expect(session.observed.storageEgressBytes).toBeUndefined();
  await session.finish();
  await session.finish();
  expect((await ledger.read())!.observed.hypixelRequests).toBe(3);
  expect((await ledger.read())!.reserved.hypixelRequests).toBe(96);
});
it("stop state survives a new ledger and rejects optional work", async () => {
  const { ledger, store } = await setup();
  await ledger.stop("measurement ended");
  await expect(
    new TrialLedger(store, () => start).admit("browser", "late"),
  ).rejects.toThrow("measurement ended");
});
it("an exhausted reservation latches closed and cancels parallel I/O before further optional work", async () => {
  const { ledger } = await setup();
  const session = (await ledger.admit("collector", "event"))!;
  const signal = session.signal();
  session.take({ hypixelRequests: 96 });
  expect(() => session.take({ hypixelRequests: 1 })).toThrow("exhausted");
  expect(signal.aborted).toBe(true);
  expect(() => session.take({ firestoreReads: 1 })).toThrow("exhausted");
  await expect(session.extend({ hypixelRequests: 1 })).rejects.toThrow(
    "exhausted",
  );
  expect(session.observed.firestoreReads).toBeUndefined();
  await session.finish();
  expect((await ledger.read())!.reserved.hypixelRequests).toBe(96);
});
