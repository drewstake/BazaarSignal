import { afterEach, expect, it, vi } from "vitest";
import { trialGoogleStore } from "../collector/trial-google";
import { SnapshotReadCache } from "../collector/snapshot-read-cache";
import { Coordinator, emptyJob } from "../collector/coordinator";
import { MarketCollector } from "../collector/engine";
import { defaultPolicy } from "../collector/policy";
import {
  createLiveRuntime,
  livePolicy,
  liveMaximums,
  liveDailyMaximums,
  pacificDay,
  LiveLedger,
} from "../collector/allowance-live";
import { offlineGoogle } from "./support/offline-google";
import * as bazaarModule from "../shared/companion/bazaar";

afterEach(() => {
  vi.restoreAllMocks();
});
const raw = (version: string, observedAt = 1) =>
  JSON.stringify({
    version,
    observedAt,
    upstreamAt: observedAt,
    data: { nested: ["immutable"] },
  });

it("reuses a read version without another document read; external writes and ABA remain fenced", async () => {
  const f = offlineGoogle(),
    a = trialGoogleStore(f.config),
    b = trialGoogleStore(f.config);
  f.seed("control", "one");
  expect(await a.read("control")).toBe("one");
  const before = f.counts.firestoreReads;
  expect(await a.commit("control", "one", "two")).toBe(true);
  expect(f.counts.firestoreReads).toBe(before);
  expect(await a.read("control")).toBe("two");
  expect(await b.commit("control", "two", "other")).toBe(true);
  expect(await b.commit("control", "other", "two")).toBe(true);
  expect(await a.commit("control", "two", "stale")).toBe(false);
  expect(f.read("control")).toBe("two");
  expect(await a.read("control")).toBe("two");
  expect(await a.commit("control", "two", "fresh")).toBe(true);
});

it("serializes one owner without losing parallel charges, response limits or external concurrency protection", async () => {
  const f = offlineGoogle(),
    store = trialGoogleStore(f.config),
    owner = new Coordinator(store, defaultPolicy);
  await owner.acquire();
  await Promise.all(
    Array.from({ length: 40 }, (_, i) => owner.charge(`page=${i}`, false)),
  );
  const s = await owner.state();
  expect(s.totalRequests).toBe(40);
  expect(new Set(s.requests.map((r) => r.path)).size).toBe(40);
  expect(f.counts.casConflicts ?? 0).toBe(0);
  await owner.headers(
    new Response(null, {
      headers: { "RateLimit-Remaining": "1", "RateLimit-Reset": "60" },
    }),
    1,
  );
  await owner.charge("last", false);
  await expect(owner.charge("blocked", false)).rejects.toThrow("header budget");
  expect(
    await new Coordinator(trialGoogleStore(f.config), defaultPolicy).acquire(),
  ).toBe(false);
});

it("snapshot CAS rejects lease expiry during upload and preserves the last complete pointer", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const f = offlineGoogle(() => now),
    store = trialGoogleStore(f.config),
    owner = new Coordinator(store, defaultPolicy);
  f.snapshot("auctions", raw("old"));
  await owner.acquire();
  const old = await store.read("control");
  const put = store.blobs.put;
  store.blobs.put = async (name, value) => {
    await put(name, value);
    now += defaultPolicy.leaseMs + 1;
  };
  expect(
    await store.commit("control", old, old!, {
      key: "auctions",
      value: raw("late"),
    }),
  ).toBe(false);
  expect(JSON.parse((await store.read("auctions"))!).version).toBe("old");
  expect(f.objects.size).toBe(2); // Uncertain/staged upload kept for bounded cleanup.
});

it("cache coalesces one immutable generation, invalidates, bounds memory and isolates instances", async () => {
  const cache = new SnapshotReadCache(200),
    load = vi.fn(async () => raw("one"));
  const all = await Promise.all(
    Array.from({ length: 30 }, () => cache.read("auctions", "one", load)),
  );
  expect(load).toHaveBeenCalledOnce();
  expect(all.every((s) => s === all[0])).toBe(true);
  expect(() => (all[0]!.data as any).nested.push("mutation")).toThrow();
  await cache.read("auctions", "two", async () => raw("two"));
  expect((await cache.read("auctions", "two", load))!.version).toBe("two");
  await cache.read("bazaar", "one", load);
  expect(cache.retainedBytes).toBeLessThanOrEqual(200);
  const large = vi.fn(async () => raw("x".repeat(300)));
  await cache.read("auctions", "large", large);
  await cache.read("auctions", "large", large);
  expect(large).toHaveBeenCalledTimes(2);
  expect(cache.retainedBytes).toBeLessThanOrEqual(200);
  const separate = new SnapshotReadCache();
  expect(
    (await separate.read("bazaar", "one", async () =>
      raw("private-other-store"),
    ))!.version,
  ).toBe("private-other-store");
  await expect(cache.read("live-allowance", "secret", load)).rejects.toThrow(
    "immutable",
  );
});

