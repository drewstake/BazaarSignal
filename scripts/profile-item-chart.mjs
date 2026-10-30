// Offline production React profile; synthetic data, no market requests.
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const label = process.argv[2] ?? "current";
if (!/^[a-z-]+$/.test(label)) throw new Error("Invalid label");
const out = resolve(".local/audit", `item-chart-${label}`);
await mkdir(out, { recursive: true });
await build({
  stdin: {
    contents: `
import React, {Profiler} from 'react';
import {createRoot} from 'react-dom/profiling';
import Chart from './src/companion/BazaarPriceChart';
import {bazaarPriceHistoryKey} from './src/companion/bazaar-price-history';
import {marketUrl} from './src/companion/api';
const now = Date.now();
const points = Array.from({length:2160}, (_,i)=>({at:now-(2159-i)*3600000,buy:14000000+Math.sin(i/30)*100000,sell:13000000+Math.cos(i/30)*100000}));
localStorage.clear();
localStorage.setItem(bazaarPriceHistoryKey(marketUrl('bazaar'),'BOOSTER_COOKIE'), JSON.stringify({version:1,points}));
window.chartRenders=[];
createRoot(document.getElementById('root')).render(<Profiler id="chart" onRender={(_id,phase,duration)=>window.chartRenders.push({phase,duration})}><Chart itemId="BOOSTER_COOKIE" detail={{}} now={now}/></Profiler>);
`,
    loader: "tsx",
    resolveDir: process.cwd(),
  },
  outfile: resolve(out, "chart.js"),
  bundle: true,
  minify: true,
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env": '{"DEV":false}',
  },
  jsx: "automatic",
});
const server = createServer(async (req, res) => {
  const name =
    req.url === "/chart.js"
      ? "chart.js"
      : req.url === "/chart.css"
        ? "chart.css"
        : null;
  if (!name)
    return res
      .setHeader("Content-Type", "text/html")
      .end(
        '<html><head><link rel="stylesheet" href="/chart.css"></head><body style="margin:30px;background:#102030;color:white;font-family:Arial"><div id="root" class="night-workspace bazaar-item-page"></div><script type="module" src="/chart.js"></script></body></html>',
      );
  res
    .setHeader(
      "Content-Type",
      name.endsWith(".js") ? "text/javascript" : "text/css",
    )
    .end(await readFile(resolve(out, name)));
});
await new Promise((done) => server.listen(5204, "127.0.0.1", done));
const browser = await chromium.launch();
const samples = [];
try {
  for (let run = 0; run < 5; run++) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === "http://127.0.0.1:5204"
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto("http://127.0.0.1:5204");
    await page.getByRole("button", { name: "Device observations", exact: true }).click();
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByRole("img", { name: /2160 saved snapshots/ }).waitFor();
    const layout = await page.evaluate(() => ({
      plotElements: document.querySelectorAll(".item-chart-plot *").length,
      savedCharacters: localStorage.getItem(
        Object.keys(localStorage).find((key) =>
          key.startsWith("bazaarsignal-item-prices-"),
        ),
      ).length,
      initialRenders: window.chartRenders,
    }));
    const slider = page.getByRole("slider");
    await slider.focus();
    await slider.press("Home");
    await page.evaluate(() => {
      window.chartRenders = [];
    });
    for (let index = 0; index < 30; index++) await slider.press("ArrowRight");
    samples.push({
      ...layout,
      cursorRenders: await page.evaluate(() => window.chartRenders),
    });
    if (!run)
      await page.screenshot({
        path: resolve(out, "chart.png"),
        fullPage: true,
      });
    await context.close();
  }
  const durations = samples
    .flatMap((sample) => sample.cursorRenders.map((render) => render.duration))
    .sort((a, b) => a - b);
  const summary = {
    label,
    points: 2160,
    synthetic: true,
    cpuThrottle: 4,
    runs: samples.length,
    plotElements: samples[0].plotElements,
    savedCharacters: samples[0].savedCharacters,
    updates: durations.length,
    medianCursorRenderMs: durations[Math.floor(durations.length / 2)],
  };
  await mkdir(".local/measurements", { recursive: true });
  await writeFile(
    `.local/measurements/item-price-chart-${label}.json`,
    JSON.stringify({ summary, samples }, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
