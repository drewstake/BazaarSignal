// Compare existing audit builds over a controlled slow connection, offline.
// First capture builds with profile-app.mjs; this never rebuilds or calls APIs.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { chromium } from "@playwright/test";

const origin = "http://127.0.0.1:5204";
let directory;
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, origin).pathname);
    const file = resolve(
      directory,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!file.startsWith(directory + "\\") && !file.startsWith(directory + "/"))
      throw new Error("Invalid path");
    response
      .writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      })
      .end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(5204, "127.0.0.1", resolve));
const browser = await chromium.launch();
const runs = [];
try {
  for (let sample = 0; sample < 5; sample++) {
    for (const label of ["before", "after"]) {
      directory = resolve(".local/audit", label);
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage();
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      );
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 60,
        downloadThroughput: 750000,
        uploadThroughput: 250000,
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      const started = performance.now();
      const extension = label === "before" ? "png" : "webp";
      const artwork = ["scene-only", "reference"].map(async (name) => {
        const response = await page.waitForResponse(
          (response) =>
            response.url() ===
            `${origin}/assets/night-market/${name}.${extension}`,
        );
        if (!response.ok())
          throw new Error(`Artwork unavailable: ${response.url()}`);
        await response.finished();
      });
      await page.goto(origin);
      await page
        .getByRole("combobox", { name: "Search Bazaar items" })
        .waitFor();
      const loadedMs = performance.now() - started;
      await Promise.all(artwork);
      const artworkLoadedMs = performance.now() - started;
      const resources = await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .filter((entry) => entry.name.startsWith(location.origin))
          .map((entry) => ({
            url: new URL(entry.name).pathname,
            bytes: entry.decodedBodySize,
          })),
      );
      runs.push({ label, loadedMs, artworkLoadedMs, resources });
      if (sample === 0)
        await page.screenshot({
          path: resolve(".local/audit", `load-${label}.png`),
          fullPage: true,
        });
      await context.close();
    }
  }
  const median = (values) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = ["before", "after"].map((label) => ({
    label,
    samples: 5,
    medianLoadMs: median(
      runs.filter((run) => run.label === label).map((run) => run.loadedMs),
    ),
    medianArtworkLoadedMs: median(
      runs
        .filter((run) => run.label === label)
        .map((run) => run.artworkLoadedMs),
    ),
    resourceBytes: runs
      .find((run) => run.label === label)
      .resources.reduce((total, resource) => total + resource.bytes, 0),
  }));
  const output = {
    method:
      "Alternating builds, Chromium, 4x CPU, 6 Mbps download, 60 ms latency, fresh browser context, HTTP cache disabled, external URLs blocked. Measures load event plus usable search, then completion of both large landing images; local static server sends uncompressed JS/CSS. No cloud requests.",
    summary,
    runs,
  };
  await writeFile(
    resolve(".local/audit/slow-load.json"),
    JSON.stringify(output, null, 2),
  );
  console.log(JSON.stringify({ method: output.method, summary }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
