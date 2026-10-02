import { afterEach, expect, it, vi } from "vitest";
import { SqliteCache } from "../collector/cache-store";
import { googleMeters } from "../collector/usage";
import type { TrialPreflight } from "../collector/trial-preflight";
import { launchTrial, type TrialLaunchControl } from "../collector/trial-launch";
import { googleTrialControl, type GoogleTrialPlan } from "../collector/trial-launch-google";

const stores: SqliteCache[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); });
function fixture() {
  let now = 1_800_000_000_000;
  const store = new SqliteCache(":memory:"); stores.push(store);
  const plan: TrialPreflight = {
    id: "launch-fixture", startsAt: now, expiresAt: now + 840_000,
    deploymentVerified: true, shutdownPermissionsVerified: true,
    allowanceScopesVerified: true, transferEligibilityVerified: true,
    evidence: Object.fromEntries(googleMeters.map(key => [key, { source: "fixture-only", verifiedAt: now }])) as TrialPreflight["evidence"],
    overhead: Object.fromEntries(googleMeters.map(key => [key, 100])) as TrialPreflight["overhead"],
    baseline: { meters: Object.fromEntries(googleMeters.map(key => [key, {
      scope: "fixture-only", periodStart: now - 1000, periodEnd: now + 86_400_000,
      verifiedAt: now, limit: 1e15, used: 1, reserved: 0, headroom: 100, projectedRemaining: 0,
    }])) },
  };
  let publicApi = false, scheduled = false;
  const control = {
    verifyContained: vi.fn(async () => { if (publicApi || scheduled) throw new Error("not contained"); }),
    openApi: vi.fn(async () => { publicApi = true; }),
    resumeCollector: vi.fn(async () => { scheduled = true; }),
    verifyRunning: vi.fn(async () => { if (!publicApi || !scheduled) throw new Error("not running"); }),
    stop: vi.fn(async () => { publicApi = false; scheduled = false; }),
  } satisfies TrialLaunchControl;
  return { store, plan, control, now: () => now, advance: (ms: number) => { now += ms; }, active: () => publicApi || scheduled };
}
it("rejects unknown accounting without inspecting or mutating cloud state", async () => {
  const f = fixture(); delete f.plan.baseline.meters.egressBytes;
  await expect(launchTrial(f.plan, f.store, f.control, true, f.now)).rejects.toThrow("egressBytes");
  expect(f.control.verifyContained).not.toHaveBeenCalled();
  expect(await f.store.read("trial-launches")).toBeNull();
});
it("dry run is read-only and a launch installs accounting before enabling work", async () => {
  const f = fixture();
  await expect(launchTrial(f.plan, f.store, f.control, false, f.now)).resolves.toMatchObject({ status: "ready-for-one-launch" });
  expect(await f.store.read("trial")).toBeNull();
  expect(await f.store.read("trial-launches")).toBeNull();
  expect(f.active()).toBe(false);
  const open = f.control.openApi.getMockImplementation()!;
  f.control.openApi.mockImplementationOnce(async () => {
    expect(JSON.parse((await f.store.read("trial"))!).id).toBe(f.plan.id);
    expect(JSON.parse((await f.store.read("trial-launches"))!).attempts[f.plan.id]).toBeDefined();
    await open();
  });
  await expect(launchTrial(f.plan, f.store, f.control, true, f.now)).resolves.toMatchObject({ status: "started" });
  expect(f.control.resumeCollector).toHaveBeenCalledOnce();
});
it("concurrent launch losers do not roll back the successful winner", async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    launchTrial(f.plan, f.store, f.control, true, f.now),
    launchTrial(f.plan, f.store, f.control, true, f.now),
  ]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(f.control.openApi).toHaveBeenCalledOnce();
  expect(f.control.stop).not.toHaveBeenCalled();
  expect(f.active()).toBe(true);
});
it("an ambiguous activation contains both services and consumes its identity", async () => {
  const f = fixture();
  f.control.resumeCollector.mockRejectedValueOnce(new Error("lost resume reply"));
  await expect(launchTrial(f.plan, f.store, f.control, true, f.now)).rejects.toThrow("lost resume reply");
  expect(f.control.stop).toHaveBeenCalledOnce(); expect(f.active()).toBe(false);
  expect(JSON.parse((await f.store.read("trial"))!).stoppedAt).toBe(f.now());
  // A fresh invocation cannot retry a used launch even after its drain window.
  f.advance(1_100_000);
  f.plan.startsAt = f.now(); f.plan.expiresAt = f.now() + 840_000;
  for (const key of googleMeters) {
    f.plan.baseline.meters[key]!.verifiedAt = f.now(); f.plan.evidence[key].verifiedAt = f.now();
  }
  await expect(launchTrial(f.plan, f.store, f.control, true, f.now)).rejects.toThrow("identity was used");
  expect(f.control.openApi).toHaveBeenCalledOnce();
});
it("reports partial rollback and stops activation when its deadline passes", async () => {
  const f = fixture();
  f.control.resumeCollector.mockImplementationOnce(async () => { f.advance(840_000); });
  f.control.verifyRunning.mockResolvedValueOnce();
  f.control.stop.mockRejectedValueOnce(new Error("IAM unavailable"));
  await expect(launchTrial(f.plan, f.store, f.control, true, f.now)).rejects.toThrow("containment is incomplete");
  expect(JSON.parse((await f.store.read("trial"))!).stoppedAt).toBe(f.now());
});
it("refuses to replace an existing trial or activate a future trial", async () => {
  const f = fixture();
  await f.store.commit("trial", null, JSON.stringify({ version: 1, expiresAt: f.now() + 5000 }));
  await expect(launchTrial(f.plan, f.store, f.control, true, f.now)).rejects.toThrow("still draining");
  expect(f.control.openApi).not.toHaveBeenCalled();
  f.plan.startsAt += 5000;
  await expect(launchTrial(f.plan, f.store, f.control, true, f.now)).rejects.toThrow("measurement window");
});

