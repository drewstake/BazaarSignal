import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

/** This gate permits one private image release only. It cannot activate a trial,
 * invoke an application handler, create a build/job, or change billing or IAM. */
export function verifyReleasePlan(plan, receipt, now = Date.now()) {
  if (plan.project !== project || plan.imageDigest !== receipt.imageDigest ||
      !/^sha256:[a-f0-9]{64}$/.test(receipt.imageDigest) ||
      !receipt.applicationOnly || !receipt.localRuntimeSmokeVerified ||
      receipt.requiredBaseImage !== baseImage || receipt.cloudBuildMinutes !== 0)
    throw new Error('Unverified local application-only image');
  const start = Date.parse(plan.startsAt), end = Date.parse(plan.expiresAt);
  const live = plan.operatingMode === 'free-tier';
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(plan.id) || !Number.isFinite(start + end) ||
      end <= start || end - start > (live ? 32 * 86400000 : 900000) || (live ? now >= end : now >= start) ||
      Date.parse(plan.shutdownGrantExpiresAt) < end + 180000)
    throw new Error('Invalid fixed release/trial window or shutdown margin');
  if (!Number.isFinite(plan.observedAt) || now < plan.observedAt || now - plan.observedAt > 1800000 ||
      !plan.scopeEvidence || !plan.capacityEvidence || !plan.counterEvidence)
    throw new Error('Missing or stale deployment evidence');
  const required = ['cpuSeconds', 'memoryGiBSeconds', 'artifactBytes', 'logBytes'];
  for (const key of required) {
    const m = plan.meters?.[key];
    if (!m || ![m.used, m.hold, m.headroom, m.limit].every(Number.isFinite) ||
        Math.min(m.used, m.hold, m.headroom) < 0 || m.limit <= 0 ||
        (m.used + m.hold + m.headroom) / m.limit >= .75)
      throw new Error(`Private deployment lacks allowance headroom: ${key}`);
  }
  if (plan.meters.artifactBytes.hold < receipt.artifactStorageHoldBytes ||
      plan.meters.cpuSeconds.hold < 10000 || plan.meters.memoryGiBSeconds.hold < 10000 ||
      plan.meters.logBytes.hold < 16 * 1024 ** 2 ||
      receipt.registryUploadBytes > 20 * 1024 ** 2)
    throw new Error('Insufficient rollout/image/log allowance reservation');
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

export function releasePatch(service, name, plan) {
  if (!['marketapi', 'refreshmarket'].includes(name) || service.name !== `${root}/services/${name}` ||
      !service.etag || service.reconciling || service.invokerIamDisabled === true ||
      service.template?.containers?.length !== 1)
    throw new Error('Unexpected existing service');
  const template = structuredClone(service.template);
  delete template.revision;
  const container = template.containers[0];
  container.image = `${registry.slice(8)}/${repository}@${plan.imageDigest}`;
  container.baseImageUri = baseImage;
  delete container.command;
  delete container.args;
  container.resources = { limits: { cpu: '1', memory: '1Gi' }, cpuIdle: true, startupCpuBoost: false };
  const values = {
    GCLOUD_PROJECT: project, FUNCTION_TARGET: name === 'marketapi' ? 'marketApi' : 'refreshMarket',
    FUNCTION_SIGNATURE_TYPE: 'http', MARKET_TRIAL_ID: plan.id,
    MARKET_TRIAL_START: plan.startsAt, MARKET_TRIAL_END: plan.expiresAt,
    MARKET_OPERATING_MODE: plan.operatingMode === 'free-tier' ? 'free-tier' : 'trial',
    ...(plan.operatingMode === 'free-tier' ? { MARKET_LIVE_ID: plan.id, MARKET_LIVE_END: plan.expiresAt } : {}),
  };
  container.env = (container.env ?? []).filter(e => !(e.name in values));
  container.env.push(...Object.entries(values).map(([name, value]) => ({ name, value })));
  template.scaling = { minInstanceCount: 0, maxInstanceCount: 1 };
  template.maxInstanceRequestConcurrency = name === 'marketapi' ? 2 : 1;
  template.timeout = plan.operatingMode === 'free-tier' ? (name === 'marketapi' ? '15s' : '90s') : (name === 'marketapi' ? '30s' : '180s');
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
  const receipt = read(resolve(plan.imageDirectory, 'receipt.json'));
  verifyReleasePlan(plan, receipt);
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
  const reportPath = resolve(`.local/private-release-${plan.id}-${apply ? 'apply' : 'inspect'}.json`);
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
    if ((await json(`https://cloudscheduler.googleapis.com/v1/${job}`)).state !== 'PAUSED')
      throw new Error('Collector is not paused');
    for (const name of ['marketapi', 'refreshmarket'])
      if (isPublic(await json(`https://run.googleapis.com/v1/${root}/services/${name}:getIamPolicy?options.requestedPolicyVersion=3`)))
        throw new Error('A service has public access');
  }
  try {
    await contained();
    const services = {};
    for (const name of ['marketapi', 'refreshmarket']) {
      services[name] = await json(`https://run.googleapis.com/v2/${root}/services/${name}`);
      releasePatch(services[name], name, plan);
    }
    if (!apply) { report.result = 'private-release-ready'; return; }
    verifyReleasePlan(plan, receipt);
    // Reserve the entire image before any upload. A failure never refunds it.
    report.reservations = plan.meters;
    save();
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
    for (const name of ['marketapi', 'refreshmarket']) {
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
    report.result = 'privately-deployed-collector-paused';
  } catch (error) { report.error = error.message; throw error; }
  finally { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ reportPath, ...report }, null, 2)); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
