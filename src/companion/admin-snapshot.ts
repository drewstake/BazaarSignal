import type { User } from "firebase/auth";
import { requestBackend } from "../backend";
import {
  nextAdminRefresh,
  parseAdminReport,
  type AdminReport,
} from "../../shared/admin";
import type { UsageDashboard } from "../../shared/usage-dashboard";

// Private in-memory cache, scoped to the authenticated Firebase User object.
// Reopening Admin shares the same read. No timer, persistent browser storage,
// or caller-driven measurement; the server serves its daily saved report only.
const reports = new WeakMap<
  User,
  { until: number; value: Promise<AdminReport> }
>();
const histories = new WeakMap<User, { until: number; value: Promise<UsageDashboard> }>();
export function loadAdminSnapshot(user: User, now = Date.now()) {
  const saved = reports.get(user);
  if (saved && now < saved.until) return saved.value;
  const value = user
    .getIdToken()
    .then((token) =>
      requestBackend<AdminReport>({ action: "admin-report" }, token),
    )
    .then(parseAdminReport);
  const entry = { until: nextAdminRefresh(now) + 60000, value };
  reports.set(user, entry);
  void value
    .then((report) => {
      // A visit just before the clock finishes must not pin yesterday's report
      // for another full day. This only expires the cache; it never starts a poll.
      entry.until = Math.min(
        entry.until,
        Math.max(now + 60000, report.nextRefreshAt + 60000),
      );
    })
    .catch(() => {});
  void value.catch(() => {
    entry.until = Date.now() + 60000;
  });
  return value;
}
export function loadAdminHistory(user: User, now = Date.now()) {
  const saved = histories.get(user);
  if (saved && now < saved.until) return saved.value;
  const value = user
    .getIdToken()
    .then((token) =>
      requestBackend<UsageDashboard>({ action: "admin-history" }, token),
    );
  const entry = { until: Infinity, value };
  histories.set(user, entry);
  // A transient failure must not poison this user's history for the whole
  // session. Reopening after the cooldown may retry; there is no background I/O.
  void value.catch(() => { entry.until = Date.now() + 60000; });
  return value;
}
