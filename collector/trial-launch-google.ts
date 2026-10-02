import { TrialStopped } from "./trial";
import type { TrialPreflight } from "./trial-preflight";
import type { TrialLaunchControl } from "./trial-launch";
import { stopTrialInfrastructure, type ShutdownConfig } from "./trial-shutdown";

export interface GoogleTrialPlan extends TrialPreflight {
  project: "bazaarsignal-510305";
  /** Immutable deployed images from the separately verified deployment receipt. */
  images: { marketapi: string; refreshmarket: string };
  shutdownEvidence: string;
}
const PROJECT = "bazaarsignal-510305";
const ROOT = `projects/${PROJECT}/locations/us-central1`;
const JOB = `https://cloudscheduler.googleapis.com/v1/${ROOT}/jobs/firebase-schedule-refreshMarket-us-central1`;
const API = `https://run.googleapis.com/v1/${ROOT}/services/marketapi`;
const IAM_OPTIONS = "?options.requestedPolicyVersion=3";
const hasPublic = (policy: any) => (policy.bindings ?? []).some((b: any) =>
  b.role === "roles/run.invoker" && b.members?.some((m: string) =>
    m === "allUsers" || m === "allAuthenticatedUsers"));

/** Only the existing named project/job/API can be activated. Verification uses
 * actual service state, not a local env file or a successful deploy exit code. */
