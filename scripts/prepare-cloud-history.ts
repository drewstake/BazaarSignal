import { DatabaseSync } from "node:sqlite";
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  encodeHistory,
  historyDocument,
  historyShard,
  historyYear,
  mergeCloudPrice,
  type HistoryShard,
} from "../collector/cloud-price-history";
import { historyDay, type DailyPrice } from "../shared/daily-price-history";
const db = new DatabaseSync(
  process.env.PRICE_HISTORY_FILE ?? ".local/price-history.sqlite",
  { readOnly: true },
);
const documents = new Map<string, HistoryShard>();
const today = historyDay(Date.now());
try {
  const rows = db
    .prepare(
      `SELECT item,day,at,buy,sell,source,reference FROM daily_prices WHERE day<? ORDER BY item,day,at`,
    )
    .iterate(today);
  for (const row of rows) {
    const point = row as unknown as DailyPrice;
    const year = historyYear(point.day),
      key = historyDocument(year, historyShard(point.item));
    const shard = documents.get(key) ?? {
      version: 1 as const,
      year,
      items: {},
    };
    mergeCloudPrice((shard.items[point.item] ??= []), point);
    documents.set(key, shard);
  }
  const packed = [...documents]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, value]) => ({ id, packed: encodeHistory(value) }));
  const years = [...new Set([...documents.values()].map((s) => s.year))].sort();
  if (years.length > 14 || packed.length > 14 * 32)
    throw Error("Seed exceeds history bound");
  const encodedBytes = packed.reduce(
    (n, r) => n + Buffer.byteLength(r.packed),
    0,
  );
  const itemDays = [...documents.values()].reduce(
    (n, s) => n + Object.values(s.items).reduce((n, p) => n + p.length, 0),
    0,
  );
  const sha256 = createHash("sha256")
    .update(JSON.stringify(packed))
    .digest("hex");
  mkdirSync(".local/cloud-history", { recursive: true });
  writeFileSync(
    ".local/cloud-history/seed.json",
    JSON.stringify({ sha256, years, documents: packed }),
  );
  const report = {
    at: new Date().toISOString(),
    sha256,
    documents: packed.length,
    years,
    itemDays,
    encodedBytes,
    maxDocumentBytes: Math.max(...packed.map((r) => r.packed.length)),
    dailyWrites: 33,
    dailyReads: 33,
    ownProvisionalSamplesExcluded: true,
    sources: ["skytrack", "bazaar-calc", "bazaarsignal"],
  };
  writeFileSync(
    ".local/cloud-history/seed-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  db.close();
}
