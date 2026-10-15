// Bounded read-only preflight. No activation, scans, handlers, mail or mutations.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { verifyReleasePlan, verifyPaidPreflight, scheduleConfiguration } from './private-trial-release.mjs';

const [directory, releaseId] = process.argv.slice(2);
if (process.argv.length !== 4 || !/^[a-z][a-z0-9-]{1,90}$/.test(releaseId ?? '')) throw Error('Usage: node scripts/prepare-active-paid-release.mjs <image-directory> <new-release-id>');
const image = JSON.parse(readFileSync(resolve(directory, 'receipt.json'), 'utf8'));
if (!image.localRuntimeSmokeVerified || !image.applicationOnly) throw Error('Verify the local image first');
const project = 'bazaarsignal-510305', root = `projects/${project}/locations/us-central1`;
const docs = `projects/${project}/databases/(default)/documents/marketCache`;
const file = `.local/${releaseId}-preflight.json`, planFile = `.local/${releaseId}-plan.json`;
if (existsSync(file) || existsSync(planFile)) throw Error('Preflight identity already exists');
const out = { at: new Date().toISOString(), calls: 0, maxCalls: 24, maxResponseBytes: 1024 ** 2,
  reservationNote: 'Bounded operator reads remain covered by the existing fixed reserve. Apply separately retains $0.50 before upload for rollout, Hosting, smoke checks and rollback.', resources: {}, errors: [] };
writeFileSync(file, JSON.stringify(out), { flag: 'wx' });
const save = () => writeFileSync(file, JSON.stringify(out, null, 2));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const auth = createRequire(import.meta.url)('firebase-tools/lib/auth');
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw Error('Expected deployment account unavailable');
  const token = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token;
  const endpoints = {
    paid: `https://firestore.googleapis.com/v1/${docs}/paid-budget-october`,
    legacy: `https://firestore.googleapis.com/v1/${docs}/live-allowance`,
    control: `https://firestore.googleapis.com/v1/${docs}/control`,
    scheduler: `https://cloudscheduler.googleapis.com/v1/${root}/jobs/firebase-schedule-refreshMarket-us-central1`,
    marketapi: `https://run.googleapis.com/v2/${root}/services/marketapi`,
    refreshmarket: `https://run.googleapis.com/v2/${root}/services/refreshmarket`,
    marketapiIam: `https://run.googleapis.com/v1/${root}/services/marketapi:getIamPolicy?options.requestedPolicyVersion=3`,
    refreshmarketIam: `https://run.googleapis.com/v1/${root}/services/refreshmarket:getIamPolicy?options.requestedPolicyVersion=3`,
    projectIam: `https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`,
    schedulerStopRole: `https://iam.googleapis.com/v1/projects/${project}/roles/marketTrialSchedulerStop`,
    apiStopRole: `https://iam.googleapis.com/v1/projects/${project}/roles/marketTrialApiStop`,
    repository: `https://artifactregistry.googleapis.com/v1/${root}/repositories/gcf-artifacts`,
    database: `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)`,
    billing: `https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`,
    hosting: 'https://firebasehosting.googleapis.com/v1beta1/sites/bazaarsignal/releases?pageSize=1',
  };
  for (const [key, url] of Object.entries(endpoints)) {
    if (++out.calls > out.maxCalls) throw Error('Preflight request bound reached');
    save();
    const post = key === 'projectIam';
    const response = await fetch(url, { method: post ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(post ? { body: JSON.stringify({ options: { requestedPolicyVersion: 3 } }) } : {}) });
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length; if (length > out.maxResponseBytes) throw Error(`Preflight ${key} response bound`);
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (!response.ok) throw Error(`Preflight ${key} HTTP ${response.status}: ${data.error?.status}`);
    out.resources[key] = data; save();
  }
  const r = out.resources, ledger = JSON.parse(r.paid.fields.value.stringValue);
  const env = Object.fromEntries(r.marketapi.template.containers[0].env.map(e => [e.name, e.value]));
  const plan = { project, activePaidUpdate: true, operatingMode: 'paid-budget', updateExistingLive: true,
    services: ['marketapi'], releaseId, id: ledger.id, servicePeriodId: env.MARKET_LIVE_ID,
    startsAt: new Date(ledger.startsAt).toISOString(), expiresAt: new Date(ledger.expiresAt).toISOString(),
    shutdownGrantExpiresAt: '2026-11-01T08:00:00.000Z', legacyLedgerSha256: ledger.legacyLedgerSha256,
    budgetUsd: 5, applicationStopUsd: 4.5, fixedReserveUsd: 1, paidRolloutReserveUsd: .5,
    imageDirectory: resolve(directory), imageDigest: image.imageDigest, observedAt: Date.parse(out.at),
    scopeEvidence: file, capacityEvidence: 'Existing paid budget and retained resources, $0.50 additional nonrefundable rollout hold including Hosting/rollback; no billed-spend claim.',
    counterEvidence: 'Fresh paid ledger admission; old stopped ledger checked only for integrity, never used to admit an active paid release.',
    policySha256: Object.fromEntries(['marketapi','refreshmarket'].map(n => [n, hash(JSON.stringify(r[`${n}Iam`]))])),
    scheduleSha256: hash(JSON.stringify(scheduleConfiguration(r.scheduler))),
    meters: {
      cpuSeconds: { used: ledger.reserved.cpuSeconds ?? 0, hold: 10000, headroom: 0, limit: 180000 },
      memoryGiBSeconds: { used: ledger.reserved.memoryGiBSeconds ?? 0, hold: 10000, headroom: 0, limit: 360000 },
      artifactBytes: { used: Math.max(Number(r.repository.sizeBytes), ledger.reserved.artifactBytes ?? 0), hold: image.artifactStorageHoldBytes, headroom: 0, limit: 1024 ** 3 },
      logBytes: { used: ledger.reserved.logBytes ?? 0, hold: 16 * 1024 ** 2, headroom: 0, limit: 50 * 1024 ** 3 },
    }, preflightPath: file,
  };
  verifyReleasePlan(plan, image); verifyPaidPreflight(plan, out);
  out.result = 'active-paid-preflight-ready'; out.finishedAt = new Date().toISOString(); save();
  plan.preflightSha256 = hash(readFileSync(file));
  writeFileSync(planFile, JSON.stringify(plan, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ file, planFile, calls: out.calls, reservedUsd: ledger.reservedUsd,
    additionalRolloutReservationUsd: .5, expiresAt: plan.expiresAt, targets: plan.services,
    rollback: { api: r.marketapi.latestReadyRevision, hosting: r.hosting.releases[0].version.name } }, null, 2));
} catch (error) { out.errors.push(error.message); save(); throw error; }
