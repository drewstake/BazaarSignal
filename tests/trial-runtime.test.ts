import { afterEach, expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import { SqliteCache } from "../collector/cache-store";
import { createTrialRuntime } from "../collector/trial-runtime";
import { trialLimits, TRIAL_MAX_MS, type TrialState } from "../collector/trial";
import { googleMeters } from "../collector/usage";
import { MarketCollector } from "../collector/engine";
import { defaultPolicy } from "../collector/policy";
const stores: SqliteCache[] = [];
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
});
async function fixture() {
  let now = Date.now();
  const start = now,
    store = new SqliteCache(":memory:");
  stores.push(store);
  const state: TrialState = {
    version: 1,
    id: "fixture",
    startsAt: start,
    expiresAt: start + TRIAL_MAX_MS,
    limits: { ...trialLimits },
    reserved: {},
    observed: {},
    admissions: {},
    baseline: {
      meters: Object.fromEntries(
        googleMeters.map((key) => [
          key,
          {
            scope: "fixture",
            periodStart: start - 1000,
            periodEnd: start + 86400_000,
            verifiedAt: start,
            limit: 1e15,
            used: 1,
            reserved: 0,
            headroom: 1,
            projectedRemaining: 0,
          },
        ]),
      ),
    },
  };
  await store.commit("trial", null, JSON.stringify(state));
  const network = vi.fn(async (input: any) => {
    const path = String(input);
    return Response.json({
      success: true,
      ...(path.includes("/items")
        ? { items: [] }
        : path.includes("/election")
          ? { mayor: { name: "Normal", perks: [] } }
          : path.includes("/bazaar")
            ? {
                lastUpdated: now,
                products: {
                  TEST: {
                    buy_summary: [{ amount: 10, pricePerUnit: 100, orders: 1 }],
                    sell_summary: [{ amount: 10, pricePerUnit: 90, orders: 1 }],
                  },
                },
              }
            : {
                page: 0,
                totalPages: 1,
                totalAuctions: 0,
                lastUpdated: now,
                auctions: [],
              }),
    });
  });
  const shutdown = vi.fn(async () => {}),
    report = vi.fn();
  const runtime = createTrialRuntime({
    trialId: state.id,
    startsAt: start,
    expiresAt: state.expiresAt,
    store: () => store,
    shutdown,
    report,
    network,
    now: () => now,
  });
  return {
    runtime,
    network,
    store,
    shutdown,
    report,
    state,
    setNow: (value: number) => {
      now = value;
    },
  };
}
function response() {
  const result = {
    status: 0,
    body: Buffer.alloc(0),
    headers: {} as Record<string, any>,
    headersSent: false,
    setHeader(key: string, value: any) {
      this.headers[key] = value;
    },
    writeHead(status: number) {
      this.status = status;
      this.headersSent = true;
      return this;
    },
    end(value?: any) {
      this.body = Buffer.from(value ?? "");
      return this;
    },
  };
  return result;
}
it("the actual collector runtime deduplicates events; browser reads and conditional responses never fetch Hypixel", async () => {
  const f = await fixture();
  await f.runtime.collect("minute-1");
  await f.runtime.collect("minute-1");
  expect(f.network).toHaveBeenCalledTimes(4);
  const res = response();
  await f.runtime.handle(
    {
      url: "/api/companion/bazaar",
      method: "GET",
      headers: { "accept-encoding": "gzip" },
    } as any,
    res as any,
  );
  expect(res.status).toBe(200);
  expect(JSON.parse(gunzipSync(res.body).toString()).usage.expiresAt).toBe(
    f.state.expiresAt,
  );
  const second = response();
  await f.runtime.handle(
    {
      url: "/api/companion/bazaar",
      method: "GET",
      headers: { "if-none-match": res.headers.ETag },
    } as any,
    second as any,
  );
  expect(second.status).toBe(304);
  expect(second.body.length).toBe(0);
  expect(f.network).toHaveBeenCalledTimes(4);
  expect(f.shutdown).not.toHaveBeenCalled();
  const ledger = JSON.parse((await f.store.read("trial"))!);
  expect(ledger.observed.collectorInvocations).toBe(1);
  expect(ledger.observed.browserRequests).toBe(2);
  expect(ledger.observed.auctionsRefreshesCompleted).toBe(1);
});
it("the final scheduled minute stops infrastructure with no upstream work; a later browser stays paused", async () => {
  const f = await fixture();
  f.setNow(f.state.expiresAt - 60000);
  await expect(f.runtime.collect("last-minute")).rejects.toThrow(
    "shutdown window",
  );
  expect(f.shutdown).toHaveBeenCalledTimes(1);
  expect(f.network).not.toHaveBeenCalled();
  const res = response();
  await f.runtime.handle(
    { url: "/api/companion/bazaar", method: "GET", headers: {} } as any,
    res as any,
  );
  expect(res.status).toBe(503);
  expect(JSON.parse(res.body.toString()).usage.mode).toBe("paused");
  expect(f.network).not.toHaveBeenCalled();
});
it("missing accounting causes infrastructure shutdown before any upstream or cleanup activity", async () => {
  const f = await fixture();
  const raw = (await f.store.read("trial"))!,
    state = JSON.parse(raw);
  delete state.baseline.meters.storageClassA;
  await f.store.commit("trial", raw, JSON.stringify(state));
  await expect(f.runtime.collect("first-minute")).rejects.toThrow("accounting");
  expect(f.shutdown).toHaveBeenCalledOnce();
  expect(f.network).not.toHaveBeenCalled();
});
it("rejects a different trial identity even when its deadlines match this release", async () => {
  const f = await fixture();
  const raw = (await f.store.read("trial"))!;
  await f.store.commit("trial", raw, JSON.stringify({ ...f.state, id: "other-trial" }));
  await expect(f.runtime.collect("first-minute")).rejects.toThrow("does not match");
  expect(f.shutdown).toHaveBeenCalledOnce();
  expect(f.network).not.toHaveBeenCalled();
});
it("a budget stop from a physical request interrupts the collector without retry sleeps or later jobs", async () => {
  const f = await fixture();
  const denied = vi.fn(async () => {
    const error = new Error("budget stopped");
    error.name = "TrialStopped";
    throw error;
  });
  // Use the concrete error class so the collector aborts rather than recording an ordinary failed job.
  const { TrialStopped } = await import("../collector/trial");
  denied.mockImplementation(async () => {
    throw new TrialStopped("budget stopped");
  });
  const collector = new MarketCollector(
    f.store,
    defaultPolicy,
    denied,
    Date.now,
  );
  await expect(collector.tick()).rejects.toThrow("budget stopped");
  expect(denied).toHaveBeenCalledTimes(1);
});
it("retired seller routes perform no storage or network work", async () => {
 const { marketHandler } = await import("../collector/routes");
 const res=response();
 await marketHandler({} as any)({url:"/api/companion/player-names?ids="+"a".repeat(32),method:"GET",headers:{}} as any,res as any);
 expect(res.status).toBe(410);
});
