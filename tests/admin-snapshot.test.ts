import { afterEach, expect, it, vi } from "vitest";
import { emptyAdmin, nextAdminRefresh } from "../shared/admin";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/backend", () => ({ requestBackend: request }));
import {
  loadAdminSnapshot,
  loadAdminHistory,
} from "../src/companion/admin-snapshot";
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
it("shares concurrent and repeated page reads until the next clock boundary, never across users", async () => {
  const now = Date.parse("2026-10-14T15:00:00Z"),
    report = emptyAdmin(now);
  const user = { getIdToken: vi.fn(async () => "verified-token") } as any;
  request.mockResolvedValue(report);
  const loads = Array.from({ length: 100 }, () => loadAdminSnapshot(user, now));
  await Promise.all(loads);
  expect(request).toHaveBeenCalledOnce();
  expect(user.getIdToken).toHaveBeenCalledOnce();
  await loadAdminSnapshot(user, nextAdminRefresh(now) + 60000);
  expect(request).toHaveBeenCalledTimes(2);
  await loadAdminSnapshot(
    { getIdToken: async () => "another-token" } as any,
    now,
  );
  expect(request).toHaveBeenCalledTimes(3);
});
it("retains historical reads through repeated opens for the same signed-in user", async () => {
  const user = { getIdToken: async () => "token" } as any;
  request.mockResolvedValue({ rows: [] });
  await Promise.all(Array.from({ length: 30 }, () => loadAdminHistory(user)));
  expect(request).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith({ action: "admin-history" }, "token");
});
it('allows a failed history read to recover after a minute without retry loops or cross-user reuse', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T15:00:00Z'));
  const user = { getIdToken: async () => 'token' } as any;
  request.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ rows: [] });
  await expect(loadAdminHistory(user)).rejects.toThrow('Offline');
  await expect(loadAdminHistory(user)).rejects.toThrow('Offline');
  expect(request).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(60000);
  expect(request).toHaveBeenCalledOnce();
  await expect(loadAdminHistory(user)).resolves.toEqual({ rows: [] });
  expect(request).toHaveBeenCalledTimes(2);
});
