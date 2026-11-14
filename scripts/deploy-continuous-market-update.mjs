// Image-only update of the two existing continuous services. No ledger, IAM,
// schedule, billing, Hosting, or Apps Script mutations. Default is inspection.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';

const [receiptPath, action = '--inspect'] = process.argv.slice(2);
if (!receiptPath || !['--inspect', '--apply'].includes(action) || process.argv.length > 4)
  throw Error('Pass an image receipt and --inspect or --apply');
const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
const sha = data => createHash('sha256').update(data).digest('hex');
if (!receipt.localRuntimeSmokeVerified || !receipt.localRuntimeSmoke?.operatingModes?.includes('continuous') ||
    receipt.sourceSha256 !== sha(await fs.readFile('market-functions/lib/index.cjs')))
  throw Error('Current bundle and verified continuous image must match');
const project = 'bazaarsignal-510305';
const root = `projects/${project}/locations/us-central1`;
const registry = 'https://us-central1-docker.pkg.dev';
const repository = `${project}/gcf-artifacts/market-trial`;
const run = `https://run.googleapis.com/v2/${root}/services/`;
const db = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/marketCache/`;
const account = createRequire(import.meta.url)('firebase-tools/lib/auth');
const owner = account.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
if (!owner) throw Error('Expected deployment account unavailable');
const token = (await account.getAccessToken(owner.tokens.refresh_token, [])).access_token;
async function request(url, method = 'GET', body, type = 'application/json', allowed = []) {
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
    ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
  if (!response.ok && !allowed.includes(response.status)) {
    await response.body?.cancel();
    throw Error(`Release HTTP ${response.status} at ${new URL(url).hostname}; inspect before retrying mutations`);
  }
  return response;
}
const json = async (...args) => (await request(...args)).json();
const publicAccess = policy => policy.bindings?.some(b => b.role === 'roles/run.invoker' &&
  b.members?.some(member => ['allUsers', 'allAuthenticatedUsers'].includes(member)));
const before = { at: new Date().toISOString(), services: {}, iam: {}, jobs: {}, ledgers: {} };
for (const name of ['marketapi', 'refreshmarket']) {
  const service = before.services[name] = await json(run + name);
  const iam = before.iam[name] = await json(run + name + ':getIamPolicy');
  if (service.reconciling || service.latestReadyRevision !== service.latestCreatedRevision ||
      service.template?.containers?.length !== 1 || service.invokerIamDisabled ||
      service.template.containers[0].env?.find(e => e.name === 'MARKET_OPERATING_MODE')?.value !== 'continuous' ||
      service.traffic?.length !== 1 || service.traffic[0].type !== 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST' ||
      service.traffic[0].percent !== 100 || !!publicAccess(iam) !== (name === 'marketapi'))
    throw Error(`Unexpected service configuration: ${name}`);
}
for (const name of ['firebase-schedule-refreshMarket-us-central1', 'bazaar-daily-close']) {
  const job = before.jobs[name] = await json(`https://cloudscheduler.googleapis.com/v1/${root}/jobs/${name}`);
  if (job.state !== 'ENABLED') throw Error(`Schedule is not running: ${name}`);
}
for (const name of ['market-operations', 'paid-budget-october', 'live-allowance']) {
  const doc = await json(db + name);
  before.ledgers[name] = sha(doc.fields.value.stringValue);
  if (name === 'market-operations') {
    const ledger = JSON.parse(doc.fields.value.stringValue);
    if (ledger.id !== 'continuous-v1' || ledger.budgetPolicy !== 'uncapped' || ledger.stoppedAt)
      throw Error('Continuous operating ledger is not active');
  }
}
const blob = async digest => {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw Error('Invalid image digest');
  const bytes = await fs.readFile(join(resolve(receipt.layout), 'blobs', 'sha256', digest.slice(7)));
  if (`sha256:${sha(bytes)}` !== digest) throw Error('Image content mismatch');
  return bytes;
};
const manifestBytes = await blob(receipt.imageDigest), manifest = JSON.parse(manifestBytes);
if (manifest.layers?.length !== 1 || manifest.layers[0].size > 64 * 1024 ** 2) throw Error('Unexpected image layout');
for (const descriptor of [manifest.config, ...manifest.layers])
  if ((await blob(descriptor.digest)).length !== descriptor.size) throw Error('Image size mismatch');
