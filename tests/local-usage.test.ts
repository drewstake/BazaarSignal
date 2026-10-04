import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalUsageReport, readOnlyUsageNetwork, measureReadOnlyUsage } from '../server/local-usage';
import { MEASUREMENT_TTL } from '../collector/usage-dashboard';
import type { UsageDashboard } from '../shared/usage-dashboard';

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, {recursive: true, force: true}); });
const start = Date.parse('2026-10-04T18:00:00Z');
const snapshot = (at: number) => ({generatedAt: at, nextMeasurementAt: at + MEASUREMENT_TTL, rows: [],
  spending: {state: 'unavailable', month: null, total: null}, collection: {state: 'Paused', scheduler: 'PAUSED', measuredAt: at},
}) as UsageDashboard;
async function fixture(saved?: UsageDashboard) {
  const dir = await mkdtemp(join(tmpdir(), 'bazaarsignal-usage-')); directories.push(dir);
  const paths = {path: join(dir, 'cache.sqlite'), legacyPath: join(dir, 'saved.json')};
  if (saved) await writeFile(paths.legacyPath, JSON.stringify(saved));
  return paths;
}

it('refreshes old local reports, preserves source times and unknown billing, and shares a slot across tabs and restarts', async () => {
  const paths = await fixture(snapshot(start - 86400000)); let time = start;
  const measure = vi.fn(async () => snapshot(time));
  const options = {...paths, now: () => time, measure};
  const report = createLocalUsageReport(options);
  const results = await Promise.all(Array.from({length: 20}, () => report()));
  expect(measure).toHaveBeenCalledOnce();
  for (const result of results) {
    expect(result.stale).toBe(false);
    expect(result.generatedAt).toBe(start);
    expect(result.collection.scheduler).toBe('PAUSED');
    expect(result.spending.total).toBeNull();
  }
  time += 60001;
  const restarted = await createLocalUsageReport(options)();
  expect(restarted.generatedAt).toBe(start);
  expect(restarted.nextMeasurementAt).toBe(start + MEASUREMENT_TTL);
  expect(measure).toHaveBeenCalledOnce();
  time = start + MEASUREMENT_TTL;
  expect((await report()).stale).toBe(false);
  expect(measure).toHaveBeenCalledTimes(2);
});

it('does not remeasure a fresh saved report or claim missing source samples have refreshed', async () => {
  const saved = {...snapshot(start), rows: [{id: 'sample', state: 'unavailable', measured: null, measuredAt: null} as any]};
  const paths = await fixture(saved), measure = vi.fn();
  const result = await createLocalUsageReport({...paths, now: () => start + 10000, measure})();
  expect(measure).not.toHaveBeenCalled();
  expect(result.stale).toBe(false);
  expect(result.rows[0].measuredAt).toBeNull();
});

it('durably retains failed slots and the stale report without retimestamping or retrying on restart', async () => {
  const saved = snapshot(start - 86400000), paths = await fixture(saved);
  const measure = vi.fn(async () => { throw new Error('credentials unavailable'); });
  const options = {...paths, now: () => start, measure};
  const result = await createLocalUsageReport(options)();
  expect(result.stale).toBe(true);
  expect(result.generatedAt).toBe(saved.generatedAt);
  expect(result.nextMeasurementAt).toBe(saved.nextMeasurementAt);
  expect(result.localNextAttemptAt).toBe(start + MEASUREMENT_TTL);
  expect(result.localReport).toContain('previous report');
  expect((await createLocalUsageReport(options)()).stale).toBe(true);
  expect(measure).toHaveBeenCalledOnce();
});

it('a failure without any report stays unavailable and cannot immediately retry', async () => {
  const paths = await fixture(), measure = vi.fn(async () => { throw new Error('offline'); });
  const options = {...paths, now: () => start, measure};
  await expect(createLocalUsageReport(options)()).rejects.toThrow('reserved refresh slot');
  await expect(createLocalUsageReport(options)()).rejects.toThrow('reserved refresh slot');
  expect(measure).toHaveBeenCalledOnce();
});

it('independent local readers cannot oversubscribe a measurement slot', async () => {
  const paths = await fixture(snapshot(start - 86400000));
  const measure = vi.fn(async () => snapshot(start));
  const options = {...paths, now: () => start, measure};
  const results = await Promise.all(Array.from({length: 12}, () => createLocalUsageReport(options)()));
  expect(measure).toHaveBeenCalledOnce();
  expect(results.some(result => result.generatedAt === start)).toBe(true);
});

it('blocks cloud writes, collection, foreign destinations and unbounded reporting calls', async () => {
  const network = vi.fn(async () => new Response('{}')), read = readOnlyUsageNetwork(network);
  for (const [url, init] of [
    ['https://firestore.googleapis.com/v1/documents', {method: 'PATCH'}],
    ['https://cloudscheduler.googleapis.com/v1/jobs:run', {method: 'POST'}],
    ['https://api.hypixel.net/v2/skyblock/bazaar', {}],
    ['https://example.test', {}],
    ['http://monitoring.googleapis.com/v3/projects', {}],
  ] as const) await expect(read(url, init)).rejects.toThrow('Read-only');
  expect(network).not.toHaveBeenCalled();
  for (let i = 0; i < 32; i++) await read('https://monitoring.googleapis.com/v3/projects');
  await expect(read('https://monitoring.googleapis.com/v3/projects')).rejects.toThrow('limit');
  expect(network).toHaveBeenCalledTimes(32);
  expect(network.mock.calls.every(call => (call as any)[1].redirect === 'error')).toBe(true);
});

it('reads the real reporting document paths with GET and keeps the ledger reservations separate from measured use', async () => {
  const network = vi.fn(async (url: any, init: any) => {
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer offline');
    return new Response(JSON.stringify(String(url).endsWith('/marketCache/live-allowance') ? {
      fields: {value: {stringValue: JSON.stringify({monthlyReserved: {cpuSeconds: 110}, expiresAt: start})}},
    } : String(url).endsWith('/marketCache/control') ? {fields: {value: {stringValue: '{}'}}}
      : String(url).includes('cloudscheduler') ? {jobs: [{name: '/firebase-schedule-refreshMarket-us-central1', state: 'PAUSED'}]} : {}));
  });
  const report = await measureReadOnlyUsage('offline', network);
  expect(report.collection.state).toBe('Paused');
  expect(report.collection.reviewAt).toBe(start);
  expect(report.rows.find(row => row.id === 'run-cpu')).toMatchObject({reservation: 110, measured: null});
  expect(network.mock.calls.length).toBeLessThanOrEqual(32);
});
