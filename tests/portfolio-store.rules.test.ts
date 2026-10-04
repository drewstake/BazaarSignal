import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  getDocs,
  collection,
} from "firebase/firestore";
const client = vi.hoisted(() => ({
  auth: { currentUser: null as any },
  db: null as any,
}));
vi.mock("../src/data", () => ({
  auth: client.auth,
  get db() {
    return client.db;
  },
}));
import {
  loadPortfolios,
  loadHoldings,
  migratePositions,
  saveHolding,
  savePortfolio,
} from "../src/companion/portfolio-store";
import { legacyHolding } from "../shared/companion/portfolio";
let env: RulesTestEnvironment;
const google = {
  email_verified: true,
  firebase: { sign_in_provider: "google.com" },
};
const user = (uid: string) => ({
  uid,
  emailVerified: true,
  providerData: [{ providerId: "google.com" }],
});
const position = () => ({
  itemId: "BOOSTER_COOKIE",
  name: "Booster Cookie",
  quantity: 287,
  costBasis: 3501400000,
  createdAt: Date.now() - 10000,
  updatedAt: Date.now() - 10000,
  revision: 1,
});
let uid = "";
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-bazaar-watch",
    firestore: {
      host: "127.0.0.1",
      port: 8081,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
});
afterAll(async () => env?.cleanup());
beforeEach(() => {
  uid = `portfolio-${crypto.randomUUID()}`;
  client.auth.currentUser = user(uid);
  client.db = env.authenticatedContext(uid, google).firestore();
});
it("creates, renames, tombstones portfolios and rejects stale edits or resurrection", async () => {
  const first = await savePortfolio(uid, "Long term");
  expect((await loadPortfolios(uid))[0].name).toBe("Long term");
  const renamed = await savePortfolio(uid, "Materials", first);
  expect(renamed.revision).toBe(2);
  await expect(savePortfolio(uid, "stale", first)).rejects.toThrow("changed");
  await savePortfolio(uid, "Materials", renamed, true);
  expect(await loadPortfolios(uid)).toEqual([]);
  await assertFails(
    setDoc(doc(client.db, "users", uid, "portfolios", first.id), {
      ...renamed,
      revision: 4,
      deleted: false,
    }),
  );
});
it("migrates positions atomically and retrying never duplicates or recreates deleted holdings", async () => {
  const p = position();
  await setDoc(doc(client.db, "users", uid, "positions", p.itemId), p);
  await Promise.all([migratePositions(uid), migratePositions(uid)]);
  const portfolios = await loadPortfolios(uid),
    holdings = await loadHoldings(uid, "default");
  expect(portfolios).toHaveLength(1);
  expect(holdings).toHaveLength(1);
  expect(holdings[0]).toMatchObject({ quantity: 287, costBasis: 3501400000 });
  await assertFails(
    setDoc(doc(client.db, "users", uid, "positions", p.itemId), {
      ...p,
      revision: 2,
      quantity: 400,
    }),
  );
  await saveHolding(uid, "default", {
    ...holdings[0],
    mode: "delete",
    expected: holdings[0],
  });
  await migratePositions(uid);
  expect(await loadHoldings(uid, "default")).toEqual([]);
  expect(
    (await getDoc(doc(client.db, "users", uid, "positions", p.itemId))).data(),
  ).toEqual(p);
  await savePortfolio(uid, portfolios[0].name, portfolios[0], true);
  await migratePositions(uid);
  expect(await loadPortfolios(uid)).toEqual([]);
});
it("keeps a migration retry safe after a mid-scan failure", async () => {
  const p = position();
  await setDoc(doc(client.db, "users", uid, "positions", p.itemId), p);
  await env.withSecurityRulesDisabled(async (ctx) =>
    setDoc(doc(ctx.firestore(), "users", uid, "positions", "ZZ_BAD"), {
      bad: true,
    }),
  );
  await expect(migratePositions(uid)).rejects.toThrow("invalid");
  expect(await loadHoldings(uid, "default")).toHaveLength(1);
  await env.withSecurityRulesDisabled(async (ctx) =>
    deleteDoc(doc(ctx.firestore(), "users", uid, "positions", "ZZ_BAD")),
  );
  await migratePositions(uid);
  expect(await loadHoldings(uid, "default")).toHaveLength(1);
});
it("combines concurrent purchases transactionally and rejects stale replacement edits/deletes", async () => {
  const p = await savePortfolio(uid, "Trading"),
    base = { ...legacyHolding(position()), mode: "create" as const };
  const first = await saveHolding(uid, p.id, base);
  await Promise.all([
    saveHolding(uid, p.id, {
      ...base,
      mode: "purchase",
      quantity: 3,
      costBasis: 30000000,
    }),
    saveHolding(uid, p.id, {
      ...base,
      mode: "purchase",
      quantity: 10,
      costBasis: 100000000,
    }),
  ]);
  const current = (await loadHoldings(uid, p.id))[0];
  expect(current).toMatchObject({
    quantity: 300,
    costBasis: 3631400000,
    revision: 3,
  });
  await expect(
    saveHolding(uid, p.id, { ...first, mode: "edit", expected: first }),
  ).rejects.toThrow("another tab");
  await expect(
    saveHolding(uid, p.id, { ...first, mode: "delete", expected: first }),
  ).rejects.toThrow("another tab");
  await expect(saveHolding(uid, p.id, base)).rejects.toThrow("already track");
  const second = await savePortfolio(uid, "Other");
  await saveHolding(uid, second.id, base);
  expect(await loadHoldings(uid, second.id)).toHaveLength(1);
});
it("atomically retires notifications on holding deletion and cannot silently resume on recreation", async () => {
  const p = await savePortfolio(uid, "Alerts"),
    h = await saveHolding(uid, p.id, {
      ...legacyHolding(position()),
      mode: "create",
    }),
    key = `${p.id}__${h.id}`;
  const path = ["users", uid, "portfolioNotifications", key];
  await env.withSecurityRulesDisabled(async (ctx) =>
    setDoc(doc(ctx.firestore(), path.join("/")), {
      id: key,
      holdingId: h.id,
      portfolioId: p.id,
      enabled: true,
      deleted: false,
      revision: 1,
      updatedAt: Date.now(),
    }),
  );
  await assertFails(
    setDoc(doc(client.db, "users", uid, "portfolios", p.id, "holdings", h.id), {
      ...h,
      deleted: true,
      revision: h.revision + 1,
      updatedAt: Date.now(),
    }),
  );
  await saveHolding(uid, p.id, { ...h, mode: "delete", expected: h });
  expect((await getDoc(doc(client.db, path.join("/")))).data()).toMatchObject({
    enabled: false,
    deleted: true,
    revision: 2,
  });
  await saveHolding(uid, p.id, { ...h, mode: "create" });
  expect((await getDoc(doc(client.db, path.join("/")))).data()?.enabled).toBe(
    false,
  );
});
it("isolates accounts, requires verified Google identity and validates portfolio/holding/settings schemas", async () => {
  const p = await savePortfolio(uid, "Private"),
    h = await saveHolding(uid, p.id, {
      ...legacyHolding(position()),
      mode: "create",
    }),
    path = `users/${uid}/portfolios/${p.id}/holdings/${h.id}`;
  for (const db of [
    env.unauthenticatedContext().firestore(),
    env.authenticatedContext("other", google).firestore(),
    env
      .authenticatedContext(uid, { ...google, email_verified: false })
      .firestore(),
    env
      .authenticatedContext(uid, {
        email_verified: true,
        firebase: { sign_in_provider: "password" },
      })
      .firestore(),
  ]) {
    await assertFails(getDoc(doc(db, path)));
    await assertFails(getDocs(collection(db, "users", uid, "portfolios")));
    await assertFails(setDoc(doc(db, path), { ...h, revision: 2 }));
  }
  for (const patch of [
    { quantity: 1.5 },
    { costBasis: 0 },
    { quantity: 1e10 },
    { price: 123 },
    { revision: 4 },
    { id: "forged" },
    { kind: "unknown" },
    { configuration: "forged" },
  ])
    await assertFails(
      setDoc(doc(client.db, path), { ...h, revision: 2, ...patch }),
    );
  await assertFails(
    setDoc(doc(client.db, "users", uid, "portfolioNotifications", "forged"), {
      price: 123,
      enabled: true,
    }),
  );
  await assertFails(
    setDoc(doc(client.db, "users", uid, "portfolioPreferences", "main"), {
      emailEnabled: true,
      recipient: "attacker@example.test",
    }),
  );
  await assertSucceeds(
    setDoc(doc(client.db, "users", uid, "portfolioPreferences", "main"), {
      emailEnabled: false,
    }),
  );
  await assertFails(
    setDoc(doc(client.db, "users", uid, "positionMigrations", "FORGED"), {
      itemId: "FORGED",
      sourceRevision: 1,
      migratedAt: Date.now(),
    }),
  );
});
it("drops stale asynchronous responses on account switching, including replacement sessions with the same UID", async () => {
  const pending = loadPortfolios(uid);
  client.auth.currentUser = user("someone-else");
  client.auth.currentUser = user(uid);
  await expect(pending).rejects.toThrow("account changed");
  client.auth.currentUser = null;
  await expect(savePortfolio(uid, "blocked")).rejects.toThrow(
    "verified Google",
  );
});
