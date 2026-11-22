import { afterEach, expect, it, vi } from 'vitest';
import { errorDiagnostic, isTransientFirestoreFailure } from '../collector/diagnostics';
import { createPaidRuntime, PAID_BUDGET_KEY } from '../collector/paid-budget';
import { trialGoogleStore } from '../collector/trial-google';
import { paidRuntimeFixture, snapshotFixture, fixtureTime, fixtureEnd } from './support/paid-runtime-fixture';
import { emptyJob } from '../collector/coordinator';

afterEach(() => vi.useRealTimers());

const unavailable = () => Response.json({ error: { status: 'UNAVAILABLE',
  message: 'The service is temporarily unavailable. Please retry with exponential backoff.' } }, { status: 503 });

it.each([
  ['before commit', 2],
  ['after commit', 1],
  ['late commit', 2],
  ['failed verification', 1],
  ['persistent outage', 3],
] as const)('handles a Firestore 503 during scheduled Bazaar publication (%s)', async (scenario, expectedAttempts) => {
    const previousAt = fixtureTime - 900000;
    const f = paidRuntimeFixture(snapshotFixture('previous', previousAt, 1), false, true);
    for (const job of ['catalog', 'election']) f.control.jobs[job] = { ...emptyJob(), nextAt: fixtureTime + 900000 };
    f.f.seed('control', JSON.stringify(f.control));
    let publications = 0, failVerification = false;
    let delayedCommit: (() => Promise<Response>) | undefined;
    const transport: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (failVerification && body.documents?.some((name: string) => name.endsWith('/control'))) {
        failVerification = false;
        return unavailable();
      }
      if (body.writes?.some((w: any) => w.update.name.endsWith('/bazaar'))) {
        publications++;
        if (scenario === 'persistent outage') return unavailable();
        if (publications === 1) {
          if (scenario === 'late commit') delayedCommit = () => f.f.network(url, init);
          if (scenario === 'after commit' || scenario === 'failed verification') await f.f.network(url, init);
          failVerification = scenario === 'failed verification';
          return unavailable();
        }
        if (delayedCommit) await delayedCommit();
      }
      return f.f.network(url, init);
    };
    const upstream = vi.fn(async () => Response.json({ success: true, lastUpdated: fixtureTime,
      products: { ITEM_0: { buy_summary: [{ amount: 8, orders: 2, pricePerUnit: 123 }],
        sell_summary: [{ amount: 3, orders: 1, pricePerUnit: 110 }] } } }));
    const shutdown = vi.fn(async () => {});
    const runtime = createPaidRuntime({ continuous: true, expiresAt: 0, now: () => fixtureTime, network: upstream,
      store: session => trialGoogleStore({ ...f.f.config, network: transport, inlineSmallSnapshots: true, recordTrends: true }, session),
      shutdown });

    await runtime.collect('scheduled-slot');
    const prices = await f.request('/api/companion/portfolio-prices?assets=bz_ITEM_0', 'GET', runtime);
    expect(prices.status).toBe(200);
    const missed = scenario === 'persistent outage';
    expect(publications).toBe(expectedAttempts);
    expect(f.f.counts.casConflicts ?? 0).toBe(scenario === 'late commit' ? 1 : 0);
    expect(prices.body.bazaar[0].upstreamAt).toBe(missed ? previousAt : fixtureTime);
    expect(prices.body.bazaar[0].asks[0].pricePerUnit).toBe(missed ? 110 : 123);
    expect(prices.body.error).toBe(missed ? 'The latest market update was delayed. Collection will retry automatically.' : null);
    expect(JSON.parse(f.f.read('control')!).jobs.bazaar.upstreamAt).toBe(prices.body.bazaar[0].upstreamAt);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(shutdown).not.toHaveBeenCalled();
  }, 15000);

it('only treats identified Firestore unavailability as temporary', () => {
  expect(isTransientFirestoreFailure({ service: 'firestore', code: 503 })).toBe(true);
  expect(isTransientFirestoreFailure({ service: 'firestore', code: 14 })).toBe(true);
  expect(errorDiagnostic({ service: 'firestore', code: 503 }).reason).toBe('firestore-unavailable');
  for (const error of [{code:503}, {service:'pubsub',code:503}, ...[401,403,429,500,504].map(code=>({service:'firestore',code})), Error('Paid release expired')])
    expect(isTransientFirestoreFailure(error)).toBe(false);
});

