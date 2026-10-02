import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { getApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { FirestoreHistory } from "../collector/store";
import { MarketCollector, quotaDay } from "../collector/legacy-history-engine";
import { normalizeVariant } from "../collector/normalize";
import { valueVariant } from "../shared/companion/auctions";
import type { Sale } from "../shared/companion/types";

describe("Firestore collector persistence", () => {
  const now = Date.now();
  const variant = normalizeVariant(
    { i: [{ Count: 1, tag: { ExtraAttributes: { id: "STORE_TEST" } } }] },
    { STORE_TEST: { name: "Test", tier: "COMMON" } },
  );
  const sale: Sale = {
    id: "store-test-sale",
    variant,
    price: 1000,
    soldAt: now,
    observedAt: now,
    seller: "seller",
    buyer: "buyer",
    source: "hypixel-ended",
  };
  let db: ReturnType<typeof getFirestore>;
  beforeAll(async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST)
      throw new Error("Emulator required");
    process.env.GOOGLE_CLOUD_PROJECT = "demo-bazaar-watch";
    await new FirestoreHistory().connect();
    db = getFirestore(getApp("collector"));
    for (const collection of [
      "completedSales",
      "itemVariants",
      "comparablePrices",
      "collectorStatus",
    ])
      await db.recursiveDelete(db.collection(collection));
  });
  afterAll(async () => {
    await deleteApp(getApp("collector"));
  });
  it("persists exact events once across retries and restarts; expires all historical collections", async () => {
    const store = new FirestoreHistory();
    await store.load();
    const health = new MarketCollector(store).health;
    health.endedUpstreamAt = now;
    health.lastEndedSuccess = now;
    await db
      .doc("completedSales/expired")
      .set({ ...sale, id: "expired", soldAt: now - 15 * 86400000 });
    await db
      .doc("comparablePrices/expired")
      .set({ updatedAt: now - 15 * 86400000 });
    await db
      .doc("itemVariants/expired")
      .set({ lastSeenAt: now - 31 * 86400000 });
    const values = new Map([
      [variant.fingerprint, valueVariant(variant, [sale], [], now)],
    ]);
    await store.commit([sale], health, values);
    const firstCount = health.writesToday;
    await store.commit([sale], health, values);
    expect(health.writesToday).toBe(firstCount + 1); // Only the coverage heartbeat changes.
    expect((await db.collection("completedSales").get()).size).toBe(1);
    expect((await db.doc("itemVariants/expired").get()).exists).toBe(false);
    expect((await db.doc("comparablePrices/expired").get()).exists).toBe(false);
    const reopened = new FirestoreHistory(),
      saved = await reopened.load();
    expect(saved.sales).toHaveLength(1);
    expect(saved.health?.endedUpstreamAt).toBe(now);
    await reopened.commit(saved.sales, health, new Map());
    expect((await db.collection("completedSales").get()).size).toBe(1);
    expect(
      (await db.doc(`itemVariants/${variant.fingerprint}`).get()).data()
        ?.lastSeenAt,
    ).toBe(now);
  });
  it("reserves a durable status write and stops before the daily limit", async () => {
    const store = new FirestoreHistory();
    await store.load();
    const health = new MarketCollector(store).health;
    health.writesToday = 99;
    health.writeLimit = 100;
    health.lastEndedSuccess = now;
    await store.commit([{ ...sale, id: "over-budget" }], health, new Map());
    expect(health.writesToday).toBe(100);
    expect((await db.doc("completedSales/over-budget").get()).exists).toBe(
      false,
    );
    expect(
      (await db.doc("collectorStatus/main").get()).data()?.error,
    ).toContain("budget");
    await store.commit([{ ...sale, id: "over-budget" }], health, new Map());
    expect(health.writesToday).toBe(100);
  });
  it("uses the Pacific quota day across UTC midnight and daylight saving", () => {
    expect(quotaDay(Date.parse("2026-09-30T02:00:00Z"))).toBe("2026-09-29");
    expect(quotaDay(Date.parse("2026-09-30T08:00:00Z"))).toBe("2026-09-30");
    expect(quotaDay(Date.parse("2026-12-30T07:00:00Z"))).toBe("2026-12-29");
  });
});
