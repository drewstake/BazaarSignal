import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SqliteCache } from "../collector/cache-store";
import { MarketCollector } from "../collector/engine";
import { Coordinator } from "../collector/coordinator";
import {
  defaultPolicy,
  auctionInterval,
  configuredPolicy,
} from "../collector/policy";
import { marketHandler } from "../collector/http";
import { visiblePoll } from "../src/companion/polling";
import { livePolicy, LIVE_HOUR } from '../collector/allowance-live';

const dirs: string[] = [],
  stores: SqliteCache[] = [];
const database = () => {
  const dir = mkdtempSync(join(tmpdir(), "bazaar-cache-"));
  dirs.push(dir);
  return join(dir, "cache.sqlite");
};
const connect = (path = ":memory:") => {
  const s = new SqliteCache(path);
  stores.push(s);
  return s;
};
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const s of stores.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function upstream(now: () => number, pages = 4) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input),
      page = Number(new URL(url).searchParams.get("page"));
    const data = url.includes("/items")
      ? { items: [] }
      : url.includes("/election")
        ? { mayor: { name: "Normal", perks: [] } }
        : url.includes("/bazaar")
          ? {
              lastUpdated: now(),
              products: {
                TEST: {
                  buy_summary: [{ amount: 10, pricePerUnit: 100, orders: 1 }],
                  sell_summary: [{ amount: 10, pricePerUnit: 90, orders: 1 }],
                },
              },
            }
          : {
              page,
              totalPages: pages,
              totalAuctions: pages,
              lastUpdated: now(),
              auctions: [{ uuid: page.toString(16).padStart(32, "0") }],
            };
    return new Response(JSON.stringify({ success: true, ...data }), {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  });
}
it('hourly collection remains due on the next clock hour despite startup jitter',async()=>{
  let now=Date.parse('2026-10-02T03:00:25Z');const store=connect(),fetcher=upstream(()=>now);
  const c=new MarketCollector(store,livePolicy,fetcher,()=>now,()=>0,()=>{},LIVE_HOUR);
  await c.tick();
  expect((await c.coordinator.state()).jobs.bazaar.nextAt).toBe(Date.parse('2026-10-02T04:00:00Z'));
  now=Date.parse('2026-10-02T04:00:02Z');await c.tick();
  expect((await c.rawBazaar()).lastUpdated).toBe(now);
  expect((await c.coordinator.state()).jobs.bazaar.nextAt).toBe(Date.parse('2026-10-02T05:00:00Z'));
});
async function get(c: MarketCollector, path: string) {
  let code = 200,
    body = "";
  const res = {
    setHeader: vi.fn(),
    writeHead(n: number) {
      code = n;
      return this;
    },
    end(text = "") {
      body = text;
      return this;
    },
  };
  await marketHandler(c)(
    { url: path, headers: {}, method: "GET" } as any,
    res as any,
  );
  return { code, body: JSON.parse(body || "null") };
}

it("concurrent cold readers share one decoded snapshot allocation", async () => {
  const now = Date.now(), store = connect(), fetcher = upstream(() => now);
  await new MarketCollector(store, defaultPolicy, fetcher, () => now).tick();
  const reader = new MarketCollector(store, defaultPolicy, fetcher, () => now);
  const reads = vi.spyOn(store, "read");
  const snapshots = await Promise.all(Array.from({ length: 100 }, () => reader.read("bazaar")));
  expect(snapshots[0]).not.toBeNull();
  expect(snapshots.every(s => s === snapshots[0])).toBe(true);
  expect(reads.mock.calls.filter(([key]) => key === "bazaar")).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(7);
});

