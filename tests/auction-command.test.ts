import { expect, it, vi } from "vitest";
import { PlayerNames } from "../collector/player-name";
import { SqliteCache } from "../collector/cache-store";
import { MarketCollector } from "../collector/engine";
const response = (body: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });

it("shares positive seller names across instances and validates identities", async () => {
  const store = new SqliteCache(":memory:"),
    id = "1".repeat(32);
  const fetcher = vi.fn(async () => response({ id, name: "Sky_Player7" }));
  const a = new PlayerNames(store, fetcher),
    b = new PlayerNames(store, fetcher);
  expect(await a.resolve(id)).toBe("Sky_Player7");
  expect(await b.resolve(id)).toBe("Sky_Player7");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(b.resolve("2".repeat(32))).rejects.toThrow("unavailable");
  await expect(a.resolve("bad-id")).rejects.toThrow("identity unavailable");
  await store.close();
});
it("negative-caches failures, honors provider Retry-After globally and recovers", async () => {
  let now = Date.now();
  const store = new SqliteCache(":memory:"),
    id = "3".repeat(32);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response({}, 429, { "Retry-After": "120" }))
    .mockResolvedValue(response({ id, name: "RecoveredName" }));
  const names = new PlayerNames(store, fetcher, () => now);
  await expect(names.resolve(id)).rejects.toThrow("look up");
  await expect(names.resolve(id)).rejects.toThrow("look up");
  now += 60001;
  await expect(names.resolve("4".repeat(32))).rejects.toThrow("cooling down");
  expect(fetcher).toHaveBeenCalledTimes(1);
  now += 60000;
  expect(await names.resolve(id)).toBe("RecoveredName");
  await store.close();
});
it("deduplicates concurrent names and caps unique lookups separately from Hypixel", async () => {
  const store = new SqliteCache(":memory:"),
    id = "a".repeat(32);
  const fetcher = vi.fn(async () => response({ id, name: "Seller" }));
  const a = new PlayerNames(store, fetcher, Date.now, 1),
    b = new PlayerNames(store, fetcher, Date.now, 1);
  expect(await Promise.all([a.resolve(id), b.resolve(id)])).toEqual([
    "Seller",
    "Seller",
  ]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(b.resolve("b".repeat(32))).rejects.toThrow("cooling down");
  await store.close();
});
it("uses cached availability, rechecks after lookup, and copies only verified usernames", async () => {
  const store = new SqliteCache(":memory:"),
    c = new MarketCollector(store);
  const seller = "b".repeat(32),
    id = "a".repeat(32);
  const recheck = vi
    .spyOn(c, "recheck")
    .mockResolvedValue({
      status: "active",
      seller,
      dataAt: Date.now(),
      checkedAt: Date.now(),
      command: null,
      source: "cache",
    });
  const resolve = vi.spyOn(c.names, "resolve").mockResolvedValue("RealSeller");
  expect(await c.auctionCommand(id)).toEqual({
    command: "/ah RealSeller",
    seller: "RealSeller",
  });
  recheck.mockResolvedValue({
    status: "stale",
    seller,
    dataAt: 0,
    checkedAt: Date.now(),
    command: null,
    source: "cache",
  });
  await expect(c.auctionCommand(id)).rejects.toThrow("Listing stale");
  expect(resolve).toHaveBeenCalledTimes(1);
  await store.close();
});
