import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  aggregateUsers,
  emptyAdmin,
  pilotStatus,
  ADMIN_CACHE_MS,
  adminClockSlot,
  adminClockWindow,
  nextAdminRefresh,
} from "../shared/admin";
const { read, commit } = vi.hoisted(() => ({ read: vi.fn(), commit: vi.fn() }));
vi.mock("../apps-script/store", async (original) => ({
  ...((await original()) as any),
  readDoc: read,
  commit,
}));
import {
  measureAdmin,
  readOwnerAdmin,
  readAdminHistory,
  scheduledAdminDailyTick,
} from "../apps-script/admin-report";
const now = Date.parse("2026-10-14T12:10:15Z");
const owner = { uid: "verified-owner", email: "drewstake3@gmail.com" };
let properties: Record<string, string>,
  saved: any,
  release: ReturnType<typeof vi.fn>,
  fetcher: ReturnType<typeof vi.fn>;
function fixture(at = now) {
  const r = emptyAdmin(at);
  r.pilot = {
    measuredAt: at,
    startsAt: at - 3600000,
    expiresAt: Date.parse("2026-11-01T07:00:00Z"),
    budgetUsd: 5,
    stopUsd: 4.5,
    reservedUsd: 1.012,
    stoppedAt: null,
    reason: null,
    lastPriceCheck: at - 1000,
    priceError: null,
  };
  r.scheduler = {
    measuredAt: at,
    state: "ENABLED",
    schedule: "0 * * * *",
    expiresAt: r.pilot.expiresAt,
  };
  return r;
}
beforeEach(() => {
  properties = { MARKET_OPERATING_MODE: "paid-budget" };
  saved = fixture(now - ADMIN_CACHE_MS);
  release = vi.fn();
  fetcher = vi.fn(() => ({ getResponseCode: () => 403 }));
  read.mockImplementation((path) =>
    path === "config/access"
      ? { fields: { ownerUid: { stringValue: "owner" } } }
      : {
          fields: { json: { stringValue: JSON.stringify(saved) } },
          updateTime: "version",
        },
  );
  commit.mockImplementation((writes) => {
    saved = JSON.parse(writes[0].update.fields.json.stringValue);
  });
  vi.stubGlobal("PropertiesService", {
    getScriptProperties: () => ({
      getProperty: (k: string) => properties[k] ?? null,
      setProperty: (k: string, v: string) => {
        properties[k] = v;
      },
    }),
  });
  vi.stubGlobal("LockService", {
    getScriptLock: () => ({ tryLock: () => true, releaseLock: release }),
  });
  vi.stubGlobal("ScriptApp", { getOAuthToken: () => "server-only" });
  vi.stubGlobal("UrlFetchApp", { fetch: fetcher });
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("rejects non-owners before private reads, properties, or history", () => {
  const props = vi.spyOn(
    (globalThis as any).PropertiesService,
    "getScriptProperties",
  );
  for (const identity of [
    { uid: "other", email: "other@example.test" },
    { uid: "", email: owner.email },
  ]) {
    expect(() => readOwnerAdmin(identity)).toThrow("owner access required");
    expect(() => readAdminHistory(identity)).toThrow("owner access required");
  }
  expect(read).not.toHaveBeenCalled();
  expect(props).not.toHaveBeenCalled();
});
it("repeated and overdue page reads never collect or write and reuse the private durable snapshot", () => {
  // Migration starts with yesterday's already expired measurement slot.
  for (let i = 0; i < 100; i++)
    expect(readOwnerAdmin(owner, now + i * ADMIN_CACHE_MS).pilot).toEqual(
      saved.pilot,
    );
  expect(read).toHaveBeenCalledTimes(2);
  expect(commit).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  expect(properties.ADMIN_DAILY_SNAPSHOT).toBeTruthy();
  expect(release).toHaveBeenCalledOnce();
});
it("runs only in a fixed daily UTC clock window, including across daylight saving time", () => {
  expect(adminClockWindow(now)).toBe(true);
  expect(adminClockWindow(Date.parse("2026-10-14T12:09:59Z"))).toBe(false);
  expect(adminClockWindow(Date.parse("2026-10-14T12:11:00Z"))).toBe(false);
  expect(nextAdminRefresh(now) - nextAdminRefresh(now - ADMIN_CACHE_MS)).toBe(
    ADMIN_CACHE_MS,
  );
  expect(nextAdminRefresh(Date.parse("2026-11-01T12:10:15Z"))).toBe(
    Date.parse("2026-11-02T12:10:00Z"),
  );
  const props = vi.spyOn(
    (globalThis as any).PropertiesService,
    "getScriptProperties",
  );
  expect(scheduledAdminDailyTick(now - 60000)).toEqual({
    ok: true,
    skipped: true,
  });
  expect(props).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});
it("claims the daily slot before network work and retains failed measurements without same-day retries", () => {
  fetcher.mockImplementation(() => {
    expect(properties.ADMIN_DAILY_ATTEMPT_SLOT).toBe(
      String(adminClockSlot(now)),
    );
    expect(saved.nextRefreshAt).toBe(nextAdminRefresh(now));
    expect(release).toHaveBeenCalledOnce();
    return { getResponseCode: () => 403 };
  });
  expect(scheduledAdminDailyTick(now)).toEqual({
    ok: true,
    checkedAt: now,
    nextRefreshAt: nextAdminRefresh(now),
  });
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(commit).toHaveBeenCalledTimes(2);
  expect(saved.pilot.measuredAt).toBe(now - ADMIN_CACHE_MS);
  expect(saved.failures).toHaveLength(5);
  for (let i = 0; i < 20; i++) scheduledAdminDailyTick(now + i);
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(commit).toHaveBeenCalledTimes(2);
  readOwnerAdmin(owner, now + 7 * ADMIN_CACHE_MS);
  expect(fetcher).toHaveBeenCalledTimes(5);
  fetcher.mockImplementation(() => ({ getResponseCode: () => 403 }));
  scheduledAdminDailyTick(now + ADMIN_CACHE_MS);
  expect(fetcher).toHaveBeenCalledTimes(10);
});
it("an admission failure still consumes the daily attempt before any provider reads", () => {
  commit.mockImplementation(() => {
    throw Error("Write unavailable");
  });
  expect(() => scheduledAdminDailyTick(now)).toThrow("Write unavailable");
  expect(properties.ADMIN_DAILY_ATTEMPT_SLOT).toBe(String(adminClockSlot(now)));
  expect(scheduledAdminDailyTick(now + 1000)).toEqual({
    ok: true,
    skipped: true,
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(commit).toHaveBeenCalledOnce();
});
it("the daily clock skips an already claimed report, stopped mode, and expired pilot", () => {
  saved = fixture(now);
  expect(scheduledAdminDailyTick(now)).toEqual({ ok: true, skipped: true });
  expect(fetcher).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  properties.MARKET_OPERATING_MODE = "paused";
  expect(scheduledAdminDailyTick(now + ADMIN_CACHE_MS)).toEqual({
    ok: true,
    paused: true,
  });
  properties.MARKET_OPERATING_MODE = "paid-budget";
  expect(scheduledAdminDailyTick(Date.parse("2026-11-01T12:10:15Z"))).toEqual({
    ok: true,
    paused: true,
  });
});
it("aggregates real creation dates without retaining identities and rejects incomplete inventories", () => {
  const r = aggregateUsers(
    [
      {
        createdAt: String(now - 1000),
        email: "private@example.test",
        localId: "secret",
      },
      { createdAt: String(now - 86400000), disabled: true },
    ],
    now,
  );
  expect(r.total).toBe(2);
  expect(r.days).toHaveLength(30);
  expect(r.days.at(-1)?.count).toBe(1);
  expect(JSON.stringify(r)).not.toMatch(/secret|private@example/);
  expect(() => aggregateUsers([{}], now)).toThrow();
  const report = measureAdmin(
    (url) =>
      url.includes("batchGet")
        ? { users: [], nextPageToken: "more" }
        : (() => {
            throw Error("No source");
          })(),
    null,
    now,
  );
  expect(report.users).toBeNull();
  expect(report.billing.actualUsd).toBeNull();
});
it("daily status describes measurement time while expiration, stops and overdue reports remain visible", () => {
  const r = fixture();
  expect(pilotStatus(r, now + 12 * 3600000)).toBe("Active paid pilot");
  expect(pilotStatus(r, now + 26 * 3600000)).toBe("Verification due");
  expect(pilotStatus(r, r.pilot!.expiresAt)).toBe("Expired");
  r.scheduler!.schedule = "*/15 * * * *";
  r.pilot!.lastPriceCheck = now - 20 * 60000;
  expect(pilotStatus(r, now)).toBe("Active paid pilot");
  r.pilot!.lastPriceCheck--;
  expect(pilotStatus(r, now)).toBe("Needs attention");
  r.scheduler!.schedule = "0 * * * *";
  r.pilot!.lastPriceCheck = now - 76 * 60000;
  expect(pilotStatus(r, now)).toBe("Needs attention");
  r.pilot!.lastPriceCheck = now;
  r.scheduler!.expiresAt++;
  expect(pilotStatus(r, now)).toBe("Needs attention");
  r.scheduler!.state = "PAUSED";
  expect(pilotStatus(r, now)).toBe("Paused");
  r.pilot!.stoppedAt = now;
  expect(pilotStatus(r, now)).toBe("Stopped");
});
it("source failures preserve original measurement timestamps and never turn unknown charges into zero", () => {
  const old = fixture(),
    get = vi.fn(() => {
      throw Error("Permission denied");
    });
  const next = measureAdmin(get, old, now + ADMIN_CACHE_MS);
  expect(next.pilot).toEqual(old.pilot);
  expect(next.scheduler).toEqual(old.scheduler);
  expect(next.billing.actualUsd).toBeNull();
  expect(next.failures).toHaveLength(5);
  expect(get).toHaveBeenCalledTimes(5);
  expect(next.nextRefreshAt).toBe(nextAdminRefresh(now + ADMIN_CACHE_MS));
});
it("publishes new operational measurements on the clock and serves the same snapshot without provider reads", () => {
  const old = saved;
  fetcher.mockImplementation((url: string) => {
    let value: any;
    if (url.endsWith("/paid-budget-october"))
      value = {
        fields: {
          value: {
            stringValue: JSON.stringify({
              version: 1,
              id: "paid-202610",
              startsAt: old.pilot.startsAt,
              expiresAt: old.pilot.expiresAt,
              limitUsd: 5,
              stopUsd: 4.5,
              reservedUsd: 1.2,
            }),
          },
        },
      };
    else if (url.endsWith("/control"))
      value = {
        fields: {
          value: {
            stringValue: JSON.stringify({
              jobs: { bazaar: { lastCheckedAt: now - 1000, error: null } },
            }),
          },
        },
      };
    else if (url.endsWith("/backend/worker"))
      value = {
        fields: {
          json: {
            stringValue: JSON.stringify({
              monitor: { enabled: true },
              paidLastSuccess: now - 1000,
              paidLastAttempt: now - 2000,
              paidError: null,
            }),
          },
        },
      };
    else return { getResponseCode: () => 403 };
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify(value),
    };
  });
  scheduledAdminDailyTick(now);
  expect(saved.pilot.reservedUsd).toBe(1.2);
  expect(saved.pilot.measuredAt).toBe(now);
  expect(saved.email.lastSuccess).toBe(now - 1000);
  expect(saved.scheduler).toEqual(old.scheduler);
  expect(saved.failures).toHaveLength(3);
  const count = fetcher.mock.calls.length;
  for (let i = 0; i < 100; i++) expect(readOwnerAdmin(owner)).toEqual(saved);
  expect(fetcher).toHaveBeenCalledTimes(count);
});