it("100 backend instances, concurrent users, reloads, filters and tabs issue exactly one shared refresh", async () => {
  const path = database(),
    now = Date.now(),
    fetcher = upstream(() => now, 43);
  const collectors = Array.from(
    { length: 100 },
    () => new MarketCollector(connect(path), defaultPolicy, fetcher, () => now),
  );
  await Promise.all(collectors.map((c) => c.tick()));
  expect(fetcher).toHaveBeenCalledTimes(46); // 43 pages + Bazaar + catalog + election.
  for (let reload = 0; reload < 3; reload++) {
    await Promise.all(
      collectors.map(async (c, i) => {
        const results = await Promise.all([
          get(c, "/api/companion/bazaar"),
          get(
            c,
            `/api/companion/auctions?filters=${encodeURIComponent(JSON.stringify({ query: `search-${i}` }))}&page=${i % 3}`,
          ),
          get(c, `/api/companion/auctions/${"a".repeat(32)}/check`),
          get(c, "/api/companion/raw-bazaar"),
        ]);
        expect(results.every((r) => r.code === 200)).toBe(true);
      }),
    );
  }
  await Promise.all(collectors.map((c) => c.tick()));
  expect(fetcher).toHaveBeenCalledTimes(46);
  expect((await collectors[0].status()).requestBudget.total).toBe(46);
  expect((await collectors[0].status()).intervalMs).toBe(145000);
});
it("read misses and expired caches never trigger upstream requests, and force parameters are rejected", async () => {
  let now = Date.now();
  const fetcher = upstream(() => now),
    c = new MarketCollector(connect(), defaultPolicy, fetcher, () => now);
  expect((await get(c, "/api/companion/auctions")).code).toBe(503);
  expect((await get(c, "/api/companion/bazaar?force=1")).code).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  await c.tick();
  const count = fetcher.mock.calls.length,
    before = await c.store.read("auctions");
  now += 181000;
  expect((await get(c, "/api/companion/auctions")).body.status.stale).toBe(
    true,
  );
  expect((await c.recheck("a".repeat(32))).status).toBe("stale");
  expect(await c.store.read("auctions")).toBe(before);
  expect(fetcher).toHaveBeenCalledTimes(count);
});
it("an unchanged Bazaar generation reuses its complete blob and observation identity", async () => {
  const now=Date.now(), store=connect(), fetcher=upstream(()=>now);
  const c=new MarketCollector(store,defaultPolicy,fetcher,()=>now);
  await c.tick();const snapshot=await store.read("bazaar");
  await c.coordinator.change(state=>{state.jobs.bazaar.nextAt=0;return {result:undefined};});
  const writes=vi.spyOn(store,"commit");await c.tick();
  expect(fetcher).toHaveBeenCalledTimes(8);
  expect(writes.mock.calls.filter(args=>args[3])).toHaveLength(0);
  expect(await store.read("bazaar")).toBe(snapshot);
});
it('an unchanged auction first page prevents another full pagination or upload',async()=>{
  const now=Date.now(),store=connect(),fetcher=upstream(()=>now,43),measure=vi.fn();
  const c=new MarketCollector(store,defaultPolicy,fetcher,()=>now,()=>0,measure);
  await c.tick();const previous=await store.read('auctions');
  await c.coordinator.change(state=>{state.jobs.auctions.nextAt=0;return {result:undefined};});
  const writes=vi.spyOn(store,'commit');await c.tick();
  expect(fetcher).toHaveBeenCalledTimes(47);
  expect(writes.mock.calls.filter(args=>args[3])).toHaveLength(0);
  expect(await store.read('auctions')).toBe(previous);
  expect(measure).toHaveBeenCalledWith('auctionsGenerationProbesUnchanged');
  expect(measure.mock.calls.filter(([name])=>name==='auctionsRefreshesCompleted')).toHaveLength(1);
});
it('unchanged metadata checks preserve blobs and derived versions while refreshing fee verification', async () => {
  let now = Date.now(), generation = now, failElection = false;
  const store = connect(), base = upstream(() => generation), measure = vi.fn();
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    if (failElection && String(input).includes('/election'))
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    return base(input);
  });
  const c = new MarketCollector(store, defaultPolicy, fetcher, () => now, () => 0, measure);
  await c.tick();
  const original = await Promise.all(['catalog','election','bazaar','auctions'].map(k => store.read(k)));
  now += 1000;
  await c.coordinator.change(state => {
    for (const job of Object.values(state.jobs)) job.nextAt = 0;
    return { result: undefined };
  });
  const commits = vi.spyOn(store, 'commit');
  await c.tick();
  expect(commits.mock.calls.filter(args => args[3])).toHaveLength(0);
  expect(await Promise.all(['catalog','election','bazaar','auctions'].map(k => store.read(k)))).toEqual(original);
  expect(measure).toHaveBeenCalledWith('electionSnapshotsUnchanged');
  expect(measure).toHaveBeenCalledWith('catalogSnapshotsUnchanged');
  const checkedAt = now;
  expect((await c.coordinator.state()).jobs.election.lastCheckedAt).toBe(checkedAt);
  now += 60000; generation = now;
  // A new worker must use the shared successful check, not a local timestamp.
  const restarted = new MarketCollector(store, defaultPolicy, fetcher, () => now);
  await restarted.tick();
  expect((await restarted.read<any>('bazaar'))!.data.items[0].feeContext.checkedAt).toBe(checkedAt);
  failElection = true;
  await restarted.coordinator.change(state => { state.jobs.election.nextAt = 0; return {result:undefined}; });
  await restarted.tick();
  // An unavailable fee profile is a real semantic change and must fail closed.
  expect((await restarted.read<any>('election'))!.data.multiplier).toBeNull();
  expect(await store.read('election')).not.toBe(original[1]);
});
it('metadata content changes republish affected market snapshots even within the same source generation', async () => {
  let now = Date.now(), changed = false;
  const generation = now, store = connect(), base = upstream(() => generation);
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    if (String(input).includes('/election') && changed)
      return new Response(JSON.stringify({ success: true, mayor: { name:'Different', perks:[] } }));
    return base(input);
  });
  const c = new MarketCollector(store, defaultPolicy, fetcher, () => now);
  await c.tick();
  const before = await c.read('bazaar');
  changed = true; now += 1000;
  await c.coordinator.change(state => {
    for (const key of ['election','bazaar','auctions']) state.jobs[key].nextAt = 0;
    return { result: undefined };
  });
  const commits = vi.spyOn(store, 'commit');
  await c.tick();
  expect(commits.mock.calls.flatMap(args => args[3] ? [args[3].key] : [])).toEqual(['election','bazaar','auctions']);
  const after = await c.read<any>('bazaar');
  expect(after!.upstreamAt).toBe(before!.upstreamAt);
  expect(after!.version).not.toBe(before!.version);
  expect(after!.data.items[0].feeContext.mayor).toBe('Different');
});
it("atomic publication coordinates separate OS processes, not just JavaScript instances", async () => {
  const path = database();
  connect(path);
  const module = pathToFileURL(
    join(process.cwd(), "collector/cache-store.ts"),
  ).href;
  const run = promisify(execFile);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      run(process.execPath, [
        "--input-type=module",
        "-e",
        `import {SqliteCache} from ${JSON.stringify(module)};const s=new SqliteCache(${JSON.stringify(path)});console.log(await s.commit('winner',null,'${i}',{key:'payload',value:'${i}'}));await s.close();`,
      ]),
    ),
  );
  expect(results.filter((r) => r.stdout.trim() === "true")).toHaveLength(1);
  const s = connect(path);
  expect(await s.read("winner")).toBe(await s.read("payload"));
});
it("payload eviction is cache-only on reads and the independent scheduler recovers", async () => {
  let now = Date.now();
  const s = connect(),
    fetcher = upstream(() => now),
    c = new MarketCollector(s, defaultPolicy, fetcher, () => now);
  await c.tick();
  const before = fetcher.mock.calls.length;
  await s.commit("auctions", await s.read("auctions"), "null");
  const other = new MarketCollector(s, defaultPolicy, fetcher, () => now);
  expect((await get(other, "/api/companion/auctions")).code).toBe(503);
  await other.tick();
  expect(fetcher).toHaveBeenCalledTimes(before);
  now += 120001;
  await other.tick();
  expect((await get(other, "/api/companion/auctions")).code).toBe(200);
});
it("Price Alerts price/book reads bypass authentication and never fetch upstream, including when stale", async () => {
  let now=Date.now();const fetcher=upstream(()=>now),c=new MarketCollector(connect(),defaultPolicy,fetcher,()=>now);
  await c.tick();const count=fetcher.mock.calls.length;
  await Promise.all(Array.from({length:100},async()=>{
    expect((await get(c,"/api/companion/snapshot")).body.prices[0].buy).toBe(100);
    expect((await get(c,"/api/companion/book?itemId=TEST")).body.book.buy[0].pricePerUnit).toBe(100);
  }));
  now+=181000;
  expect((await get(c,"/api/companion/snapshot")).body.status.error).toContain("stale");
  expect((await get(c,"/api/companion/book?itemId=TEST")).code).toBe(503);
  expect(fetcher).toHaveBeenCalledTimes(count);
});
it("counts discovery, stops unaffordable pagination, preserves reserve, survives restart and recovers", async () => {
  let now = Date.now();
  const path = database(),
    fetcher = upstream(() => now, 6),
    policy = { ...defaultPolicy, requestLimit: 10 };
  const c = new MarketCollector(connect(path), policy, fetcher, () => now);
  await c.tick();
  expect(fetcher).toHaveBeenCalledTimes(4); // 3 metadata/Bazaar, then one page-count discovery.
  expect(await c.store.read("auctions")).toBeNull();
  expect((await c.status()).error).toContain("Insufficient shared budget");
  const restarted = new MarketCollector(
    connect(path),
    policy,
    fetcher,
    () => now,
  );
  await restarted.tick();
  expect(fetcher).toHaveBeenCalledTimes(4);
  // After expiry, catalog is cached and all six pages fit beside Bazaar/election.
  now += 300001;
  await restarted.tick();
  expect(await c.store.read("auctions")).not.toBeNull();
  expect((await c.status()).requestBudget.used).toBeLessThanOrEqual(8);
});
it("charges all retries and rejects exhausted budgets before network I/O", async () => {
  let now = Date.now();
  const policy = { ...defaultPolicy, requestLimit: 10 };
  const co = new Coordinator(
    connect(),
    policy,
    () => now,
    () => 0,
  );
  await co.acquire();
  for (let i = 0; i < 8; i++) await co.charge(`page=${i}`, false);
  await expect(co.charge("probe", false)).rejects.toThrow("budget exhausted");
  await co.charge("retry1", true);
  await co.charge("retry2", true);
  await expect(co.charge("retry3", true)).rejects.toThrow("budget exhausted");
  expect((await co.state()).totalRequests).toBe(10);
  now += 300001;
  await co.acquire();
  await co.charge("next", false);
  expect((await co.state()).totalRequests).toBe(11);
});
it("waits until enough staggered charges expire to fit every auction page", async () => {
  let now = Date.now(); const start = now;
  const co = new Coordinator(connect(), { ...defaultPolicy, requestLimit: 10 }, () => now);
  await co.acquire();
  for (let i = 0; i < 7; i++) { now = start + i * 1000; await co.charge(`page=${i}`, false); }
  // Routine capacity is 8: fitting 4 pages requires THREE charges to expire.
  await expect(co.capacity(4)).rejects.toMatchObject({ until: start + 302001 });
});
it("honors shared 429 Retry-After and per-minute rate headers across instances", async () => {
  let now = Date.now();
  const path = database(),
    s = connect(path),
    fetcher = upstream(() => now);
  const limited = vi
    .fn()
    .mockResolvedValueOnce(
      new Response("{}", { status: 429, headers: { "Retry-After": "120" } }),
    )
    .mockImplementation(fetcher);
  const c = new MarketCollector(
    s,
    defaultPolicy,
    limited,
    () => now,
    () => 0,
  );
  await c.tick();
  expect(limited).toHaveBeenCalledTimes(1);
  const other = new MarketCollector(
    connect(path),
    defaultPolicy,
    limited,
    () => now,
  );
  now += 60000;
  await other.tick();
  expect(limited).toHaveBeenCalledTimes(1);
  now += 60001;
  await other.tick();
  expect((await other.status()).error).toBeNull();
  const co = other.coordinator;
  await co.change((c) => {
    c.jobs.auctions.nextAt = 0;
    return { result: undefined };
  });
  await co.acquire();
  await co.headers(
    new Response("{}", {
      headers: {
        "RateLimit-Limit": "2",
        "RateLimit-Remaining": "0",
        "RateLimit-Reset": "60",
      },
    }),
    1,
  );
  await expect(co.charge("probe", false)).rejects.toThrow(
    "header budget exhausted",
  );
  now += 60001;
  await co.acquire();
  await co.charge("after-reset", false);
});
it("failed or mixed pagination cannot replace the last complete snapshot; recovery publishes atomically", async () => {
  let now = Date.now(),
    mixed = false;
  const good = upstream(() => now, 4),
    fetcher = vi.fn(async (input: string | URL | Request) => {
      const r = await good(input),
        data = await r.json();
      if (mixed && String(input).includes("page=2")) data.lastUpdated++;
      return new Response(JSON.stringify(data));
    });
  const c = new MarketCollector(
    connect(),
    defaultPolicy,
    fetcher,
    () => now,
    () => 0,
  );
  await c.tick();
  const prior = await c.store.read("auctions");
  now += 120001;
  mixed = true;
  await c.tick();
  expect(await c.store.read("auctions")).toBe(prior);
  expect((await c.status()).error).toContain("changed during pagination");
  mixed = false;
  now += 5001;
  await c.tick();
  expect(await c.store.read("auctions")).not.toBe(prior);
  expect((await c.status()).error).toBeNull();
});
it("an expired worker cannot publish or spend after another instance takes its lease", async () => {
  let now = Date.now();
  const path = database(),
    a = new Coordinator(connect(path), defaultPolicy, () => now),
    b = new Coordinator(connect(path), defaultPolicy, () => now);
  expect(await a.acquire()).toBe(true);
  expect(await b.acquire()).toBe(false);
  now += defaultPolicy.leaseMs + 1;
  expect(await b.acquire()).toBe(true);
  await expect(
    a.change((c) => {
      a.assert(c);
      return { result: true, payload: { key: "auctions", value: "partial" } };
    }),
  ).rejects.toThrow("lease lost");
  await expect(a.charge("old-worker", false)).rejects.toThrow("lease lost");
  expect(await a.store.read("auctions")).toBeNull();
  await b.change((c) => {
    b.assert(c);
    return { result: true, payload: { key: "auctions", value: "complete" } };
  });
  expect(await a.store.read("auctions")).toBe("complete");
});
it("network retries spend the shared reserve and use bounded backoff", async () => {
  vi.useFakeTimers();
  const co = new Coordinator(connect(), defaultPolicy, Date.now, () => 0);
  await co.acquire();
  const network = vi
    .fn()
    .mockRejectedValueOnce(new Error("network interrupted"))
    .mockResolvedValueOnce(new Response("{}", { status: 503 }))
    .mockResolvedValue(new Response('{"success":true}'));
  const work = co.fetchJson("skyblock/auctions?page=0", network);
  await vi.advanceTimersByTimeAsync(2000);
  await expect(work).resolves.toMatchObject({ data: { success: true } });
  expect(network).toHaveBeenCalledTimes(3);
  expect((await co.state()).requests.map((r) => r.retry)).toEqual([
    false,
    true,
    true,
  ]);
});
it("uses store time for distributed leases and budgets despite host clock skew", async () => {
  let serverNow = Date.now();
  const store = Object.assign(connect(), { time: async () => serverNow });
  const a = new Coordinator(store, defaultPolicy, () => serverNow - 3600000),
    b = new Coordinator(store, defaultPolicy, () => serverNow + 3600000);
  expect(await a.acquire()).toBe(true);
  expect(await b.acquire()).toBe(false);
  await a.charge("page=0", false);
  expect((await a.state()).requests[0].at).toBe(serverNow);
  serverNow += 60001;
  expect(await b.acquire()).toBe(true);
  await expect(a.charge("page=1", false)).rejects.toThrow("lease lost");
});
it("failed pagination drains concurrent pages, retains data and retries after backoff", async () => {
  let now = Date.now(),
    fail = false;
  const good = upstream(() => now),
    policy = { ...defaultPolicy, maxRetries: 0 };
  const fetcher = vi.fn(async (url: string | URL | Request) =>
    fail && String(url).endsWith("page=1")
      ? new Response("{}", { status: 503 })
      : good(url),
  );
  const c = new MarketCollector(
    connect(),
    policy,
    fetcher,
    () => now,
    () => 0,
  );
  await c.tick();
  const prior = await c.store.read("auctions");
  now += 120001;
  fail = true;
  await c.tick();
  expect(await c.store.read("auctions")).toBe(prior);
  expect((await c.status()).error).toContain("503");
  const count = fetcher.mock.calls.length;
  await c.tick();
  expect(fetcher).toHaveBeenCalledTimes(count);
  now += 5001;
  fail = false;
  await c.tick();
  expect((await c.status()).error).toBeNull();
});
it("interval planning includes actual page count, cadence, fetch duration and a 20% reserve", () => {
  expect(auctionInterval(defaultPolicy, 43, 18000)).toBe(145000);
  expect(
    auctionInterval({ ...defaultPolicy, requestLimit: 300 }, 43, 18000),
  ).toBe(120000);
  expect(auctionInterval(defaultPolicy, 43, 200000)).toBe(205000);
  vi.stubEnv("HYPIXEL_RESERVE", "0.19");
  expect(() => configuredPolicy()).toThrow("reserve");
});
it("visible polling pauses hidden tabs, never overlaps, resumes and aborts cleanup", async () => {
  vi.useFakeTimers();
  const doc = new EventTarget() as EventTarget & { visibilityState: string };
  doc.visibilityState = "visible";
  vi.stubGlobal("document", doc);
  let finish: () => void = () => {},
    signal: AbortSignal | undefined;
  const task = vi.fn((s: AbortSignal) => {
    signal = s;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const stop = visiblePoll(task);
  await vi.advanceTimersByTimeAsync(0);
  expect(task).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(15000);
  expect(task).toHaveBeenCalledTimes(1);
  doc.visibilityState = "hidden";
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(signal?.aborted).toBe(true);
  finish();
  await vi.advanceTimersByTimeAsync(60000);
  expect(task).toHaveBeenCalledTimes(1);
  doc.visibilityState = "visible";
  doc.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(task).toHaveBeenCalledTimes(2);
  stop();
  expect(signal?.aborted).toBe(true);
  finish();
  await vi.advanceTimersByTimeAsync(60000);
  expect(task).toHaveBeenCalledTimes(2);
});