export function googleTrialControl(
  config: Omit<ShutdownConfig, "project">,
  plan: GoogleTrialPlan,
): TrialLaunchControl {
  if (plan.project !== PROJECT || !plan.shutdownEvidence ||
      ![plan.images?.marketapi, plan.images?.refreshmarket].every(image =>
        typeof image === "string" && /^us-central1-docker\.pkg\.dev\/bazaarsignal-510305\/[^\s]+@sha256:[a-f0-9]{64}$/.test(image)))
    throw new TrialStopped("Verified deployment images and shutdown evidence are required");
  const network = config.network ?? fetch;
  let calls = 0;
  async function call(url: string, method = "GET", body?: unknown) {
    if (++calls > 32) throw new TrialStopped("Launch inspection call bound reached");
    const response = await network(url, {
      method, redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${await config.token()}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new TrialStopped(`Launch control HTTP ${response.status}`);
    return response.json();
  }
  async function verifyServices() {
    const services: Record<string, any> = {};
    for (const name of ["marketapi", "refreshmarket"] as const) {
      const service = await call(`https://run.googleapis.com/v2/${ROOT}/services/${name}`);
      const revisionPrefix = `${ROOT}/services/${name}/revisions/`;
      if (typeof service.latestReadyRevision !== "string" ||
          !service.latestReadyRevision.startsWith(revisionPrefix) ||
          !/^[a-z0-9-]+$/.test(service.latestReadyRevision.slice(revisionPrefix.length)))
        throw new TrialStopped(`Deployed ${name} has no verified ready revision`);
      // The Service template can retain a mutable :version tag. The serving
      // Revision resolves it to the digest that actually executes.
      const t = await call(`https://run.googleapis.com/v2/${service.latestReadyRevision}`);
      const c = t?.containers?.[0];
      const env = new Map((c?.env ?? []).map((e: any) => [e.name, e.value]));
      const traffic = service.trafficStatuses;
      if (
        service.name !== `${ROOT}/services/${name}` || service.reconciling ||
        service.terminalCondition?.state !== "CONDITION_SUCCEEDED" ||
        service.invokerIamDisabled === true || service.defaultUriDisabled === true ||
        service.latestCreatedRevision !== service.latestReadyRevision ||
        !service.latestReadyRevision ||
        traffic?.length !== 1 || traffic[0].percent !== 100 || traffic[0].tag ||
        ![service.latestReadyRevision, service.latestReadyRevision.slice(revisionPrefix.length)].includes(traffic[0].revision) ||
        t.name !== service.latestReadyRevision ||
        !t.conditions?.some((condition: any) => condition.type === "Ready" && condition.state === "CONDITION_SUCCEEDED") ||
        t?.containers?.length !== 1 || c.image !== plan.images[name] ||
        (t.scaling?.minInstanceCount ?? 0) !== 0 || t.scaling?.maxInstanceCount !== 1 ||
        (service.scaling?.minInstanceCount ?? 0) !== 0 ||
        service.scaling?.scalingMode === "MANUAL" ||
        (service.scaling?.manualInstanceCount ?? 0) !== 0 ||
        t.maxInstanceRequestConcurrency !== (name === "marketapi" ? 2 : 1) ||
        t.timeout !== (name === "marketapi" ? "30s" : "180s") ||
        c.resources?.cpuIdle !== true || c.resources?.limits?.cpu !== "1" ||
        !["1Gi", "1024Mi"].includes(c.resources?.limits?.memory) ||
        t.serviceAccount !== `${name === "marketapi" ? "market-reader" : "market-collector"}@${PROJECT}.iam.gserviceaccount.com` ||
        env.get("MARKET_TRIAL_ID") !== plan.id ||
        env.get("FUNCTION_TARGET") !== (name === "marketapi" ? "marketApi" : "refreshMarket") ||
        env.get("FUNCTION_SIGNATURE_TYPE") !== "http" ||
        (env.get("GCLOUD_PROJECT") ?? PROJECT) !== PROJECT ||
        Date.parse(String(env.get("MARKET_TRIAL_START"))) !== plan.startsAt ||
        Date.parse(String(env.get("MARKET_TRIAL_END"))) !== plan.expiresAt
      ) throw new TrialStopped(`Deployed ${name} does not match the bounded trial`);
      services[name] = service;
    }
    return services;
  }
  return {
    async verifyContained(candidate) {
      if (candidate.id !== plan.id || candidate.startsAt !== plan.startsAt || candidate.expiresAt !== plan.expiresAt)
        throw new TrialStopped("Launch control plan mismatch");
      const services = await verifyServices();
      const project = await call(`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}`);
      if (project.parent)
        throw new TrialStopped("Inherited organization/folder IAM needs separate verification");
      const inherited = await call(`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy`, "POST", { options: { requestedPolicyVersion: 3 } });
      if ((inherited.bindings ?? []).some((binding: any) => binding.members?.some((member: string) =>
        member === "allUsers" || member === "allAuthenticatedUsers")))
        throw new TrialStopped("Project IAM grants public inherited access");
      const job = await call(JOB);
      const target = job.httpTarget;
      const allowedTargets = [services.refreshmarket.uri,
        `${services.refreshmarket.uri}/`,
        `https://us-central1-${PROJECT}.cloudfunctions.net/refreshMarket`,
        `https://us-central1-${PROJECT}.cloudfunctions.net/refreshMarket/`];
      if (job.state !== "PAUSED" || job.schedule !== "* * * * *" ||
          job.timeZone !== "Etc/UTC" || (job.retryConfig?.retryCount ?? 0) !== 0 ||
          ![undefined, "0s"].includes(job.retryConfig?.maxRetryDuration) ||
          target?.httpMethod !== "POST" ||
          target.oidcToken?.serviceAccountEmail !== `market-collector@${PROJECT}.iam.gserviceaccount.com` ||
          !allowedTargets.includes(target.oidcToken?.audience) ||
          !allowedTargets.includes(target.uri))
        throw new TrialStopped("Scheduler is not contained with the verified minute schedule");
      if (hasPublic(await call(`${API}:getIamPolicy${IAM_OPTIONS}`)) ||
          hasPublic(await call(`https://run.googleapis.com/v1/${ROOT}/services/refreshmarket:getIamPolicy${IAM_OPTIONS}`)))
        throw new TrialStopped("A trial service is already publicly invokable");
    },
    async openApi() {
      const policy = await call(`${API}:getIamPolicy${IAM_OPTIONS}`);
      if (!policy.etag || hasPublic(policy))
        throw new TrialStopped("API IAM changed before activation");
      policy.bindings ??= [];
      const binding = policy.bindings.find((b: any) => b.role === "roles/run.invoker" && !b.condition);
      if (binding) binding.members = [...new Set([...(binding.members ?? []), "allUsers"])];
      else policy.bindings.push({ role: "roles/run.invoker", members: ["allUsers"] });
      await call(`${API}:setIamPolicy`, "POST", { policy });
    },
    async resumeCollector() {
      if ((await call(JOB)).state !== "PAUSED")
        throw new TrialStopped("Scheduler changed before activation");
      await call(`${JOB}:resume`, "POST", {});
    },
    async verifyRunning() {
      await verifyServices();
      if ((await call(JOB)).state !== "ENABLED" || !hasPublic(await call(`${API}:getIamPolicy${IAM_OPTIONS}`)))
        throw new TrialStopped("Trial activation is unverified");
    },
    stop: () => stopTrialInfrastructure({ ...config, project: PROJECT }),
  };
}
