// Offline, repeatable production-browser audit. No collectors, cloud APIs or mail.
// node scripts/profile-app.mjs before|after (writes only .local/audit/)
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const label = process.argv[2] ?? "current";
if (!/^[a-z-]+$/.test(label)) throw new Error("Use a simple audit label");
const out = resolve(".local/audit", label);
await mkdir(out, { recursive: true });
const env = {
  ...process.env,
  VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
  VITE_FIREBASE_API_KEY: "",
  VITE_FIREBASE_AUTH_DOMAIN: "",
  VITE_FIREBASE_PROJECT_ID: "",
  VITE_FIREBASE_APP_ID: "",
  VITE_LOCAL_WORKSPACE: "false",
  VITE_LOCAL_MARKET_PREVIEW: "false",
  LOCAL_SHARED_MARKET: "false",
  VITE_MARKET_API_URL: "/live-market",
  VITE_MARKET_OPERATING_MODE: "paid-budget",
  VITE_MARKET_UPDATES_PAUSED: "false",
  VITE_MARKET_TRIAL_ID: "audit-local",
  VITE_MARKET_TRIAL_END: "2026-11-01T07:00:00Z",
};
const built = spawnSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build", "--outDir", out],
  { env, encoding: "utf8" },
);
await writeFile(resolve(out, "build.txt"), built.stdout + built.stderr);
if (built.status !== 0) throw new Error(built.stdout + built.stderr);
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webp": "image/webp",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const file = resolve(
      out,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!file.startsWith(out + "\\") && !file.startsWith(out + "/"))
      throw new Error("Invalid path");
    const body = await readFile(file);
    res
      .writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(5202, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:5202";
const now = Date.parse("2026-10-15T15:03:00Z");
const usage = {
  mode: "normal",
  pollMs: 3600000,
  trialId: "audit-local",
  expiresAt: Date.parse(env.VITE_MARKET_TRIAL_END),
};
const book = (id) => ({
  id,
  name: id,
  asks: Array.from({ length: 30 }, (_, i) => ({
    pricePerUnit: 100 + i,
    amount: 10 + i,
    orders: 2,
  })),
  bids: Array.from({ length: 30 }, (_, i) => ({
    pricePerUnit: 90 - i,
    amount: 20 + i,
    orders: 3,
  })),
  upstreamAt: now,
  observedAt: now,
});
const browser = await chromium.launch();
const runs = [];
try {
  for (let run = 0; run < 7; run++) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    await page.addInitScript((now) => {
      const OriginalDate = Date;
      window.Date = class extends OriginalDate {
        constructor(...args) {
          super(...(args.length ? args : [now]));
        }
        static now() {
          return now;
        }
      };
    }, now);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    let requests = 0,
      payloadBytes = 0;
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.includes("/api/")) {
        requests++;
        const ids = (url.searchParams.get("assets") ?? "")
          .split(",")
          .map((id) => id.replace(/^bz_/, ""));
        const body = JSON.stringify({
          bazaar: ids.map(book),
          listings: [],
          usage,
        });
        payloadBytes += Buffer.byteLength(body);
        return route.fulfill({ contentType: "application/json", body });
      }
      return route.continue();
    });
    await page.addInitScript(() => {
      window.audit = {
        cacheDecodes: 0,
        cacheDecodeMs: 0,
        longTasks: 0,
        cls: 0,
      };
      const json = Response.prototype.json;
      Response.prototype.json = async function () {
        const start = performance.now();
        const value = await json.call(this);
        if (this.headers.has("X-Cache-Bytes")) {
          window.audit.cacheDecodes++;
          window.audit.cacheDecodeMs += performance.now() - start;
        }
        return value;
      };
      new PerformanceObserver((list) => {
        window.audit.longTasks += list
          .getEntries()
          .reduce((n, e) => n + e.duration, 0);
      }).observe({ type: "longtask", buffered: true });
      new PerformanceObserver((list) => {
        window.audit.cls += list
          .getEntries()
          .filter((e) => !e.hadRecentInput)
          .reduce((n, e) => n + e.value, 0);
      }).observe({ type: "layout-shift", buffered: true });
    });
    const coldStart = performance.now();
    await page.goto(origin);
    const input = page.getByRole("combobox", { name: "Search Bazaar items" });
    await input.waitFor();
    const coldMs = performance.now() - coldStart;
    const coldJs = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((e) => e.name.endsWith(".js"))
        .map((e) => ({ url: e.name, bytes: e.decodedBodySize })),
    );
    const typing = [];
    for (const query of [
      "e",
      "en",
      "enc",
      "ench",
      "encha",
      "enchant",
      "enchanted",
      "cookie",
    ]) {
      const start = performance.now();
      await input.fill(query);
      await page.getByRole("option").first().waitFor();
      typing.push(performance.now() - start);
    }
    const afterTypingRequests = requests;
    const selectionStart = performance.now();
    await input.fill("BOOSTER_COOKIE");
    await input.press("ArrowDown");
    await input.press("Enter");
    await page
      .getByRole("region", { name: "Booster Cookie" })
      .getByText("100 coins", { exact: true })
      .waitFor();
    const selectionMs = performance.now() - selectionStart;
    const coldRequests = requests;
    const warmStart = performance.now();
    await page.reload();
    await page
      .getByRole("region", { name: "Booster Cookie" })
      .getByText("100 coins", { exact: true })
      .waitFor();
    const warmItemMs = performance.now() - warmStart;
    const warmRequests = requests - coldRequests;
    // Approximate a previously downloaded full catalog using complete real-format books.
    const catalog = JSON.parse(
      await readFile("src/companion/bazaar-catalog.json", "utf8"),
    );
    const full = {
      at: now,
      etag: null,
      body: { bazaar: catalog.map(([id]) => book(id)), usage },
    };
    const serialized = JSON.stringify(full);
    await page.evaluate(
      async ({ serialized, origin }) => {
        const cache = await caches.open("bazaarsignal-public-market-v1");
        await cache.put(
          origin + "/live-market/api/companion/bazaar",
          new Response(serialized, {
            headers: {
              "Content-Type": "application/json",
              "X-Cache-Bytes": String(serialized.length * 2),
            },
          }),
        );
        window.audit.cacheDecodes = 0;
        window.audit.cacheDecodeMs = 0;
      },
      { serialized, origin },
    );
    const reuse = [];
    for (let i = 0; i < 12; i++) {
      const id = i % 2 ? "BOOSTER_COOKIE" : "ENCHANTED_DIAMOND";
      const start = performance.now();
      await page.evaluate((id) => {
        location.hash = "view=item&item=" + id;
      }, id);
      await page
        .locator('.bazaar-item-page[aria-busy="false"] h1[title="' + id + '"]')
        .waitFor();
      reuse.push(performance.now() - start);
    }
    const metrics = await page.evaluate(() => window.audit);
    runs.push({
      coldMs,
      coldJs,
      typing,
      afterTypingRequests,
      selectionMs,
      coldRequests,
      warmItemMs,
      warmRequests,
      reuse,
      fullCacheBytes: Buffer.byteLength(serialized),
      requests,
      payloadBytes,
      ...metrics,
      failures,
    });
    await context.close();
  }
  const assets = [];
  for (const name of await readdir(resolve(out, "assets")))
    if (/\.(js|css)$/.test(name)) {
      const body = await readFile(resolve(out, "assets", name));
      assets.push({ name, bytes: body.length, gzip: gzipSync(body).length });
    }
  const median = (values) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = {
    label,
    cpuThrottle: 4,
    samples: runs.length,
    network: "loopback, mocked APIs; browser HTTP cache disabled by routing",
    coldMs: median(runs.map((r) => r.coldMs)),
    initialJsBytes: runs[0].coldJs.reduce((n, r) => n + r.bytes, 0),
    warmItemMs: median(runs.map((r) => r.warmItemMs)),
    typingMs: median(runs.flatMap((r) => r.typing)),
    reuseMs: median(runs.flatMap((r) => r.reuse)),
    cacheDecodes: runs.map((r) => r.cacheDecodes),
    cacheDecodeMs: median(runs.map((r) => r.cacheDecodeMs)),
    fullCacheBytes: runs[0].fullCacheBytes,
    coldRequests: runs.map((r) => r.coldRequests),
    warmRequests: runs.map((r) => r.warmRequests),
    totalRequests: runs.map((r) => r.requests),
    payloadBytes: runs.map((r) => r.payloadBytes),
    assets,
  };
  await writeFile(
    resolve(out, "metrics.json"),
    JSON.stringify({ summary, runs }, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
