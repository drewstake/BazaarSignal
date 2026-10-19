import { afterEach, expect, it, vi } from "vitest";
import { HistoryStore } from "../collector/history-store";
import {
  dailyReducer,
  decodeBazaarCalc,
  decodeSkytrack,
} from "../collector/history-sources";
import { DailyCloseCollector } from "../collector/daily-close-collector";
import { historyDownload } from "../collector/history-download";
import {
  historyDay,
  historyDayLabel,
  historyDayStart,
  HISTORY_DAY_MS,
} from "../shared/daily-price-history";
import { priceHistoryHandler } from "../server/price-history";
import { gunzipSync } from "node:zlib";

const now = Date.parse("2026-10-19T12:00:00Z");
const day = historyDay(now) - 1,
  start = historyDayStart(day);
const stores: HistoryStore[] = [];
const open = () => {
  const s = new HistoryStore(":memory:");
  stores.push(s);
  return s;
};
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  vi.unstubAllGlobals();
});

it("uses fixed EST calendar boundaries year-round", () => {
  expect(historyDayLabel(historyDay(Date.parse("2026-07-01T04:59:59Z")))).toBe(
    "2026-06-30",
  );
  expect(historyDayLabel(historyDay(Date.parse("2026-07-01T05:00:00Z")))).toBe(
    "2026-07-01",
  );
  expect(historyDayStart(historyDay(now))).toBe(
    Date.parse("2026-10-19T05:00:00Z"),
  );
});

it("reduces tiers to last actual daily samples without filling missing days or sides", () => {
  const data = decodeSkytrack(
    "BOOSTER_COOKIE",
    {
      bazaar: {
        raw: [
          [(start + 1000) / 1000, 11.123456, 9],
          [(start + 2000) / 1000, 12, null],
        ],
        hourly: [[(start + 2000) / 1000, 99, 99]],
        daily: [[(start - 2 * HISTORY_DAY_MS) / 1000, 10, 0]],
      },
    },
    "skytrack",
    now,
  );
  expect(
    [...data.rows.values()].map((p) => [p.day, p.at, p.buy, p.sell]),
  ).toEqual([
    [day, start + 2000, 12, null],
    [day - 2, start - 2 * HISTORY_DAY_MS, 10, null],
  ]);
  expect(data.count()).toBe(4);
});

it("decodes per-item centicoin deltas across interleaved rows and nulls", () => {
  const input = {
    format: "bazaar-calc-data/1",
    encoding: "delta2",
    items: ["A", "B"],
    polls: [start, 1000, 1000],
    closes: {
      poll: [0, 0, 1, 1],
      item: [0, 1, 0, 0],
      ask: [1000, 4000, null, -123],
      bid: [900, 3500, -100, 50],
    },
  };
  const result = [...decodeBazaarCalc(input, "calc", now).rows.values()];
  expect(result.map((p) => [p.item, p.at, p.buy, p.sell])).toEqual([
    ["A", start + 2000, 8.77, 8.5],
    ["B", start, 40, 35],
  ]);
  expect(() =>
    decodeBazaarCalc(
      { ...input, closes: { ...input.closes, poll: [0, 0, 1, 99] } },
      "calc",
      now,
    ),
  ).toThrow("Invalid poll index");
  expect(() =>
    decodeBazaarCalc({ ...input, encoding: "unknown" }, "calc", now),
  ).toThrow();
  expect(() =>
    decodeBazaarCalc(
      { ...input, closes: { ...input.closes, ask: [] } },
      "calc",
      now,
    ),
  ).toThrow();
});

