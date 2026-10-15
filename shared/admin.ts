import { USAGE_OWNER_EMAIL } from "./published-usage";
import type { PaidBilling } from './paid-spending';

export const ADMIN_CACHE_MS = 24 * 60 * 60_000;
export const ADMIN_CLOCK_OFFSET = (12 * 60 + 10) * 60_000;
export const adminClockSlot = (now: number) =>
  Math.floor((now - ADMIN_CLOCK_OFFSET) / ADMIN_CACHE_MS);
export const nextAdminRefresh = (now: number) =>
  (adminClockSlot(now) + 1) * ADMIN_CACHE_MS + ADMIN_CLOCK_OFFSET;
export const adminClockWindow = (now: number) =>
  now % ADMIN_CACHE_MS >= ADMIN_CLOCK_OFFSET &&
  now % ADMIN_CACHE_MS < ADMIN_CLOCK_OFFSET + 60_000;
export const ADMIN_REPORT_PATH = "reports/admin";
export interface AdminReport {
  version: 1;
  checkedAt: number;
  nextRefreshAt: number;
  schedule?: "daily";
  pilot: {
    measuredAt: number;
    startsAt: number;
    expiresAt: number;
    budgetUsd: number;
    stopUsd: number;
    reservedUsd: number;
    stoppedAt: number | null;
    reason: string | null;
    lastPriceCheck: number | null;
    priceError: string | null;
    billing?: PaidBilling;
  } | null;
  scheduler: {
    measuredAt: number;
    state: string;
    schedule: string;
    expiresAt: number | null;
  } | null;
  email: {
    measuredAt: number;
    lastSuccess: number | null;
    lastAttempt: number | null;
    enabled: boolean;
    error: string | null;
  } | null;
  users: {
    measuredAt: number;
    total: number;
    disabled: number;
    days: { day: string; count: number }[];
  } | null;
  traffic: {
    measuredAt: number;
    from: number;
    through: number;
    bytes: number;
  } | null;
  billing: {
    actualUsd: number | null;
    measuredAt: number | null;
    reason: string;
    sourceUrl: string;
  };
  failures: string[];
}
export function authorizeAdmin(identity: { uid: string; email: string }) {
  // Called only after verifyIdentity has validated signature, project, verified
  // Google provider, expiration and revocation with accounts:lookup.
  if (!identity.uid || identity.email !== USAGE_OWNER_EMAIL)
    throw new Error("Admin: owner access required.");
}
export function emptyAdmin(now: number): AdminReport {
  return {
    version: 1,
    checkedAt: now,
    nextRefreshAt: nextAdminRefresh(now),
    schedule: "daily",
    pilot: null,
    scheduler: null,
    email: null,
    users: null,
    traffic: null,
    billing: {
      actualUsd: null,
      measuredAt: null,
      reason:
        "No readable Cloud Billing cost export is configured for this dashboard. Usage counters and application reservations cannot establish Google charges.",
      sourceUrl: "https://console.cloud.google.com/billing",
    },
    failures: [],
  };
}
export function aggregateUsers(
  users: any[],
  now: number,
): NonNullable<AdminReport["users"]> {
  const today = new Date(now).toISOString().slice(0, 10);
  const dayStart = Date.parse(today + "T00:00:00Z");
  const days = Array.from({ length: 30 }, (_, i) => ({
    day: new Date(dayStart - (29 - i) * 86400000).toISOString().slice(0, 10),
    count: 0,
  }));
  for (const user of users) {
    const created = Number(user.createdAt);
    if (!Number.isFinite(created) || created <= 0 || created > now)
      throw new Error("Incomplete account creation dates");
    const bucket = days.find(
      (d) => d.day === new Date(created).toISOString().slice(0, 10),
    );
    if (bucket) bucket.count++;
  }
  return {
    measuredAt: now,
    total: users.length,
    disabled: users.filter((u) => u.disabled === true).length,
    days,
  };
}
export function pilotStatus(report: AdminReport, now: number) {
  const p = report.pilot,
    s = report.scheduler;
  if (!p) return "Unavailable";
  if (now >= p.expiresAt) return "Expired";
  if (p.stoppedAt || (p.billing?.latest ? p.billing.latest.actualUsd >= p.stopUsd : p.reservedUsd >= p.stopUsd)) return "Stopped";
  if (
    !s ||
    now - p.measuredAt >= ADMIN_CACHE_MS + 60 * 60_000 ||
    (now - s.measuredAt >= ADMIN_CACHE_MS &&
      (!p.lastPriceCheck || p.lastPriceCheck <= s.measuredAt))
  )
    return "Verification due";
  if (s.state !== "ENABLED") return "Paused";
  if (
    s.schedule !== "0 * * * *" ||
    s.expiresAt !== p.expiresAt ||
    p.priceError ||
    !p.lastPriceCheck ||
    p.measuredAt - p.lastPriceCheck > 75 * 60000
  )
    return "Needs attention";
  return "Active paid pilot";
}
export function parseAdminReport(value: unknown): AdminReport {
  const r = value as AdminReport;
  if (
    !r ||
    r.version !== 1 ||
    !Number.isFinite(r.checkedAt) ||
    !Number.isFinite(r.nextRefreshAt) ||
    r.nextRefreshAt <= r.checkedAt ||
    !r.billing ||
    !Array.isArray(r.failures)
  )
    throw new Error("Invalid Admin report.");
  if (
    r.pilot &&
    (![
      r.pilot.measuredAt,
      r.pilot.startsAt,
      r.pilot.expiresAt,
      r.pilot.budgetUsd,
      r.pilot.stopUsd,
      r.pilot.reservedUsd,
    ].every(Number.isFinite) ||
      r.pilot.reservedUsd < 0 ||
      r.pilot.expiresAt <= r.pilot.startsAt ||
      r.pilot.stopUsd > r.pilot.budgetUsd)
  )
    throw new Error("Invalid pilot report.");
  return r;
}
