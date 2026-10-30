import { expect, it } from 'vitest';
import { PaidLedger, PAID_BUDGET_KEY, validatePaid } from '../collector/paid-budget';
import { paidReceiptKey, PAID_RECEIPT_LIMIT } from '../collector/paid-ledger-storage';
import { trialGoogleStore } from '../collector/trial-google';
import { BILLING_ACCOUNT_ID, BILLING_INTERVAL_START, BILLING_SUBSCRIPTION } from '../shared/paid-spending';
import { fixtureTime, paidRuntimeFixture, snapshotFixture } from './support/paid-runtime-fixture';

const fixture = () => paidRuntimeFixture(snapshotFixture('one', fixtureTime, 1));
const read = (f: ReturnType<typeof fixture>) => JSON.parse(f.f.read(PAID_BUDGET_KEY)!);
function reportedBilling(f: ReturnType<typeof fixture>) {
  const budget = read(f);
  budget.billing = { accountId: BILLING_ACCOUNT_ID, budgetId: 'offline-budget', subscription: BILLING_SUBSCRIPTION,
    scope: 'Offline fixture', intervalStart: BILLING_INTERVAL_START,
    latest: { actualUsd: 0, publishedAt: fixtureTime - 1000, receivedAt: fixtureTime, intervalStart: BILLING_INTERVAL_START } };
  f.f.seed(PAID_BUDGET_KEY, JSON.stringify(budget));
}

it('reads a legacy ledger beyond 128 KiB, preserves every old hold and stops growing its inline receipts', async () => {
  const f = fixture(), before = read(f);
  before.admissions = Object.fromEntries(Array.from({length:1200}, (_, i) =>
    [`firebase-schedule-refreshMarket-us-central1:${'x'.repeat(80)}-${i}`, {at:fixtureTime - 1000, finished:i % 2 === 0}]));
  before.observed = { firestoreReads: 12345 };
  const raw = JSON.stringify(before);
  expect(Buffer.byteLength(raw)).toBeGreaterThan(128 * 1024);
  f.f.seed(PAID_BUDGET_KEY, raw);
  expect((await f.request('/api/companion/status')).status).toBe(200);
  const after = read(f);
  expect(after).toMatchObject({version:2,admissionCount:1201,expiresAt:before.expiresAt,legacyLedgerSha256:before.legacyLedgerSha256});
  expect(after.admissions).toEqual(before.admissions);
  expect(after.reservedUsd).toBeGreaterThan(before.reservedUsd);
  expect(after.observed.firestoreReads).toBeGreaterThanOrEqual(12345);
  expect(f.receipts()).toMatchObject([{finished:true}]);
  expect(f.metrics.shutdowns).toBe(0);
  const ledger = new PaidLedger(trialGoogleStore(f.f.config), () => fixtureTime);
  const unfinished = Object.keys(before.admissions)[1];
  expect(await ledger.admit('browser', unfinished)).toBeNull();
  await ledger.finish(before.id, unfinished, {runRequests:1});
  await ledger.finish(before.id, unfinished, {runRequests:1});
  expect(read(f).observed.runRequests).toBe(1);
  expect(read(f).admissions[unfinished].finished).toBe(true);
});

it('fits all 4000 maximum-length invocation IDs without growing the accounting document, and retains the cap', async () => {
  const f = fixture(); reportedBilling(f);
  const store = trialGoogleStore(f.f.config), ledger = new PaidLedger(store, () => fixtureTime);
  const id = (i: number) => `request-${String(i).padStart(4,'0')}-${'x'.repeat(237)}`;
  expect(id(0)).toHaveLength(250);
  for (let i = 0; i < 4000; i++) {
    const session = await ledger.admit('browser', id(i));
    expect(session).not.toBeNull();
    await session!.finish();
  }
  const raw = f.f.read(PAID_BUDGET_KEY)!;
  expect(Buffer.byteLength(raw)).toBeLessThan(8192);
  expect(read(f)).toMatchObject({version:2,admissionCount:4000,admissions:{}});
  expect(f.receipts()).toHaveLength(4000);
  expect(f.receipts().every(r => r.finished && Buffer.byteLength(JSON.stringify(r)) <= PAID_RECEIPT_LIMIT)).toBe(true);
  expect(await ledger.admit('browser', id(0))).toBeNull();
  await expect(ledger.admit('browser', 'one-too-many')).rejects.toThrow('request limit');
  expect(f.f.read(PAID_BUDGET_KEY)).toBe(raw);
  await ledger.stop('Offline capacity check');
  expect(read(f).reason).toBe('Offline capacity check');
  await store.close();
}, 60000);

it('commits receipts with accounting atomically and preserves ambiguous admission holds', async () => {
  const f = fixture(), base = f.f.config.network;
  let fail = 'before';
  const store = trialGoogleStore({...f.f.config, network:async (url, init) => {
    if (String(url).endsWith(':commit') && fail === 'before') { fail = ''; throw Error('Offline rejected commit'); }
    const response = await base(url, init);
    if (String(url).endsWith(':commit') && fail === 'after') { fail = ''; throw Error('Offline lost acknowledgement'); }
    return response;
  }});
  const ledger = new PaidLedger(store, () => fixtureTime);
  await expect(ledger.admit('browser', 'rejected')).rejects.toThrow('rejected commit');
  expect(read(f).reservedUsd).toBe(1);
  expect(f.receipts()).toHaveLength(0);
  fail = 'after';
  await expect(ledger.admit('browser', 'ambiguous')).rejects.toThrow('lost acknowledgement');
  const held = read(f);
  expect(held.admissionCount).toBe(1);
  expect(f.receipts()).toMatchObject([{invocation:'ambiguous'}]);
  expect(f.receipts()[0].finished).toBeUndefined();
  expect(await ledger.admit('browser', 'ambiguous')).toBeNull();
  expect(read(f)).toEqual(held);
  await store.close();
});

it('deduplicates admission and finish across independent stores and cannot lose receipt counts on validation', async () => {
  const f = fixture();
  const stores = [trialGoogleStore(f.f.config), trialGoogleStore(f.f.config)];
  const ledgers = stores.map(s => new PaidLedger(s, () => fixtureTime));
  const admitted = await Promise.all(ledgers.map(l => l.admit('browser', 'same-event')));
  expect(admitted.filter(Boolean)).toHaveLength(1);
  const hold = read(f).reservedUsd;
  await Promise.all(ledgers.map(l => l.finish('paid-202610', 'same-event', {firestoreReads:7})));
  expect(read(f)).toMatchObject({admissionCount:1,reservedUsd:hold,observed:{firestoreReads:7}});
  expect(JSON.parse(f.f.read(paidReceiptKey('paid-202610','same-event'))!).finished).toBe(true);
  expect(() => validatePaid({...read(f),admissionCount:undefined},fixtureTime)).toThrow();
  expect(() => validatePaid({...read(f),admissionCount:-1},fixtureTime)).toThrow();
  await Promise.all(stores.map(s => s.close()));
});
