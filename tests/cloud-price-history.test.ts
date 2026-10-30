import { expect, it, vi } from "vitest";
import {
  CloudPriceHistory,
  decodeHistory,
  encodeHistory,
  historyDocument,
  historyShard,
  mergeCloudPrice,
  isHistoryJob,
} from "../collector/cloud-price-history";
import { historyDay, historyDayStart } from "../shared/daily-price-history";
import {
  paidEnvelope,
  createPaidRuntime,
  PAID_BUDGET_KEY,
  type PaidBudget,
} from "../collector/paid-budget";
import { SqliteCache } from "../collector/cache-store";
import { TrialSession } from "../collector/trial";
import { stopTrialInfrastructure } from "../collector/trial-shutdown";

const now = Date.parse("2026-10-19T04:59:15Z"),
  day = historyDay(now);
it("routes both Cloud Scheduler job header forms without matching other jobs", () => {
  expect(isHistoryJob("bazaar-daily-close", "demo")).toBe(true);
  expect(isHistoryJob("projects/demo/locations/us-central1/jobs/bazaar-daily-close", "demo")).toBe(true);
  for (const job of [undefined, "firebase-schedule-refreshMarket-us-central1", "projects/other/locations/us-central1/jobs/bazaar-daily-close", "wrong-bazaar-daily-close"])
    expect(isHistoryJob(job, "demo")).toBe(false);
});
function fakeCloud() {
  const docs = new Map<string, { packed: string; update: string }>();
  let version = 0;
  const counts = { reads: 0, writes: 0 };
  const network = vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    if (body.documents) {
      counts.reads += body.documents.length;
      return Response.json(
        body.documents.map((name: string) => {
          const doc = docs.get(name.split("/").at(-1)!);
          return doc
            ? {
                found: {
                  name,
                  fields: { packed: { stringValue: doc.packed } },
                  updateTime: doc.update,
                },
              }
            : { missing: name };
        }),
      );
    }
    for (const row of body.writes) {
      const id = row.update.name.split("/").at(-1)!;
      const previous = docs.get(id);
      if (
        row.currentDocument.exists === false
          ? !!previous
          : previous?.update !== row.currentDocument.updateTime
      )
        return Response.json(
          { error: { status: "FAILED_PRECONDITION" } },
          { status: 409 },
        );
    }
    counts.writes += body.writes.length;
    body.writes.forEach((row: any) =>
      docs.set(row.update.name.split("/").at(-1), {
        packed: row.update.fields.packed.stringValue,
        update: `${++version}`,
      }),
    );
    return Response.json({ writeResults: [] });
  });
  return {
    docs,
    counts,
    network,
    config: { project: "fixture", token: async () => "test", network },
  };
}
function recoveryFixture() {
  const fake = fakeCloud();
  fake.docs.set('meta', { packed: encodeHistory({ version: 1, years: [2026],
    lastSuccess: { at: now - 86400000, checkedAt: now - 86400000, items: 1, closing: true } }), update: 'seed' });
  const products = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`ITEM_${i}`, {
    buy_summary: [{ pricePerUnit: 12, amount: 10, orders: 1 }],
    sell_summary: [{ pricePerUnit: 11, amount: 10, orders: 1 }],
  }]));
  const fetcher = async () => Response.json({ success: true, lastUpdated: now, products });
  let time = now;
  const session = new TrialSession({ add: async () => { throw Error('Unexpected reservation extension'); }, finish: async () => {} },
    'paid-202610', 'recovery', now + 80000, paidEnvelope('history'), () => time, 0, 'normal');
  const config = { ...fake.config, wait: async () => {} };
  return { ...fake, config, fetcher, session, expire: () => { time += 80000; } };
}
it.each(Array.from({ length: 8 }, (_, batch) => [batch, 429] as const).concat(
  Array.from({ length: 8 }, (_, batch) => [batch, 503] as any)))('recovers shard batch %i after HTTP %i within the original envelope', async (target, status) => {
  const f = recoveryFixture(), actual = f.network.getMockImplementation()!;
  let batch = 0;
  f.network.mockImplementation(async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.writes && batch++ === target) return Response.json({}, { status });
    return actual(url, init);
  });
  const archive = new CloudPriceHistory(f.config, f.session);
  await archive.capture(() => now, f.session.network(f.fetcher));
  expect(f.session.observed.firestoreReads).toBeLessThanOrEqual(40);
  expect(f.session.observed.firestoreWrites).toBeLessThanOrEqual(40);
  expect(f.session.observed.hypixelRequests).toBe(1);
  const result = await new CloudPriceHistory(f.config).item('ITEM_0', now + 60000, now + 86400000);
  expect(result.points).toHaveLength(1);
  expect(result.collector.lastError).toBeNull();
});
it('reconciles a committed batch whose response was lost without writing it twice', async () => {
  const f = recoveryFixture(), actual = f.network.getMockImplementation()!;
  let lost = false;
  f.network.mockImplementation(async (url, init) => {
    const result = await actual(url, init);
    if (JSON.parse(init.body).writes && !lost) { lost = true; throw new TypeError('Connection lost after commit'); }
    return result;
  });
  await new CloudPriceHistory(f.config, f.session).capture(() => now, f.fetcher);
  expect(f.counts.writes).toBe(33);
  expect(f.session.observed.firestoreWrites).toBe(33);
  expect(f.session.observed.firestoreReads).toBe(37);
});
it('retains partial points and exposes a persistent rejection without retrying the entire capture', async () => {
  const f = recoveryFixture(), actual = f.network.getMockImplementation()!;
  let rejected = 0;
  f.network.mockImplementation(async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.writes?.[0].update.name.endsWith('/year-2026-4')) { rejected++; return Response.json({}, { status: 429 }); }
    return actual(url, init);
  });
  await expect(new CloudPriceHistory(f.config, f.session).capture(() => now, f.fetcher)).rejects.toThrow('429');
  expect(rejected).toBe(2);
  const meta = decodeHistory(f.docs.get('meta')!.packed);
  expect(meta.lastSuccess.at).toBe(now - 86400000);
  expect(meta.lastError.message).toContain('capture failed');
  expect((await new CloudPriceHistory(f.config).item('ITEM_0', now + 60000, now + 86400000)).collector.lastError).toEqual(meta.lastError);
  expect(f.session.observed.firestoreWrites).toBeLessThanOrEqual(40);
  expect(f.session.observed.firestoreReads).toBeLessThanOrEqual(40);
});
it('does not retry or write error metadata after the invocation expires during backoff', async () => {
  const f = recoveryFixture(), actual = f.network.getMockImplementation()!;
  let writes = 0;
  f.network.mockImplementation(async (url, init) => {
    if (JSON.parse(init.body).writes) { writes++; return Response.json({}, { status: 429 }); }
    return actual(url, init);
  });
  await expect(new CloudPriceHistory({ ...f.config, wait: async () => f.expire() }, f.session)
    .capture(() => now, f.fetcher)).rejects.toThrow('deadline');
  expect(writes).toBe(1);
  expect(decodeHistory(f.docs.get('meta')!.packed).lastError).toBeUndefined();
});
it('never overwrites a changed shard while reconciling an uncertain commit', async () => {
  const f = recoveryFixture(), actual = f.network.getMockImplementation()!;
  let changed = false;
  f.network.mockImplementation(async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.writes?.[0].update.name.endsWith('/year-2026-0') && !changed) {
      changed = true;
      f.docs.set('year-2026-0', { packed: encodeHistory({ version: 1, year: 2026, items: { OTHER: [] } }), update: 'other-writer' });
      throw new TypeError('Connection lost');
    }
    return actual(url, init);
  });
  await expect(new CloudPriceHistory(f.config, f.session).capture(() => now, f.fetcher)).rejects.toThrow('changed');
  expect(f.docs.get('year-2026-0')!.update).toBe('other-writer');
});
it('exposes an overdue close even when the failure metadata could not be saved', async () => {
  const f = recoveryFixture();
  const result = await new CloudPriceHistory(f.config).item('ITEM_0', now + 86400000 + 600000, now + 3 * 86400000);
  expect(result.collector.lastError?.message).toContain('overdue');
});
it("stores a full all-item close within its reserved reads/writes and preserves imported years and gaps", async () => {
  const fake = fakeCloud();
  fake.docs.set("meta", {
    packed: encodeHistory({
      version: 1,
      years: [2025, 2026],
      lastSuccess: null,
    }),
    update: "seed",
  });
  fake.docs.set(historyDocument(2025, historyShard("A")), {
    packed: encodeHistory({
      version: 1,
      year: 2025,
      items: {
        A: [[20362, Date.parse("2025-10-02T03:00:00Z"), 10, 9, "bazaar-calc"]],
      },
    }),
    update: "seed",
  });
  const session = new TrialSession(
    { add: async () => {}, finish: async () => {} },
    "paid-202610",
    "daily-test",
    now + 80_000,
    paidEnvelope("history"),
    () => now,
    0,
    "normal",
  );
  const archive = new CloudPriceHistory(fake.config, session);
  const fetcher = vi.fn(async () =>
    Response.json({
      success: true,
      lastUpdated: now - 1000,
      products: {
        A: {
          buy_summary: [{ pricePerUnit: 12, amount: 10, orders: 1 }],
          sell_summary: [{ pricePerUnit: 11, amount: 10, orders: 1 }],
        },
        B: {
          buy_summary: [],
          sell_summary: [{ pricePerUnit: 5, amount: 10, orders: 1 }],
        },
      },
    }),
  );
  const capture = await archive.capture(() => now, session.network(fetcher));
  expect(capture).toMatchObject({ items: 2, closing: true, at: now - 1000 });
  expect(fake.counts).toEqual({ reads: 33, writes: 33 });
  expect(session.observed.hypixelRequests).toBe(1);
  const reader = new CloudPriceHistory(fake.config);
  expect((await reader.item("A", now, now + 86400000)).points).toHaveLength(1); // Today still provisional.
  const after = await reader.item("A", now + 60_000, now + 86400000);
  expect(after.points).toEqual([
    [20362, Date.parse("2025-10-02T03:00:00Z"), 10, 9, "bazaar-calc"],
    [day, now - 1000, 12, 11, "bazaarsignal"],
  ]);
  expect((await reader.item("B", now + 60_000, now + 86400000)).points).toEqual(
    [[day, now - 1000, null, 5, "bazaarsignal"]],
  );
  expect(after.collector).toMatchObject({
    location: "cloud",
    enabled: true,
    lastSuccess: { items: 2 },
  });
  expect(fake.counts.reads).toBe(42); // Three selected-item reads, three documents each.
});
it("rejects stale snapshots and unsafe overwrites without publishing a successful collection", async () => {
  const fake = fakeCloud(),
    store = new CloudPriceHistory(fake.config);
  await expect(
    store.capture(
      () => now,
      vi.fn(async () =>
        Response.json({
          success: true,
          lastUpdated: now - 600_000,
          products: {},
        }),
      ),
    ),
  ).rejects.toThrow("Stale");
  expect(fake.counts.writes).toBe(0);
  await store.write([{ id: "meta", value: { version: 1, years: [] } }]);
  await expect(
    store.write([{ id: "meta", value: { version: 1, years: [2026] } }]),
  ).rejects.toThrow("409");
  expect(decodeHistory(fake.docs.get("meta")!.packed)).toEqual({
    version: 1,
    years: [],
  });
});
it("keeps full price precision, source priority, explicit nulls, and a bounded annual payload", () => {
  const points: any[] = [[day, now - 1, 10, 9, "bazaar-calc"]];
  mergeCloudPrice(points, {
    item: "A",
    day,
    at: now - 1,
    buy: 10.123456789,
    sell: null,
    source: "skytrack",
    reference: "s",
  });
  mergeCloudPrice(points, {
    item: "A",
    day,
    at: now - 2,
    buy: 99,
    sell: 99,
    source: "bazaarsignal",
    reference: "own",
  });
  expect(decodeHistory(encodeHistory({ version: 1, points })).points).toEqual([
    [day, now - 1, 10.123456789, null, "skytrack"],
  ]);
  expect(() => encodeHistory({ payload: "x".repeat(8 * 1024 ** 2) })).toThrow(
    "bound",
  );
});
const budget = (): PaidBudget => ({
  version: 1,
  id: "paid-202610",
  startsAt: now - 86400000,
  expiresAt: Date.parse("2026-11-01T07:00:00Z"),
  limitUsd: 5,
  stopUsd: 4.5,
  reservedUsd: 1,
  reserved: {},
  observed: {},
  legacyLedgerSha256: "a".repeat(64),
  admissions: {},
});
it("deduplicates manual verification and daily schedules, independently of hourly collection, without resetting budgets", async () => {
  const store = new SqliteCache(":memory:");
  await store.commit(PAID_BUDGET_KEY, null, JSON.stringify(budget()));
  let time = historyDayStart(day) + 12 * 3600000;
  const capture = vi.fn(async () => ({ items: 2201 })),
    shutdown = vi.fn(async () => {});
  const runtime = createPaidRuntime({
    expiresAt: budget().expiresAt,
    now: () => time,
    store: () => ({
      ...store,
      read: store.read.bind(store),
      commit: store.commit.bind(store),
      close: async () => {},
    }),
    shutdown,
    history: { capture, item: async () => ({}) },
  });
  await runtime.collectDaily();
  await runtime.collectDaily();
  time = now;
  await runtime.collectDaily();
  await runtime.collectDaily();
  expect(capture).toHaveBeenCalledTimes(2);
  const after = JSON.parse((await store.read(PAID_BUDGET_KEY))!);
  expect(after.lastCollectorAt).toBeUndefined();
  expect(after.expiresAt).toBe(budget().expiresAt);
  expect(after.reservedUsd).toBeGreaterThan(1);
  expect(shutdown).not.toHaveBeenCalled();
  time = budget().expiresAt;
  await expect(runtime.collectDaily()).rejects.toThrow("expired");
  expect(shutdown).toHaveBeenCalledOnce();
  await store.close();
});
it("budget shutdown also pauses the daily job, including idempotent absence before deployment", async () => {
  const paused: string[] = [];
  const network = vi.fn(async (input: any) => {
    const url = String(input);
    if (url.includes("getIamPolicy")) return Response.json({ bindings: [] });
    if (url.endsWith(":pause")) {
      paused.push(url);
      return Response.json({ state: "PAUSED" });
    }
    return Response.json({
      state: paused.includes(url + ":pause") ? "PAUSED" : "ENABLED",
    });
  });
  await stopTrialInfrastructure({
    project: "fixture",
    token: async () => "test",
    network,
    additionalJobs: ["bazaar-daily-close"],
  });
  expect(paused).toHaveLength(2);
  expect(paused.some((url) => url.includes("bazaar-daily-close"))).toBe(true);
});