console.log(JSON.stringify({ action, image: receipt.imageDigest,
  previousRevisions: Object.fromEntries(Object.entries(before.services).map(([name, service]) => [name, service.latestReadyRevision])),
  changes: 'Container image only; existing continuous mode, resources, traffic, schedules and permissions preserved' }));
if (action === '--inspect') process.exit(0);
const directory = resolve('.local', `continuous-timeout-release-${Date.now()}`);
await fs.mkdir(directory);
await fs.writeFile(join(directory, 'before.json'), JSON.stringify(before, null, 2));
const journal = { at: before.at, image: receipt.imageDigest, directory, uploaded: false, operations: {}, services: {} };
const save = () => fs.writeFile(join(directory, 'release.json'), JSON.stringify(journal, null, 2));
await save();
for (const descriptor of [manifest.config, ...manifest.layers]) {
  const head = await request(`${registry}/v2/${repository}/blobs/${descriptor.digest}`, 'HEAD', undefined, undefined, [404]);
  if (head.status === 404) {
    const start = await request(`${registry}/v2/${repository}/blobs/uploads/`, 'POST');
    const destination = new URL(start.headers.get('location') ?? '', registry);
    if (destination.origin !== registry || destination.username || destination.password ||
        !(destination.pathname.startsWith(`/v2/${repository}/blobs/uploads/`) ||
          destination.pathname.startsWith(`/artifacts-uploads/namespaces/${project}/repositories/gcf-artifacts/uploads/`)))
      throw Error('Unexpected upload destination');
    destination.searchParams.set('digest', descriptor.digest);
    await request(destination.href, 'PUT', await blob(descriptor.digest), 'application/octet-stream');
  }
}
const uploaded = await request(`${registry}/v2/${repository}/manifests/${receipt.imageDigest}`, 'PUT', manifestBytes, manifest.mediaType);
if (uploaded.headers.get('docker-content-digest') !== receipt.imageDigest) throw Error('Uploaded digest mismatch');
// Keep a named recovery artifact as well as the immutable digest.
await request(`${registry}/v2/${repository}/manifests/timeout-recovery-${receipt.imageDigest.slice(7, 19)}`, 'PUT', manifestBytes, manifest.mediaType);
journal.uploaded = true; await save();
for (const name of ['marketapi', 'refreshmarket']) {
  const current = await json(run + name), previous = before.services[name];
  if (current.etag !== previous.etag) throw Error(`Concurrent configuration change: ${name}`);
  const template = structuredClone(current.template);
  delete template.revision;
  template.containers[0].image = `${registry.slice(8)}/${repository}@${receipt.imageDigest}`;
  const operation = await json(run + name + '?updateMask=template', 'PATCH', { name: current.name, etag: current.etag, template });
  if (!operation.name?.startsWith(root + '/operations/')) throw Error('Deployment operation identity missing');
  journal.operations[name] = operation.name; await save();
  console.log(`Deploying ${name}: ${operation.name}`);
  let state = operation;
  for (let count = 0; !state.done && count < 36; count++) {
    await new Promise(done => setTimeout(done, 5000));
    state = await json('https://run.googleapis.com/v2/' + operation.name);
  }
  if (!state.done || state.error) throw Error(`Deployment needs inspection: ${operation.name}`);
  const after = await json(run + name);
  if (after.template.containers[0].image !== template.containers[0].image ||
      after.latestReadyRevision !== after.latestCreatedRevision || after.reconciling ||
      after.trafficStatuses?.length !== 1 || after.trafficStatuses[0].percent !== 100 ||
      after.trafficStatuses[0].revision !== after.latestReadyRevision.split('/').at(-1))
    throw Error(`Serving revision verification failed: ${name}`);
  const normalized = structuredClone(after.template); delete normalized.revision;
  if (JSON.stringify(normalized) !== JSON.stringify(template)) throw Error(`Unexpected template change: ${name}`);
  journal.services[name] = { revision: after.latestReadyRevision, image: after.template.containers[0].image };
  await save(); console.log(`Ready: ${after.latestReadyRevision}`);
}
for (const name of ['paid-budget-october', 'live-allowance']) {
  const doc = await json(db + name);
  if (sha(doc.fields.value.stringValue) !== before.ledgers[name]) throw Error('Historical ledger changed');
}
console.log(JSON.stringify(journal, null, 2));
