// Offline validation of freshly captured cloud state. Never creates evidence,
// clears a stop, changes counters, widens access, or starts collection.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { capacityProblems, chooseCadence } from '../collector/capacity-plan';
import { liveInvocationCharge, nextPacificReset } from '../collector/allowance-live';
import { requireExistingBrowserDelivery, requireLiveCapacity } from '../collector/live-activation';
import { PORTFOLIO_COLLECTION_ENABLED } from '../shared/companion/portfolio-policy';

const [stateFile, releaseFile, output] = process.argv.slice(2);
if (!stateFile || !releaseFile || !/^\.local\/[a-z0-9-]+\.json$/.test(output ?? '') || process.argv.length !== 5)
  throw new Error('Usage: validate-activation-readiness <inspection.json> <release-plan.json> .local/<new-report>.json');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const state = read(stateFile), plan = read(releaseFile), now = Date.now();
const ledger = JSON.parse(state.resources?.ledger?.fields?.value?.stringValue ?? 'null');
if (!ledger?.monthlyReserved || !ledger?.dailyReserved) throw new Error('Missing captured ledger');
const hash = createHash('sha256').update(JSON.stringify(ledger)).digest('hex');
const checks: { name: string; passed: boolean; detail: string }[] = [];
const check = (name: string, evaluate: () => string) => {
  try { checks.push({ name, passed: true, detail: evaluate() }); }
  catch (error) { checks.push({ name, passed: false, detail: (error as Error).message }); }
};
check('fresh cloud inspection', () => {
  const at = Date.parse(state.at);
  if (!Number.isFinite(at) || at > now || now - at > 900000 || state.errors?.length)
    throw new Error('Inspection is stale, incomplete or unavailable');
  return state.at;
});
check('deployed image', () => {
  for (const name of ['marketapi', 'refreshmarket']) {
    const service = state.resources[name];
    if (service?.reconciling || service?.terminalCondition?.state !== 'CONDITION_SUCCEEDED' ||
        service.latestCreatedRevision !== service.latestReadyRevision ||
        !service.template?.containers?.[0]?.image.endsWith(`@${plan.imageDigest}`))
      throw new Error(`${name} is not ready on the reviewed image`);
  }
  return plan.imageDigest;
});
check('preserved ledger', () => {
  if (hash !== plan.stoppedLedgerSha256) throw new Error('Ledger changed since the reviewed release');
  return hash;
});
check('scheduler containment', () => {
  if (state.resources.scheduler?.state !== 'PAUSED') throw new Error('Scheduler is not paused');
  return 'PAUSED';
});
check('source collection gate', () => {
  if (!PORTFOLIO_COLLECTION_ENABLED) throw new Error('Deployed preparation source leaves collection disabled');
  return 'Enabled';
});
check('complete capacity evidence', () => {
  const problems = capacityProblems(ledger.capacity, now);
  if (problems.length) throw new Error(problems.join('; '));
  return 'Fresh, complete capacity evidence';
});
check('live allowance admission', () => {
  return requireLiveCapacity(ledger, now).mode;
});
check('browser delivery', () => {
  requireExistingBrowserDelivery(state.resources.marketapiIam ?? {});
  return 'Existing browser access verified';
});
// Report the capacity decision independently of the owner stop. This is an
// arithmetic diagnostic only; it does not remove the stop in memory or storage.
const cadence = chooseCadence(ledger.capacity, { ...ledger, dailyEnd: nextPacificReset(now) },
  liveInvocationCharge('collector', 'bazaar-inline'), liveInvocationCharge('browser'), now);
const report = { at: new Date(now).toISOString(), stateFile, releaseFile,
  activationReady: checks.every(c => c.passed), checks, cadence,
  ledgerSha256: hash, monthlyReserved: ledger.monthlyReserved, dailyReserved: ledger.dailyReserved,
  limitations: 'Inspection timestamps do not renew underlying usage samples. No missing readings, upstream entitlement, or ingress bounds are inferred. No cloud requests or changes were made by this validator.' };
writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ output, ...report }, null, 2));
