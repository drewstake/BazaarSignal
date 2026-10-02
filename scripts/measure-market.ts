import { writeFileSync, mkdirSync } from "node:fs";
import { configuredStore } from "../collector/cache-store";
import { MarketCollector } from "../collector/engine";
import { configuredPolicy } from "../collector/policy";

// One scheduler pass, using the SAME durable budget/leases as the running service.
// No force flag, separate key, bypass probe, API key output, or completed sales.
const requests: unknown[] = [];
const store = await configuredStore();
const network: typeof fetch = async (url, options) => {
  const start = Date.now();
  try {
    const response = await fetch(url, options);
    requests.push({
      path: new URL(String(url)).pathname + new URL(String(url)).search,
      durationMs: Date.now() - start,
      status: response.status,
      headers: Object.fromEntries(
        [
          "cache-control",
          "age",
          "ratelimit-limit",
          "ratelimit-remaining",
          "ratelimit-reset",
          "retry-after",
        ].map((k) => [k, response.headers.get(k)]),
      ),
    });
    return response;
  } catch (e) {
    requests.push({
      path: new URL(String(url)).pathname,
      durationMs: Date.now() - start,
      error: String(e),
    });
    throw e;
  }
};
const collector = new MarketCollector(store, configuredPolicy(), network);
try {
  await collector.tick();
  const report = {
    measuredAt: new Date().toISOString(),
    requests,
    auctions: await collector.status(),
    bazaar: await collector.status("bazaar"),
  };
  mkdirSync(".local", { recursive: true });
  writeFileSync(
    ".local/market-measurement.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await store.close();
}
