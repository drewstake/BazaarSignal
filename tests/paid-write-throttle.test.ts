import { afterEach, expect, it, vi } from 'vitest';
import { LedgerWriteQueue } from '../collector/ledger-write-queue';
import { errorDiagnostic, isFirestoreWriteThrottle } from '../collector/diagnostics';
import { PAID_BUDGET_KEY } from '../collector/paid-budget';
import { paidRuntimeFixture, snapshotFixture, fixtureTime } from './support/paid-runtime-fixture';

afterEach(() => vi.useRealTimers());
const throttles = ['This database has exceeded their maximum bandwidth for writes',
  'This database has exceeded their maximum request_rate/bandwidth/document_rate for writes, please retry with exponential backoff.'];

it('spaces ledger operations, serializes reads with their CAS writes, and recovers after a rejected write', async () => {
  vi.useFakeTimers();
  const queue = new LedgerWriteQueue(1000), starts: number[] = [];
  const run = (fail = false) => queue.run(async () => {
    starts.push(Date.now());
    if (fail) throw Error('rejected');
    return starts.length;
  });
  const work = Promise.allSettled([run(), run(true), run()]);
  await vi.runAllTimersAsync();
  expect((await work).map(x => x.status)).toEqual(['fulfilled','rejected','fulfilled']);
  expect(starts[1] - starts[0]).toBe(1000);
  expect(starts[2] - starts[1]).toBe(1000);
});

it.each(throttles)('classifies only explicit write-bandwidth rejections as temporary: %s', message => {
  expect(isFirestoreWriteThrottle({code:429,message})).toBe(true);
  expect(isFirestoreWriteThrottle({code:8,message})).toBe(true);
  expect(errorDiagnostic({code:429,message}).reason).toBe('firestore-write-bandwidth');
  for (const error of [{code:429,message:'Quota exhausted'}, {code:429,message:`Quota exhausted: ${message}`}, {code:500,message}, {message}, Error('Timeout')])
    expect(isFirestoreWriteThrottle(error)).toBe(false);
});

it.each(throttles)('a rejected admission returns a retry response without collection or shutdown: %s', async message => {
  const f = paidRuntimeFixture(snapshotFixture('one',fixtureTime,30));
  const network = f.f.config.network;
  f.f.config.network = async (url, init) => String(url).endsWith(':commit')
    ? Response.json({error:{status:'RESOURCE_EXHAUSTED',message}},{status:429})
    : network(url,init);
  const before = f.f.read(PAID_BUDGET_KEY);
  const reply = await f.request();
  expect(reply.status).toBe(503);
  expect(reply.headers['retry-after']).toBe('60');
  expect(reply.body.usage).toMatchObject({mode:'slow',retryAt:fixtureTime+60000});
  expect(f.f.read(PAID_BUDGET_KEY)).toBe(before);
  expect(f.metrics).toMatchObject({snapshotLoads:0,upstreamCalls:0,shutdowns:0});
  f.f.config.network = network;
  expect((await f.request()).status).toBe(200);
  const budget = JSON.parse(f.f.read(PAID_BUDGET_KEY)!);
  expect(budget.reservedUsd).toBeGreaterThan(1);
  expect(budget.limitUsd).toBe(5);
  expect(budget.stopUsd).toBe(4.5);
}, 15000);

it.each(throttles)('a throttled finish retains the entire admitted hold and never stops the scheduler: %s', async message => {
  const f = paidRuntimeFixture(snapshotFixture('one',fixtureTime,30));
  const network = f.f.config.network;
  let commits = 0;
  f.f.config.network = async (url, init) => {
    if (String(url).endsWith(':commit') && ++commits > 1)
      return Response.json({error:{status:'RESOURCE_EXHAUSTED',message}},{status:429});
    return network(url,init);
  };
  expect((await f.request()).status).toBe(200);
  const budget = JSON.parse(f.f.read(PAID_BUDGET_KEY)!);
  expect(budget.reservedUsd).toBeGreaterThan(1);
  expect(f.receipts()).toHaveLength(1);
  expect(f.receipts()[0]).not.toHaveProperty('finished');
  expect(budget.stoppedAt).toBeUndefined();
  expect(f.metrics.shutdowns).toBe(0);
}, 15000);

it('finishes accounting before ending the HTTP response, keeping Cloud Run CPU available', async () => {
  const f = paidRuntimeFixture(snapshotFixture('one',fixtureTime,30));
  let finishedAtEnd = false;
  const res = { headersSent:false, setHeader() {}, writeHead() { this.headersSent=true; return this; },
    end() { finishedAtEnd = f.receipts().length === 1 && f.receipts().every(a => a.finished); } };
  await f.runtime.handle({url:'/api/companion/portfolio-prices?assets=bz_ITEM_0',method:'GET',headers:{}} as any,res as any);
  expect(finishedAtEnd).toBe(true);
  expect(f.metrics.shutdowns).toBe(0);
});

it.each(['collector','history'])('a throttled %s admission leaves both schedules running and performs no upstream work', async kind => {
  const f=paidRuntimeFixture(snapshotFixture('one',fixtureTime,30)), network=f.f.config.network;
  f.f.config.network=async(url,init)=>String(url).endsWith(':commit')
    ? Response.json({error:{status:'RESOURCE_EXHAUSTED',message:throttles[1]}},{status:429}) : network(url,init);
  const before=f.f.read(PAID_BUDGET_KEY);
  await expect(kind==='history'?f.runtime.collectDaily():f.runtime.collect('scheduled-throttle')).rejects.toMatchObject({code:429});
  expect(f.f.read(PAID_BUDGET_KEY)).toBe(before);
  expect(f.metrics).toMatchObject({upstreamCalls:0,shutdowns:0});
},15000);
