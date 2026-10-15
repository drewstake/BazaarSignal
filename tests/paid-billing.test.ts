import { expect, it, vi } from 'vitest';
import { SqliteCache } from '../collector/cache-store';
import { PaidLedger, PAID_BUDGET_KEY, createPaidRuntime, type PaidBudget } from '../collector/paid-budget';
import { googleBillingFeed, parseBudgetMessage, type BudgetMessage } from '../collector/paid-billing';
import { BILLING_ACCOUNT_ID, BILLING_INTERVAL_START, BILLING_SUBSCRIPTION, type PaidBilling } from '../shared/paid-spending';
import { emptyAdmin, pilotStatus } from '../shared/admin';
import { measureAdmin } from '../apps-script/admin-report';
import { trialGoogleStore } from '../collector/trial-google';
import { offlineGoogle } from './support/offline-google';

const now = Date.parse('2026-10-15T16:00:00Z');
const billing = (): PaidBilling => ({ accountId: BILLING_ACCOUNT_ID, budgetId: 'test-budget', subscription: BILLING_SUBSCRIPTION,
  intervalStart: BILLING_INTERVAL_START, scope: 'BazaarSignal market project · after credits' });
const cost = (actualUsd = 0, publishedAt = now - 60000) => ({actualUsd, publishedAt, receivedAt: now, intervalStart: BILLING_INTERVAL_START});
const state = (): PaidBudget => ({ version: 1, id: 'paid-202610', startsAt: now - 86400000, expiresAt: Date.parse('2026-11-01T07:00:00Z'),
  limitUsd: 5, stopUsd: 4.5, reservedUsd: 1, reserved: {}, observed: {}, admissions: {}, legacyLedgerSha256: 'a'.repeat(64), billing: billing() });
const message = (patch = {}, attributes = {}): BudgetMessage => ({ ackId: 'ack-1', message: {
  publishTime: new Date(now - 60000).toISOString(),
  attributes: { billingAccountId: BILLING_ACCOUNT_ID, budgetId: 'test-budget', schemaVersion: '1.0', ...attributes },
  data: Buffer.from(JSON.stringify({ costAmount: 0, currencyCode: 'USD', budgetAmount: 5, budgetAmountType: 'SPECIFIED_AMOUNT',
    costIntervalStart: new Date(BILLING_INTERVAL_START).toISOString(), ...patch })).toString('base64'),
} });
it('ingests and acknowledges billing with a lagging Firestore clock, then admits work and refreshes again', async () => {
  const f = offlineGoogle(() => now - 3700);
  f.seed(PAID_BUDGET_KEY, JSON.stringify(state()));
  const store = trialGoogleStore(f.config), report = vi.fn();
  const ledger = new PaidLedger(store, () => now, report);
  const network = vi.fn(async (url: any) => Response.json(String(url).endsWith(':pull') ? {receivedMessages:[message()]} : {}));
  const feed = googleBillingFeed(async () => 'fake-token', network, () => now);
  await ledger.refreshBilling(feed);
  expect(JSON.parse(f.read(PAID_BUDGET_KEY)!).billing).toMatchObject({latest:cost(),checkedAt:now});
  expect(String(network.mock.calls[1][0])).toContain(':acknowledge');
  expect(await ledger.admit('collector', 'after-first-cost')).toBeTruthy();
  await ledger.refreshBilling(feed);
  expect(report).not.toHaveBeenCalled();
  expect(network).toHaveBeenCalledTimes(4);
});