it("an in-flight old generation cannot satisfy a new generation; failed loads are retriable", async () => {
  const cache = new SnapshotReadCache();
  let release!: (s: string) => void;
  const old = cache.read(
    "auctions",
    "old",
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const latest = cache.read("auctions", "new", async () => raw("new"));
  release(raw("old"));
  expect((await old)!.version).toBe("old");
  expect((await latest)!.version).toBe("new");
  await expect(
    cache.read("auctions", "failure", async () => {
      throw new Error("download failed");
    }),
  ).rejects.toThrow("download failed");
  expect(
    (await cache.read("auctions", "failure", async () => raw("recovered")))!
      .version,
  ).toBe("recovered");
  expect(await cache.read("auctions", "removed", async () => null)).toBeNull();
  expect(cache.retainedBytes).toBe(0);
});

function runtimeFixture() {
  let now = Date.parse("2026-10-03T08:00:00Z");
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const f = offlineGoogle(() => now),
    expiresAt = now + 86_400_000;
  const control = {
    revision: 1,
    policy: livePolicy,
    lease: null,
    requests: [],
    totalRequests: 0,
    blockedUntil: 0,
    header: null,
    jobs: {
      bazaar: {
        ...emptyJob(),
        observedAt: now,
        upstreamAt: now,
        snapshotVersion: "one",
      },
      auctions: {
        ...emptyJob(),
        observedAt: now,
        upstreamAt: now,
        snapshotVersion: "one",
      },
    },
  };
  f.seed("control", JSON.stringify(control));
  f.snapshot(
    "bazaar",
    JSON.stringify({
      version: "one",
      observedAt: now,
      upstreamAt: now,
      data: {
        items: [],
        raw: { success: true, lastUpdated: now, products: {} },
        names: {},
      },
    }),
  );
  f.snapshot(
    "auctions",
    JSON.stringify({
      version: "one",
      observedAt: now,
      upstreamAt: now,
      data: {
        listings: [],
        fees: {
          mayor: "Normal",
          multiplier: 1,
          checkedAt: now,
          explanation: "",
        },
      },
    }),
  );
  f.seed(
    "live-allowance",
    JSON.stringify({
      version: 1,
      id: "free-fixture",
      startsAt: now - 1,
      expiresAt,
      monthlyLimits: liveMaximums,
      monthlyReserved: {},
      dailyLimits: liveDailyMaximums,
      dailyReserved: {},
      day: pacificDay(now),
      observed: {},
      evidence: "offline",
    }),
  );
  const shutdown = vi.fn(async () => {}),
    network = vi.fn(async () => {
      throw new Error("No upstream");
    });
  const runtime = createLiveRuntime({
    id: "free-fixture",
    expiresAt,
    store: (s) => trialGoogleStore(f.config, s),
    now: () => now,
    network,
    shutdown,
  });
  async function get(url: string, method = "GET") {
    let status = 0,
      body: any;
    await runtime.handle(
      { url, method, headers: { origin: "http://127.0.0.1:5173" } } as any,
      {
        headersSent: false,
        setHeader() {},
        writeHead(n: number) {
          status = n;
          return this;
        },
        end(data: any) {
          body = data?.length ? JSON.parse(String(data)) : null;
        },
      } as any,
    );
    return { status, body };
  }
  return {
    f,
    control,
    get,
    network,
    shutdown,
    expiresAt,
    setNow: (n: number) => {
      now = n;
    },
  };
}

it("every ordinary API route stays inside the smaller miss reservation, including failures and preflight", async () => {
  const { f, get, network, shutdown } = runtimeFixture();
  const paths = [
    "/api/companion/bazaar",
    "/api/companion/raw-bazaar",
    "/api/companion/book?itemId=missing",
    "/api/companion/snapshot",
    "/api/market",
    "/api/companion/auctions",
    "/api/companion/status",
    `/api/companion/auctions/${"a".repeat(32)}`,
    `/api/companion/auctions/${"a".repeat(32)}/check`,
    "/api/companion/auctions?filters=bad-json",
    "/api/companion/bazaar?refresh=true",
    "/api/companion/unknown",
  ];
  for (const path of paths) {
    const before = { ...f.counts };
    const response = await get(path);
    expect([200, 400, 404, 503]).toContain(response.status);
    // Actual operations include admission/finish, outside the 8-read work hold.
    expect(
      f.counts.firestoreReads - (before.firestoreReads ?? 0),
    ).toBeLessThanOrEqual(8);
    expect(
      (f.counts.storageClassB ?? 0) - (before.storageClassB ?? 0),
    ).toBeLessThanOrEqual(1);
  }
  expect((await get("/api/companion/bazaar", "OPTIONS")).status).toBe(204);
  const ledger = JSON.parse(f.read("live-allowance")!);
  expect(ledger.monthlyReserved.sellerRequests).toBe(0);
  expect(ledger.dailyReserved.firestoreReads).toBe(108 * (paths.length + 1));
  expect(shutdown).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});

it("fresh durable identity invalidates warm snapshots and no cache bypasses deadline or stale-command checks", async () => {
  const { f, control, get, network, shutdown, expiresAt, setNow } =
    runtimeFixture();
  expect((await get("/api/companion/bazaar")).body.version).toBe("one");
  await get("/api/companion/bazaar");
  expect(f.counts.storageClassB).toBe(1);
  // Same timestamp, different publication version is still invalidated.
  control.jobs.bazaar.snapshotVersion = "two";
  f.seed("control", JSON.stringify(control));
  f.snapshot(
    "bazaar",
    JSON.stringify({
      version: "two",
      observedAt: control.jobs.bazaar.observedAt,
      upstreamAt: control.jobs.bazaar.upstreamAt,
      data: { items: [] },
    }),
  );
  expect((await get("/api/companion/bazaar")).body.version).toBe("two");
  expect(f.counts.storageClassB).toBe(2);
  setNow(expiresAt - 1);
  expect(
    (await get(`/api/companion/auctions/${"a".repeat(32)}/check`)).body.status,
  ).toBe("stale");
  setNow(expiresAt);
  expect((await get("/api/companion/bazaar")).status).toBe(503);
  expect(shutdown).toHaveBeenCalledOnce();
  expect(network).not.toHaveBeenCalled();
});

it("same Bazaar generation skips normalization; metadata changes still normalize and republish", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const f = offlineGoogle(() => now),
    store = trialGoogleStore(f.config);
  const normalize = vi.spyOn(bazaarModule, "normalizeBazaar");
  const sourceAt = now;
  const network: typeof fetch = async (input) =>
    Response.json({
      success: true,
      ...(String(input).includes("/items")
        ? { items: [] }
        : String(input).includes("/election")
          ? { mayor: { name: "Normal", perks: [] } }
          : String(input).includes("/bazaar")
            ? {
                lastUpdated: sourceAt,
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
                lastUpdated: sourceAt,
                auctions: [],
              }),
    });
  const c = new MarketCollector(store, defaultPolicy, network);
  await c.tick();
  expect(normalize).toHaveBeenCalledTimes(1);
  const before = JSON.parse(f.read("control")!).jobs.bazaar.observedAt;
  now += 60_000;
  await c.tick();
  expect(normalize).toHaveBeenCalledTimes(1);
  expect(JSON.parse(f.read("control")!).jobs.bazaar.observedAt).toBe(before);
  const state = JSON.parse(f.read("control")!);
  state.jobs.catalog.observedAt = now;
  state.jobs.bazaar.nextAt = 0;
  f.snapshot(
    "catalog",
    JSON.stringify({
      version: "new-metadata",
      observedAt: now,
      upstreamAt: now,
      data: {},
    }),
  );
  f.seed("control", JSON.stringify(state));
  await c.tick();
  expect(normalize).toHaveBeenCalledTimes(2);
});

