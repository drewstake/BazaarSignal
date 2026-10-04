import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { auth } from "../data";
import { readPublishedUsage } from "./usage-report";
import { localWorkspace } from "../local-workspace";
import type {
  UsageDashboard as Dashboard,
  UsageRow,
} from "../../shared/usage-dashboard";
import { verifiedUsageSnapshot } from "../../shared/usage-dashboard";
import { APP_BUDGET_PAUSE_DESCRIPTION } from "../../shared/app-budget-policy";
import {
  currentStatus,
  imageStorageEstimate,
  kindOf,
  needsAttention,
  projectionStatus,
  sortResources,
} from "../../shared/usage-presentation";
import "./usage-dashboard.css";
import { ownerCandidate } from "./usage-access";
import { ChevronDown, ChevronRight } from "lucide-react";

function amount(value: number | null, unit: string) {
  if (value === null || !Number.isFinite(value)) return "Unknown";
  if (unit === "bytes") {
    const scale =
      value >= 1024 ** 3
        ? 1024 ** 3
        : value >= 1024 ** 2
          ? 1024 ** 2
          : value >= 1024
            ? 1024
            : 1;
    return `${(value / scale).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${scale === 1024 ** 3 ? "GiB" : scale === 1024 ** 2 ? "MiB" : scale === 1024 ? "KiB" : "bytes"}`;
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}
const date = (value: number | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "Unknown";
const tone = (status: string) =>
  status === "Over allowance"
    ? "over"
    : status === "Getting close"
      ? "close"
      : status === "Within allowance"
        ? "within"
        : "unknown";
const windowLabel = (row: UsageRow) =>
  row.id === "scheduler"
    ? "Configured jobs"
    : {
        daily: "Today",
        monthly: "This month",
        capacity: "Stored capacity",
        rolling: "Current 24-hour quota",
      }[kindOf(row)];
const coverageLabels = {
  permission: "Missing permission",
  delay: "No reported samples",
  setup: "Missing setup",
  "not-exposed": "No Google quota API",
  incomplete: "Incomplete coverage",
  error: "Source unavailable",
};
const expiredRow = (row: UsageRow, now: number) =>
  ["daily", "monthly"].includes(kindOf(row)) && now >= row.periodEnd;

function metricLine(row: UsageRow, expired: boolean) {
  const context = row.id.startsWith("bazaarsignal-510305-")
    ? " (Market service)"
    : row.id.startsWith("bazaarsignal-")
      ? " (Website & alerts)"
      : "";
  const measured = row.state === "measured" ? row.measured : null,
    total = row.allowanceComparable === false ? null : row.allowance;
  const value = (n: number | null) =>
    n === null || !Number.isFinite(n)
      ? "Unknown"
      : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  // Scale each byte value independently so small nonzero usage never rounds to 0 GiB.
  const ratio = (used: number | null, limit: number | null) =>
    row.unit === "bytes"
      ? `${amount(used, row.unit)} / ${amount(limit, row.unit)}`
      : `${value(used)} / ${value(limit)} ${row.unit}`;
  const reserved =
    row.budget !== null
      ? `; app reserved: ${ratio(row.reservation, row.budget)}`
      : "";
  return `${row.resource}${context}: ${ratio(measured, total)} (measured / Google allowance)${reserved}${expired ? " [report out of date]" : ""}`;
}

function ResourceTable({
  rows,
  stale,
  now,
  label,
}: {
  rows: UsageRow[];
  stale: boolean;
  now: number;
  label: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div
      className="holdings-table-scroll usage-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      <table className="holdings-table usage-table">
        <caption>
          Select a resource for details · Reserved budget is separate from
          measured usage
        </caption>
        <thead>
          <tr>
            <th scope="col">Resource</th>
            <th scope="col">Period</th>
            <th scope="col">Measured</th>
            <th scope="col">Google allowance</th>
            <th scope="col" aria-sort="descending">
              Used % <ChevronDown size={12} aria-hidden="true" />
            </th>
            <th scope="col">Reserved / app budget</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        {rows.map((row) => {
          const expired = stale || expiredRow(row, now),
            status = currentStatus(row, expired);
          const measured = row.state === "measured" && row.measured !== null;
          const context = row.id.startsWith("bazaarsignal-510305-")
            ? "Market service"
            : row.id.startsWith("bazaarsignal-")
              ? "Website & alerts"
              : null;
          const name = `${row.resource}${context ? ` · ${context}` : ""}`;
          const percent =
            measured && row.allowance && currentStatus(row) !== "Unknown"
              ? (row.measured! / row.allowance) * 100
              : null;
          const projection = projectionStatus(row),
            forecast =
              !expired &&
              ["Over allowance", "Getting close"].includes(projection);
          const open = expanded === row.id;
          return (
            <tbody key={row.id} aria-label={name}>
              <tr className={`holding-row ${open ? "expanded" : ""}`}>
                <th scope="row">
                  <button
                    className="holding-toggle"
                    aria-label={`${open ? "Hide" : "Show"} details for ${name}`}
                    aria-expanded={open}
                    aria-controls={`usage-details-${row.id}`}
                    onClick={() => setExpanded(open ? null : row.id)}
                  >
                    <ChevronRight size={14} />
                    <span className="usage-resource-name" title={name}>
                      {row.resource}
                      {context && (
                        <small>
                          {context === "Market service" ? "Market" : "Website"}
                        </small>
                      )}
                    </span>
                  </button>
                </th>
                <td title={expired ? "Report out of date" : row.periodLabel}>
                  {windowLabel(row)}
                  {expired && <span className="stale-tag">stale</span>}
                </td>
                <td>{measured ? amount(row.measured, row.unit) : "Unknown"}</td>
                <td title={row.allowanceLabel}>
                  {row.allowanceComparable === false
                    ? "Not comparable"
                    : row.allowance === null
                      ? "Not specified"
                      : amount(row.allowance, row.unit)}
                </td>
                <td
                  title={
                    percent === null
                      ? "No comparable measurement available"
                      : expired
                        ? `Last reported usage · ${date(row.measuredAt)}`
                        : "Measured usage as a percentage of the Google allowance"
                  }
                >
                  <div className="usage-used">
                    {percent !== null ? (
                      <div
                        className={`usage-meter ${expired ? "stale" : tone(status)}`}
                        role="progressbar"
                        aria-label={`${row.resource} measured allowance use`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.min(100, percent)}
                        aria-valuetext={`${expired ? "Last reported: " : ""}${percent.toFixed(1)}% of allowance`}
                      >
                        <span style={{ width: `${Math.min(100, percent)}%` }} />
                      </div>
                    ) : (
                      <div className="usage-meter unknown" aria-hidden="true" />
                    )}
                    <span className="usage-used-value">
                      {percent === null ? "—" : `${percent.toFixed(1)}%`}
                    </span>
                  </div>
                </td>
                <td>
                  {row.budget === null
                    ? "—"
                    : `${amount(row.reservation, row.unit)} / ${amount(row.budget, row.unit)}`}
                </td>
                <td>
                  <span className={`usage-badge ${tone(status)}`}>
                    {status}
                  </span>
                  {forecast && (
                    <span
                      className="usage-forecast"
                      title={`Estimated ${kindOf(row) === "daily" ? "day-end" : "month-end"}: ${amount(row.projected, row.unit)} · ${projection}`}
                    >
                      Forecast high
                    </span>
                  )}
                </td>
              </tr>
              <tr className="holding-detail-row" hidden={!open}>
                <td colSpan={7}>
                  <div
                    className="holding-expanded"
                    id={`usage-details-${row.id}`}
                  >
                    <ResourceCard row={row} stale={stale} now={now} />
                  </div>
                </td>
              </tr>
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

function ResourceCard({
  row,
  stale,
  now,
}: {
  row: UsageRow;
  stale: boolean;
  now: number;
}) {
  const expired = stale || expiredRow(row, now);
  const status = currentStatus(row, expired),
    attention = needsAttention(row, expired),
    kind = kindOf(row);
  const estimate = imageStorageEstimate(row),
    projection = projectionStatus(row);
  const measured = row.state === "measured" && row.measured !== null;
  const allowance =
    row.allowance === null
      ? row.allowanceLabel
      : amount(row.allowance, row.unit);
  const context = row.id.startsWith("bazaarsignal-510305-")
    ? "Market service"
    : row.id.startsWith("bazaarsignal-")
      ? "Website & alerts"
      : null;
  return (
    <article
      className={`usage-card ${attention ? "attention" : ""} ${tone(status)}`}
      aria-label={`${row.resource}${context ? ` · ${context}` : ""}`}
    >
      <div className="usage-card-heading">
        <div>
          <h4>{row.resource}</h4>
          {context && <small>{context}</small>}
        </div>
        <span className={`usage-badge ${tone(status)}`}>{status}</span>
      </div>
      <p className="usage-period">
        {windowLabel(row)}
        {expired ? " · report out of date" : ""}
      </p>
      <p className="usage-value-label">Measured usage / Google allowance</p>
      <p className="usage-amount">
        <strong>{measured ? amount(row.measured, row.unit) : "Unknown"}</strong>
        <span>{row.allowance !== null ? `of ${allowance}` : allowance}</span>
      </p>
      <p className="usage-reset">
        {row.id === "scheduler"
          ? "No counter reset · paused jobs still count"
          : kind === "capacity"
            ? "No reset · changes as resources are removed"
            : kind === "rolling"
              ? "Reset time not exposed by Google"
              : `Resets ${date(row.resetAt ?? row.periodEnd)}`}
      </p>
      {row.budget !== null && (
        <div className="usage-budget">
          <b>App safety budget · reserved</b>
          <p>
            {amount(row.reservation, row.unit)}{" "}
            <span>of {amount(row.budget, row.unit)}</span>
          </p>
          <small>
            Set aside as a precaution; not measured usage.{" "}
            {row.reservationPeriod}.
          </small>
        </div>
      )}
      {row.id === "builds" && (
        <p className="usage-reset">
          Deployment regions only · eligible default-pool allowance
        </p>
      )}
      {row.allowanceComparable === false && (
        <p className="usage-coverage-reason">
          Includes machine types outside this allowance. Usage is measured;
          allowance eligibility is unknown.
        </p>
      )}
      {attention && (
        <p className="usage-action">
          {row.id === "images"
            ? "Review retained images at your next cleanup review. Preserve the active image and any rollback images you need."
            : status === "Over allowance"
              ? `Review ${kind === "daily" ? "today’s" : kind === "capacity" ? "stored" : "this month’s"} usage before adding more work.`
              : projection === "Over allowance" ||
                  projection === "Getting close"
                ? `The ${kind === "daily" ? "day-end" : "month-end"} estimate is approaching or above the allowance. Check the trend before increasing usage.`
                : "Usage has reached 80% of the allowance. Review before adding more work."}
        </p>
      )}
      {estimate !== null && estimate > 0 && (
        <p className="usage-estimate">
          <b>Storage-only estimate: ≈ ${estimate.toFixed(3)} USD/month</b>
          <span>
            If this capacity stays unchanged for a typical month, with the full
            0.5 GiB allowance available. Not an actual charge; excludes
            transfer, scans and other projects.
          </span>
        </p>
      )}
      {attention && row.projected !== null && !expired && (
        <p className="usage-projection">
          <b>Estimated {kind === "daily" ? "day-end" : "month-end"}:</b>{" "}
          {amount(row.projected, row.unit)}
          <small>
            Projected: {projection}. Current average rate; separate from
            measured usage above.
          </small>
        </p>
      )}
      {!measured && (
        <p className="usage-coverage-reason">
          {row.coverageDetail ??
            "No reliable measurement is available. Missing data does not mean zero usage."}
        </p>
      )}
      <div className="usage-details">
        <h4>
          Source{!attention && row.projected !== null ? " & projection" : ""}
        </h4>
        <p>{row.purpose}</p>
        {!attention && row.projected !== null && (
          <p>
            <b>Estimated {kind === "daily" ? "day-end" : "month-end"}:</b>{" "}
            {amount(row.projected, row.unit)}. Extrapolated from the average
            reported rate; not measured usage.
          </p>
        )}
        <dl>
          <dt>Google allowance</dt>
          <dd>{row.allowanceLabel}</dd>
          <dt>Scope</dt>
          <dd>{row.scope}</dd>
          <dt>Project</dt>
          <dd>{row.project}</dd>
          <dt>Measured at</dt>
          <dd>{date(row.measuredAt)}</dd>
          <dt>Source</dt>
          <dd>{row.source}</dd>
        </dl>
        <p>{row.note}</p>
        <a href={row.sourceUrl} target="_blank" rel="noreferrer">
          Allowance documentation
        </a>
      </div>
    </article>
  );
}

export default function UsageDashboard({ user }: { user: User | null }) {
  const [data, setData] = useState<Dashboard | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refreshAt, setRefreshAt] = useState(0),
    [now, setNow] = useState(Date.now());
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    if (!copyStatus) return;
    const timer = setTimeout(() => setCopyStatus(""), 3000);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  const allowed = ownerCandidate(user);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setData(null);
    setError("");
    setRefreshAt(0);
    setCopyStatus("");
    if (!allowed || !user) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [user?.uid, allowed]);
  async function load(signal?: AbortSignal) {
    if (!user || !allowed) return;
    setBusy(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000);
      let result: Dashboard;
      if (!localWorkspace) {
        result = await readPublishedUsage({
          token,
          signal: requestSignal,
        });
      } else {
        const r = await fetch("/api/owner/usage", {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: requestSignal,
        });
        if (!r.ok)
          throw new Error(
            r.status === 401
              ? "Your session expired. Sign in again."
              : r.status === 403
                ? "Access denied."
                : r.status === 429
                  ? "Please wait before refreshing."
                  : "Cloud measurements are unavailable. Check the local reporting credentials and try after the 30-minute measurement interval. Collection remains paused.",
          );
        result = (await r.json()) as Dashboard;
      }
      if (!signal?.aborted && auth?.currentUser === user)
        setData(verifiedUsageSnapshot(result));
    } catch (e) {
      if (!signal?.aborted && auth?.currentUser === user) {
        setData(null);
        setError(
          e instanceof TypeError
            ? "Cannot reach the usage reporting service. Collection remains paused; no usage measurements were inferred."
            : e instanceof Error
              ? e.message
              : "Usage unavailable.",
        );
      }
    } finally {
      if (!signal?.aborted && auth?.currentUser === user) {
        setBusy(false);
        setRefreshAt(Date.now() + 60_000);
      }
    }
  }
  async function copyMetrics() {
    if (!data || busy) return;
    try {
      await navigator.clipboard.writeText(
        data.rows
          .map((row) =>
            metricLine(
              row,
              !!data.stale ||
                now >= data.nextMeasurementAt ||
                expiredRow(row, now),
            ),
          )
          .join("\n"),
      );
      setCopyStatus("Copied!");
    } catch {
      setCopyStatus("Could not copy. Try again.");
    }
  }
  if (!allowed)
    return (
      <section className="usage-page">
        <h2>Owner access required</h2>
        <p>Sign in with the authorized Google account to open this page.</p>
      </section>
    );
  const stale = !!data && (!!data.stale || now >= data.nextMeasurementAt);
  const rows = sortResources(data?.rows ?? []);
  const attention = rows.filter((r) =>
    needsAttention(r, stale || expiredRow(r, now)),
  );
  const missing = rows.filter(
    (r) => r.state !== "measured" || r.measured === null,
  );
  const groups = Object.entries(coverageLabels)
    .map(([key, label]) => ({
      label,
      rows: missing.filter(
        (r) =>
          (r.coverage ?? (r.state === "not-reported" ? "delay" : "setup")) ===
          key,
      ),
    }))
    .filter((g) => g.rows.length);
  return (
    <section className="usage-page" aria-labelledby="usage-title">
      <div className="usage-heading">
        <div>
          <h1 id="usage-title">Usage &amp; Costs</h1>
          <p>Usage, allowances, and collection status.</p>
        </div>
        <div className="usage-heading-actions">
          <button
            className="primary"
            disabled={busy || now < refreshAt}
            onClick={() => void load()}
          >
            {busy
              ? "Loading…"
              : now < refreshAt
                ? `Refresh in ${Math.ceil((refreshAt - now) / 1000)}s`
                : "Refresh"}
          </button>
          <button
            className="button"
            disabled={!data || busy}
            onClick={() => void copyMetrics()}
          >
            Copy metrics
          </button>
          <span className="usage-copy-status" role="status">
            {copyStatus}
          </span>
        </div>
      </div>
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      {data?.publishedReport ? (
        <details className="notice usage-local-report">
          <summary>
            Published usage report · Measured {date(data.generatedAt)}
          </summary>
          <p>
            Refresh checks for a newer published report. It does not start cloud
            measurements or price collection. Reports are published separately
            while collection is paused.
          </p>
          <p>
            Report measured: {date(data.generatedAt)}. Freshness expires:{" "}
            {date(data.nextMeasurementAt)}. Individual resources retain their
            own measurement times.
          </p>
        </details>
      ) : (
        data?.localReport && (
          <details className="notice usage-local-report">
            <summary>
              Read-only cloud report · Refresh checks for new measurements
            </summary>
            <p>{data.localReport}</p>
            <p>
              Report checked: {date(data.generatedAt)}. Next cloud refresh
              allowed: {date(data.localNextAttemptAt ?? data.nextMeasurementAt)}
              .
            </p>
          </details>
        )
      )}
      {!data && busy && (
        <p role="status">
          Verifying owner access and loading cached measurements…
        </p>
      )}
      {data && (
        <>
          <div className="usage-summary">
            <article
              className={attention.length || stale ? "usage-warning" : ""}
            >
              <span>Allowance overview</span>
              <strong>
                {stale
                  ? "Report out of date"
                  : attention.length
                    ? `${attention.length} ${attention.length === 1 ? "resource needs" : "resources need"} attention`
                    : "No reported allowance warnings"}
              </strong>
              <p>
                {stale
                  ? data.publishedReport
                    ? "A newer measurement report is needed. Refresh checks whether one has been published."
                    : "Refresh the cached report before relying on its statuses."
                  : `${data.rows.filter((r) => r.state === "measured").length} of ${data.rows.length} resources measured. Statuses apply to the reported scope.`}
              </p>
            </article>
            <article
              className={
                !stale && data.collection.state === "Active"
                  ? ""
                  : "usage-warning"
              }
            >
              <span>Market collection</span>
              <strong>
                {stale ? "Current state unknown" : data.collection.state}
              </strong>
              <p>
                Highest budget reserved:{" "}
                <b>
                  {data.collection.pressure === null
                    ? "Unknown"
                    : `${(100 * data.collection.pressure).toFixed(1)}%`}
                </b>
                {stale ? " · stale report" : ""}
              </p>
              <details>
                <summary>Collection details</summary>
                {stale && (
                  <p>
                    Last reported: <b>{data.collection.state}</b> at{" "}
                    {date(data.collection.measuredAt)}.
                  </p>
                )}
                {!stale && data.collection.state === "Waiting for budget" && (
                  <p>
                    Next eligible collection:{" "}
                    <b>{date(data.collection.nextCollectionAt)}</b>.{" "}
                    {data.collection.reason}
                  </p>
                )}
                {data.collection.hourlyTrialEndsAt ? (
                  <p>
                    {stale ? "Reported hourly test end" : "Hourly test ends"}{" "}
                    <b>{date(data.collection.hourlyTrialEndsAt)}</b>.
                  </p>
                ) : null}
                <p>
                  {localWorkspace ? "Prepared rule: " : ""}
                  {APP_BUDGET_PAUSE_DESCRIPTION}
                </p>
                <p>
                  {stale ? "Reported fixed stop" : "Fixed stop"}:{" "}
                  <b>{date(data.collection.reviewAt)}</b>
                </p>
              </details>
            </article>
            <article className="usage-neutral">
              <span>Actual spending this month</span>
              <strong>Unknown</strong>
              <p>Billing records not connected.</p>
              <details>
                <summary>Billing setup</summary>
                <p>
                  Measured usage and estimates do not establish actual spending.
                  Connect an existing Cloud Billing cost export with read access
                  and bounded query permission. No export was found during
                  inspection.
                </p>
                <p>No billing or paid service is enabled by this dashboard.</p>
                <a
                  href={data.spending.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Billing export documentation
                </a>
                <small>
                  Checked {date(Date.parse(data.spending.checkedAt))}.
                  Available-history spending is also unknown.
                </small>
              </details>
            </article>
          </div>
          <details className="usage-explanation">
            <summary>Measured usage &amp; reserved budget</summary>
            <p>
              Google allowance compares reported usage with Google's published
              allowance. App safety budget tracks amounts set aside as a
              precaution and can slow updates before the Google allowance is
              used. Reserved amounts are not extra usage and should not be added
              to measured usage.
            </p>
          </details>
          {missing.length > 0 && (
            <details className="usage-coverage">
              <summary>
                <b>Coverage: {missing.length} unknown measurements</b>
                <span>
                  {groups
                    .map((g) => `${g.rows.length} ${g.label.toLowerCase()}`)
                    .join(" · ")}
                  . Unknown usage is not confirmed within allowance.
                </span>
              </summary>
              {groups.map((g) => (
                <section key={g.label}>
                  <h3>{g.label}</h3>
                  <ul className="usage-coverage-list">
                    {g.rows.map((row) => (
                      <li key={row.id}>
                        <b>{row.resource}</b> ·{" "}
                        {row.coverageDetail ??
                          "No reliable measurement is available."}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </details>
          )}
          <section aria-labelledby="usage-resources">
            <h3 id="usage-resources">Resources</h3>
            <p className="usage-section-note">
              Reported usage · Estimates and reset times are in resource
              details.
            </p>
            <ResourceTable
              rows={rows}
              stale={stale}
              now={now}
              label="Resource usage"
            />
          </section>
          <details className="usage-operations">
            <summary>Report sources &amp; collection safeguards</summary>
            <p>
              Report saved {date(data.generatedAt)}. Next measurement eligible{" "}
              {date(data.nextMeasurementAt)}. Refreshes reuse the shared
              30-minute cache and never collect market data.
            </p>
            <p>
              {data.collection.reason} Scheduler: {data.collection.scheduler}.
              Last successful source check:{" "}
              {date(data.collection.lastSuccessAt)}. Next due:{" "}
              {date(data.collection.nextCollectionAt)}.
            </p>
            <p>
              Highest individual app budget reserved:{" "}
              {data.collection.pressure === null
                ? "Unknown"
                : `${(100 * data.collection.pressure).toFixed(1)}%`}
              . {APP_BUDGET_PAUSE_DESCRIPTION}{" "}
              {data.collection.hourlyTrialEndsAt
                ? `The temporary hourly test ends ${date(data.collection.hourlyTrialEndsAt)}. `
                : ""}
              {data.collection.cleanup}.
            </p>
            <p>
              Google reporting can be delayed. Projections extend the reported
              average through the period and can vary sharply early in the
              month. Billing-account allowances may also be used by other
              projects; displayed usage cannot certify account-wide headroom.
              Free allowances are not spending caps.
            </p>
            <p>
              If fixed-deadline shutdown removes API access, this reporting
              service also becomes unavailable. Review through authorized Google
              tools; this page cannot resume collection.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
