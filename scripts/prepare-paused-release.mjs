// Offline assessment only: it never uploads, deploys, activates, or renews counters.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadDeploymentAccounting, deploymentUsed } from './deployment-accounting.mjs';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const directory = process.argv[2], statePath = process.argv[3] ?? '.local/live-state-latest.json';
if (!directory || !resolve(directory).startsWith(resolve('.local/market-image-')))
  throw new Error('Pass the verified local image directory');
const image = read(resolve(directory, 'receipt.json'));
if (!image.localRuntimeSmokeVerified) throw new Error('Verify the local image first');
const measure = read('.local/usage-dashboard-measured.json'), state = read(statePath);
const ledger = state.ledger ?? JSON.parse(state.resources?.ledger?.fields?.value?.stringValue ?? 'null');
if (!Number.isFinite(ledger?.stoppedAt) || !ledger.monthlyReserved) throw new Error('Missing stopped ledger');
const meter = id => measure.rows.find(row => row.id === id);
const cpu = meter('run-cpu');
if (!cpu) throw new Error('Missing accounting period');
const periodStart = new Date(cpu.periodStart).toISOString(), periodEnd = new Date(cpu.periodEnd).toISOString();
const balance = loadDeploymentAccounting(periodStart, periodEnd);
const rows = [
  ['cpuSeconds', 'run-cpu', 'vCPU-seconds', 10000, 180000 * .75],
  ['memoryGiBSeconds', 'run-memory', 'GiB-seconds', 10000, 360000 * .75],
  ['artifactBytes', 'images', 'byte-month equivalents (full-period holds)', image.artifactStorageHoldBytes, .5 * 1024 ** 3 * .75],
  ['logBytes', 'bazaarsignal-510305-logs', 'bytes', 16 * 1024 ** 2, 50 * 1024 ** 3 * .75],
].map(([key, id, unit, rollout, ceiling]) => {
  const m = meter(id), reported = m?.state === 'measured' && Number.isFinite(m.measured) ? m.measured : null;
  // A current storage gauge is never substituted for historical byte-month use.
  const measured = key === 'artifactBytes' ? null : reported;
  const marketReserved = ledger.monthlyReserved[key] ?? 0;
  const priorUsed = deploymentUsed(balance, key, measured ?? 0);
  return { resource:key, unit, reported, reportedAt:m?.measuredAt ?? null, historicalMeasured:balance.observed[key] ?? measured,
    originalRolloutReservations:balance.original[key] ?? 0, unresolvedRolloutReservations:balance.unresolved[key] ?? 0,
    uncertainty:balance.uncertainty[key] ?? 0, marketReserved, rollout, ceiling,
    projected:priorUsed + marketReserved + rollout, withinNumericCeiling:priorUsed + marketReserved + rollout < ceiling };
});
const report = { at: new Date().toISOString(), deployable: false, imageDirectory: resolve(directory), imageDigest: image.imageDigest,
  sourceSha256: image.sourceSha256, localImageVerified: true, cloudBuildMinutes: 0,
  periodStart, periodEnd, deploymentAccounting: balance, rows,
  stoppedLedgerSha256: createHash('sha256').update(JSON.stringify(ledger)).digest('hex'),
  blockers: [...rows.filter(row => !row.withinNumericCeiling).map(row => `Reserved capacity exceeds rollout headroom: ${row.resource}`),
    'This offline assessment is not a fresh complete deployment plan. Refresh scope, retained-resource inventory and bounded remaining-work evidence before rollout.',
    ...(!ledger.capacity ? ['The stopped market ledger has no current capacity plan; settlement cannot activate collection.'] : [])],
  note: 'Evidence-backed settlements count reported usage once and retain explicit uncertainty. Original receipts and market counters are unchanged. Numeric headroom is not an activation grant.' };
const output = `.local/paused-release-assessment-${Date.now()}.json`;
writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ report: output, ...report }, null, 2));
