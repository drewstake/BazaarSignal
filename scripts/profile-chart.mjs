// Offline React production-profiler harness for the full retained 5,000-point chart.
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const label = process.argv[2] ?? "current";
if (!/^[a-z-]+$/.test(label)) throw new Error("Invalid label");
const out = resolve(".local/audit", `chart-${label}`);
await mkdir(out, { recursive: true });
const source = `import React, {Profiler} from 'react';
import {createRoot} from 'react-dom/profiling';
import Chart from './src/companion/PortfolioValueChart';
import {portfolioValueHistoryKey} from './src/companion/portfolio-value-history';
const now=Date.now();
localStorage.setItem(portfolioValueHistoryKey('audit','chart'), JSON.stringify({version:1,signature:'audit',points:Array.from({length:5000},(_,i)=>({at:now-(5000-i)*10000,sampledAt:now-(5000-i)*10000,value:1000000+Math.sin(i/30)*100000,stale:false}))}));
window.chartRenders=[];
createRoot(document.getElementById('root')).render(<Profiler id="chart" onRender={(_id,_phase,duration)=>window.chartRenders.push(duration)}><Chart uid="audit" portfolioId="chart" totals={{rows:[],value:1000000,missing:0,stale:false}} loading={false} fixture={false}/></Profiler>);`;
await build({
  stdin: { contents: source, loader: "tsx", resolveDir: process.cwd() },
  outfile: resolve(out, "chart.js"),
  bundle: true,
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
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
        '<html><head><link rel="stylesheet" href="/chart.css"></head><body style="margin:30px;background:#102030;color:white"><div id="root"></div><script type="module" src="/chart.js"></script></body></html>',
      );
  res
    .setHeader(
      "Content-Type",
      name.endsWith(".js") ? "text/javascript" : "text/css",
    )
    .end(await readFile(resolve(out, name)));
});
await new Promise((resolve) => server.listen(5203, "127.0.0.1", resolve));
const browser = await chromium.launch();
const samples = [];
try {
  for (let i = 0; i < 7; i++) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto("http://127.0.0.1:5203");
    const slider = page.getByRole("slider");
    await slider.focus();
    await slider.press("Home");
    await page.evaluate(() => {
      window.chartRenders = [];
    });
    for (let j = 0; j < 30; j++) await slider.press("ArrowRight");
    samples.push(await page.evaluate(() => window.chartRenders));
    await context.close();
  }
  const values = samples.flat().sort((a, b) => a - b);
  const summary = {
    label,
    points: 5000,
    cpuThrottle: 4,
    samples: 7,
    updates: values.length,
    medianRenderMs: values[Math.floor(values.length / 2)],
    totalRenderMs: values.reduce((a, b) => a + b, 0),
  };
  await writeFile(
    resolve(out, "metrics.json"),
    JSON.stringify({ summary, samples }, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
