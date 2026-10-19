import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  historyDay,
  historyDayLabel,
  validHistoryItem,
  type DailyPrice,
  type HistorySource,
} from "../shared/daily-price-history";
import { historyDownload } from "./history-download";
import { dailyReducer } from "./history-sources";
import { parseBook } from "../shared/market";
import type { TrialSession, Counters } from "./trial";

export const HISTORY_JOB = "bazaar-daily-close";
// Cloud Scheduler's delivered job header can contain its short job ID.
export const isHistoryJob = (job: string | undefined, project: string) =>
  job === HISTORY_JOB ||
  job === `projects/${project}/locations/us-central1/jobs/${HISTORY_JOB}`;
export const HISTORY_SHARDS = 32;
export type CloudPriceTuple = [
  number,
  number,
  number | null,
  number | null,
  HistorySource,
];
export type HistoryShard = {
  version: 1;
  year: number;
  items: Record<string, CloudPriceTuple[]>;
};
export type HistoryMeta = {
  version: 1;
  years: number[];
  lastSuccess: {
    at: number;
    checkedAt: number;
    items: number;
    closing: boolean;
  } | null;
};
export const historyYear = (day: number) =>
  Number(historyDayLabel(day).slice(0, 4));
export const historyShard = (item: string) =>
  createHash("sha256").update(item).digest()[0] % HISTORY_SHARDS;
export const historyDocument = (year: number, shard: number) =>
  `year-${year}-${shard}`;
export const encodeHistory = (value: unknown) => {
  const raw = Buffer.from(JSON.stringify(value));
  if (raw.length > 8 * 1024 ** 2)
    throw Error("History shard exceeds decoded bound");
  const packed = gzipSync(raw).toString("base64");
  if (packed.length > 800 * 1024)
    throw Error("History shard exceeds Firestore bound");
  return packed;
};
export function decodeHistory(value: string) {
  if (value.length > 800 * 1024) throw Error("History document exceeds bound");
  const decoded = JSON.parse(
    gunzipSync(Buffer.from(value, "base64"), {
      maxOutputLength: 8 * 1024 ** 2,
    }).toString(),
  );
  if (decoded?.version !== 1) throw Error("Unsupported history document");
  return decoded;
}
const sourceOrder: Record<HistorySource, number> = {
  bazaarsignal: 0,
  skytrack: 1,
  "bazaar-calc": 2,
};
export function mergeCloudPrice(points: CloudPriceTuple[], row: DailyPrice) {
  const next: CloudPriceTuple = [
    row.day,
    row.at,
    row.buy,
    row.sell,
    row.source,
  ];
  const index = points.findIndex((p) => p[0] === row.day);
  if (index < 0) points.push(next);
  else if (
    row.at > points[index][1] ||
    (row.at === points[index][1] &&
      sourceOrder[row.source] < sourceOrder[points[index][4]])
  )
    points[index] = next;
  points.sort((a, b) => a[0] - b[0]);
  if (points.length > 366) throw Error("Annual history exceeds 366 days");
}

/** Private Firestore documents; browsers can only reach the budgeted selected-item
 * API. Explicit REST calls have bounded bodies/deadlines and no automatic retries. */
