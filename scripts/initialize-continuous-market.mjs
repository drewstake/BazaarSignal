// Create-only operational accounting after the continuous handlers are deployed
// privately. This never changes old ledgers, schedules, IAM, billing, or mail.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CONTINUOUS_LEDGER_KEY, CONTINUOUS_MARKET_ID } from '../shared/continuous-market.ts';

const [receiptPath, action = '--inspect'] = process.argv.slice(2);
if (!receiptPath || !['--inspect', '--apply'].includes(action) || process.argv.length > 4)
  throw Error('Pass the verified market image receipt and --inspect or --apply');
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
if (!receipt.localRuntimeSmokeVerified || !receipt.localRuntimeSmoke?.operatingModes?.includes('continuous') ||
    !/^sha256:[a-f0-9]{64}$/.test(receipt.imageDigest)) throw Error('Verified continuous image required');
const auth = createRequire(import.meta.url)('firebase-tools/lib/auth');
const owner = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
if (!owner) throw Error('Firebase deployment sign-in required');
const token = (await auth.getAccessToken(owner.tokens.refresh_token, [])).access_token;
const project = 'bazaarsignal-510305', root = `projects/${project}/locations/us-central1`;
const db = `projects/${project}/databases/(default)/documents`;
const hash = value => createHash('sha256').update(value).digest('hex');
let calls = 0;
async function request(url, method = 'GET', body) {
  if (++calls > 16) throw Error('Inspection request bound exceeded');
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw Error(`Continuous setup HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 3 * 1024 ** 2) throw Error('Inspection response bound exceeded');
  return JSON.parse(text);
}
const document = name => request(`https://firestore.googleapis.com/v1/${db}/marketCache/${name}`);
const old = await document('paid-budget-october'), legacy = await document('live-allowance');
const previousRaw = old.fields.value.stringValue, previous = JSON.parse(previousRaw);
if (previous.id !== 'paid-202610' || !previous.stoppedAt || previous.expiresAt > Date.now() ||
    previous.legacyLedgerSha256 !== hash(legacy.fields.value.stringValue)) throw Error('Historical accounting changed; inspect before activation');
const readiness = [];
for (const name of ['marketapi', 'refreshmarket']) {
  const service = await request(`https://run.googleapis.com/v2/${root}/services/${name}`);
  const policy = await request(`https://run.googleapis.com/v1/${root}/services/${name}:getIamPolicy?options.requestedPolicyVersion=3`);
  const container = service.template?.containers?.[0];
  const mode = container?.env?.find(e => e.name === 'MARKET_OPERATING_MODE')?.value;
  readiness.push(!service.reconciling && service.latestReadyRevision === service.latestCreatedRevision &&
    mode === 'continuous' && container.image.endsWith(`@${receipt.imageDigest}`) &&
    !(policy.bindings ?? []).some(b => b.members?.some(m => ['allUsers', 'allAuthenticatedUsers'].includes(m))));
}
for (const name of ['firebase-schedule-refreshMarket-us-central1', 'bazaar-daily-close']) {
  const job = await request(`https://cloudscheduler.googleapis.com/v1/${root}/jobs/${name}`);
  readiness.push(job.state === 'PAUSED');
}
const value = { version: 2, budgetPolicy: 'uncapped', id: CONTINUOUS_MARKET_ID, startsAt: Date.now(),
  // Zeroes denote disabled money/calendar controls, never a $0 spending cap.
  expiresAt: 0, limitUsd: 0, stopUsd: 0, reservedUsd: 0, reserved: {}, observed: {},
  legacyLedgerSha256: hash(previousRaw), admissions: {}, admissionCount: 0 };
mkdirSync('.local', { recursive: true });
const output = `.local/continuous-initialization-${Date.now()}.json`;
const report = { action, imageDigest: receipt.imageDigest, ready: readiness.every(Boolean), value,
  originalUpdateTime: old.updateTime, legacyUpdateTime: legacy.updateTime, applied: false };
writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' });
if (action === '--apply') {
  if (!report.ready) throw Error('Deploy the verified continuous handlers privately and retain paused schedules first');
  await request(`https://firestore.googleapis.com/v1/${db}:commit`, 'POST', { writes: [
    { verify: old.name, currentDocument: { updateTime: old.updateTime } },
    { verify: legacy.name, currentDocument: { updateTime: legacy.updateTime } },
    { update: { name: `${db}/marketCache/${CONTINUOUS_LEDGER_KEY}`, fields: { value: { stringValue: JSON.stringify(value) } } }, currentDocument: { exists: false } },
  ] });
  const created = await document(CONTINUOUS_LEDGER_KEY);
  if (created.fields?.value?.stringValue !== JSON.stringify(value))
    throw Error('Initialization outcome needs inspection; do not recreate or reset accounting');
  report.applied = true;
  writeFileSync(output, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ output, ready: report.ready, applied: report.applied }));
