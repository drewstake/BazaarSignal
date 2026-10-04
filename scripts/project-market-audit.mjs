import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const state = read(".local/market-audit/state.json"),
  s = state.ledger;
const after = read(".local/market-audit/after.json");
const halfHour = 1_800_000,
  day = 86_400_000;
const first = Math.ceil(Date.parse(state.at) / halfHour) * halfHour;
const slots = Math.max(0, Math.ceil((s.expiresAt - first) / halfHour));
const days = (s.expiresAt - Date.parse(state.at)) / day;
const raw = JSON.parse(
  gunzipSync(readFileSync(".local/zero-cost-backup/bazaar.json.gz")),
);
const bridge = JSON.stringify({ ...raw.data.raw, names: raw.data.names });
const browserBody = after.results[0].bodyBytes / 20;
const bridgeGzip = gzipSync(bridge).length,
  bridgePlain = Buffer.byteLength(bridge);
function projection(n, d, includeExisting = false) {
  const browser = Math.ceil(20 * d),
    worker = Math.ceil(24 * d),
    total = browser + worker,
    cleanups = Math.ceil(d);
  const reservation = {
    collectorInvocations: n,
    browserRequests: total,
    runRequests: n + total,
    cpuSeconds: n * 100 + total * 20,
    memoryGiBSeconds: n * 100 + total * 20,
    hypixelRequests: n * 96,
    snapshotUploads: n * 4,
    storageClassA: n * 4 + cleanups * 4,
    storageClassB: n * 16 + total,
    storageEgressBytes: n * 128 * 1024 ** 2 + total * 8 * 1024 ** 2,
    logBytes: n * 128 * 1024 + total * 16 * 1024,
    cleanupRuns: cleanups,
    storageListPages: cleanups * 4,
  };
  // Uses measured payload sizes; includes the existing 2 KiB per-response hold.
  // Worker frequency stays hourly and is not doubled with collection frequency.
  const egress = (workerBytes) =>
    n * 64 * 1024 +
    browser * (browserBody + 2048) +
    worker * (workerBytes + 2048);
  const projected = Object.fromEntries(
    Object.entries(reservation).map(([k, v]) => [
      k,
      v + (includeExisting ? (s.monthlyReserved[k] ?? 0) : 0),
    ]),
  );
  const baseEgress = includeExisting ? s.monthlyReserved.egressBytes : 0;
  return {
    collections: n,
    days: d,
    browserRequests: browser,
    workerRequests: worker,
    reserved: projected,
    assumedEgressWithGzip: egress(bridgeGzip) + baseEgress,
    assumedEgressWithoutWorkerGzip: egress(bridgePlain) + baseEgress,
    normalUpstream: n * 47 + cleanups,
    larger90PageUpstream: n * 92 + cleanups,
    normalUploadsAndLists: n * 2 + cleanups * 2, // daily changed catalog + one list; unchanged election
    mixedFailure30PercentUpstream:
      Math.ceil(n * (0.7 * 47 + 0.3 * 27)) + cleanups,
    retryStress5PercentUpstream:
      Math.ceil(n * (0.95 * 47 + 0.05 * 96)) + cleanups,
    reservationFailures: Object.entries(projected)
      .filter(([k, v]) => v > s.monthlyLimits[k])
      .map(([k]) => k),
  };
}
const currentPressure = Math.max(
  ...Object.entries(s.monthlyLimits)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => (s.monthlyReserved[k] ?? 0) / v),
  ...Object.entries(s.dailyLimits)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => (s.dailyReserved[k] ?? 0) / v),
);
const report = {
  sourceAt: state.at,
  firstSlot: new Date(first).toISOString(),
  deadline: new Date(s.expiresAt).toISOString(),
  slots,
  days,
  currentPressure,
  sellerReservationPressure:
    s.monthlyReserved.sellerRequests / s.monthlyLimits.sellerRequests,
  assumptions:
    "20 ordinary UI HTTP requests/day plus up to 24 existing hourly worker requests/day; no seller calls, no dashboard costs, no cache-hit credit for reservations. Mixed failures model fewer complete snapshots, not successful refreshes.",
  daily: {
    ...projection(48, 1),
    reservedFirestoreReads: 48 * 700 + 44 * 108,
    reservedFirestoreWrites: 48 * 296 + 44 * 40,
    estimatedNormalReads:
      48 * (after.results[1].steady.firestoreReads + 3) + 44 * 6 + 12,
    estimatedNormalWrites:
      48 * (after.results[1].steady.firestoreWrites + 2) + 44 * 3 + 10,
  },
  full31Days: projection(1488, 31),
  remaining: projection(slots, days, true),
  egressInputs: {
    averageBrowserGzip: browserBody,
    rawWorkerGzip: bridgeGzip,
    rawWorkerPlain: bridgePlain,
  },
  limits: { monthly: s.monthlyLimits, daily: s.dailyLimits },
};
writeFileSync(
  ".local/market-audit/projection.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