export class CloudPriceHistory {
  constructor(
    private config: {
      project: string;
      token: () => Promise<string>;
      network?: typeof fetch;
    },
    private session?: TrialSession,
  ) {}
  private get root() {
    return `https://firestore.googleapis.com/v1/projects/${this.config.project}/databases/(default)/documents`;
  }
  private name(id: string) {
    if (!/^(meta|year-20\d\d-(?:[0-9]|[12][0-9]|3[01]))$/.test(id))
      throw Error("Invalid history document ID");
    return `projects/${this.config.project}/databases/(default)/documents/priceHistory/${id}`;
  }
  private async request(
    suffix: string,
    body: unknown,
    costs: Counters,
    limit = 8 * 1024 ** 2,
  ) {
    this.session?.take(costs);
    const auth = await this.config.token();
    this.session?.assertOpen();
    const response = await (this.config.network ?? fetch)(this.root + suffix, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: this.session?.signal(12_000) ?? AbortSignal.timeout(20_000),
    });
    const parts: Uint8Array[] = [];
    let length = 0;
    if (!response.body) throw Error("Empty Firestore response");
    for await (const part of response.body) {
      length += part.length;
      if (length > limit) throw Error("History response exceeds bound");
      parts.push(part);
    }
    this.session?.take({ firestoreEgressBytes: length });
    const result = JSON.parse(Buffer.concat(parts).toString());
    if (!response.ok)
      throw Error(
        `History storage HTTP ${response.status}: ${result.error?.status ?? "unknown"}`,
      );
    return result;
  }
  async read(ids: string[]) {
    if (ids.length > 32) throw Error("Too many history documents");
    const output = new Map<string, { value: any; updateTime?: string }>();
    for (let offset = 0; offset < ids.length; offset += 8) {
      const batch = ids.slice(offset, offset + 8);
      const result = await this.request(
        ":batchGet",
        { documents: batch.map((id) => this.name(id)) },
        { firestoreReads: batch.length },
      );
      if (!Array.isArray(result) || result.length !== batch.length)
        throw Error("Incomplete history read");
      for (const id of batch) {
        const row = result.find(
          (r: any) => (r.found?.name ?? r.missing) === this.name(id),
        );
        if (!row) throw Error("Missing history response");
        output.set(
          id,
          row.found
            ? {
                value: decodeHistory(row.found.fields?.packed?.stringValue),
                updateTime: row.found.updateTime,
              }
            : { value: null },
        );
      }
    }
    return output;
  }
  async write(rows: { id: string; value: unknown; updateTime?: string }[]) {
    if (rows.length > 32) throw Error("Too many history writes");
    const writes = rows.map((row) => ({
      update: {
        name: this.name(row.id),
        fields: { packed: { stringValue: encodeHistory(row.value) } },
      },
      currentDocument: row.updateTime
        ? { updateTime: row.updateTime }
        : { exists: false },
    }));
    for (let offset = 0; offset < writes.length; offset += 4) {
      const batch = writes.slice(offset, offset + 4);
      this.session?.take(
        { firestoreStorageBytes: Buffer.byteLength(JSON.stringify(batch)) },
        false,
      );
      await this.request(
        ":commit",
        { writes: batch },
        { firestoreWrites: batch.length },
        64 * 1024,
      );
    }
  }
  async capture(now = Date.now, network: typeof fetch = fetch) {
    const raw = JSON.parse(
      (
        await historyDownload(
          "https://api.hypixel.net/v2/skyblock/bazaar",
          16 * 1024 ** 2,
          network,
        )
      ).toString(),
    );
    const checkedAt = now();
    if (
      !raw.success ||
      !Number.isSafeInteger(raw.lastUpdated) ||
      raw.lastUpdated > checkedAt ||
      checkedAt - raw.lastUpdated > 300_000 ||
      !raw.products ||
      typeof raw.products !== "object" ||
      Array.isArray(raw.products) ||
      Object.keys(raw.products).length > 8192
    )
      throw Error("Stale or invalid daily snapshot");
    const reduced = dailyReducer(
      "bazaarsignal",
      "https://api.hypixel.net/v2/skyblock/bazaar",
      checkedAt,
    );
    for (const [item, product] of Object.entries(raw.products)) {
      try {
        const book = parseBook(product);
        reduced.add(
          item,
          raw.lastUpdated,
          book.buy[0]?.pricePerUnit ?? null,
          book.sell[0]?.pricePerUnit ?? null,
        );
      } catch {
        /* Missing/malformed books remain gaps. */
      }
    }
    if (!reduced.rows.size) throw Error("No valid daily prices");
    const year = historyYear(historyDay(raw.lastUpdated));
    const metaDoc = (await this.read(["meta"])).get("meta")!;
    if (!metaDoc.value) throw Error("Import cloud history before collection");
    const meta = metaDoc.value as HistoryMeta;
    if (!Array.isArray(meta.years) || meta.years.length > 16)
      throw Error("Invalid history years");
    const ids = Array.from({ length: HISTORY_SHARDS }, (_, shard) =>
      historyDocument(year, shard),
    );
    const documents = await this.read(ids);
    for (const id of ids)
      documents.get(id)!.value ??= { version: 1, year, items: {} };
    for (const row of reduced.rows.values()) {
      const shard = documents.get(
        historyDocument(year, historyShard(row.item)),
      )!.value as HistoryShard;
      mergeCloudPrice((shard.items[row.item] ??= []), row);
    }
    // Prepare every shard before issuing writes. A partial RPC failure retains
    // real points but does not publish a successful collection status.
    for (const doc of documents.values()) encodeHistory(doc.value);
    await this.write(ids.map((id) => ({ id, ...documents.get(id)! })));
    const closing =
      checkedAt - (historyDay(checkedAt) * 86_400_000 + 5 * 3_600_000) >=
      86_340_000;
    const lastSuccess = {
      at: raw.lastUpdated,
      checkedAt,
      items: reduced.rows.size,
      closing,
    };
    await this.write([
      {
        id: "meta",
        updateTime: metaDoc.updateTime,
        value: {
          version: 1,
          years: [...new Set([...meta.years, year])].sort(),
          lastSuccess,
        },
      },
    ]);
    return lastSuccess;
  }
  async item(item: string, now = Date.now(), expiresAt: number) {
    if (!validHistoryItem(item)) throw Error("Invalid history item");
    const meta = (await this.read(["meta"])).get("meta")
      ?.value as HistoryMeta | null;
    if (
      !meta ||
      !Array.isArray(meta.years) ||
      meta.years.length > 14 ||
      meta.years.some(
        (y) =>
          !Number.isInteger(y) || y < 2020 || y > historyYear(historyDay(now)),
      )
    )
      throw Error("Daily archive unavailable");
    const ids = meta.years.map((year) =>
      historyDocument(year, historyShard(item)),
    );
    const docs = await this.read(ids);
    const points = [...docs.values()]
      .flatMap((doc) => (doc.value as HistoryShard | null)?.items[item] ?? [])
      .filter((p) => p[0] < historyDay(now))
      .sort((a, b) => a[0] - b[0]);
    return {
      version: 1,
      item,
      timezone: "EST",
      points,
      collector: {
        enabled: now < expiresAt,
        location: "cloud",
        expiresAt,
        lastSuccess: meta.lastSuccess,
        lastError: null,
      },
    };
  }
}
