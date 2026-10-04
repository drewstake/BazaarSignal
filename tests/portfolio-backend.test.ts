import { afterEach, beforeEach, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({
  docs: new Map<string, any>(),
  version: 0,
  commits: [] as any[],
  legacy: { alerts: [], mail: [] },
  admissions: 0,
  prices: { bazaar: [], listings: [] } as any,
  accountEnabled: true,
  quota: 100,
}));
vi.mock("../shared/companion/portfolio-policy", () => ({
  PORTFOLIO_EVALUATION_ENABLED: true,
}));
vi.mock("../apps-script/companion", () => ({
  sharedMarket: () => storage.prices,
}));
const encode = (v: any): any =>
  v === null
    ? { nullValue: null }
    : typeof v === "string"
      ? { stringValue: v }
      : typeof v === "boolean"
        ? { booleanValue: v }
        : typeof v === "number"
          ? { integerValue: String(v) }
          : {
              mapValue: {
                fields: Object.fromEntries(
                  Object.entries(v).map(([k, x]) => [k, encode(x)]),
                ),
              },
            };
vi.mock("../apps-script/store", () => ({
  DOCUMENT: "projects/test/databases/(default)/documents",
  readDoc: (path: string) => storage.docs.get(path) ?? null,
  loadUser: () => ({ state: storage.legacy }),
  loadControl: () => ({
    state: { admissions: storage.admissions },
    version: null,
  }),
  checkAdmission: (c: any) => {
    if (c.admissions >= 40) throw new Error("Free alert capacity is full");
  },
  jsonWrite: (path: string, value: any, version: string | null) => ({
    update: {
      name: `projects/test/databases/(default)/documents/${path}`,
      fields: { json: { stringValue: JSON.stringify(value) } },
    },
    currentDocument: version ? { updateTime: version } : { exists: false },
  }),
  commit: (writes: any[]) => {
    storage.commits.push(writes);
    for (const w of writes) {
      const name = w.verify ?? w.update.name,
        path = name.split("/documents/")[1],
        old = storage.docs.get(path);
      if (
        w.currentDocument?.updateTime &&
        old?.updateTime !== w.currentDocument.updateTime
      )
        throw new Error("Stale precondition");
      if (w.currentDocument?.exists === false && old)
        throw new Error("Already exists");
    }
    return {
      writeResults: writes.map((w) => {
        if (w.verify) return {};
        const path = w.update.name.split("/documents/")[1],
          updateTime = String(++storage.version);
        storage.docs.set(path, { ...w.update, updateTime });
        if (path === "backend/worker")
          storage.admissions = JSON.parse(
            w.update.fields.json.stringValue,
          ).admissions;
        return { updateTime };
      }),
    };
  },
  firestore: (path: string) =>
    path === ":runQuery"
      ? [...storage.docs]
          .filter(([k]) => k.startsWith("portfolioSubscribers/"))
          .map(([, document]) => ({ document }))
      : {
          documents: [...storage.docs]
            .filter(([k]) => k.startsWith(path.slice(1).split("?")[0] + "/"))
            .map(([, v]) => v),
        },
  fetchJson: () => ({
    users: [
      {
        localId: "alice",
        email: "current@example.test",
        emailVerified: true,
        disabled: !storage.accountEnabled,
        providerUserInfo: [{ providerId: "google.com" }],
      },
    ],
  }),
}));
import {
  decodeFields,
  notificationKey,
  portfolioNotificationRequest,
  runPortfolioNotifications,
} from "../apps-script/portfolio-backend";
import { legacyHolding } from "../shared/companion/portfolio";
import { normalizeBazaar } from "../shared/companion/bazaar";
const now = Date.now(),
  pid = "portfolio",
  hid = "bz_BOOSTER_COOKIE",
  id = `${pid}__${hid}`,
  path = `users/alice/portfolioNotifications/${id}`,
  identity = { uid: "alice", email: "alice@example.test" };
