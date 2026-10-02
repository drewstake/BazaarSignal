import type { Firestore } from "firebase-admin/firestore";
import { gzipSync, gunzipSync } from "node:zlib";
import { GoogleCacheStore, type SnapshotBlobs } from "./google-cache-store";
import type { Counters, TrialSession } from "./trial";
import { TrialStopped } from "./trial";

export interface GoogleTransport {
  project: string;
  bucket: string;
  token: () => Promise<string>;
  network?: typeof fetch;
  firestoreOrigin?: string;
  storageOrigin?: string;
  collection?: string;
  onAttempt?: (costs: Counters) => void;
}
/** Bound reads before JSON/gzip decoding; no SDK retry can issue an uncounted RPC. */
async function bytes(response: Response, limit: number) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new TrialStopped("Google response exceeded reserved size");
      }
      parts.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts, size);
}
/** A narrow REST implementation of the Firestore methods GoogleCacheStore uses.
 * Each attempted RPC is counted before sending. Automatic transport retries are
 * intentionally absent; the existing durable CAS handles contention explicitly.
 */
export function trialGoogleStore(
  config: GoogleTransport,
  session?: TrialSession,
) {
  const origin = config.firestoreOrigin ?? "https://firestore.googleapis.com";
  const dbName = `projects/${config.project}/databases/(default)`,
    root = `${origin}/v1/${dbName}/documents`;
  const network = config.network ?? fetch;
  const take = (costs: Counters) => {
    session?.take(costs);
    config.onAttempt?.(costs);
  };
  async function request(
    url: string,
    method: string,
    body: unknown,
    costs: Counters,
    limit = 8 * 1024 ** 2,
  ) {
    if (url.startsWith(root))
      session?.take({ firestoreEgressBytes: limit }, false);
    take(costs);
    const token = await config.token();
    session?.assertOpen();
    const r = await network(url, {
      method,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: session?.signal(10_000) ?? AbortSignal.timeout(10_000),
    });
    const data = await bytes(r, limit);
    session?.count("googleResponseBytes", data.length);
    let parsed: any;
    try {
      parsed = data.length ? JSON.parse(data.toString("utf8")) : {};
    } catch {
      throw new Error("Invalid Google API response");
    }
    if (!r.ok) {
      const statuses: Record<string, number> = {
        ALREADY_EXISTS: 6,
        FAILED_PRECONDITION: 9,
        ABORTED: 10,
      };
      const error = Object.assign(
        new Error(parsed.error?.message ?? `Google HTTP ${r.status}`),
        {
          code:
            statuses[parsed.error?.status] ??
            (r.status === 409 ? 10 : r.status === 412 ? 9 : r.status),
        },
      );
      throw error;
    }
    return parsed;
  }
  const decode = (fields: Record<string, any>) =>
    Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [
        k,
        v.stringValue ??
          (v.timestampValue
            ? {
                toDate: () => new Date(v.timestampValue),
                toMillis: () => Date.parse(v.timestampValue),
              }
            : undefined),
      ]),
    );
  const encode = (data: Record<string, any>) =>
    Object.fromEntries(
      Object.entries(data).map(([k, v]) => [
        k,
        typeof v === "string"
          ? { stringValue: v }
          : { timestampValue: new Date(v.toMillis()).toISOString() },
      ]),
    );
  function ref(collection: string, id: string) {
    return {
      name: `${dbName}/documents/${collection}/${id}`,
      get: async () => (await getAll(ref(collection, id)))[0],
    };
  }
  async function getAll(...refs: { name: string }[]) {
    const results = await request(
      `${root}:batchGet`,
      "POST",
      { documents: refs.map((r) => r.name) },
      { firestoreReads: refs.length },
      refs.length * 128 * 1024,
    );
    if (!Array.isArray(results)) throw new Error("Missing Firestore read time");
    return refs.map((ref) => {
      const r = results.find(
        (r: any) => (r.found?.name ?? r.missing) === ref.name,
      );
      const at = Date.parse(r?.readTime);
      if (!r || !Number.isFinite(at))
        throw new Error("Firestore response is incomplete");
      return {
        exists: !!r.found,
        updateTime: r.found?.updateTime,
        readTime: { toMillis: () => at },
        data: () => (r.found ? decode(r.found.fields ?? {}) : undefined),
      };
    });
  }
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(name, id) }),
    getAll,
    batch: () => {
      const writes: any[] = [];
      const update = (
        reference: { name: string },
        data: Record<string, any>,
        precondition?: any,
      ) => {
        writes.push({
          update: { name: reference.name, fields: encode(data) },
          ...(precondition ? { currentDocument: precondition } : {}),
        });
      };
      return {
        set: update,
        create: (r: any, d: any) => update(r, d, { exists: false }),
        update: (r: any, d: any, options: any) =>
          update(r, d, { updateTime: options.lastUpdateTime }),
        commit: () =>
          request(
            `${root}:commit`,
            "POST",
            { writes },
            { firestoreWrites: writes.length },
            16 * 1024,
          ),
      };
    },
  } as unknown as Firestore;
  const bucketOrigin = config.storageOrigin ?? "https://storage.googleapis.com";
  const bucket = `${bucketOrigin}/storage/v1/b/${encodeURIComponent(config.bucket)}/o`;
  const blobs: SnapshotBlobs = {
    put: async (name, value) => {
      const data = gzipSync(value);
      if (data.length > 8 * 1024 ** 2)
        throw new TrialStopped("Snapshot exceeds upload reservation");
      session?.take({ storageByteMonths: data.length }, false);
      take({ storageClassA: 1, snapshotUploads: 1 });
      const token = await config.token();
      session?.assertOpen();
      const q = new URLSearchParams({
        uploadType: "media",
        name,
        ifGenerationMatch: "0",
      });
      const r = await network(
        `${bucketOrigin}/upload/storage/v1/b/${encodeURIComponent(config.bucket)}/o?${q}`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/gzip",
          },
          body: data,
          signal: session?.signal(20_000) ?? AbortSignal.timeout(20_000),
        },
      );
      const reply = await bytes(r, 65536);
      if (!r.ok) throw new Error(`Snapshot upload HTTP ${r.status}`);
      session?.count("uploadedCompressedBytes", data.length);
      session?.count("googleResponseBytes", reply.length);
    },
    get: async (name) => {
      // Reserve the maximum before reading, but report actual bytes separately.
      session?.take({ storageEgressBytes: 8 * 1024 ** 2 }, false);
      take({ storageClassB: 1 });
      const token = await config.token();
      session?.assertOpen();
      const r = await network(
        `${bucket}/${encodeURIComponent(name)}?alt=media`,
        {
          redirect: "error",
          headers: { Authorization: `Bearer ${token}` },
          signal: session?.signal(15_000) ?? AbortSignal.timeout(15_000),
        },
      );
      const data = await bytes(r, 8 * 1024 ** 2);
      if (!r.ok) throw new Error(`Snapshot read HTTP ${r.status}`);
      session?.count("downloadedCompressedBytes", data.length);
      return gunzipSync(data, { maxOutputLength: 64 * 1024 ** 2 }).toString(
        "utf8",
      );
    },
    remove: async (name) => {
      await request(
        `${bucket}/${encodeURIComponent(name)}`,
        "DELETE",
        undefined,
        {},
      );
      session?.count("storageObjectDeletes");
    },
    list: async () => {
      const result: { name: string; createdAt: number }[] = [];
      let pageToken = "";
      do {
        const q = new URLSearchParams({
          prefix: "market-current/",
          maxResults: "1000",
          ...(pageToken ? { pageToken } : {}),
        });
        const page = await request(`${bucket}?${q}`, "GET", undefined, {
          storageClassA: 1,
          storageListPages: 1,
        });
        for (const item of page.items ?? [])
          result.push({
            name: item.name,
            createdAt: Date.parse(item.timeCreated),
          });
        pageToken = page.nextPageToken ?? "";
      } while (pageToken);
      return result;
    },
  };
  return new GoogleCacheStore(db, blobs, config.collection);
}
