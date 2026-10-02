import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// Offline analysis only. Local work is never presented as measured Google billing.
const file = resolve(process.argv[2] ?? '.local/local-trial-20261001a/report.json');
const r = JSON.parse(readFileSync(file, 'utf8'));
if (!r.finishedAt) throw new Error('Wait for the fixed trial to finish');
const seconds = (Date.parse(r.expiresAt) - Date.parse(r.startsAt)) / 1000;
if (!(seconds > 0 && seconds <= 900)) throw new Error('Invalid trial duration');
const c = r.counters, factor = 31 * 86400 / seconds;
const sum = (rows, field) => rows.reduce((n, x) => n + (x[field] ?? 0), 0);
const paths = [...new Set(r.api.map(x => x.path))].map(path => {
  const rows = r.api.filter(x => x.path === path);
  const gaps = rows.slice(1).map((x, i) => Date.parse(x.at) - Date.parse(rows[i].at)).sort((a,b) => a-b);
  const activeSeconds = (Date.parse(r.expiresAt) - Date.parse(rows[0].at)) / 1000;
  const bytes = sum(rows, 'bytes');
  return { path, requests: rows.length, http200: rows.filter(x => x.status === 200).length,
    http304: rows.filter(x => x.status === 304).length, firstAt: rows[0].at,
    lastAt: rows.at(-1).at, bodyBytes: bytes, activeSeconds,
    medianGapSeconds: gaps.length ? gaps[Math.floor(gaps.length / 2)] / 1000 : null,
    projected31DayBodyBytesIfContinuouslyVisible: bytes * 31 * 86400 / activeSeconds };
});
const upstream = Object.fromEntries([...new Set(r.requests.map(x => x.path.split('?')[0]))]
  .map(path => [path, r.requests.filter(x => x.path.split('?')[0] === path).length]));
const publicationTypes = Object.fromEntries([...new Set(r.publications.map(x => x.key))]
  .map(key => { const rows = r.publications.filter(x => x.key === key); return [key,
    { count: rows.length, compressedBytes: sum(rows,'compressedBytes'), averageCompressedBytes: sum(rows,'compressedBytes') / rows.length }]; }));
const collectorWallSeconds = sum(r.cycles, 'durationMs') / 1000;
const summary = {
  id: r.id, startsAt: r.startsAt, expiresAt: r.expiresAt, finishedAt: r.finishedAt,
  stopReason: r.stopReason, seconds, extrapolationFactor: factor, upstream, publicationTypes, paths,
  measured: { ...c, processCpuSeconds: r.processCpuSeconds, collectorWallSeconds,
    peakResidentBytes: r.peakResidentBytes, googleCollectorOperations: r.googleCollectorOperations },
  projections: {
    assumptions: 'Linear extrapolation of this short local sample; no cloud overhead, billing calibration or later metadata fix. Daily database figures are estimates for a cache adapter with one document read per read/CAS attempt and one write per successful CAS plus snapshot pointer.',
    collectorOpportunitiesPerHour: c.collectorOpportunities * 3600 / seconds,
    collectorOpportunities31Days: c.collectorOpportunities * factor,
    physicalHypixelRequestsPerHour: c.physicalHypixelRequests * 3600 / seconds,
    physicalHypixelRequests31Days: c.physicalHypixelRequests * factor,
    bazaarRefreshesPerHour: c.bazaarRefreshesCompleted * 3600 / seconds,
    auctionRefreshesPerHour: c.auctionsRefreshesCompleted * 3600 / seconds,
    publications31Days: c.changedSnapshotPublications * factor,
    classAWith56OnePageCleanupsDaily31Days: c.changedSnapshotPublications * factor + 56 * 31,
    classAPercentOf5000: (c.changedSnapshotPublications * factor + 56 * 31) / 5000 * 100,
    localCpuSeconds31Days: r.processCpuSeconds * factor,
    collectorWallSeconds31Days: collectorWallSeconds * factor,
    cacheAdapterReadsDaily: (c.logicalCacheReads + c.logicalCasAttempts) * 86400 / seconds,
    cacheAdapterWritesDaily: (c.logicalCommitsSucceeded + c.changedSnapshotPublications) * 86400 / seconds,
    snapshotBytesProduced31Days: c.snapshotCompressedBytes * factor,
    browserBodyBytesAtObservedMixedExposure31Days: c.apiBodyBytes * factor,
    upstreamDecodedBytes31Days: c.upstreamResponseBytes * factor,
    avoidedPublicationsVersusFourPerOpportunityPercent: (1 - c.changedSnapshotPublications / (c.collectorOpportunities * 4)) * 100,
  },
};
const destination = resolve(dirname(file), 'summary.json');
writeFileSync(destination, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
