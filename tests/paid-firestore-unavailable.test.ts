import { expect, it } from 'vitest';
import { errorDiagnostic, isTransientFirestoreFailure } from '../collector/diagnostics';
import { createPaidRuntime, PAID_BUDGET_KEY } from '../collector/paid-budget';
import { trialGoogleStore } from '../collector/trial-google';
import { paidRuntimeFixture, snapshotFixture, fixtureTime, fixtureEnd } from './support/paid-runtime-fixture';

const unavailable = () => Response.json({ error: { status: 'UNAVAILABLE',
  message: 'The service is temporarily unavailable. Please retry with exponential backoff.' } }, { status: 503 });

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
