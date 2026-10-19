import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { HistoryStore } from "../collector/history-store";
import { decodeSkytrack, decodeBazaarCalc } from "../collector/history-sources";
import { historyDownload } from "../collector/history-download";
import {
  historyDayLabel,
  validHistoryItem,
} from "../shared/daily-price-history";

const root = ".local/history-import";
mkdirSync(`${root}/downloads`, { recursive: true });
const store = new HistoryStore();
const indexFile = `${root}/skytrack-index.json`,
  treeFile = `${root}/bazaar-calc-tree.json`;
async function metadata(path: string, url: string) {
  if (!existsSync(path))
    writeFileSync(path, await historyDownload(url, 16 * 1024 ** 2));
  return JSON.parse(readFileSync(path, "utf8"));
}
const tree = await metadata(
  treeFile,
  "https://api.github.com/repos/Goofythesecond/bazaar-calc/git/trees/HEAD?recursive=1",
);
if (tree.truncated || !/^[a-f0-9]{40}$/.test(tree.sha))
  throw new Error("Incomplete repository tree");
const index = await metadata(
  indexFile,
  "https://skytrack.twango.dev/search-index.json",
);
if (!Array.isArray(index)) throw new Error("Invalid Skytrack directory");
for (const name of ["LICENSE", "NOTICE.md"]) {
  const path = `${root}/bazaar-calc-${name}.txt`;
  if (!existsSync(path))
    writeFileSync(
      path,
      await historyDownload(
        `https://raw.githubusercontent.com/Goofythesecond/bazaar-calc/${tree.sha}/${name}`,
        128 * 1024,
      ),
    );
}
const tasks: {
  source: "skytrack" | "bazaar-calc";
  item?: string;
  url: string;
  hash?: string;
  size?: number;
}[] = [];
for (const entry of index.filter((r: any) => r.kind === "bazaar")) {
  if (!/^[a-z0-9.-]{1,100}$/.test(entry.slug))
    throw new Error("Unexpected Skytrack slug");
  const item = entry.slug
    .toUpperCase()
    .replaceAll("-", "_")
    .replaceAll(".", ":");
  if (validHistoryItem(item))
    tasks.push({
      source: "skytrack",
      item,
      url: `https://skytrack.twango.dev/data/items/${entry.slug}.json`,
    });
}
for (const file of tree.tree) {
  if (
    file.type === "blob" &&
    /^data\/contrib\/[A-Za-z0-9_/-]+\.json\.gz$/.test(file.path)
  )
    tasks.push({
      source: "bazaar-calc",
      url: `https://raw.githubusercontent.com/Goofythesecond/bazaar-calc/${tree.sha}/${file.path}`,
      hash: file.sha,
      size: file.size,
    });
}
// Bazaar Calc first, so older days are usable while the larger Skytrack import runs.
tasks.sort(
  (a, b) => a.source.localeCompare(b.source) || a.url.localeCompare(b.url),
);
let next = 0,
  done = 0,
  resumed = 0;
const failures: { url: string; error: string }[] = [];
const unavailable: { url: string; error: string }[] = [];
console.log(
  JSON.stringify({
    tasks: tasks.length,
    commit: tree.sha,
    database: process.env.PRICE_HISTORY_FILE ?? ".local/price-history.sqlite",
  }),
);
async function worker() {
  while (next < tasks.length) {
    const task = tasks[next++];
    if (store.imported(task.url)) {
      resumed++;
      done++;
      continue;
    }
    const cache = `${root}/downloads/${createHash("sha256").update(task.url).digest("hex")}.gz`;
    try {
      let body: Buffer | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          body = existsSync(cache)
            ? gunzipSync(readFileSync(cache), {
                maxOutputLength: 16 * 1024 ** 2,
              })
            : await historyDownload(task.url, 16 * 1024 ** 2);
          break;
        } catch (error) {
          if (
            attempt === 2 ||
            /HTTP (400|401|403|404|410):/.test(String(error))
          )
            throw error;
          await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        }
      }
      if (!body) throw new Error("No response");
      if (task.hash) {
        const hash = createHash("sha1")
          .update(`blob ${body.length}\0`)
          .update(body)
          .digest("hex");
        if (hash !== task.hash || body.length !== task.size)
          throw new Error("Git blob verification failed");
      }
      const decoded =
        task.source === "bazaar-calc"
          ? decodeBazaarCalc(
              JSON.parse(
                gunzipSync(body, { maxOutputLength: 128 * 1024 ** 2 }).toString(
                  "utf8",
                ),
              ),
              task.url,
            )
          : decodeSkytrack(
              task.item!,
              JSON.parse(body.toString("utf8")),
              task.url,
            );
      if (!existsSync(cache)) writeFileSync(cache, gzipSync(body));
      store.save(decoded.rows.values(), {
        reference: task.url,
        sha256: createHash("sha256").update(body).digest("hex"),
        bytes: body.length,
        observations: decoded.count(),
      });
    } catch (error) {
      const entry = { url: task.url, error: String(error) };
      if (task.source === "skytrack" && /HTTP (404|410):|Missing Skytrack Bazaar history/.test(entry.error)) {
        unavailable.push(entry);
      } else {
        failures.push(entry);
        console.error(JSON.stringify(entry));
      }
    }
    done++;
    if (done % 50 === 0 || done === tasks.length)
      console.log(
        JSON.stringify({
          done,
          total: tasks.length,
          resumed,
          failed: failures.length,
          unavailable: unavailable.length,
        }),
      );
    await new Promise((r) => setTimeout(r, 150));
  }
}
try {
  await Promise.all(Array.from({ length: 4 }, worker));
  const report = {
    completedAt: new Date().toISOString(),
    commit: tree.sha,
    tasks: tasks.length,
    resumed,
    failures,
    unavailable,
    cutoff:
      "Fixed EST (UTC-05:00); last actual observation in each completed day; no interpolation",
    summary: store.summary(),
    boosterCookie: store
      .prices("BOOSTER_COOKIE")
      .map((p: any) => ({ ...p, date: historyDayLabel(p.day) })),
  };
  writeFileSync(`${root}/report.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      ...report,
      failures: failures.length,
      unavailable: unavailable.length,
      boosterCookie: `${report.boosterCookie.length} days`,
    }),
  );
  if (failures.length) process.exitCode = 1;
} finally {
  store.close();
}
