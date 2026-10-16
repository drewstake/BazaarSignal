import { afterEach, expect, it, vi } from 'vitest';
import { LedgerWriteQueue } from '../collector/ledger-write-queue';
import { isFirestoreWriteThrottle } from '../collector/diagnostics';
import { PAID_BUDGET_KEY } from '../collector/paid-budget';
import { paidRuntimeFixture, snapshotFixture, fixtureTime } from './support/paid-runtime-fixture';

afterEach(() => vi.useRealTimers());

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

it('classifies only explicit write-bandwidth rejections as temporary', () => {
  const message = 'This database has exceeded their maximum bandwidth for writes';
  expect(isFirestoreWriteThrottle({code:429,message})).toBe(true);
  expect(isFirestoreWriteThrottle({code:8,message})).toBe(true);
  for (const error of [{code:429,message:'Quota exhausted'}, {code:500,message}, {message}, Error('Timeout')])
    expect(isFirestoreWriteThrottle(error)).toBe(false);
});

it('a rejected admission returns a retry response without collection, snapshot reads, or a global shutdown', async () => {
  const f = paidRuntimeFixture(snapshotFixture('one',fixtureTime,30));
  const network = f.f.config.network;
  f.f.config.network = async (url, init) => String(url).endsWith(':commit')
    ? Response.json({error:{status:'RESOURCE_EXHAUSTED',message:'This database has exceeded their maximum bandwidth for writes'}},{status:429})
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
});

it('a throttled finish retains the entire admitted hold and never stops the scheduler', async () => {
  const f = paidRuntimeFixture(snapshotFixture('one',fixtureTime,30));
  const network = f.f.config.network;
  let commits = 0;
  f.f.config.network = async (url, init) => {
    if (String(url).endsWith(':commit') && ++commits > 1)
      return Response.json({error:{status:'RESOURCE_EXHAUSTED',message:'This database has exceeded their maximum bandwidth for writes'}},{status:429});
    return network(url,init);
  };
  expect((await f.request()).status).toBe(200);
  const budget = JSON.parse(f.f.read(PAID_BUDGET_KEY)!);
  expect(budget.reservedUsd).toBeGreaterThan(1);
  expect(Object.values(budget.admissions)).toHaveLength(1);
  expect(Object.values(budget.admissions)[0]).not.toHaveProperty('finished');
  expect(budget.stoppedAt).toBeUndefined();
  expect(f.metrics.shutdowns).toBe(0);
});