it.each(['read','admission','ambiguous-admission','finish','ambiguous-finish'] as const)(
  'defers a Firestore %s outage without shutdown or replay and recovers on the next read', async phase => {
    const f = paidRuntimeFixture(snapshotFixture('one',fixtureTime,30));
    const network=f.f.config.network;
    const before=JSON.parse(f.f.read(PAID_BUDGET_KEY)!);
    let commits=0, failures=0;
    f.f.config.network=async(url,init)=>{
      const commit=String(url).endsWith(':commit');
      if(commit)commits++;
      const fail=phase==='read' ? String(url).endsWith(':batchGet')
        : commit && (phase.includes('finish') ? commits===2 : commits===1);
      if(fail){ failures++; if(phase.startsWith('ambiguous'))await network(url,init); return unavailable(); }
      return network(url,init);
    };
    const reply=await f.request();
    expect(failures).toBe(1);
    expect(f.metrics.shutdowns).toBe(0);expect(f.metrics.upstreamCalls).toBe(0);
    expect(commits).toBe(phase==='read'?0:phase.includes('finish')?2:1);
    const after=JSON.parse(f.f.read(PAID_BUDGET_KEY)!);
    expect(after.stoppedAt).toBeUndefined();
    expect(after.limitUsd).toBe(before.limitUsd);expect(after.stopUsd).toBe(before.stopUsd);
    if(phase.includes('finish')||phase==='ambiguous-admission') {
      expect(after.reservedUsd).toBeGreaterThan(before.reservedUsd);
      expect(f.receipts()).toHaveLength(1);
      expect(!!f.receipts()[0].finished).toBe(phase==='ambiguous-finish');
    } else expect(after).toEqual(before);
    if(phase.includes('finish'))expect(reply.status).toBe(200);
    else {
      expect(reply.status).toBe(503);expect(reply.headers['retry-after']).toBe('60');
      expect(reply.body.usage).toMatchObject({mode:'slow',retryAt:fixtureTime+60000,expiresAt:fixtureEnd});
      expect(f.metrics.snapshotLoads).toBe(0);
    }
    f.f.config.network=network;
    expect((await f.request()).status).toBe(200);
    const recovered=JSON.parse(f.f.read(PAID_BUDGET_KEY)!);
    expect(recovered.reservedUsd).toBeGreaterThan(after.reservedUsd);
    expect(recovered.stoppedAt).toBeUndefined();
  });

it.each(['collector','history'] as const)('an unavailable %s admission does no upstream work or shutdown', async kind=>{
  const f=paidRuntimeFixture(snapshotFixture('one',fixtureTime,30)),network=f.f.config.network;
  let commits=0;
  f.f.config.network=async(url,init)=>String(url).endsWith(':commit')?(commits++,unavailable()):network(url,init);
  const before=f.f.read(PAID_BUDGET_KEY);
  await expect(kind==='collector'?f.runtime.collect('unavailable'):f.runtime.collectDaily()).rejects.toMatchObject({code:503,service:'firestore'});
  expect(commits).toBe(1);expect(f.f.read(PAID_BUDGET_KEY)).toBe(before);
  expect(f.metrics).toMatchObject({upstreamCalls:0,shutdowns:0});
});

it('does not collect twice when an admission committed before its 503 response', async()=>{
  const f=paidRuntimeFixture(snapshotFixture('one',fixtureTime,30)),network=f.f.config.network;
  let commits=0;
  f.f.config.network=async(url,init)=>{
    const result=await network(url,init);
    if(String(url).endsWith(':commit')){commits++;return unavailable();}
    return result;
  };
  await expect(f.runtime.collect('uncertain-scheduled-slot')).rejects.toMatchObject({code:503});
  expect(commits).toBe(1);const held=f.f.read(PAID_BUDGET_KEY);
  f.f.config.network=network;
  await f.runtime.collect('uncertain-scheduled-slot');
  expect(f.f.read(PAID_BUDGET_KEY)).toBe(held);
  expect(f.receipts()).toHaveLength(1);expect(f.receipts()[0].finished).toBeUndefined();
  expect(f.metrics).toMatchObject({upstreamCalls:0,shutdowns:0});
});

it.each([401,403,429,500])('preserves terminal handling for provider status %s', async status=>{
  // GoogleCacheStore advances the observed server clock with Date.now(). Keep
  // that clock fixed for this exact timestamp assertion on every runner.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(fixtureTime);
  const f=paidRuntimeFixture(snapshotFixture('one',fixtureTime,30)),network=f.f.config.network;
  let commits=0;
  f.f.config.network=async(url,init)=>{
    if(String(url).endsWith(':commit')&&++commits===1)
      return Response.json({error:{message:status===429?'Quota exceeded':'Provider failure'}},{status});
    return network(url,init);
  };
  await expect(f.runtime.collect('terminal')).rejects.toMatchObject({code:status});
  expect(f.metrics.shutdowns).toBe(1);expect(f.metrics.upstreamCalls).toBe(0);
  expect(JSON.parse(f.f.read(PAID_BUDGET_KEY)!).stoppedAt).toBe(fixtureTime);
});

it('a billing save outage leaves the message unacknowledged and does not admit collection or write again', async()=>{
  const f=paidRuntimeFixture(snapshotFixture('one',fixtureTime,30)),network=f.f.config.network;
  const billing={accountId:'012803-EA91BE-8DCD32',budgetId:'budget-test',subscription:'projects/bazaarsignal-510305/subscriptions/bazaar-paid-spend-october',scope:'test',intervalStart:Date.parse('2026-10-01T07:00:00Z')};
  const budget=JSON.parse(f.f.read(PAID_BUDGET_KEY)!);budget.billing=billing;f.f.seed(PAID_BUDGET_KEY,JSON.stringify(budget));
  let commits=0,acknowledged=false,shutdowns=0;
  f.f.config.network=async(url,init)=>String(url).endsWith(':commit')?(commits++,unavailable()):network(url,init);
  const runtime=createPaidRuntime({expiresAt:fixtureEnd,now:()=>fixtureTime,
    store:session=>trialGoogleStore(f.f.config,session),shutdown:async()=>{shutdowns++;},
    billingFeed:async(_billing,save)=>{await save([]);acknowledged=true;},
    network:async()=>{throw Error('No upstream request allowed');}});
  await expect(runtime.collect('billing-outage')).rejects.toMatchObject({code:503});
  expect(commits).toBe(1);expect(acknowledged).toBe(false);expect(shutdowns).toBe(0);
  expect(JSON.parse(f.f.read(PAID_BUDGET_KEY)!)).toEqual(budget);
});
