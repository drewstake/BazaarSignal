// Update only the existing paid collector's schedule after its reviewed rollout.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { PAID_COLLECTION_SCHEDULE, PAID_PILOT_INTERVAL, PAID_MARKET_ORIGIN } from '../shared/paid-pilot.ts';
import { verifyPaidReleaseBudget, verifyPaidContinuity, verifySchedule, scheduleConfiguration } from './private-trial-release.mjs';

const [planPath, flag] = process.argv.slice(2);
if (!planPath || (flag !== undefined && flag !== '--apply')) throw Error('Usage: node scripts/configure-paid-cadence.mjs <release-plan.json> [--apply]');
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const apply = flag === '--apply';
const root = 'projects/bazaarsignal-510305/locations/us-central1';
const job = `${root}/jobs/firebase-schedule-refreshMarket-us-central1`;
const file = `.local/${plan.releaseId}-cadence-${apply ? 'apply' : 'inspect'}.json`;
const out = { at: new Date().toISOString(), apply, calls: 0, target: PAID_COLLECTION_SCHEDULE };
writeFileSync(file, JSON.stringify(out), { flag: 'wx' });
const save = () => writeFileSync(file, JSON.stringify(out, null, 2));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  const auth = createRequire(import.meta.url)('firebase-tools/lib/auth');
  const account = auth.getAllAccounts().find(a => a.user.email === 'drewstake3@gmail.com');
  if (!account) throw Error('Expected deployment account unavailable');
  const token = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token;
  async function request(url, method = 'GET', body, authenticated = true) {
    if (++out.calls > 14) throw Error('Cadence verification request bound reached');
    save();
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { ...(authenticated ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    if (text.length > 1024 ** 2) throw Error('Cadence response exceeded bound');
    if (!response.ok) throw Error(`Cadence verification HTTP ${response.status}`);
    return JSON.parse(text);
  }
  const scheduleUrl = `https://cloudscheduler.googleapis.com/v1/${job}`;
  const dailyUrl = `https://cloudscheduler.googleapis.com/v1/${root}/jobs/bazaar-daily-close`;
  const budgetUrl = 'https://firestore.googleapis.com/v1/projects/bazaarsignal-510305/databases/(default)/documents/marketCache/paid-budget-october';
  out.before = await request(scheduleUrl);
  verifySchedule(plan, out.before);
  out.dailyBefore = await request(dailyUrl);
  const budget = JSON.parse((await request(budgetUrl)).fields.value.stringValue);
  verifyPaidReleaseBudget(plan, budget);
  if (budget.deployments?.[plan.releaseId]?.imageDigest !== plan.imageDigest) throw Error('Reviewed rollout hold missing');
  out.revisions = {};
  for (const name of ['marketapi','refreshmarket']) {
    const service = await request(`https://run.googleapis.com/v2/${root}/services/${name}`);
    if (service.reconciling || service.latestReadyRevision !== service.latestCreatedRevision ||
        service.terminalCondition?.state !== 'CONDITION_SUCCEEDED' ||
        !service.template.containers[0].image.endsWith(`@${plan.imageDigest}`)) throw Error(`${name} has not completed the cadence rollout`);
    out.revisions[name] = service.latestReadyRevision;
  }
  const prices = await request(`${PAID_MARKET_ORIGIN}/api/companion/portfolio-prices?assets=bz_SUMMONING_EYE`, 'GET', undefined, false);
  if (prices.usage?.pollMs !== PAID_PILOT_INTERVAL || prices.usage?.bazaarMs !== PAID_PILOT_INTERVAL || prices.usage?.mode !== 'normal')
    throw Error('API does not advertise the reviewed 15-minute cadence');
  out.api = { usage: prices.usage, upstreamAt: prices.bazaar?.[0]?.upstreamAt };
  const latestBudget = JSON.parse((await request(budgetUrl)).fields.value.stringValue);
  verifyPaidReleaseBudget(plan, latestBudget); verifyPaidContinuity(budget, latestBudget);
  verifySchedule(plan, await request(scheduleUrl));
  if (apply) {
    out.patch = { schedule: PAID_COLLECTION_SCHEDULE }; save();
    await request(`${scheduleUrl}?updateMask=schedule`, 'PATCH', out.patch);
    out.after = await request(scheduleUrl);
    const expected = { ...scheduleConfiguration(out.before), schedule: PAID_COLLECTION_SCHEDULE };
    verifySchedule({ ...plan, paidSchedule: PAID_COLLECTION_SCHEDULE, scheduleSha256: hash(expected) }, out.after);
    out.dailyAfter = await request(dailyUrl);
    if (hash(scheduleConfiguration(out.dailyBefore)) !== hash(scheduleConfiguration(out.dailyAfter))) throw Error('Daily archive schedule changed');
  }
  out.result = apply ? '15-minute-schedule-verified' : '15-minute-schedule-ready';
} catch (error) { out.error = error.message; throw error; }
finally { out.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ file, result: out.result, error: out.error, calls: out.calls, schedule: out.after?.schedule, state: out.after?.state }, null, 2)); }