it("unchanged metadata verification reuses its payload across collector instances", async () => {
  const now = Date.now(),
    f = offlineGoogle(),
    cache = new SnapshotReadCache();
  const control = {
    revision: 1,
    policy: defaultPolicy,
    lease: null,
    requests: [],
    totalRequests: 0,
    blockedUntil: 0,
    header: null,
    jobs: {
      election: {
        ...emptyJob(),
        observedAt: now,
        upstreamAt: now,
        snapshotVersion: "same",
      },
    },
  };
  f.seed("control", JSON.stringify(control));
  f.snapshot("election", raw("same", now));
  const collector = () =>
    new MarketCollector(
      trialGoogleStore(f.config),
      defaultPolicy,
      vi.fn(),
      Date.now,
      Math.random,
      () => {},
      0,
      cache,
    );
  const first = await collector().read("election");
  control.jobs.election.upstreamAt += 3600000;
  f.seed("control", JSON.stringify(control));
  expect(await collector().read("election")).toBe(first);
  expect(f.counts.storageClassB).toBe(1);
});

it("larger upstream bodies stop at 128 MiB and retain the entire durable failed-run reservation", async () => {
  const { f } = runtimeFixture();
  const ledger = new LiveLedger(trialGoogleStore(f.config));
  const session = (await ledger.admit("collector", "large-body"))!;
  const chunk = new Uint8Array(1024 * 1024);
  const transport = vi.fn(async () => {
    let chunks = 0;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (chunks++ < 16) controller.enqueue(chunk);
          else controller.close();
        },
      }),
    );
  });
  const network = session.network(transport);
  const consume = async () => {
    const response = await network(
      "https://api.hypixel.net/v2/skyblock/auctions?page=0",
    );
    const reader = response.body!.getReader();
    try {
      while (!(await reader.read()).done) {
        /* Stream without retaining the fixture. */
      }
    } finally {
      reader.releaseLock();
    }
  };
  for (let i = 0; i < 8; i++) await consume();
  await expect(consume()).rejects.toThrow("upstreamResponseBytes");
  await expect(consume()).rejects.toThrow("upstreamResponseBytes");
  expect(transport).toHaveBeenCalledTimes(9);
  expect(session.observed.upstreamResponseBytes).toBe(128 * 1024 ** 2);
  await session.finish();
  const saved = JSON.parse(f.read("live-allowance")!);
  expect(saved.monthlyReserved.hypixelRequests).toBe(96);
  expect(saved.dailyReserved.firestoreReads).toBe(700);
  expect(saved.dailyReserved.firestoreWrites).toBe(296);
});