function googleFixture() {
  const f = fixture(), root = "projects/bazaarsignal-510305/locations/us-central1";
  const image = `us-central1-docker.pkg.dev/bazaarsignal-510305/gcf-artifacts/trial@sha256:${"a".repeat(64)}`;
  const plan: GoogleTrialPlan = { ...f.plan, project: "bazaarsignal-510305", images: { marketapi: image, refreshmarket: image }, shutdownEvidence: "fixture-only" };
  const services = Object.fromEntries(["marketapi", "refreshmarket"].map(name => [name, {
    name: `${root}/services/${name}`, uri: `https://${name}-fixture.a.run.app`,
    terminalCondition: { state: "CONDITION_SUCCEEDED" },
    latestCreatedRevision: `${root}/services/${name}/revisions/${name}-00001`, latestReadyRevision: `${root}/services/${name}/revisions/${name}-00001`,
    trafficStatuses: [{ percent: 100, revision: `${name}-00001` }],
    template: { scaling: { maxInstanceCount: 1 }, timeout: name === "marketapi" ? "30s" : "180s",
      maxInstanceRequestConcurrency: name === "marketapi" ? 2 : 1,
      serviceAccount: `${name === "marketapi" ? "market-reader" : "market-collector"}@bazaarsignal-510305.iam.gserviceaccount.com`,
      containers: [{ image, resources: { cpuIdle: true, limits: { cpu: "1", memory: "1024Mi" } }, env: [
        { name: "MARKET_TRIAL_ID", value: plan.id },
        { name: "MARKET_TRIAL_START", value: new Date(plan.startsAt).toISOString() },
        { name: "MARKET_TRIAL_END", value: new Date(plan.expiresAt).toISOString() },
        { name: "FUNCTION_TARGET", value: name === "marketapi" ? "marketApi" : "refreshMarket" },
        { name: "FUNCTION_SIGNATURE_TYPE", value: "http" },
      ] }],
    },
  }]));
  const revisions = Object.fromEntries(Object.entries(services).map(([name, service]) => [name, {
    ...structuredClone(service.template), name: service.latestReadyRevision,
    conditions: [{ type: "Ready", state: "CONDITION_SUCCEEDED" }],
  }]));
  // Real Functions services retain a tag in the template, while their serving
  // revision exposes the resolved digest and traffic uses a short revision ID.
  for (const service of Object.values(services)) service.template.containers[0].image = image.split("@")[0] + ":version_1";
  let policy: any = { etag: "original", version: 3, bindings: [{ role: "roles/run.viewer", members: ["user:owner@example.com"], condition: { title: "retained", expression: "true" } }] };
  const project: any = { projectId: "bazaarsignal-510305" }, inherited: any = { bindings: [] };
  const job: any = { state: "PAUSED", schedule: "* * * * *", timeZone: "Etc/UTC", httpTarget: {
    uri: `${services.refreshmarket.uri}/`, httpMethod: "POST", oidcToken: {
      serviceAccountEmail: "market-collector@bazaarsignal-510305.iam.gserviceaccount.com",
      audience: `${services.refreshmarket.uri}/`,
    },
  } };
  const network = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input).split("?")[0];
    if (url.includes("cloudresourcemanager.googleapis.com")) return Response.json(url.endsWith(":getIamPolicy") ? inherited : project);
    if (url.includes("/revisions/")) return Response.json(revisions[url.split("/").at(-3)!]);
    if (url.includes("/v2/")) return Response.json(services[url.split("/").pop()!]);
    if (url.endsWith("marketapi:getIamPolicy")) return Response.json(policy);
    if (url.endsWith("refreshmarket:getIamPolicy")) return Response.json({ bindings: [] });
    if (url.endsWith(":setIamPolicy")) { policy = JSON.parse(init.body).policy; return Response.json(policy); }
    if (url.endsWith(":resume")) { job.state = "ENABLED"; return Response.json(job); }
    if (url.endsWith(":pause")) { job.state = "PAUSED"; return Response.json(job); }
    return Response.json(job);
  });
  const control = googleTrialControl({ token: async () => "fixture", network }, plan);
  return { ...f, plan, control, network, services, revisions, job, project, inherited, policy: () => policy };
}
it("the Google adapter verifies deployed settings and preserves unrelated IAM during activation", async () => {
  const f = googleFixture();
  await expect(launchTrial(f.plan, f.store, f.control, true, f.now)).resolves.toMatchObject({ status: "started" });
  expect(f.job.state).toBe("ENABLED");
  expect(f.policy().etag).toBe("original");
  expect(f.policy().bindings).toContainEqual({ role: "roles/run.viewer", members: ["user:owner@example.com"], condition: { title: "retained", expression: "true" } });
  expect(f.network.mock.calls.filter(([url]) => /:setIamPolicy$|:resume$/.test(String(url)))).toHaveLength(2);
});
it("the Google adapter rejects an old image, wrong handler/project or mismatched deadline before writes", async () => {
  for (const change of [
    (f: ReturnType<typeof googleFixture>) => { f.revisions.marketapi.containers[0].image += "bad"; },
    (f: ReturnType<typeof googleFixture>) => { f.revisions.refreshmarket.containers[0].env[2].value = new Date(f.plan.expiresAt + 1).toISOString(); },
    (f: ReturnType<typeof googleFixture>) => { f.revisions.marketapi.containers[0].env[3].value = "refreshMarket"; },
    (f: ReturnType<typeof googleFixture>) => { f.revisions.refreshmarket.containers[0].env[4].value = "cloudevent"; },
    (f: ReturnType<typeof googleFixture>) => { f.revisions.marketapi.containers[0].env.push({ name: "GCLOUD_PROJECT", value: "different-project" }); },
    (f: ReturnType<typeof googleFixture>) => { f.inherited.bindings.push({ role: "roles/run.invoker", members: ["allUsers"] }); },
    (f: ReturnType<typeof googleFixture>) => { f.job.httpTarget.oidcToken.audience = "https://unrelated.example/"; },
    (f: ReturnType<typeof googleFixture>) => { f.job.httpTarget.oidcToken.serviceAccountEmail = "wrong@example.com"; },
  ]) {
    const f = googleFixture(); change(f);
    await expect(launchTrial(f.plan, f.store, f.control, true, f.now)).rejects.toThrow();
    expect(f.network.mock.calls.filter(([url]) => /:setIamPolicy$|:resume$/.test(String(url)))).toHaveLength(0);
    expect(await f.store.read("trial")).toBeNull();
  }
});