it("merges deterministically regardless of import order, keeps source receipts, and excludes today", () => {
  const store = open();
  const rows = [
    {
      item: "A",
      day,
      at: start + 2000,
      buy: 12,
      sell: null,
      source: "skytrack" as const,
      reference: "z",
    },
    {
      item: "A",
      day,
      at: start + 1000,
      buy: 10,
      sell: 9,
      source: "bazaar-calc" as const,
      reference: "c",
    },
    {
      item: "A",
      day,
      at: start + 2000,
      buy: 13,
      sell: null,
      source: "bazaarsignal" as const,
      reference: "own",
    },
    {
      item: "A",
      day: day + 1,
      at: now,
      buy: 15,
      sell: 14,
      source: "bazaarsignal" as const,
      reference: "own",
    },
    {
      item: "A",
      day: day - 2,
      at: start - 2 * HISTORY_DAY_MS,
      buy: null,
      sell: null,
      source: "skytrack" as const,
      reference: "z",
    },
  ];
  const receipt = {
    reference: "z",
    sha256: "hash",
    bytes: 100,
    observations: 8,
  };
  store.save(rows, receipt);
  const first = store.prices("A", now);
  store.save(rows.reverse(), receipt);
  expect(store.prices("A", now)).toEqual(first);
  expect(first).toEqual([
    {
      day: day - 2,
      at: start - 2 * HISTORY_DAY_MS,
      buy: null,
      sell: null,
      source: "skytrack",
    },
    { day, at: start + 2000, buy: 13, sell: null, source: "bazaarsignal" },
  ]);
  expect(store.imported("z")).toBe(true);
  expect(store.prices("A", now + HISTORY_DAY_MS)).toHaveLength(3);
});

it("a malformed batch rolls back its points and completion receipt", () => {
  const store = open(),
    reduced = dailyReducer("skytrack", "test", now);
  reduced.add("A", start, 10, 9);
  const row = [...reduced.rows.values()][0];
  expect(() =>
    store.save([row, { ...row, item: "B", reference: undefined as any }], {
      reference: "test",
      sha256: "x",
      bytes: 1,
      observations: 2,
    }),
  ).toThrow();
  expect(store.prices("A", now)).toEqual([]);
  expect(store.imported("test")).toBe(false);
});

const payload = (at: number) => ({
  success: true,
  lastUpdated: at,
  products: {
    A: {
      buy_summary: [
        { pricePerUnit: 12, amount: 1, orders: 1 },
        { pricePerUnit: 10, amount: 2, orders: 1 },
      ],
      sell_summary: [{ pricePerUnit: 9, amount: 2, orders: 1 }],
    },
    B: {
      buy_summary: [],
      sell_summary: [{ pricePerUnit: 20, amount: 1, orders: 1 }],
    },
  },
});

it("captures all items without viewing them, updates at close, survives restarts, and leaves off days absent", async () => {
  const store = open();
  let time = start + 12 * 3_600_000;
  const network = vi.fn(async () => Response.json(payload(time - 1000)));
  let collector = new DailyCloseCollector(store, network, () => time);
  await collector.tick();
  await collector.tick();
  expect(network).toHaveBeenCalledTimes(1);
  expect(store.prices("A", time)).toEqual([]); // Not a completed day yet.
  collector = new DailyCloseCollector(store, network, () => time);
  await collector.tick();
  expect(network).toHaveBeenCalledTimes(1);
  time = start + HISTORY_DAY_MS - 60_000;
  await collector.tick();
  time += 20_000;
  await collector.tick();
  expect(network).toHaveBeenCalledTimes(2);
  expect(store.prices("A", now)[0]).toMatchObject({
    buy: 10,
    sell: 9,
    at: start + HISTORY_DAY_MS - 61_000,
  });
  expect(store.prices("B", now)[0]).toMatchObject({ buy: null, sell: 20 });
  time = start + 3 * HISTORY_DAY_MS + 12 * 3_600_000;
  await collector.tick();
  expect(store.prices("A", time + HISTORY_DAY_MS).map((p) => p.day)).toEqual([
    day,
    day + 3,
  ]);
});

