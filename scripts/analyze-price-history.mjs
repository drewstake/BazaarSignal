// Offline architecture sizing, not a collector or production codec.
// Synthetic series exercise exact numeric round trips; they are NOT market history.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { performance } from "node:perf_hooks";

const catalog = JSON.parse(
  readFileSync("src/companion/bazaar-catalog.json", "utf8"),
);
const ids = catalog.map((row) => row[0]);
const count = ids.length,
  hours = 365 * 24,
  monthlyHours = hours / 12;
const shardSize = 32,
  shards = Math.ceil(count / shardSize);
let seeds = new Map();
if (existsSync(".local/current-market.sqlite")) {
  const db = new DatabaseSync(".local/current-market.sqlite", {
    readOnly: true,
  });
  try {
    const row = db.prepare("SELECT value FROM cache WHERE key='bazaar'").get();
    const items = row ? (JSON.parse(row.value).data?.items ?? []) : [];
    seeds = new Map(
      items.map((item) => [
        item.id,
        {
          buy: item.asks?.length
            ? Math.min(...item.asks.map((level) => level.pricePerUnit))
            : 100,
          sell: item.bids?.length
            ? Math.max(...item.bids.map((level) => level.pricePerUnit))
            : 90,
        },
      ]),
    );
  } finally {
    db.close();
  }
}
let randomState = 20261018;
const random = () => {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return (randomState >>> 0) / 4294967296;
};
const start = Date.parse("2026-01-01T00:00:00Z");
function sampleSeries(id, length, mode) {
  const seed = seeds.get(id) ?? { buy: 14000000.5, sell: 13000000.3 };
  let buy = seed.buy,
    sell = seed.sell;
  return Array.from({ length }, (_, index) => {
    if (mode === "walk") {
      buy = Math.max(0.1, buy * (1 + (random() - 0.5) * 0.003));
      sell = Math.max(0.1, sell * (1 + (random() - 0.5) * 0.003));
    } else if (mode === "noise") {
      buy = 0.1 + random() * 1e9;
      sell = 0.1 + random() * 1e9;
    }
    return {
      at: start + index * 3600000 + 12345,
      buy: index % 53 === 17 ? null : buy,
      sell: index % 47 === 11 ? null : sell,
    };
  });
}
function encodeShard(series) {
  const entries = [...series],
    rows = entries[0][1].length;
  const metadata = Buffer.from(
    JSON.stringify({ v: 1, ids: entries.map(([id]) => id), rows }),
  );
  const header = Buffer.alloc(4);
  header.writeUInt32LE(metadata.length);
  const data = Buffer.alloc(rows * (8 + entries.length * 16));
  let offset = 0;
  for (let row = 0; row < rows; row++) {
    data.writeDoubleLE(entries[0][1][row].at, offset);
    offset += 8;
    for (const [, points] of entries)
      for (const side of ["buy", "sell"]) {
        assert.equal(points[row].at, entries[0][1][row].at);
        data.writeDoubleLE(points[row][side] ?? NaN, offset);
        offset += 8;
      }
  }
  return Buffer.concat([header, metadata, data]);
}
function extractItem(bytes, id) {
  const length = bytes.readUInt32LE();
  const metadata = JSON.parse(bytes.subarray(4, 4 + length).toString());
  const slot = metadata.ids.indexOf(id),
    width = 8 + metadata.ids.length * 16;
  assert.notEqual(slot, -1);
  return Array.from({ length: metadata.rows }, (_, row) => {
    const offset = 4 + length + row * width;
    const buy = bytes.readDoubleLE(offset + 8 + slot * 16);
    const sell = bytes.readDoubleLE(offset + 16 + slot * 16);
    return {
      at: bytes.readDoubleLE(offset),
      buy: Number.isNaN(buy) ? null : buy,
      sell: Number.isNaN(sell) ? null : sell,
    };
  });
}
const experiments = [];
for (const mode of ["flat", "walk", "noise"]) {
  const series = new Map(
    ids.slice(0, shardSize).map((id) => [id, sampleSeries(id, 31 * 24, mode)]),
  );
  const started = performance.now(),
    packed = encodeShard(series),
    encodeMs = performance.now() - started;
  const selected = ids[0],
    extractStart = performance.now(),
    extracted = extractItem(packed, selected);
  const extractMs = performance.now() - extractStart;
  assert.deepEqual(extracted, series.get(selected));
  for (const [id, original] of series)
    assert.deepEqual(extractItem(packed, id), original);
  const json = Buffer.from(JSON.stringify(Object.fromEntries(series)));
  const gzip = gzipSync(packed);
  const brotli = brotliCompressSync(packed, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
  });
  experiments.push({
    mode,
    rows: 744,
    items: shardSize,
    objectJsonBytes: json.length,
    packedBytes: packed.length,
    gzipBytes: gzip.length,
    brotliBytes: brotli.length,
    restBase64Bytes: 4 * Math.ceil(packed.length / 3),
    exactRoundTrips: series.size,
    encodeMs,
    extractOneItemMs: extractMs,
  });
}
const year = sampleSeries("BOOSTER_COOKIE", hours, "walk");
const original = JSON.stringify({ version: 1, points: year });
const tuples = JSON.stringify({
  version: 2,
  points: year.map((point) => [point.at, point.buy, point.sell]),
});
assert.deepEqual(
  JSON.parse(tuples).points.map(([at, buy, sell]) => ({ at, buy, sell })),
  year,
);
const binaryYear = encodeShard(new Map([["BOOSTER_COOKIE", year]]));
assert.deepEqual(extractItem(binaryYear, "BOOSTER_COOKIE"), year);
const storageComparison = {
  syntheticYear: true,
  records: hours,
  objectJsonBytes: Buffer.byteLength(original),
  tupleJsonBytes: Buffer.byteLength(tuples),
  tupleReductionPct: 100 * (1 - tuples.length / original.length),
  objectGzipBytes: gzipSync(original).length,
  tupleGzipBytes: gzipSync(tuples).length,
  binaryBytes: binaryYear.length,
  binaryGzipBytes: gzipSync(binaryYear).length,
};
// Illustrative UTC daily closes: the last scheduled hourly observation in each
// synthetic day. This is not an official trade close or a production time policy.
const dailyCloses = year.filter((_, index) => index % 24 === 23);
const binaryDailyYear = encodeShard(new Map([["BOOSTER_COOKIE", dailyCloses]]));
assert.equal(dailyCloses.length, 365);
assert.deepEqual(extractItem(binaryDailyYear, "BOOSTER_COOKIE"), dailyCloses);
const dailyComparison = {
  pointsPerItem: dailyCloses.length,
  observationsAllItems: dailyCloses.length * count,
  packedAnnualRawBytes: 365 * (count * 16 + shards * 8),
  binaryBytesPerFullYear: binaryDailyYear.length,
  gzipBytesPerFullYear: gzipSync(binaryDailyYear).length,
  observationsReductionPct: 100 * (1 - dailyCloses.length / hours),
  caveats: [
    "Daily display alone does not save archive costs: persist one finalized daily observation rather than all hourly observations.",
    "Existing live order books, portfolios and alerts retain their hourly collection. Only archive processing moves to daily.",
    "Keeping monthly documents still needs up to 13 document reads per full-year chart. Read billing does not shrink 24-fold just because those documents are smaller.",
    "Choose one explicit day-boundary timezone. Keep the last qualifying source snapshot's actual timestamp, define a freshness window, and leave gaps when no qualifying close exists.",
    "Current best-ask/best-bid quotes do not provide a last executed trade price. A daily close here means a scheduled closing quote for each side.",
  ],
};
const rates = {
  write: 0.09 / 100000,
  read: 0.03 / 100000,
  delete: 0.01 / 100000,
  gibMonth: 0.15,
  cpuSecond: 0.000024,
  gibSecond: 0.0000025,
  request: 0.4 / 1e6,
  egressGiB: 0.12,
};
const designs = [
  {
    name: "Earlier per-item monthly estimate",
    docs: count,
    storageGiB: 1.25,
    bytesPerFullYear: 515112,
    responseEncoding: "prior representative uncompressed JSON",
  },
  {
    name: "Per-item monthly chunks with existing HTTP gzip",
    docs: count,
    storageGiB: 1.25,
    bytesPerFullYear: storageComparison.objectGzipBytes,
    responseEncoding: "gzip JSON; synthetic full-precision walk",
  },
  {
    name: "32-item monthly chunks, exact float64, HTTP gzip",
    docs: shards,
    storageGiB: 0.4,
    bytesPerFullYear: storageComparison.binaryGzipBytes,
    responseEncoding: "gzip binary; synthetic full-precision walk",
  },
  {
    name: "32-item monthly chunks without HTTP compression",
    docs: shards,
    storageGiB: 0.4,
    bytesPerFullYear: binaryYear.length,
    responseEncoding: "uncompressed binary sensitivity case",
  },
  {
    name: "Daily closes, 32-item monthly chunks, HTTP gzip",
    docs: shards,
    cyclesPerMonth: 365 / 12,
    storageGiB: 0.4 / 24,
    bytesPerFullYear: dailyComparison.gzipBytesPerFullYear,
    responseEncoding:
      "gzip binary; last hourly observation of each synthetic UTC day",
  },
  {
    name: "Daily closes retaining the full prior hourly compute allowance",
    docs: shards,
    cyclesPerMonth: 365 / 12,
    computeCyclesPerMonth: monthlyHours,
    storageGiB: 0.4 / 24,
    bytesPerFullYear: dailyComparison.gzipBytesPerFullYear,
    responseEncoding:
      "gzip binary; sensitivity case, unchanged collector compute allowance",
  },
];
const costModels = designs.map((design) => {
  const control = 1;
  const cyclesPerMonth = design.cyclesPerMonth ?? monthlyHours;
  const computeCyclesPerMonth = design.computeCyclesPerMonth ?? cyclesPerMonth;
  const fixed = {
    writes: (design.docs + control) * cyclesPerMonth * rates.write,
    maintenanceReads: (design.docs + control) * cyclesPerMonth * rates.read,
    storage: design.storageGiB * rates.gibMonth,
    cleanupAllowance: 0.01,
    compute: computeCyclesPerMonth * 30 * (rates.cpuSecond + rates.gibSecond),
  };
  const totalFixed = Object.values(fixed).reduce((a, b) => a + b, 0);
  return {
    ...design,
    writesPerMonth: (design.docs + control) * cyclesPerMonth,
    fixed,
    traffic: [0, 1000, 10000, 100000].map((loads) => {
      const variable = {
        chartReads: loads * 17 * rates.read,
        accountingWrites: loads * 2 * rates.write,
        serving: loads * (rates.cpuSecond + rates.gibSecond + rates.request),
        bandwidth:
          ((loads * design.bytesPerFullYear) / 1024 ** 3) * rates.egressGiB,
      };
      return {
        uncachedFullYearLoads: loads,
        ...variable,
        totalUsd:
          totalFixed + Object.values(variable).reduce((a, b) => a + b, 0),
      };
    }),
  };
});
const report = {
  assumptions: {
    items: count,
    hoursPerYear: hours,
    monthlyHours,
    shardSize,
    shards,
    preservedPrecision: "IEEE-754 float64; no price rounding; nulls retained",
    data: "Synthetic flat/walk/noise series, seeded from the existing local PUBLIC snapshot when available; no fetched historical prices.",
    model:
      "Incremental archive cost in USD: us-central1 Standard Firestore, North America egress, no free credits, no minimum instances; excludes existing site/email/deployment/backup costs",
    processing:
      "Unmeasured planning allowance: 30 s per archive cycle, 1 s per uncached chart; 1 vCPU + 1 GiB. Hourly designs have 730 cycles/month; daily has 365/12. A sensitivity case retains hourly compute. Existing live collection is unchanged. Not inferred from local codec timings.",
    archive:
      "13 monthly chunks; at most 32 items per chunk; byte payload excluded from indexing; .4 GiB allows an extra boundary month and metadata.",
    retention:
      "365-day readable window; whole-month cleanup may retain up to one extra boundary month. Exact per-hour physical deletion would need additional budgeted writes.",
    cautions: [
      "Batch grouping alone does not reduce billed writes; fewer documents does.",
      "Grouped reads amplify internal bytes. Same-region Firestore transfer is free, but decode/latency must be measured.",
      "HTTP gzip and shared hourly collection already exist; compression is not a newly implemented saving. Actual year-long price distributions are unknown.",
      "Chart read allowance is 13 monthly documents plus 4 overhead reads and 2 accounting writes; the final budget gate may require more operations.",
      "Split writes below the 10 MiB commit limit; per-item history must stay complete through partial multi-batch publication.",
      "Existing paid envelopes, response bounds and publication API do not permit the new archive unchanged.",
    ],
  },
  sourceUrls: [
    "https://cloud.google.com/firestore/pricing",
    "https://firebase.google.com/docs/firestore/quotas",
    "https://firebase.google.com/docs/firestore/best-practices",
    "https://cloud.google.com/run/pricing",
    "https://cloud.google.com/vpc/network-pricing",
  ],
  rates,
  recommendations: [
    "Reuse the existing hourly full-market collection. Archive only source timestamp, best ask and best bid; never archive raw order books for a price-line chart.",
    "Use stable groups of at most 32 item IDs and one bounded binary document per group per UTC month. Do not reassign existing IDs when the catalog changes.",
    "Keep exact hourly observations, missing-side markers and original source timestamps. Deduplicate upstream snapshots, not equal prices at different times.",
    "Read only the selected item and requested time range. A full year spans at most 13 calendar-month documents; never send other items' grouped data to a browser.",
    "Cache immutable closed months in a bounded client cache and server cache. Fetch only the changed current month or new points. Reuse existing cross-tab request coordination and respect stop/expiry directives.",
    "Consider separate daily min/max or OHLC overview data if traffic grows; keep hourly records available for zoom. This is not included in modeled savings.",
    "Exclude archive payloads from indexing. Split commits below 10 MiB including REST base64 and metadata; use guarded, resumable publication and test failures between batches.",
    "Measure live archive read latency and incremental CPU in an emulator/staging harness before changing the paid reservation envelopes. Never bypass the existing budget or expiration gates.",
  ],
  currentRuntimeCompatibility: {
    serverHistoryArchive: false,
    collectorWriteEnvelope: 40,
    proposedArchiveWritesPerHourIncludingControl: shards + 1,
    browserResponseReservationBytes: 16 * 1024,
    proposedSyntheticGzipYearBytes: storageComparison.binaryGzipBytes,
    note: "New counted archive transport and route are required. The present cache API and budgets cannot accept the proposed archive as-is. Pilot renewal is separate from retention.",
  },
  groupSizeTradeoffs: [1, 16, 32, 64, 128].map((itemsPerGroup) => {
    const groups = Math.ceil(count / itemsPerGroup);
    // Worst catalog ID length, all 744 rows, plus conservative header allowance.
    const boundedMonthBytes =
      744 * (8 + itemsPerGroup * 16) + itemsPerGroup * 42 + 128;
    return {
      itemsPerGroup,
      groups,
      boundedMonthBytes,
      fitsFirestoreDocumentWith4KiBMetadata:
        boundedMonthBytes + 4096 < 1024 ** 2,
      monthlyMaintenanceReadWriteUsd:
        (groups + 1) * monthlyHours * (rates.read + rates.write),
      internalBytesReadFor13Months: 13 * boundedMonthBytes,
    };
  }),
  shardExperiments: experiments,
  storageComparison,
  dailyComparison,
  packedAnnualRawBytes: hours * (count * 16 + shards * 8),
  operationsReductionPct: 100 * (1 - shards / count),
  costModels,
};
mkdirSync("docs/measurements", { recursive: true });
writeFileSync(
  "docs/measurements/price-history-optimization.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
