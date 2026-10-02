import { afterEach, expect, it } from "vitest";
import { SqliteCache } from "../collector/cache-store";
import { assessUsage, googleMeters, usagePhases, UsageLedger, type UsageState, type NoAdditionalUsage } from "../collector/usage";
const stores: SqliteCache[] = [];
afterEach(async()=>{for(const s of stores.splice(0))await s.close();});
const now = 1_800_000_000_000;
function state(used=0): UsageState {
  return { meters: Object.fromEntries(googleMeters.map(key=>[key,{
    scope:`verified-account:${key}`, periodStart:now-1000,periodEnd:now+86400_000,
    verifiedAt:now,limit:1000,used,reserved:0,headroom:10,projectedRemaining:0,
  }])) };
}
it("warns at 50%, slows at 65%, pauses before a 75% operation including headroom",()=>{
  expect(assessUsage(state(489),now).mode).toBe("normal");
  expect(assessUsage(state(490),now).mode).toBe("warning");
  expect(assessUsage(state(640),now)).toEqual({mode:"slow",pollMs:60000});
  expect(assessUsage(state(739),now,{cpuSeconds:1}).mode).toBe("paused");
  const forecast=state(100);forecast.meters.storageClassA!.projectedRemaining=640;
  expect(assessUsage(forecast,now).mode).toBe("paused");
});
it("fails closed for every missing, expired, future, negative or inconsistent meter",()=>{
  expect(assessUsage(null,now).mode).toBe("paused");
  for(const key of googleMeters){const s=state();delete s.meters[key];expect(assessUsage(s,now).mode).toBe("paused");}
  for(const patch of [{verifiedAt:now-900001},{verifiedAt:now+1},{periodEnd:now},{used:-1},{limit:NaN},{scope:""}]){
    const s=state();Object.assign(s.meters.cpuSeconds!,patch);expect(assessUsage(s,now).mode).toBe("paused");
  }
});
it("100 simultaneous reservations share a durable ceiling, retain crashed work and latch the pause",async()=>{
  const store=new SqliteCache(":memory:");stores.push(store);
  const ledger=new UsageLedger(store,()=>now);await ledger.installVerifiedReports(state().meters);
  const results=await Promise.all(Array.from({length:100},()=>new UsageLedger(store,()=>now).reserve({cpuSeconds:10})));
  expect(results.filter(r=>r.mode!=="paused")).toHaveLength(73);
  const saved=JSON.parse((await store.read("usage"))!);
  expect(saved.meters.cpuSeconds.reserved).toBe(730);
  expect((await ledger.reserve({cpuSeconds:0})).mode).toBe("paused");
  await expect(ledger.installVerifiedReports(state().meters)).rejects.toThrow("reset");
});
it("never resets on a clock boundary without fresh complete reports and in-flight margin",async()=>{
  let clock=now;const store=new SqliteCache(":memory:");stores.push(store);
  const ledger=new UsageLedger(store,()=>clock);await ledger.installVerifiedReports(state().meters);
  await ledger.reserve({cpuSeconds:1000});
  clock=now+86400_000;
  expect((await ledger.status()).mode).toBe("paused");
  const fresh=state();for(const m of Object.values(fresh.meters))Object.assign(m!,{periodStart:clock,periodEnd:clock+86400_000,verifiedAt:clock});
  await expect(ledger.installVerifiedReports(fresh.meters)).rejects.toThrow("in-flight");
  clock+=180001;for(const m of Object.values(fresh.meters))m!.verifiedAt=clock;
  await ledger.installVerifiedReports(fresh.meters);
  expect((await ledger.status()).mode).toBe("normal");
  expect(JSON.parse((await store.read("usage"))!).meters.cpuSeconds.reserved).toBe(0);
});
it("accounting failures and CAS contention stop optional work",async()=>{
  const broken={read:async()=>{throw new Error("offline")},commit:async()=>false,close:async()=>{}};
  expect((await new UsageLedger(broken,()=>now).reserve({runRequests:1})).mode).toBe("paused");
  const contested={...broken,read:async()=>JSON.stringify(state())};
  expect((await new UsageLedger(contested,()=>now).reserve({runRequests:1})).mode).toBe("paused");
});

function excludedMonitoring(): UsageState {
  const s = state();
  delete s.meters.monitoringReads;
  s.noAdditionalUsage = { monitoringReads: {
    scope: "fixture-account", periodStart: now - 1000, periodEnd: now + 86400_000,
    verifiedAt: now, historicalUsed: null,
    phases: Object.fromEntries(usagePhases.map(phase =>
      [phase, { maximum: 0, source: `fixture-only:${phase}` }])) as NoAdditionalUsage["phases"],
  } };
  return s;
}
it("preserves unknown history when every phase is verified to add zero and refuses any new use", async () => {
  const s = excludedMonitoring();
  expect(assessUsage(s, now, { runRequests: 1 }).mode).toBe("normal");
  expect(assessUsage(s, now, { monitoringReads: 1 }).mode).toBe("paused");
  expect(s.meters.monitoringReads).toBeUndefined();
  expect(s.noAdditionalUsage!.monitoringReads!.historicalUsed).toBeNull();
  const store = new SqliteCache(":memory:"); stores.push(store);
  await store.commit("usage", null, JSON.stringify(s));
  const ledger = new UsageLedger(store, () => now);
  expect((await ledger.reserve({ runRequests: 1 })).mode).toBe("normal");
  expect((await new UsageLedger(store, () => now).reserve({ monitoringReads: 1 })).mode).toBe("paused");
  expect((await ledger.status()).mode).toBe("paused");
});
it.each(usagePhases)("requires zero usage evidence for the %s phase, not just the running handler", phase => {
  const s = excludedMonitoring();
  (s.noAdditionalUsage!.monitoringReads!.phases[phase] as any).maximum = 1;
  expect(assessUsage(s, now).mode).toBe("paused");
  (s.noAdditionalUsage!.monitoringReads!.phases[phase] as any).maximum = 0;
  s.noAdditionalUsage!.monitoringReads!.phases[phase].source = " ";
  expect(assessUsage(s, now).mode).toBe("paused");
});
it("does not exempt ongoing meters, erase a present baseline or accept stale or incomplete proofs", () => {
  for (const key of googleMeters.filter(k => k !== "monitoringReads" && k !== "firestoreDeletes")) {
    const s = excludedMonitoring();
    (s.noAdditionalUsage as any)[key] = s.noAdditionalUsage!.monitoringReads;
    delete s.meters[key];
    expect(assessUsage(s, now).mode).toBe("paused");
  }
  for (const alter of [
    (s: UsageState) => { s.meters.monitoringReads = state().meters.monitoringReads; },
    (s: UsageState) => { s.noAdditionalUsage!.monitoringReads!.verifiedAt = now - 900001; },
    (s: UsageState) => { s.noAdditionalUsage!.monitoringReads!.periodEnd = now; },
    (s: UsageState) => { (s.noAdditionalUsage!.monitoringReads as any).historicalUsed = 0; },
    (s: UsageState) => { delete (s.noAdditionalUsage!.monitoringReads!.phases as any).reporting; },
  ]) {
    const s = excludedMonitoring(); alter(s);
    expect(assessUsage(s, now).mode).toBe("paused");
  }
});
