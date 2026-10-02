import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { SqliteCache, type CacheStore } from '../collector/cache-store';
import { MarketCollector } from '../collector/engine';
import { defaultPolicy } from '../collector/policy';
import { marketHandler } from '../collector/routes';
import { TrialStopped, CLEANUP_INTERVAL_MS } from '../collector/trial';

// Deliberately bypass configuredStore: this operator command must never select
// Redis, Firestore, Storage, credentials, a cloud deployment or a cloud scheduler.
const planPath = process.argv[2];
if (!planPath) throw new Error('Supply a fixed local trial plan; no automatic deadline creation or extension');
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const start = Date.parse(plan.startsAt), end = Date.parse(plan.expiresAt);
if (!/^local-trial-[a-zA-Z0-9_-]+$/.test(plan.id) || !Number.isFinite(start + end) ||
    end <= start || end - start > 900000 || Date.now() >= end || plan.port !== 8789)
  throw new Error('Invalid or expired local-only trial plan');
const dir = resolve('.local', plan.id); mkdirSync(dir, { recursive: true });
const cachePath = resolve(plan.cacheFile ?? '.local/current-market.sqlite');
if (!cachePath.startsWith(resolve('.local') + sep)) throw new Error('Local cache must stay inside the workspace .local directory');
const reportFile = resolve(dir, 'report.json');
const durable = new SqliteCache(resolve(dir, 'admission.sqlite'));
const cache = new SqliteCache(cachePath);
const stopSignal = new AbortController();
let ending = false, running = false, timer: ReturnType<typeof setTimeout> | undefined;
const report: any = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : {
  id: plan.id, startsAt: plan.startsAt, expiresAt: plan.expiresAt, platform: `${process.platform}/${process.arch} Node ${process.version}`,
  source: 'Live public Hypixel responses, local SQLite and loopback browser requests. No Google collector RPCs.',
  counters: {}, requests: [], cycles: [], publications: [], cleanups: [], api: [],
};
if (report.expiresAt !== plan.expiresAt || report.finishedAt) throw new Error('Local trial cannot restart or extend a completed run');
const count = (name: string, n = 1) => { report.counters[name] = (report.counters[name] ?? 0) + n; };
const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2));
const cpuStart = process.cpuUsage(), wallStart = Date.now();
function assertOpen() {
  if (ending || Date.now() < start || Date.now() >= end) throw new TrialStopped('Local measurement window is closed');
}
async function reserve(kind: 'upstream' | 'browser' | 'collector', slot?: number) {
  assertOpen();
  const maximum = { upstream: 600, browser: 180, collector: Math.ceil((end - start) / 30000) }[kind];
  for (let i = 0; i < 20; i++) {
    const raw = await durable.read('admission');
    const state = raw ? JSON.parse(raw) : { id: plan.id, end, counts: {}, slots: [] };
    if (state.id !== plan.id || state.end !== end || state.stoppedAt) throw new TrialStopped('Durable local admission closed');
    if (slot !== undefined && state.slots.includes(slot)) return false;
    if ((state.counts[kind] ?? 0) >= maximum) throw new TrialStopped(`Local ${kind} limit reached`);
    state.counts[kind] = (state.counts[kind] ?? 0) + 1;
    if (slot !== undefined) state.slots.push(slot);
    if (await durable.commit('admission', raw, JSON.stringify(state))) return true;
  }
  throw new TrialStopped('Local admission contention did not settle');
}
// Logical cache operations and candidate gzip objects are measured locally.
// Their Google RPC equivalents are projections, not cloud billing counters.
const store: CacheStore = {
  read: async key => { count('logicalCacheReads'); return cache.read(key); },
  commit: async (key, old, value, payload) => {
    count('logicalCasAttempts');
    const ok = await cache.commit(key, old, value, payload);
    count(ok ? 'logicalCommitsSucceeded' : 'logicalCasConflicts');
    if (ok && payload) {
      const compressed = gzipSync(Buffer.from(payload.value));
      const hash = createHash('sha256').update(compressed).digest('hex');
      writeFileSync(resolve(dir, `${payload.key}-${hash}.json.gz`), compressed);
      report.publications.push({ at: new Date().toISOString(), key: payload.key, sha256: hash,
        uncompressedBytes: Buffer.byteLength(payload.value), compressedBytes: compressed.length });
      count('changedSnapshotPublications'); count('snapshotCompressedBytes', compressed.length);
      count('snapshotUncompressedBytes', Buffer.byteLength(payload.value));
    }
    return ok;
  },
  close: () => cache.close(),
};
const network: typeof fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      !['api.hypixel.net', 'sessionserver.mojang.com'].includes(url.hostname))
    throw new TrialStopped('Only the two existing public upstream hosts are allowed; Google calls are forbidden');
  await reserve('upstream');
  count(url.hostname === 'api.hypixel.net' ? 'physicalHypixelRequests' : 'physicalSellerRequests');
  const attempt: any = { at: new Date().toISOString(), host: url.hostname, path: url.pathname + url.search };
  report.requests.push(attempt); save();
  const began = Date.now();
  try {
    const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.any([
      stopSignal.signal, AbortSignal.timeout(12000), ...(options.signal ? [options.signal] : []),
    ]) });
    attempt.status = response.status;
    attempt.headers = Object.fromEntries(['cache-control','age','ratelimit-limit','ratelimit-remaining','ratelimit-reset','retry-after','cf-ray']
      .map(name => [name, response.headers.get(name)]));
    const chunks: Uint8Array[] = [], reader = response.body?.getReader(); let bytes = 0;
    if (reader) try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        assertOpen(); bytes += next.value.byteLength;
        count('upstreamResponseBytes', next.value.byteLength);
        if (bytes > 16 * 1024 ** 2 || report.counters.upstreamResponseBytes > 2 * 1024 ** 3) {
          await reader.cancel(); throw new TrialStopped('Local response byte limit reached');
        }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    attempt.decodedBytes = bytes;
    return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (e: any) { attempt.error = e.message; throw e; }
  finally { attempt.durationMs = Date.now() - began; save(); }
};
const collector = new MarketCollector(store, defaultPolicy, network, Date.now, Math.random, count);
const handler = marketHandler(collector, async (req, res, status, body) => {
  const payload = body === undefined ? '' : JSON.stringify({ ...body as object,
    usage: { mode: 'normal', pollMs: 20000, expiresAt: end, trialId: plan.id } });
  const etag = `"${createHash('sha256').update(payload).digest('hex')}"`;
  const unchanged = status === 200 && req.headers['if-none-match'] === etag;
  const gzip = !unchanged && payload && /\bgzip\b/.test(String(req.headers['accept-encoding']));
  const bytes = unchanged ? Buffer.alloc(0) : gzip ? gzipSync(payload) : Buffer.from(payload);
  if (status === 200) res.setHeader('ETag', etag);
  if (gzip) res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Content-Length', bytes.length);
  res.setHeader('Vary', 'Origin, Accept-Encoding');
  count('apiBodyBytes', bytes.length); count(`apiHttp${unchanged ? 304 : status}`);
  report.api.push({ at: new Date().toISOString(), path: req.url?.split('?')[0], status: unchanged ? 304 : status, bytes: bytes.length });
  res.writeHead(unchanged ? 304 : status).end(bytes); save();
});
const webRoot = resolve('.local/local-trial-web');
const server = createServer(async (req, res) => {
  try {
    if (req.url?.startsWith('/api/')) {
      await reserve('browser'); count('browserRequests');
      await handler(req, res); return;
    }
    // Static same-origin UI only. Never proxy Firebase or another remote origin.
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    const file = resolve(webRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(webRoot + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' } as any)[extname(file)] ?? 'application/octet-stream');
    // Local trial UI cannot send traffic to Firebase/Apps Script/Google services.
    res.setHeader('Content-Security-Policy', "connect-src 'self'; img-src 'self' data: https:; object-src 'none'");
    res.writeHead(200).end(readFileSync(file));
  } catch (e: any) {
    if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({
      error: 'Local measurement paused', usage: { mode: 'paused', pollMs: 0, trialId: plan.id, expiresAt: end } }));
    if (e instanceof TrialStopped && Date.now() >= start) void finish(e.message);
  }
});
async function cycle() {
  if (ending) return;
  if (Date.now() >= end) { await finish('Fixed local deadline reached'); return; }
  const slot = Math.floor((Date.now() - start) / 30000);
  if (slot >= 0 && !running) {
    running = true;
    try {
      if (await reserve('collector', slot)) {
        const began = Date.now(), before = report.counters.physicalHypixelRequests ?? 0;
        count('collectorOpportunities');
        await collector.tick();
        const control = await collector.coordinator.state();
        const cycle = { slot, at: new Date(began).toISOString(), durationMs: Date.now() - began,
          physicalHypixelRequests: (report.counters.physicalHypixelRequests ?? 0) - before,
          jobs: control.jobs, rateLimit: control.header, sharedLifetimeRequests: control.totalRequests };
        report.cycles.push(cycle);
        // Count the prospective cleanup listing without deleting any data. Only
        // this trial's local archive is scanned; current SQLite data is retained.
        const previous = await durable.read('cleanup');
        if (!previous && await durable.commit('cleanup', null, JSON.stringify({ nextAt: began + CLEANUP_INTERVAL_MS }))) {
          report.cleanups.push({ at: new Date().toISOString(), candidateObjects: report.publications.length,
            estimatedCloudListPages: Math.max(1, Math.ceil(report.publications.length / 1000)),
            retainedAll: true, reason: 'Local measurement preserves artifacts; no Cloud Storage delete/list occurred' });
          count('cleanupOpportunities');
        }
        save(); console.log(JSON.stringify({ slot, durationMs: cycle.durationMs, physicalHypixelRequests: cycle.physicalHypixelRequests,
          published: report.counters.changedSnapshotPublications ?? 0, deadline: plan.expiresAt }));
      }
    } catch (e: any) { report.error = e.message; await finish(e.message); }
    finally { running = false; }
  }
  if (!ending) timer = setTimeout(cycle, Math.max(50, Math.min(1000, start > Date.now() ? start - Date.now() : 1000)));
}
async function finish(reason: string) {
  if (ending) return;
  ending = true; clearTimeout(timer); stopSignal.abort(new TrialStopped(reason));
  for (let i = 0; i < 20; i++) {
    const old = await durable.read('admission'), state = old ? JSON.parse(old) : { id: plan.id, end, counts: {} };
    state.stoppedAt ??= Date.now(); state.reason ??= reason;
    if (await durable.commit('admission', old, JSON.stringify(state))) break;
  }
  const cpu = process.cpuUsage(cpuStart);
  report.finishedAt = new Date().toISOString(); report.stopReason = reason;
  report.processCpuSeconds = (cpu.user + cpu.system) / 1e6; report.processWallSeconds = (Date.now() - wallStart) / 1000;
  report.peakResidentBytes = process.resourceUsage().maxRSS * 1024;
  report.googleCollectorOperations = 0; report.googleCollectorCharge = 0;
  save(); console.log(JSON.stringify({ finishedAt: report.finishedAt, reason, reportFile, counters: report.counters }));
  server.close(); server.closeAllConnections();
  // All network is aborted immediately; pending callbacks may finish recording.
  setTimeout(() => { save(); process.exit(0); }, 1000);
}
server.listen(plan.port, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${plan.port}`, startsAt: plan.startsAt, expiresAt: plan.expiresAt, reportFile })));
server.on('error', error => { console.error(error.message); void finish('Local server failed'); });
process.on('SIGINT', () => void finish('Operator interrupted local trial'));
process.on('SIGTERM', () => void finish('Operator stopped local trial'));
setTimeout(() => void finish('Fixed local deadline reached'), Math.max(0, end - Date.now()));
save(); void cycle();
