import { afterEach, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { SqliteCache } from "../collector/cache-store";
import { trialGoogleStore } from "../collector/trial-google";
import {
  TrialLedger,
  trialLimits,
  TRIAL_MAX_MS,
  type TrialState,
} from "../collector/trial";
import { googleMeters } from "../collector/usage";

const stores: SqliteCache[] = [];
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
});
async function session() {
  const now = Date.now(),
    store = new SqliteCache(":memory:");
  stores.push(store);
  const state: TrialState = {
    version: 1,
    id: "fixture",
    startsAt: now,
    expiresAt: now + TRIAL_MAX_MS,
    limits: { ...trialLimits },
    reserved: {},
    observed: {},
    admissions: {},
    baseline: {
      meters: Object.fromEntries(
        googleMeters.map((key) => [
          key,
          {
            scope: "fixture",
            periodStart: now - 1000,
            periodEnd: now + 86400_000,
            verifiedAt: now,
            limit: 1e15,
            used: 1,
            reserved: 0,
            headroom: 1,
            projectedRemaining: 0,
          },
        ]),
      ),
    },
  };
  await store.commit("trial", null, JSON.stringify(state));
  return (await new TrialLedger(store, () => Date.now()).admit(
    "collector",
    "invocation",
  ))!;
}
function firestore() {
  const docs = new Map<string, { fields: any; updateTime: string }>();
  let version = 0;
  const network = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input),
        body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.endsWith(":batchGet"))
        return Response.json(
          body.documents.map((name: string) => {
            const found = docs.get(name);
            return {
              ...(found ? { found: { name, ...found } } : { missing: name }),
              readTime: new Date().toISOString(),
            };
          }),
        );
      if (url.endsWith(":commit")) {
        for (const w of body.writes) {
          const old = docs.get(w.update.name),
            p = w.currentDocument;
          if (
            (p?.exists === false && old) ||
            (p?.updateTime && p.updateTime !== old?.updateTime)
          )
            return Response.json(
              { error: { status: "ABORTED", code: 409 } },
              { status: 409 },
            );
        }
        for (const w of body.writes)
          docs.set(w.update.name, {
            fields: w.update.fields,
            updateTime: new Date(++version).toISOString(),
          });
        return Response.json({ writeResults: [] });
      }
      throw new Error(`Unexpected fixture RPC ${url}`);
    },
  );
  return { docs, network };
}
it("REST CAS has one winner, accounts for every read/write RPC, and never performs hidden retries", async () => {
  const fixture = firestore(),
    s = await session(),
    attempts: Record<string, number> = {};
  const config = {
    project: "fixture",
    bucket: "fixture",
    token: async () => "fixture-token",
    network: fixture.network,
    onAttempt: (costs: Record<string, number>) => {
      for (const [k, v] of Object.entries(costs))
        attempts[k] = (attempts[k] ?? 0) + v;
    },
  };
  const a = trialGoogleStore(config, s),
    b = trialGoogleStore(config, s);
  expect(
    await Promise.all([
      a.commit("control", null, "first"),
      b.commit("control", null, "second"),
    ]),
  ).toEqual([true, false]);
  expect(await b.read("control")).toBe("first");
  expect(fixture.network).toHaveBeenCalledTimes(5);
  expect(attempts).toEqual({ firestoreReads: 3, firestoreWrites: 2 });
  expect(s.observed.firestoreWrites).toBe(2);
});
it("snapshot uploads and downloads count operations and actual compressed bytes separately from holds", async () => {
  const s = await session(),
    data = gzipSync("complete snapshot"),
    network = vi.fn(async (_url: any, init?: RequestInit) =>
      init?.method === "POST"
        ? Response.json({ name: "saved" })
        : new Response(data),
    );
  const store = trialGoogleStore(
    {
      project: "fixture",
      bucket: "fixture",
      token: async () => "fixture-token",
      network,
    },
    s,
  );
  await store.blobs.put("market-current/example", "complete snapshot");
  expect(await store.blobs.get("market-current/example")).toBe(
    "complete snapshot",
  );
  expect(s.observed).toMatchObject({
    storageClassA: 1,
    snapshotUploads: 1,
    storageClassB: 1,
    uploadedCompressedBytes: data.length,
    downloadedCompressedBytes: data.length,
  });
  expect(s.observed.storageEgressBytes).toBeUndefined();
});
it("each cleanup listing page consumes Class A; the fifth page is stopped before its request", async () => {
  const s = await session();
  await s.extend({ storageClassA: 4, storageListPages: 4 });
  const network = vi.fn(async () =>
    Response.json({ items: [], nextPageToken: "another-page" }),
  );
  const store = trialGoogleStore(
    {
      project: "fixture",
      bucket: "fixture",
      token: async () => "fixture-token",
      network,
    },
    s,
  );
  await expect(store.blobs.list()).rejects.toThrow("storageListPages");
  expect(network).toHaveBeenCalledTimes(4);
  expect(s.observed.storageListPages).toBe(4);
});
it("an expired session cannot perform even token acquisition or an RPC", async () => {
  const s = await session(),
    token = vi.fn(),
    network = vi.fn();
  const store = trialGoogleStore(
    { project: "fixture", bucket: "fixture", token, network },
    s,
  );
  const spy = vi.spyOn(Date, "now").mockReturnValue(s.expiresAt + 1);
  try {
    await expect(store.read("control")).rejects.toThrow("deadline");
    expect(token).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});
