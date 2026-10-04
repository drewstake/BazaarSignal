// Offline only. Input artifacts are read; production clients are never constructed.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { offlineGoogle } from "../tests/support/offline-google";
import { trialGoogleStore } from "../collector/trial-google";
import {
  createLiveRuntime,
  livePolicy,
  liveMaximums,
  liveDailyMaximums,
  pacificDay,
} from "../collector/allowance-live";
import { MarketCollector } from "../collector/engine";
import { emptyJob } from "../collector/coordinator";

const label = process.argv[2];
if (!/^(before|after)$/.test(label)) throw new Error("Pass before or after");
const at = Date.parse("2026-10-03T08:00:00Z");
let simulatedNow = at;
// Deterministic latency for coordination/lease accounting, separate from measured
// local performance.now()/CPU. Every RPC advances time; no timestamps collapse.
Date.now = () => simulatedNow;
function fixture() {
  const f = offlineGoogle(() => simulatedNow),
    transport = f.config.network;
  f.config.network = async (input, init) => {
    simulatedNow += 5;
    return transport(input, init);
  };
  return f;
}
const snapshots = Object.fromEntries(
  ["catalog", "election", "bazaar", "auctions"].map((key) => {
    const original = JSON.parse(
      gunzipSync(
        readFileSync(`.local/zero-cost-backup/${key}.json.gz`),
      ).toString(),
    );
    const delta = at - original.upstreamAt;
    // Replay the real complete payload as fresh, preserving relative listing age
    // and expiry. Never write these adjusted values back to the saved evidence.
    const move = (value: any): void => {
      if (!value || typeof value !== "object") return;
      for (const [k, v] of Object.entries(value)) {
        if (
          /^(upstreamAt|observedAt|checkedAt|lastUpdated|start|end|updatedAt)$/.test(
            k,
          ) &&
          typeof v === "number" &&
          v > 1e12
        )
          value[k] = v + delta;
        else move(v);
      }
    };
    move(original);
    return [key, JSON.stringify(original)];
  }),
);
const saved = Object.fromEntries(
  Object.entries(snapshots).map(([k, v]) => [k, JSON.parse(v)]),
);
const fixtures = Object.fromEntries(
  Object.entries(snapshots).map(([k, v]) => [
    k,
    {
      jsonBytes: Buffer.byteLength(v),
      compressedBytes: gzipSync(v).length,
      records:
        k === "auctions"
          ? saved[k].data.listings.length
          : k === "bazaar"
            ? saved[k].data.items.length
            : Object.keys(saved[k].data).length,
    },
  ]),
);
const results: any[] = [];
async function measure(name: string, work: () => Promise<any>) {
  simulatedNow = at;
  global.gc?.();
  const cpu = process.cpuUsage(),
    start = performance.now(),
    memory = process.memoryUsage();
  const result = await work();
  const usage = process.cpuUsage(cpu);
  results.push({
    name,
    wallMs: performance.now() - start,
    processCpuMs: (usage.user + usage.system) / 1000,
    heapBefore: memory.heapUsed,
    heapAfter: process.memoryUsage().heapUsed,
    rss: process.memoryUsage().rss,
    maxRssBytes: process.resourceUsage().maxRSS * 1024,
    ...result,
  });
}
await measure(
  "20 complete-snapshot browser requests; cold then warm runtime",
  async () => {
    const f = fixture();
    for (const [key, value] of Object.entries(snapshots))
      f.snapshot(key, value);
    f.seed(
      "control",
      JSON.stringify({
        revision: 1,
        policy: livePolicy,
        lease: null,
        requests: [],
        totalRequests: 0,
        blockedUntil: 0,
        header: null,
        jobs: Object.fromEntries(
          Object.entries(saved).map(([key, s]) => [
            key,
            {
              ...emptyJob(),
              observedAt: s.observedAt,
              upstreamAt: s.upstreamAt,
              nextAt: at + 3_600_000,
            },
          ]),
        ),
      }),
    );
    f.seed(
      "live-allowance",
      JSON.stringify({
        version: 1,
        id: "free-offline",
        startsAt: at - 1,
        expiresAt: at + 86_400_000,
        monthlyLimits: liveMaximums,
        monthlyReserved: {},
        dailyLimits: liveDailyMaximums,
        dailyReserved: {},
        day: pacificDay(at),
        observed: {},
        evidence: "offline",
      }),
    );
    let shutdowns = 0,
      upstream = 0,
      bodyBytes = 0;
    const runtime = createLiveRuntime({
      id: "free-offline",
      expiresAt: at + 86_400_000,
      now: () => simulatedNow,
      store: (session) => trialGoogleStore(f.config, session),
      shutdown: async () => {
        shutdowns++;
      },
      network: async () => {
        upstream++;
        throw new Error("Browser must not collect");
      },
    });
    for (let i = 0; i < 20; i++) {
      let status = 0;
      await runtime.handle(
        {
          method: "GET",
          url: i % 2 ? "/api/companion/auctions" : "/api/companion/bazaar",
          headers: { "accept-encoding": "gzip" },
        } as any,
        {
          headersSent: false,
          setHeader() {},
          writeHead(n: number) {
            status = n;
            return this;
          },
          end(data: Buffer) {
            bodyBytes += data?.length ?? 0;
          },
        } as any,
      );
      if (status !== 200) throw new Error(`Browser fixture failed: ${status}`);
    }
    const ledger = JSON.parse(f.read("live-allowance")!);
    return {
      ...f.counts,
      upstream,
      shutdowns,
      bodyBytes,
      observed: ledger.observed,
      dailyReserved: ledger.dailyReserved,
      monthlyReserved: ledger.monthlyReserved,
    };
  },
);