const p = {
  id: pid,
  name: "Private",
  createdAt: now,
  updatedAt: now,
  revision: 1,
  deleted: false,
};
const h = legacyHolding({
  itemId: "BOOSTER_COOKIE",
  name: "Booster Cookie",
  quantity: 10,
  costBasis: 1000,
  createdAt: now,
  updatedAt: now,
  revision: 1,
});
function seed(path: string, value: any) {
  storage.docs.set(path, {
    name: `projects/test/databases/(default)/documents/${path}`,
    fields: encode(value).mapValue.fields,
    updateTime: String(++storage.version),
  });
}
const request = (
  operation = "save",
  revision = 0,
  input: any = { baseline: "acquisition", up: 10, down: 5 },
) => ({ portfolioId: pid, holdingId: hid, operation, revision, input });
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const properties = new Map<string, string>([
    ["MARKET_UPDATES_PAUSED", "false"],
  ]);
  vi.stubGlobal("PropertiesService", {
    getScriptProperties: () => ({
      getProperty: (key: string) => properties.get(key) ?? null,
      setProperty: (key: string, value: string) => properties.set(key, value),
      deleteProperty: (key: string) => properties.delete(key),
    }),
  });
  vi.stubGlobal("ScriptApp", { getOAuthToken: () => "offline-test-token" });
  vi.stubGlobal("MailApp", {
    sendEmail: vi.fn(),
    getRemainingDailyQuota: () => storage.quota,
  });
  storage.docs.clear();
  storage.version = 0;
  storage.commits = [];
  storage.admissions = 0;
  storage.accountEnabled = true;
  storage.quota = 100;
  storage.prices = { bazaar: [], listings: [] };
  storage.legacy = { alerts: [], mail: [] };
  seed(`users/alice/portfolios/${pid}`, p);
  seed(`users/alice/portfolios/${pid}/holdings/${hid}`, h);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function workerSample(price: number, stamp: number) {
  storage.prices = {
    bazaar: [
      normalizeBazaar(
        "BOOSTER_COOKIE",
        {
          sell_summary: [{ pricePerUnit: price, amount: 100, orders: 1 }],
          buy_summary: [],
        },
        stamp,
        stamp,
      ),
    ],
    listings: [],
  };
}
it("runs the persisted worker through priming, crossing, verified recipient lookup and replay deduplication", () => {
  portfolioNotificationRequest(identity, request(), now);
  seed("users/alice/portfolioPreferences/main", { emailEnabled: true });
  workerSample(100, now - 2000);
  expect(runPortfolioNotifications(now)).toEqual({ processed: 1 });
  expect((globalThis as any).MailApp.sendEmail).not.toHaveBeenCalled();
  workerSample(115, now - 1000);
  expect(runPortfolioNotifications(now)).toEqual({ processed: 1 });
  expect((globalThis as any).MailApp.sendEmail).toHaveBeenCalledTimes(1);
  expect((globalThis as any).MailApp.sendEmail.mock.calls[0][0]).toMatchObject({
    to: "current@example.test",
  });
  runPortfolioNotifications(now);
  expect((globalThis as any).MailApp.sendEmail).toHaveBeenCalledTimes(1);
});
it.each(["preference", "holding", "portfolio", "identity"])(
  "rechecks %s eligibility before sending a quota-deferred crossing",
  (boundary) => {
    portfolioNotificationRequest(identity, request(), now);
    seed("users/alice/portfolioPreferences/main", { emailEnabled: true });
    workerSample(100, now - 2000);
    runPortfolioNotifications(now);
    storage.quota = 0;
    workerSample(115, now - 1000);
    runPortfolioNotifications(now);
    const ledger = JSON.parse(
      storage.docs.get("portfolioDelivery/alice").fields.json.stringValue,
    );
    expect(ledger.state.mail).toHaveLength(1);
    expect((globalThis as any).MailApp.sendEmail).not.toHaveBeenCalled();
    if (boundary === "preference")
      seed("users/alice/portfolioPreferences/main", { emailEnabled: false });
    if (boundary === "holding")
      seed(`users/alice/portfolios/${pid}/holdings/${hid}`, {
        ...h,
        deleted: true,
        revision: 2,
      });
    if (boundary === "portfolio")
      seed(`users/alice/portfolios/${pid}`, {
        ...p,
        deleted: true,
        revision: 2,
      });
    if (boundary === "identity") storage.accountEnabled = false;
    storage.quota = 100;
    vi.setSystemTime(now + 3600001);
    runPortfolioNotifications(now + 3600001);
    expect((globalThis as any).MailApp.sendEmail).not.toHaveBeenCalled();
  },
);
it("accepts the full holding ID bounds and rejects arbitrary document paths", () => {
  expect(notificationKey(pid, `bz_${"A".repeat(100)}`)).toHaveLength(
    pid.length + 105,
  );
  expect(() => notificationKey(pid, "bz_../other")).toThrow("Invalid");
  expect(() => notificationKey(pid, "unknown")).toThrow("Invalid");
});
it("binds settings to the verified UID and holding and uses compare-and-swap revisions", () => {
  expect(() =>
    portfolioNotificationRequest(
      { uid: "bob", email: "bob@example.test" },
      request(),
      now,
    ),
  ).toThrow("Invalid");
  const saved = portfolioNotificationRequest(
    identity,
    {
      ...request(),
      uid: "bob",
      recipient: "attacker@example.test",
      price: 99999,
    },
    now,
  );
  expect(saved).toMatchObject({
    enabled: true,
    baseline: "acquisition",
    capturedPrice: null,
    revision: 1,
  });
  expect(storage.admissions).toBe(1);
  expect(JSON.stringify(storage.commits)).not.toMatch(/attacker|99999/);
  expect(() => portfolioNotificationRequest(identity, request(), now)).toThrow(
    "changed elsewhere",
  );
  const paused = portfolioNotificationRequest(
    identity,
    request("pause", 1),
    now + 1,
  );
  expect(paused.enabled).toBe(false);
  expect(
    portfolioNotificationRequest(identity, request("resume", 2), now + 2)
      .enabled,
  ).toBe(true);
  expect(
    portfolioNotificationRequest(identity, request("delete", 3), now + 3),
  ).toMatchObject({ deleted: true, enabled: false });
});
it("captures only a valid fresh server sample and never trusts browser prices or fixtures", () => {
  const item = normalizeBazaar(
    "BOOSTER_COOKIE",
    {
      sell_summary: [{ pricePerUnit: 120, amount: 100, orders: 1 }],
      buy_summary: [],
    },
    now - 1000,
    now - 1000,
  );
  const input = { baseline: "sample", up: 10, down: null };
  for (const prices of [
    { bazaar: [], listings: [] },
    { bazaar: [item], listings: [], fixture: true },
    {
      bazaar: [{ ...item, upstreamAt: now - 600000, observedAt: now - 600000 }],
      listings: [],
    },
  ])
    expect(() =>
      portfolioNotificationRequest(
        identity,
        request("save", 0, input),
        now,
        () => prices,
      ),
    ).toThrow("fresh valid");
  const captured = portfolioNotificationRequest(
    identity,
    request("save", 0, input),
    now,
    () => ({ bazaar: [item], listings: [] }),
  );
  expect(captured).toMatchObject({
    capturedPrice: 120,
    capturedAt: now - 1000,
  });
  portfolioNotificationRequest(identity, request("pause", 1), now + 1);
  const newer = {
    ...item,
    bids: [{ pricePerUnit: 150, amount: 100, orders: 1 }],
  };
  const resumed = portfolioNotificationRequest(
    identity,
    request("resume", 2),
    now + 2,
    () => ({ bazaar: [newer], listings: [] }),
  );
  expect(resumed.capturedPrice).toBe(120);
});
it("rejects deleted parents, invalid schema, baseline changes without a new revision and exhausted allowance", () => {
  seed(`users/alice/portfolios/${pid}`, { ...p, deleted: true });
  expect(() => portfolioNotificationRequest(identity, request(), now)).toThrow(
    "deleted",
  );
  seed(`users/alice/portfolios/${pid}`, p);
  expect(() =>
    portfolioNotificationRequest(
      identity,
      request("save", 0, { baseline: "acquisition", up: NaN, down: 10 }),
      now,
    ),
  ).toThrow();
  storage.admissions = 40;
  expect(() => portfolioNotificationRequest(identity, request(), now)).toThrow(
    "capacity",
  );
  expect(storage.docs.has(path)).toBe(false);
});
it("enforces combined legacy and portfolio active/stored limits without new mail on configuration", () => {
  storage.legacy.alerts = Array.from({ length: 20 }, () => ({
    workflow: { paused: false, stage: "watching_sell" },
  })) as any;
  expect(() => portfolioNotificationRequest(identity, request(), now)).toThrow(
    "20 active",
  );
  storage.legacy.alerts = Array.from({ length: 100 }, () => ({
    workflow: { paused: true, stage: "completed" },
  })) as any;
  expect(() => portfolioNotificationRequest(identity, request(), now)).toThrow(
    "100 stored",
  );
  storage.legacy.alerts = [];
  portfolioNotificationRequest(identity, request(), now);
  expect(
    JSON.parse(
      storage.docs.get("portfolioDelivery/alice").fields.json.stringValue,
    ).state.mail,
  ).toEqual([]);
  expect(decodeFields(storage.docs.get(path).fields).enabled).toBe(true);
});