it("bounds close retries and rejects stale snapshots without turning them into closes", async () => {
  const store = open();
  let time = start + HISTORY_DAY_MS - 60_000;
  const network = vi.fn(async () => Response.json(payload(time - 600_000)));
  const collector = new DailyCloseCollector(store, network, () => time);
  for (let n = 0; n < 6; n++) {
    await collector.tick();
    time += 9000;
  }
  expect(network).toHaveBeenCalledTimes(3);
  expect(store.prices("A", now)).toEqual([]);
  expect(JSON.parse(store.state("last-error")!)).toMatchObject({
    message: expect.stringContaining("stale"),
  });
});

it("bounds downloaded bodies and refuses redirects/non-success responses", async () => {
  await expect(
    historyDownload(
      "https://example.com",
      3,
      vi.fn(async () => new Response("1234")),
    ),
  ).rejects.toThrow("size limit");
  await expect(
    historyDownload(
      "https://example.com",
      100,
      vi.fn(async () => new Response("bad", { status: 429 })),
    ),
  ).rejects.toThrow("HTTP 429");
});

it("serves only selected-item completed days with gzip/ETag and no upstream calls", () => {
  const store = open(),
    reduced = dailyReducer("skytrack", "test", now);
  for (let n = 0; n < 100; n++)
    reduced.add("A", start - n * HISTORY_DAY_MS, 10.123, 9.123);
  store.save(reduced.rows.values());
  const handler = priceHistoryHandler(store, true, () => now);
  const request = (url: string, extra = {}, method = "GET") => {
    let status = 0,
      headers: any,
      body: any;
    const res: any = {
      writeHead(code: number, h: any) {
        status = code;
        headers = h;
        return res;
      },
      end(b: any) {
        body = b;
      },
    };
    handler(
      {
        url,
        method,
        headers: {
          host: "127.0.0.1:5173",
          "accept-encoding": "gzip",
          ...extra,
        },
      } as any,
      res,
      () => {
        status = 404;
      },
    );
    return { status, headers, body };
  };
  const response = request("/api/price-history?item=A");
  expect(response.status).toBe(200);
  expect(response.headers["Content-Encoding"]).toBe("gzip");
  expect(JSON.parse(gunzipSync(response.body).toString()).points).toHaveLength(
    100,
  );
  expect(
    request("/api/price-history?item=A", {
      "if-none-match": response.headers.ETag,
    }).status,
  ).toBe(304);
  expect(request("/api/price-history?item=A&refresh=1").status).toBe(400);
  expect(
    request("/api/price-history?item=A", { origin: "https://evil.example" })
      .status,
  ).toBe(403);
  expect(request("/api/price-history?item=A", {}, "POST").status).toBe(405);
});

it("client preserves missing days and sides, breaks SVG lines, and rejects incomplete days", async () => {
  vi.stubGlobal("location", { origin: "http://localhost", search: "" });
  const { parseDailyHistory } =
    await import("../src/companion/daily-price-history");
  const { priceLinePath } =
    await import("../src/companion/bazaar-price-history");
  const data = {
    version: 1,
    item: "A",
    timezone: "EST",
    points: [
      [day - 3, start - 3 * HISTORY_DAY_MS, 10, 9, "skytrack"],
      [day - 2, start - 2 * HISTORY_DAY_MS, 11, null, "skytrack"],
      [day, start, 12, 9, "bazaar-calc"],
    ],
  };
  const parsed = parseDailyHistory(data, "A", now);
  expect(
    priceLinePath(
      parsed.points,
      "buy",
      (at) => at,
      (p) => p,
      HISTORY_DAY_MS,
    ).match(/[ML]/g),
  ).toEqual(["M", "L", "M"]);
  expect(
    priceLinePath(
      parsed.points,
      "sell",
      (at) => at,
      (p) => p,
      HISTORY_DAY_MS,
    ).match(/[ML]/g),
  ).toEqual(["M", "M"]);
  expect(() =>
    parseDailyHistory(
      { ...data, points: [...data.points, [day + 1, now, 1, 1, "skytrack"]] },
      "A",
      now,
    ),
  ).toThrow();
  expect(() => parseDailyHistory(data, "B", now)).toThrow();
});
