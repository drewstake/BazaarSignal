import { readDoc, jsonWrite, commit } from "./store";
import { readOwnerUsageReport } from "./usage-report";
import {
  adminClockSlot,
  adminClockWindow,
  nextAdminRefresh,
  aggregateUsers,
  authorizeAdmin,
  emptyAdmin,
  parseAdminReport,
  type AdminReport,
} from "../shared/admin";
import { paidPilotActive } from "../shared/paid-pilot";

declare const UrlFetchApp: any,
  ScriptApp: any,
  LockService: any,
  PropertiesService: any;
const main = "projects/bazaarsignal/databases/(default)/documents";
const cloud = "projects/bazaarsignal-510305";
const docUrl = (path: string) =>
  `https://firestore.googleapis.com/v1/${cloud}/databases/(default)/documents/marketCache/${path}`;

/** Bounded synchronous adapter shared by the deployed backend and operator CLI.
 * Each source replaces only its own successful measurement; no timestamp laundering.
 * Maximum nine read requests, one 1,000-account page, no logs or user identifiers saved. */
export function measureAdmin(
  get: (url: string) => any,
  previous: AdminReport | null,
  now = Date.now(),
  mode?: string,
): AdminReport {
  const report = {
    ...(previous ?? emptyAdmin(now)),
    checkedAt: now,
    nextRefreshAt: nextAdminRefresh(now),
    schedule: "daily" as const,
    failures: [] as string[],
  };
  const source = (name: string, work: () => void) => {
    try {
      work();
    } catch {
      report.failures.push(
        `${name}: refresh unavailable; any displayed measurement retains its original time.`,
      );
    }
  };
  source("Paid budget and prices", () => {
    const budget = JSON.parse(
      get(docUrl("paid-budget-october")).fields.value.stringValue,
    );
    const control = JSON.parse(get(docUrl("control")).fields.value.stringValue);
    if (
      budget.version !== 1 ||
      budget.id !== "paid-202610" ||
      budget.limitUsd !== 5 ||
      budget.stopUsd !== 4.5 ||
      ![budget.startsAt, budget.expiresAt, budget.reservedUsd].every(
        Number.isFinite,
      ) ||
      budget.reservedUsd < 1
    )
      throw Error("Invalid paid ledger");
    const job = control.jobs?.bazaar;
    report.pilot = {
      measuredAt: now,
      startsAt: budget.startsAt,
      expiresAt: budget.expiresAt,
      budgetUsd: budget.limitUsd,
      stopUsd: budget.stopUsd,
      reservedUsd: budget.reservedUsd,
      stoppedAt: budget.stoppedAt ?? null,
      reason: budget.reason ?? null,
      lastPriceCheck: job?.lastCheckedAt ?? null,
      priceError: job?.error ?? null,
    };
  });
  source("Scheduler and deployed expiration", () => {
    const scheduler = get(
      `https://cloudscheduler.googleapis.com/v1/${cloud}/locations/us-central1/jobs/firebase-schedule-refreshMarket-us-central1`,
    );
    const ends = ["marketapi", "refreshmarket"].map((name) => {
      const service = get(
        `https://run.googleapis.com/v2/${cloud}/locations/us-central1/services/${name}`,
      );
      const env = Object.fromEntries(
        (service.template?.containers?.[0]?.env ?? []).map((e: any) => [
          e.name,
          e.value,
        ]),
      );
      if (env.MARKET_OPERATING_MODE !== "paid-budget")
        throw Error("Different operating mode");
      return Date.parse(env.MARKET_LIVE_END);
    });
    if (
      !ends.every(Number.isFinite) ||
      ends[0] !== ends[1] ||
      !scheduler.state ||
      !scheduler.schedule
    )
      throw Error("Unverified deployment");
    report.scheduler = {
      measuredAt: now,
      state: scheduler.state,
      schedule: scheduler.schedule,
      expiresAt: ends[0],
    };
  });
  source("Email worker", () => {
    const worker = JSON.parse(
      get(`https://firestore.googleapis.com/v1/${main}/backend/worker`).fields
        .json.stringValue,
    );
    const monitor = worker.monitor;
    const success = worker.paidLastSuccess ?? null;
    report.email = {
      measuredAt: now,
      lastAttempt: (worker.paidLastAttempt ?? monitor.lastAttempt) || null,
      lastSuccess: success,
      enabled: mode ? mode === "paid-budget" : monitor.enabled === true,
      error: worker.paidError ?? null,
    };
  });
  source("Account totals", () => {
    const result = get(
      "https://identitytoolkit.googleapis.com/v1/projects/bazaarsignal/accounts:batchGet?maxResults=1000",
    );
    if (result.nextPageToken || !Array.isArray(result.users))
      throw Error("Account inventory incomplete");
    report.users = aggregateUsers(result.users, now);
  });
  source("Hosting traffic", () => {
    const through = Math.floor(now / 86400000) * 86400000,
      from = through - 30 * 86400000;
    const query = Object.entries({
      filter:
        'metric.type="firebasehosting.googleapis.com/network/sent_bytes_count"',
      "interval.startTime": new Date(from).toISOString(),
      "interval.endTime": new Date(through).toISOString(),
      "aggregation.alignmentPeriod": "86400s",
      "aggregation.perSeriesAligner": "ALIGN_SUM",
      "aggregation.crossSeriesReducer": "REDUCE_SUM",
      pageSize: "100",
    })
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    const result = get(
      `https://monitoring.googleapis.com/v3/projects/bazaarsignal/timeSeries?${query}`,
    );
    const points = (result.timeSeries ?? []).flatMap(
      (s: any) => s.points ?? [],
    );
    if (result.nextPageToken || !points.length)
      throw Error("No response metrics");
    const values = points.map((p: any) =>
      Number(p.value?.int64Value ?? p.value?.doubleValue),
    );
    if (!values.every((v: number) => Number.isFinite(v) && v >= 0))
      throw Error("Invalid response metrics");
    report.traffic = {
      measuredAt: now,
      from,
      through,
      bytes: values.reduce((a: number, b: number) => a + b, 0),
    };
  });
  return parseAdminReport(report);
}

