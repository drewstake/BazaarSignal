import { gzipSync } from "node:zlib";
import type { Counters } from "../../collector/trial";

/** No real fetch, credentials or sockets. Models atomic document preconditions,
 * immutable objects and document (not HTTP request) operation counts. */
export function offlineGoogle(clock = Date.now) {
  const documents = new Map<string, { fields: any; updateTime: string }>();
  const objects = new Map<string, Buffer>();
  const counts: Counters = {};
  let version = 0;
  const root = "projects/offline/databases/(default)/documents/marketCache/";
  const add = (key: string, n = 1) => {
    counts[key] = (counts[key] ?? 0) + n;
  };
  const seed = (key: string, value: string) =>
    documents.set(root + key, {
      fields: { value: { stringValue: value } },
      updateTime: new Date(++version).toISOString(),
    });
  const snapshot = (key: string, value: string) => {
    const blob = `market-current/${key}/fixture-${++version}.json.gz`;
    objects.set(blob, gzipSync(value));
    documents.set(root + key, {
      fields: { blob: { stringValue: blob } },
      updateTime: new Date(++version).toISOString(),
    });
  };
  const read = (key: string) =>
    documents.get(root + key)?.fields.value?.stringValue as string | undefined;
  const network: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "firestore.googleapis.com") {
      const body = JSON.parse(String(init?.body));
      if (url.pathname.endsWith(":batchGet")) {
        add("firestoreReads", body.documents.length);
        return Response.json(
          body.documents.map((name: string) => {
            const found = documents.get(name);
            return {
              ...(found ? { found: { name, ...found } } : { missing: name }),
              readTime: new Date(clock()).toISOString(),
            };
          }),
        );
      }
      if (url.pathname.endsWith(":commit")) {
        add("firestoreWriteAttempts", body.writes.length);
        for (const w of body.writes) {
          const old = documents.get(w.update.name),
            p = w.currentDocument;
          if (
            (p?.exists === false && old) ||
            (p?.updateTime && p.updateTime !== old?.updateTime)
          ) {
            add("casConflicts");
            return Response.json(
              { error: { status: "FAILED_PRECONDITION" } },
              { status: 412 },
            );
          }
        }
        for (const w of body.writes)
          documents.set(w.update.name, {
            fields: w.update.fields,
            updateTime: new Date(++version).toISOString(),
          });
        add("firestoreWrites", body.writes.length);
        return Response.json({});
      }
    }
    if (url.hostname === "storage.googleapis.com") {
      if (url.pathname.startsWith("/upload/")) {
        const name = url.searchParams.get("name")!;
        if (objects.has(name)) return new Response(null, { status: 412 });
        const data = Buffer.from(init!.body as Uint8Array);
        objects.set(name, data);
        add("storageClassA");
        add("uploads");
        add("uploadBytes", data.length);
        return Response.json({});
      }
      if (url.pathname.endsWith("/o")) {
        add("storageClassA");
        add("listPages");
        return Response.json({
          items: [...objects.keys()].map((name) => ({
            name,
            timeCreated: new Date(clock() - 86_400_000).toISOString(),
          })),
        });
      }
      const name = decodeURIComponent(url.pathname.split("/o/")[1]);
      if (init?.method === "DELETE") {
        objects.delete(name);
        add("objectDeletes");
        return Response.json({});
      }
      add("storageClassB");
      const data = objects.get(name);
      if (!data) return new Response(null, { status: 404 });
      add("downloadBytes", data.length);
      return new Response(data);
    }
    throw new Error(`Offline transport rejected ${url.origin}${url.pathname}`);
  };
  return {
    documents,
    objects,
    counts,
    seed,
    snapshot,
    read,
    network,
    config: {
      project: "offline",
      bucket: "offline",
      token: async () => "offline",
      network,
    },
  };
}
