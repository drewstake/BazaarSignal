// Offline assessment only: it never uploads, deploys, activates, or renews counters.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { retainedReleaseHolds } from './private-trial-release.mjs';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const directory = process.argv[2];
if (!directory || !resolve(directory).startsWith(resolve('.local/market-image-')))
  throw new Error('Pass the verified local image directory');
const image = read(resolve(directory, 'receipt.json'));
if (!image.localRuntimeSmokeVerified) throw new Error('Verify the local image first');
const measure = read('.local/usage-dashboard-measured.json'), state = read('.local/live-state-latest.json');
const meter = id => {
  const row = measure.rows.find(row => row.id === id);
  if (row?.state !== 'measured' || !Number.isFinite(row.measured)) throw new Error(`Missing ${id} measurement`);
  return row;
};
const cpu = meter('run-cpu');
const paths = readdirSync('.local').filter(name => /^private-release-.*-apply\.json$/.test(name));
const periodStart = new Date(cpu.periodStart).toISOString(), periodEnd = new Date(cpu.periodEnd).toISOString();
const prior = retainedReleaseHolds(paths.map(name => read(resolve('.local', name))), periodStart, periodEnd);
const rows = [
  { resource: 'CPU seconds', measured: cpu.measured, reserved: (prior.cpuSeconds ?? 0) + (state.ledger.monthlyReserved.cpuSeconds ?? 0), rollout: 10000, ceiling: 180000 * .75 },
  { resource: 'GiB seconds', measured: meter('run-memory').measured, reserved: (prior.memoryGiBSeconds ?? 0) + (state.ledger.monthlyReserved.memoryGiBSeconds ?? 0), rollout: 10000, ceiling: 360000 * .75 },
  { resource: 'Retained artifact bytes (conservative full-period holds)', measured: meter('images').measured,
    reserved: prior.artifactBytes ?? 0, rollout: image.artifactStorageHoldBytes, ceiling: .5 * 1024 ** 3 * .75 },
  { resource: 'Log bytes', measured: meter('bazaarsignal-510305-logs').measured,
    reserved: (prior.logBytes ?? 0) + (state.ledger.monthlyReserved.logBytes ?? 0), rollout: 16 * 1024 ** 2, ceiling: 50 * 1024 ** 3 * .75 },
];
const report = { at: new Date().toISOString(), deployable: false, imageDirectory: resolve(directory), imageDigest: image.imageDigest,
  sourceSha256: image.sourceSha256, localImageVerified: true, cloudBuildMinutes: 0,
  periodStart, periodEnd, priorReceiptFiles: paths, priorReservations: prior, rows,
  stoppedLedgerSha256: createHash('sha256').update(JSON.stringify(state.ledger)).digest('hex'),
  blockers: [...rows.filter(row => row.measured + row.reserved + row.rollout >= row.ceiling).map(row => `Retained reservations exceed rollout headroom: ${row.resource}`),
    'Complete historical shared-account consumption and artifact byte-month evidence remain unavailable. Missing series or disabled APIs are not zero usage.'],
  note: 'Measured use, retained reservations and proposed rollout are separate. No holds have been released. This is not an activation plan.' };
const output = `.local/paused-release-assessment-${Date.now()}.json`;
writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ report: output, ...report }, null, 2));