const SNAPSHOT_PROPERTY = "ADMIN_DAILY_SNAPSHOT";
const SLOT_PROPERTY = "ADMIN_DAILY_ATTEMPT_SLOT";
function reportPath() {
  const owner = readDoc("config/access")?.fields?.ownerUid?.stringValue;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner ?? ""))
    throw Error("Admin owner storage is unavailable.");
  return `owners/${owner}/reports/admin`;
}
function rememberSnapshot(report: AdminReport) {
  const text = JSON.stringify(report);
  // Script properties are private to this backend and avoid a Firestore read
  // on every page request. Fail closed rather than falling back to repeated reads.
  if (encodeURIComponent(text).replace(/%[A-F0-9]{2}/g, "x").length > 8000)
    throw Error("Admin saved snapshot exceeds its limit.");
  PropertiesService.getScriptProperties().setProperty(SNAPSHOT_PROPERTY, text);
}
/** Always reads a saved snapshot. Request parameters and expired dates can never
 * dispatch measurements. Identity is checked before the private snapshot cache. */
export function readOwnerAdmin(
  identity: { uid: string; email: string },
  _now = Date.now(),
) {
  authorizeAdmin(identity);
  const properties = PropertiesService.getScriptProperties();
  const cached = properties.getProperty(SNAPSHOT_PROPERTY);
  if (cached) return parseAdminReport(JSON.parse(cached));
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(100))
    throw Error("Admin saved report is being loaded. Try again shortly.");
  try {
    const ready = properties.getProperty(SNAPSHOT_PROPERTY);
    if (ready) return parseAdminReport(JSON.parse(ready));
    // One-time migration of the existing saved report; never a source collection.
    const saved = readDoc(reportPath());
    if (!saved) throw Error("Admin daily report has not been published yet.");
    const previous = parseAdminReport(
      JSON.parse(saved.fields.json.stringValue),
    );
    const report = {
      ...previous,
      schedule: "daily" as const,
      nextRefreshAt: nextAdminRefresh(previous.checkedAt),
    };
    rememberSnapshot(report);
    return report;
  } finally {
    lock.releaseLock();
  }
}

/** Called only by the existing trusted minute trigger, once in the daily window.
 * The persistent attempt slot is claimed before any network work. A failed run
 * keeps its slot; retries and duplicate invocations cannot rescan providers. */
export function scheduledAdminDailyTick(now = Date.now()) {
  if (!adminClockWindow(now)) return { ok: true, skipped: true };
  const properties = PropertiesService.getScriptProperties();
  const mode = properties.getProperty("MARKET_OPERATING_MODE");
  if (!paidPilotActive(mode, now)) return { ok: true, paused: true };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(100)) return { ok: true, skipped: true };
  let previous: AdminReport | null = null,
    version: string | undefined,
    path = "";
  try {
    const slot = String(adminClockSlot(now));
    const last = properties.getProperty(SLOT_PROPERTY);
    if (last !== null && last !== undefined && Number(last) >= Number(slot))
      return { ok: true, skipped: true };
    properties.setProperty(SLOT_PROPERTY, slot);
    path = reportPath();
    const saved = readDoc(path);
    previous = saved
      ? parseAdminReport(JSON.parse(saved.fields.json.stringValue))
      : null;
    if (previous?.schedule === "daily" && now < previous.nextRefreshAt)
      return { ok: true, skipped: true };
    const admitted = {
      ...(previous ?? emptyAdmin(now)),
      checkedAt: now,
      nextRefreshAt: nextAdminRefresh(now),
      schedule: "daily" as const,
      failures: [
        ...(previous?.failures ?? []),
        "The scheduled daily collection has not completed. Previous measurements retain their original times.",
      ],
    };
    commit([jsonWrite(path, admitted, saved?.updateTime ?? null)]);
    rememberSnapshot(admitted);
    version = readDoc(path)?.updateTime;
  } finally {
    lock.releaseLock();
  }
  if (!version) throw Error("Admin refresh admission could not be verified.");
  const token = ScriptApp.getOAuthToken();
  const report = measureAdmin(
    (url) => {
      const r = UrlFetchApp.fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        muteHttpExceptions: true,
        followRedirects: false,
      });
      if (r.getResponseCode() !== 200) throw Error("Admin source unavailable");
      const text = r.getContentText();
      if (text.length > 2 * 1024 * 1024)
        throw Error("Admin response exceeded limit");
      return JSON.parse(text);
    },
    previous,
    now,
    mode,
  );
  commit([jsonWrite(path, report, version)]);
  rememberSnapshot(report);
  return {
    ok: true,
    checkedAt: report.checkedAt,
    nextRefreshAt: report.nextRefreshAt,
  };
}
export function readAdminHistory(identity: { uid: string; email: string }) {
  authorizeAdmin(identity);
  return readOwnerUsageReport(identity);
}