// Real saved Bazaar and catalog contents, plus a full-size synthetic auction set.
// The normalized backup cannot reconstruct original NBT; disclose this limitation.
const string = (s: string) => {
  const b = Buffer.from(s),
    n = Buffer.alloc(2);
  n.writeUInt16BE(b.length);
  return Buffer.concat([n, b]);
};
const tag = (t: number, name: string, data: Buffer) =>
  Buffer.concat([Buffer.from([t]), string(name), data]);
const nbt = gzipSync(
  tag(
    10,
    "",
    Buffer.concat([
      tag(
        9,
        "i",
        Buffer.concat([
          Buffer.from([10, 0, 0, 0, 1]),
          tag(1, "Count", Buffer.from([1])),
          tag(
            10,
            "tag",
            Buffer.concat([
              tag(
                10,
                "ExtraAttributes",
                Buffer.concat([
                  tag(8, "id", string("DIAMOND")),
                  Buffer.from([0]),
                ]),
              ),
              Buffer.from([0]),
            ]),
          ),
          Buffer.from([0]),
        ]),
      ),
      Buffer.from([0]),
    ]),
  ),
).toString("base64");
for (const pageCount of [45, 90])
  await measure(`${pageCount}-page complete synthetic collection`, async () => {
    const f = fixture(),
      store = trialGoogleStore(f.config);
    // Force all phases due. Preexisting immutable data also exercises their reads.
    for (const [key, value] of Object.entries(snapshots))
      f.snapshot(key, value);
    let requests = 0,
      upstreamBytes = 0;
    const count =
      pageCount === 45 ? saved.auctions.data.listings.length : 80000;
    const perPage = Math.ceil(count / pageCount);
    const network: typeof fetch = async (input) => {
      simulatedNow += 20;
      const url = new URL(String(input));
      requests++;
      const page = Number(url.searchParams.get("page"));
      const data = url.pathname.endsWith("/items")
        ? {
            items: Object.entries(saved.catalog.data).map(([id, x]: any) => ({
              id,
              ...x,
            })),
          }
        : url.pathname.endsWith("/election")
          ? { mayor: { name: "Diana", perks: [] } }
          : url.pathname.endsWith("/bazaar")
            ? { ...saved.bazaar.data.raw, lastUpdated: at }
            : {
                page,
                totalPages: pageCount,
                totalAuctions: count,
                lastUpdated: at,
                auctions: Array.from(
                  {
                    length: Math.max(
                      0,
                      Math.min(perPage, count - page * perPage),
                    ),
                  },
                  (_, j) => ({
                    uuid: (page * perPage + j).toString(16).padStart(32, "0"),
                    auctioneer: "b".repeat(32),
                    bin: true,
                    starting_bid: 100 + j,
                    start: at - 1000,
                    end: at + 86_400_000,
                    item_bytes: nbt,
                  }),
                ),
              };
      const text = JSON.stringify({ success: true, ...data });
      upstreamBytes += Buffer.byteLength(text);
      return new Response(text, {
        headers: { "Cache-Control": "public, max-age=60" },
      });
    };
    const observed: Record<string, number> = {};
    const collector = new MarketCollector(
      store,
      livePolicy,
      network,
      () => simulatedNow,
      () => 0,
      (k, n = 1) => {
        observed[k] = (observed[k] ?? 0) + n;
      },
    );
    const coldStart = performance.now(),
      coldCpu = process.cpuUsage();
    await collector.tick();
    const coldUse = process.cpuUsage(coldCpu);
    const control = JSON.parse(f.read("control")!);
    if (control.jobs.auctions.error)
      throw new Error(control.jobs.auctions.error);
    const initial = {
      ...f.counts,
      requests,
      upstreamBytes,
      listings: count,
      observed: { ...observed },
      timing: {
        wallMs: performance.now() - coldStart,
        cpuMs: (coldUse.user + coldUse.system) / 1000,
      },
    };
    // A second complete generation tests steady-state work and unchanged metadata.
    simulatedNow = at + 3_600_000 + 10_000;
    // Shift source times through a wrapper while keeping the complete fixture.
    const nextNetwork: typeof fetch = async (input, init) => {
      const response = await network(input, init),
        data = await response.json();
      if (data.lastUpdated) data.lastUpdated = at + 3_600_000;
      return Response.json(data, { headers: response.headers });
    };
    const next = new MarketCollector(
      trialGoogleStore(f.config),
      livePolicy,
      nextNetwork,
      () => simulatedNow,
      () => 0,
      (k, n = 1) => {
        observed[k] = (observed[k] ?? 0) + n;
      },
    );
    const steadyStart = performance.now(),
      steadyCpu = process.cpuUsage();
    await next.tick();
    const steadyUse = process.cpuUsage(steadyCpu);
    const nextControl = JSON.parse(f.read("control")!);
    if (nextControl.jobs.auctions.error)
      throw new Error(nextControl.jobs.auctions.error);
    const steady = Object.fromEntries(
      Object.entries(f.counts).map(([k, v]) => [
        k,
        v - ((initial as any)[k] ?? 0),
      ]),
    );
    if (requests === initial.requests)
      throw new Error("Steady-state collection was not due");
    const steadyResult = {
      ...steady,
      requests: requests - initial.requests,
      upstreamBytes: upstreamBytes - initial.upstreamBytes,
      timing: {
        wallMs: performance.now() - steadyStart,
        cpuMs: (steadyUse.user + steadyUse.system) / 1000,
      },
    };
    const beforeFailure = { ...f.counts },
      failedRequests = requests;
    simulatedNow = at + 2 * 3_600_000 + 20_000;
    const mixed: typeof fetch = async (input, init) => {
      const response = await network(input, init),
        data = await response.json();
      if (data.lastUpdated)
        data.lastUpdated = at + 2 * 3_600_000 + (data.page === 22 ? 1 : 0);
      return Response.json(data, { headers: response.headers });
    };
    const failureStart = performance.now(),
      failureCpu = process.cpuUsage();
    await new MarketCollector(
      trialGoogleStore(f.config),
      livePolicy,
      mixed,
      () => simulatedNow,
      () => 0,
    ).tick();
    const failureUse = process.cpuUsage(failureCpu),
      failedControl = JSON.parse(f.read("control")!);
    if (
      !failedControl.jobs.auctions.error?.includes(
        "changed during pagination",
      ) ||
      failedControl.jobs.auctions.observedAt !==
        nextControl.jobs.auctions.observedAt
    )
      throw new Error("Mixed generation replaced complete snapshot");
    return {
      ...initial,
      timingScope: "cold, steady and mixed-generation failure in this process",
      steady: steadyResult,
      mixedFailure: {
        ...Object.fromEntries(
          Object.entries(f.counts).map(([k, v]) => [
            k,
            v - (beforeFailure[k] ?? 0),
          ]),
        ),
        requests: requests - failedRequests,
        previousAuctionPreserved: true,
        timing: {
          wallMs: performance.now() - failureStart,
          cpuMs: (failureUse.user + failureUse.system) / 1000,
        },
      },
    };
  });
mkdirSync(".local/market-audit", { recursive: true });
writeFileSync(
  `.local/market-audit/${label}.json`,
  JSON.stringify(
    {
      platform: `${process.platform}/${process.arch} ${process.version}`,
      fixtures,
      results,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    results.map(
      ({
        name,
        wallMs,
        processCpuMs,
        firestoreReads,
        firestoreWrites,
        firestoreWriteAttempts,
        casConflicts,
        storageClassB,
        downloadBytes,
        dailyReserved,
        maxRssBytes,
      }) => ({
        name,
        wallMs,
        processCpuMs,
        firestoreReads,
        firestoreWrites,
        firestoreWriteAttempts,
        casConflicts,
        storageClassB,
        downloadBytes,
        dailyReserved,
        maxRssBytes,
      }),
    ),
    null,
    2,
  ),
);
