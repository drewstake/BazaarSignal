import { afterEach, expect, it, vi } from "vitest";
const { daily } = vi.hoisted(() => ({
  daily: vi.fn(() => ({ ok: true, checkedAt: 123 })),
}));
vi.mock("../apps-script/admin-report", () => ({
  scheduledAdminDailyTick: daily,
  readOwnerAdmin: vi.fn(),
  readAdminHistory: vi.fn(),
}));
import { scheduledPaidMinuteTick } from "../apps-script/backend";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
it("the installed minute clock dispatches the daily report without invoking the email worker", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T12:10:15Z"));
  vi.stubGlobal("PropertiesService", {
    getScriptProperties: () => ({
      getProperties: () => ({
        FIREBASE_API_KEY: "key",
        TOKEN_KEY: "a".repeat(64),
        APP_URL: "https://bazaarsignal.web.app",
      }),
    }),
  });
  vi.stubGlobal("Session", {
    getEffectiveUser: () => ({ getEmail: () => "bazaarsignal@gmail.com" }),
  });
  expect(scheduledPaidMinuteTick()).toEqual({ ok: true, checkedAt: 123 });
  expect(daily).toHaveBeenCalledOnce();
  vi.setSystemTime(new Date("2026-10-14T12:11:15Z"));
  expect(scheduledPaidMinuteTick()).toEqual({ ok: true, skipped: true });
  expect(daily).toHaveBeenCalledOnce();
});
