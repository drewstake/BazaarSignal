// Offline replay only. No credentials, sockets, production reads or collection.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { offlineGoogle } from "../tests/support/offline-google";
import { trialGoogleStore } from "../collector/trial-google";
import { MarketCollector } from "../collector/engine";
import { defaultPolicy } from "../collector/policy";

let now = Date.now();
const saved = Object.fromEntries(
  ["bazaar", "catalog"].map((key) => [
    key,
    JSON.parse(
      gunzipSync(
        readFileSync(".local/zero-cost-backup/" + key + ".json.gz"),
      ).toString(),
    ).data,
  ]),
);
const f = offlineGoogle(() => now);
const config = { ...f.config, inlineSmallSnapshots: true };
let upstream = 0;
const network: typeof fetch = async (input) => {
  upstream++;
  const path = new URL(String(input)).pathname;
  const data = path.endsWith("/items")
    ? {
        items: Object.entries(saved.catalog).map(([id, item]) => ({
          id,
          ...(item as object),
        })),
      }
    : path.endsWith("/election")
      ? { mayor: { name: "Offline fixture", perks: [] } }
      : path.endsWith("/bazaar")
        ? { ...saved.bazaar.raw, lastUpdated: now }
        : null;
  if (!data) throw new Error("Unsupported offline source: " + path);
  return Response.json({ success: true, ...data });
};
const collector = () =>
  new MarketCollector(
    trialGoogleStore(config),
    defaultPolicy,
    network,
    () => now,
  );
const results: unknown[] = [];
async function measure(name: string, work: () => Promise<unknown>) {
  const counts = { ...f.counts },
    calls = upstream,
    cpu = process.cpuUsage(),
    start = performance.now();
  const detail = await work(),
    usage = process.cpuUsage(cpu);
  results.push({
    name,
    wallMs: performance.now() - start,
    processCpuMs: (usage.user + usage.system) / 1000,
    upstream: upstream - calls,
    operations: Object.fromEntries(
      Object.entries(f.counts).map(([key, n]) => [key, n - (counts[key] ?? 0)]),
    ),
    detail,
  });
}
await measure("cold shared Bazaar collection", () => collector().tick());
now += 60001;
await measure("changed Bazaar generation after restart", () =>
  collector().tick(),
);
const c = collector(),
  assets = saved.bazaar.items.slice(0, 3).map((item: any) => "bz_" + item.id);
await measure("20 cached selected-asset reads, no upstream work", async () => {
  const values = await Promise.all(
    Array.from({ length: 20 }, () => c.portfolioPrices(assets)),
  );
  return {
    reads: values.length,
    gzipBytesPerResponse: gzipSync(JSON.stringify(values[0])).length,
  };
});
await measure("not-due scheduler tick, no writes", () => collector().tick());
const report = {
  schema: "bazaar-only-offline-v1",
  at: new Date().toISOString(),
  warning:
    "Local replay and modeled RPC counts only, not cloud billed execution or activation evidence. No admission/finish or user traffic included.",
  products: saved.bazaar.items.length,
  results,
};
mkdirSync(".local/market-audit", { recursive: true });
writeFileSync(
  ".local/market-audit/bazaar-only.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
