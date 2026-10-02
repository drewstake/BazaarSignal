// Local evidence calculation only. This produces a planning bound, not a launch
// certificate: scope, reporting delay, post-observation use and eligibility must
// still be checked when assembling fresh whole-trial evidence.
const fs = require('node:fs');
const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const requests = read('.local/trial-firestore-console-2026-10-01T16-20Z.json');
const samples = read('.local/trial-missing-meters-2026-10-01T15-07-07-581Z.json');
const period = read('.local/trial-period-2026-10-01T14-46-59-691Z.json');
const billing = read('.local/trial-billing-console-2026-10-01T14-59Z.json');
if (samples.errors?.length || period.errors?.length ||
    Date.parse(samples.start) !== Date.parse(requests.periodStart) ||
    Date.parse(period.start) !== Date.parse(requests.periodStart)) throw new Error('Evidence periods/errors do not reconcile');
const sizes = Object.entries(samples.metrics).find(([key]) => key.includes('/api/response_sizes'))?.[1];
if (!sizes?.timeSeries?.length || sizes.nextPageToken) throw new Error('Response-size evidence is incomplete');
const byMethod = {};
let responseBytes = 0;
for (const series of sizes.timeSeries) {
  if (series.resource.labels.project_id !== requests.project || series.resource.labels.service !== 'firestore.googleapis.com')
    throw new Error('Unexpected response scope');
  const method = series.resource.labels.method;
  byMethod[method] ??= 0;
  for (const point of series.points) {
    const d = point.value.distributionValue;
    if (!d || !Number.isFinite(Number(d.count)) || !Number.isFinite(d.mean ?? 0) ||
        Date.parse(point.interval.startTime) < Date.parse(requests.periodStart) ||
        Date.parse(point.interval.endTime) > Date.parse(requests.periodEnd)) throw new Error('Invalid response sample');
    byMethod[method] += Number(d.count);
    responseBytes += Number(d.count) * (d.mean ?? 0);
  }
}
for (const method of new Set([...Object.keys(byMethod), ...Object.keys(requests.methodCounts)]))
  if (byMethod[method] !== requests.methodCounts[method]) throw new Error(`Unreconciled non-streaming responses: ${method}`);
const reads = period.metrics['firestore.googleapis.com/document/read_ops_count'];
if (!reads?.timeSeries?.length || reads.nextPageToken) throw new Error('Document read evidence missing');
const operationalReads = reads.timeSeries.reduce((sum, series) => sum + series.points.reduce((n, point) =>
  n + Number(point.value.int64Value ?? point.value.doubleValue), 0), 0);
const postedReads = billing.rows.find(row => row.sku === '6809-9FDE-A3B6')?.usage;
if (!Number.isFinite(operationalReads) || !Number.isFinite(postedReads)) throw new Error('Invalid read totals');
const conservativeReadCount = Math.max(operationalReads, postedReads);
const result = {
  calculatedAt: new Date().toISOString(), project: requests.project,
  periodStart: requests.periodStart, requestCoverageThrough: requests.periodEnd,
  operationalReads, postedReads, conservativeReadCount,
  nonStreamingResponses: Object.values(byMethod).reduce((sum, count) => sum + count, 0),
  nonStreamingResponseBytes: Math.ceil(responseBytes),
  // Google documents a serialized Document maximum below 1 MiB. Reserve another
  // full MiB per read for BatchGet response metadata and pessimistic allowance.
  bytesPerDocumentRead: 2 * 1024 ** 2,
  observedActivityTransferBoundBytes: conservativeReadCount * 2 * 1024 ** 2 + Math.ceil(responseBytes),
  sourceInspection: '.local/deployed-market-source-ZNVcGX/receipt.json',
  sourceFindings: 'Both current deployed artifacts use document get/getAll plus commits. No long-lived Firestore listener or query stream is registered. Non-streaming response coverage is reconciled separately above.',
  limitations: [
    'Conservative bound for observed activity, not a complete fresh baseline certificate.',
    'The read counters are delayed; add verified reporting-lag and post-observation headroom before launch.',
    'Reverify current access scope and any other clients before treating deployed-source inspection as exhaustive.',
    'Counts all covered bytes conservatively even when a same-region transfer would be free.',
    'Does not classify historical charges or establish zero future paid overage.'
  ],
  sources: ['https://cloud.google.com/firestore/pricing', 'https://docs.cloud.google.com/firestore/docs/reference/rpc/google.firestore.v1#document'],
};
const target = '.local/trial-firestore-transfer-bound.json';
fs.writeFileSync(target, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ path: target, ...result }, null, 2));