it('logs the failing billing stage without provider content and retains costs if acknowledgement fails', async () => {
  const {store} = await setup();
  const report = vi.fn(), ledger = new PaidLedger(store, () => now, report);
  try {
    const feed = googleBillingFeed(async () => 'secret-token', async (url: any) =>
      String(url).endsWith(':pull') ? Response.json({receivedMessages:[message()]})
        : Response.json({error:'private-provider-body'}, {status:503}), () => now);
    await ledger.refreshBilling(feed);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({event:'billing_feed_failed',stage:'acknowledge',code:503}));
    expect(JSON.parse((await store.read(PAID_BUDGET_KEY))!).billing.latest).toEqual(cost());
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/secret-token|private-provider-body/);
    const commit = vi.spyOn(store, 'commit').mockRejectedValueOnce(Object.assign(Error('private-provider-body'),{code:429}));
    await ledger.refreshBilling(googleBillingFeed(async () => 'token', async () => Response.json({receivedMessages:[message({costAmount:1})]}), () => now));
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({event:'billing_feed_failed',stage:'save',code:429}));
    commit.mockRestore();
  } finally { await store.close(); }
});
async function setup(value = state()) {
  const store = new SqliteCache(':memory:');
  await store.commit(PAID_BUDGET_KEY, null, JSON.stringify(value));
  return { store, ledger: new PaidLedger(store, () => now), read: async () => JSON.parse((await store.read(PAID_BUDGET_KEY))!) as PaidBudget };
}
it('accepts net zero and credits, ignores forecast thresholds and rejects foreign or malformed costs', () => {
  expect(parseBudgetMessage(message({ forecastThresholdExceeded: 1 }), billing(), now)?.actualUsd).toBe(0);
  expect(parseBudgetMessage(message({ costAmount: -0.05 }), billing(), now)?.actualUsd).toBe(-0.05);
  for (const patch of [{currencyCode:'EUR'}, {costAmount:'0'}, {costAmount:null}, {budgetAmount:50}, {budgetAmountType:'LAST_MONTH_COST'},
    {costIntervalStart:'2026-09-01T07:00:00Z'}, {costIntervalStart:'2026-11-01T07:00:00Z'}])
    expect(parseBudgetMessage(message(patch), billing(), now)).toBeNull();
  for (const attributes of [{billingAccountId:'wrong'}, {budgetId:'wrong'}, {schemaVersion:'2.0'}])
    expect(parseBudgetMessage(message({}, attributes), billing(), now)).toBeNull();
  const future = message(); future.message.publishTime = new Date(now + 1).toISOString();
  expect(parseBudgetMessage(future, billing(), now)).toBeNull();
});
it('keeps running above $4.50 reserved when actual cost is zero, including after a feed outage', async () => {
  const s = state(); s.reservedUsd = 5.3; s.billing!.latest = cost();
  const { store, ledger, read } = await setup(s);
  try {
    await ledger.refreshBilling(async () => { throw Error('Unavailable'); });
    const session = await ledger.admit('browser', 'still-free');
    expect(session).toBeTruthy();
    await session!.finish();
    const after = await read();
    expect(after.reservedUsd).toBeGreaterThan(5.3);
    expect(after.billing!.latest!.actualUsd).toBe(0);
    expect(after.billing!.error).toContain('unavailable');
    expect(after.stoppedAt).toBeUndefined();
  } finally { await store.close(); }
});
it('switches only after a real first cost update and does not manufacture zero for an empty feed', async () => {
  const s = state(); s.reservedUsd = 4.4999;
  const {store, ledger, read} = await setup(s);
  try {
    await ledger.refreshBilling(async (_b, save) => save([]));
    expect((await read()).billing!.latest).toBeUndefined();
    await expect(ledger.admit('browser', 'pending')).rejects.toThrow('reservation stop');
    await ledger.refreshBilling(async (_b, save) => save([cost()]));
    expect(await ledger.admit('browser', 'verified')).toBeTruthy();
    expect((await read()).reservedUsd).toBeGreaterThan(4.5);
  } finally { await store.close(); }
});
it('orders duplicate/delayed messages by publication time and accepts later credit corrections', async () => {
  const {store, ledger, read} = await setup();
  try {
    await ledger.refreshBilling(async (_b, save) => save([cost(1, now - 100), cost(4.9, now - 200), cost(1, now - 100)]));
    expect((await read()).billing!.latest!.actualUsd).toBe(1);
    expect((await read()).stoppedAt).toBeUndefined();
    await ledger.refreshBilling(async (_b, save) => save([cost(0, now - 50)]));
    expect((await read()).billing!.latest!.actualUsd).toBe(0);
  } finally { await store.close(); }
});
it('latches the stop at $4.50 actual regardless of small reserves and never automatically resumes', async () => {
  const {store, ledger, read} = await setup();
  try {
    await ledger.refreshBilling(async (_b, save) => save([cost(4.5)]));
    expect((await read()).reservedUsd).toBe(1);
    expect((await read()).reason).toContain('Google-reported net spending');
    await expect(ledger.admit('collector','over-budget')).rejects.toThrow('Google-reported');
    const feed = vi.fn(); await ledger.refreshBilling(feed); expect(feed).not.toHaveBeenCalled();
  } finally { await store.close(); }
});
it('persists before ack and does not ack if persistence fails', async () => {
  const sequence: string[] = [];
  const network = vi.fn(async (url: any) => {
    sequence.push(String(url).endsWith(':pull') ? 'pull' : 'ack');
    return Response.json(String(url).endsWith(':pull') ? {receivedMessages:[message()]} : {});
  });
  const feed = googleBillingFeed(async () => 'test-token', network);
  await feed(billing(), async costs => { sequence.push('save'); expect(costs[0].actualUsd).toBe(0); }, now);
  expect(sequence).toEqual(['pull','save','ack']);
  sequence.length = 0;
  await expect(feed(billing(), async () => { throw Error('Write failed'); }, now)).rejects.toThrow('Write failed');
  expect(sequence).toEqual(['pull']);
});
it('accepts a notification published during the pull instead of losing it as a future event', async () => {
  const m = message(); m.message.publishTime = new Date(now + 1000).toISOString();
  const feed = googleBillingFeed(async () => 'token', vi.fn(async (url: any) =>
    Response.json(String(url).endsWith(':pull') ? {receivedMessages:[m]} : {})), () => now + 2000);
  const save = vi.fn(async () => {});
  await feed(billing(), save, now);
  expect(save).toHaveBeenCalledWith([{...cost(), publishedAt:now + 1000, receivedAt:now + 2000}]);
});
it('collector applies billing stop and shuts down without collecting prices', async () => {
  const s = state(); const {store} = await setup(s);
  const network = vi.fn(), shutdown = vi.fn(async () => {});
  const runtime = createPaidRuntime({expiresAt:s.expiresAt, now:()=>now, store:()=>store, shutdown, network,
    billingFeed: async (_b, save) => save([cost(4.51)]) });
  await expect(runtime.collect('hourly')).rejects.toThrow('Google-reported');
  expect(shutdown).toHaveBeenCalledOnce(); expect(network).not.toHaveBeenCalled();
});
it('Admin uses reported cost and original publication time rather than reserve or daily refresh time', () => {
  const s = state(); s.reservedUsd = 5.3; s.billing!.latest = cost();
  const report = measureAdmin(url => {
    if (url.endsWith('/paid-budget-october')) return {fields:{value:{stringValue:JSON.stringify(s)}}};
    if (url.endsWith('/control')) return {fields:{value:{stringValue:JSON.stringify({jobs:{bazaar:{lastCheckedAt:now}}})}}};
    throw Error('Not configured');
  }, emptyAdmin(now), now);
  report.scheduler = { measuredAt: now, state:'ENABLED', schedule:'0 * * * *', expiresAt: s.expiresAt };
  expect(report.billing.actualUsd).toBe(0);
  expect(report.billing.measuredAt).toBe(now - 60000);
  expect(pilotStatus(report, now)).toBe('Active paid pilot');
});
