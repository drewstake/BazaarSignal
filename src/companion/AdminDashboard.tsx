import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { Activity, ArrowUpRight, ShieldCheck, Users } from "lucide-react";
import { auth } from "../data";
import { formatEstDate, formatEstDateTime, formatEstTime } from "../time";
import { loadAdminSnapshot, loadAdminHistory } from "./admin-snapshot";
import {
  ADMIN_CACHE_MS,
  nextAdminRefresh,
  pilotStatus,
  type AdminReport,
} from "../../shared/admin";
import type { UsageDashboard } from "../../shared/usage-dashboard";
import "./admin-dashboard.css";
import { useVisibleNow } from './use-visible-now';

const date = (at: number | null | undefined) =>
  at ? formatEstDateTime(at) : "Not available";
// Daily counts are already aggregated. Show their actual boundaries in EST
// without shifting counts into different days or collecting any new data.
const reportingDayStart = (day: string) => Date.parse(`${day}T00:00:00Z`);
const reportingPeriod = (day: string) => {
  const start = reportingDayStart(day);
  return `${formatEstDateTime(start)} – ${formatEstDateTime(start + ADMIN_CACHE_MS)}`;
};
const money = (n: number | null | undefined) =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 3,
      }).format(n);
const count = (n: number | null | undefined) =>
  n == null ? "Unavailable" : n.toLocaleString();

export default function AdminDashboard({ user }: { user: User }) {
  const [data, setData] = useState<AdminReport | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const now = useVisibleNow(60000);
  const [history, setHistory] = useState<UsageDashboard | null>(null),
    [historyError, setHistoryError] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const active = (signal?: AbortSignal) =>
    !signal?.aborted && auth?.currentUser === user;
  async function readSnapshot() {
    if (busy) return;
    const signal = controller.current?.signal;
    setBusy(true);
    setError("");
    try {
      const result = await loadAdminSnapshot(user);
      if (active(signal)) setData(result);
    } catch (e) {
      if (active(signal)) setError((e as Error).message);
    } finally {
      if (active(signal)) {
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    controller.current = new AbortController();
    void readSnapshot();
    return () => {
      controller.current?.abort();
    };
  }, [user]);
  async function readHistory() {
    if (history || historyBusy) return;
    setHistoryBusy(true);
    setHistoryError("");
    const signal = controller.current?.signal;
    try {
      const result = await loadAdminHistory(user);
      if (active(signal)) setHistory(result);
    } catch (e) {
      if (active(signal)) setHistoryError((e as Error).message);
    } finally {
      if (active(signal)) setHistoryBusy(false);
    }
  }
  const p = data?.pilot,
    s = data?.scheduler,
    u = data?.users,
    t = data?.traffic;
  const status = data ? pilotStatus(data, now) : "Checking access";
  const actualSpend = p?.billing?.latest;
  const pauseAmount = actualSpend?.actualUsd ?? p?.reservedUsd;
  const measured = (at: number | null | undefined) => (
    <small className="admin-measured">
      Measured {date(at)}
      {at && now - at >= ADMIN_CACHE_MS ? " · Update due" : ""}
    </small>
  );
  const maxSignups = Math.max(1, ...(u?.days.map((d) => d.count) ?? []));
  const updateTime = formatEstTime(nextAdminRefresh(now));
  return (
    <section className="admin-page" aria-labelledby="admin-title">
      <div className="admin-heading">
        <div>
          <div className="admin-eyebrow">
            <ShieldCheck size={14} /> OWNER WORKSPACE
          </div>
          <h1 id="admin-title">Admin</h1>
          <p>Operations, budget, and audience.</p>
        </div>
        <span className="admin-measured">Updates daily · {updateTime}</span>
      </div>
      {error && (
        <p role="alert" className="error">
          {error} {data ? "Previous measurements remain below." : "Reopen Admin after one minute to retry."}
        </p>
      )}
      {!data && busy && (
        <p role="status">
          Verifying owner access and reading the saved daily report…
        </p>
      )}
      {data && (
        <>
          <p className="admin-measured">
            Daily snapshot · Report checked {date(data.checkedAt)} · Next
            scheduled update {date(data.nextRefreshAt)}. Opening this page does
            not collect new measurements.
          </p>
          <section className="admin-status" aria-labelledby="pilot-title">
            <div className="admin-status-title">
              <Activity size={22} />
              <div>
                <span id="pilot-title">
                  October paid pilot · Status at measurement
                </span>
                <strong
                  className={
                    status === "Active paid pilot"
                      ? "admin-positive"
                      : "admin-attention"
                  }
                >
                  {status}
                </strong>
              </div>
              <span className="admin-pill">Hourly checks</span>
            </div>
            <div className="admin-status-grid">
              <div>
                <span>Latest successful price check</span>
                <b>{date(p?.lastPriceCheck)}</b>
                <small>Collector completion, not a live quote</small>
              </div>
              <div>
                <span>Latest successful email check</span>
                <b>{date(data.email?.lastSuccess)}</b>
                <small>
                  {data.email?.error ??
                    (data.email?.lastSuccess
                      ? "Worker check; does not imply an email was sent"
                      : `Last attempt: ${date(data.email?.lastAttempt)}. Successful check not recorded.`)}
                </small>
              </div>
              <div>
                <span>Verified pilot expiration</span>
                <b>
                  {p && s?.expiresAt === p.expiresAt
                    ? date(p.expiresAt)
                    : "Not verified"}
                </b>
                <small>
                  {p && s?.expiresAt === p.expiresAt
                    ? "No auto-renewal"
                    : "Ledger and deployed service dates must agree"}
                </small>
              </div>
            </div>
            {p?.reason && <p className="admin-attention">{p.reason}</p>}
            {p?.priceError && <p role="alert">Price check: {p.priceError}</p>}
            <details>
              <summary>Operating measurements &amp; schedule</summary>
              <p>
                The server clock collects this report once daily around{" "}
                {updateTime}, independently of page visits. Repeated opens
                cannot trigger collection. Failed attempts are not retried that
                day. Status and balances describe the measured snapshot; 15-minute
                market and email checks continue separately. Unsupported sources
                retain their original measurement times.
              </p>
              <dl className="admin-source-list">
                <dt>Paid ledger &amp; prices</dt>
                <dd>{date(p?.measuredAt)}</dd>
                <dt>Scheduler &amp; deployed expiration</dt>
                <dd>
                  {date(s?.measuredAt)} · {s?.state ?? "Unavailable"} ·{" "}
                  {s?.schedule ?? "Schedule unavailable"}
                </dd>
                <dt>Email worker</dt>
                <dd>{date(data.email?.measuredAt)}</dd>
                <dt>Report checked</dt>
                <dd>{date(data.checkedAt)}</dd>
                <dt>Next daily update</dt>
                <dd>{date(data.nextRefreshAt)}</dd>
              </dl>
              {data.failures.map((f) => (
                <p key={f}>{f}</p>
              ))}
            </details>
          </section>
          <div className="admin-section-heading">
            <h2>Google billing &amp; app safety limits</h2>
            <span>USD · October pilot</span>
          </div>
          <div className="admin-cards">
            <article>
              <span>Actual Google charges</span>
              <strong>{money(data.billing.actualUsd)}</strong>
              <p>{!p?.billing && data.billing.actualUsd == null
                ? 'No Google spending reading in this saved report. Updated billing details appear with the next daily snapshot.'
                : data.billing.reason}</p>
              <p>
                Google Billing reports costs minus savings and credits. The app
                safety reserve below does not measure money spent.
              </p>
              {data.billing.measuredAt != null && measured(data.billing.measuredAt)}
              {actualSpend && (
                <p>
                  Spending pause: {money(p?.stopUsd)} in reported net cost.
                  Billing delays can allow charges beyond this threshold.
                  {now - actualSpend.publishedAt > 86400000 && ' Billing update overdue; last reported cost retained.'}
                </p>
              )}
              <a href={data.billing.sourceUrl} target="_blank" rel="noreferrer">
                Open Google Billing <ArrowUpRight size={13} />
              </a>
              <details>
                <summary>About Google spending updates</summary>
                <p>
                  The collector checks Google billing notifications every 15 minutes. Google
                  publishes net cost updates several times a day, after credits.
                  This dashboard shows the saved daily reading and its original
                  publication time. An unavailable reading is never treated as $0.
                </p>
                <a
                  href="https://docs.cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications"
                  target="_blank"
                  rel="noreferrer"
                >
                  Google billing notification timing
                </a>
              </details>
            </article>
            <article>
              <span>App safety reserve</span>
              <strong>{money(p?.reservedUsd)}</strong>
              <p>
                {actualSpend
                  ? 'Historical conservative accounting only. This amount no longer triggers a spending pause.'
                  : 'Internal allowance used until a Google spending feed is verified.'}{' '}
                No money is charged or held by Google for this reserve.
              </p>
              <details>
                <summary>How this reserve is calculated</summary>
                {p && p.reservedUsd >= 1 && (
                  <p>
                    $1.00 fixed safety buffer + {money(p.reservedUsd - 1)} in
                    operation and deployment holds = {money(p.reservedUsd)}.
                  </p>
                )}
                <p>
                  Each admitted price check or browser request adds a hold for
                  its maximum allowed resource use at gross rates. Deployment
                  holds are included too. Holds stay in the ledger after work
                  finishes, fails, or uses fewer resources than allowed. Google
                  free allowances, savings, and credits are not subtracted.
                </p>
                <p>
                  This reserve can grow while Google reports $0.00 total cost.
                  Only Google billing records establish actual charges.
                </p>
              </details>
              {measured(p?.measuredAt)}
            </article>
            <article>
              <span>Monthly app budget target</span>
              <strong>{money(p?.budgetUsd)}</strong>
              <p>
                Application pauses at {money(p?.stopUsd)}{' '}
                {actualSpend ? 'in Google-reported net spending, after credits.' : 'reserved until actual spending is connected.'}{' '}
                This is not a provider invoice cap.
              </p>
              {p && (
                <div
                  className="admin-budget-bar"
                  role="progressbar"
                  aria-label={actualSpend ? 'Reported Google spending toward pause limit' : 'App safety reserve toward pause limit'}
                  aria-valuemin={0}
                  aria-valuemax={p.stopUsd}
                  aria-valuenow={Math.max(0, Math.min(p.stopUsd, pauseAmount!))}
                  aria-valuetext={`${money(pauseAmount)} ${actualSpend ? 'reported spending' : 'reserved'} of ${money(p.stopUsd)} pause threshold`}
                >
                  <i
                    style={{
                      width: `${Math.max(0, Math.min(100, (100 * pauseAmount!) / p.stopUsd))}%`,
                    }}
                  />
                </div>
              )}
            </article>
            <article>
              <span>{actualSpend ? 'Reported spending headroom' : 'App allowance before pause'}</span>
              <strong>
                {p
                  ? money(Math.max(0, p.stopUsd - pauseAmount!))
                  : "Unavailable"}
              </strong>
              <p>
                {p
                  ? `${money(p.stopUsd)} pause limit − ${money(pauseAmount)} ${actualSpend ? 'reported net spending' : 'safety reserve'}.`
                  : "Pause limit minus safety reserve."}{" "}
                {p
                  ? `${money(p.budgetUsd - p.stopUsd)} stays outside the admission limit.`
                  : ""}{" "}
                {actualSpend ? 'Unreported charges may reduce this amount.' : 'This is room for more app activity, not an unspent Google balance.'}
              </p>
              {measured(actualSpend?.publishedAt ?? p?.measuredAt)}
            </article>
          </div>
          <div className="admin-section-heading">
            <h2>Users &amp; sign-ups</h2>
            <span>Firebase Authentication · aggregates only</span>
          </div>
          <section className="admin-audience">
            <div className="admin-user-totals">
              <Users size={22} />
              <div>
                <strong>{count(u?.total)}</strong>
                <span>Registered accounts</span>
              </div>
              <div>
                <strong>
                  {u
                    ? count(u.days.reduce((n, d) => n + d.count, 0))
                    : "Unavailable"}
                </strong>
                <span>Sign-ups · last 30 reporting days</span>
              </div>
              <small>
                {u
                  ? `${count(u.disabled)} disabled accounts included. Deleted accounts excluded.`
                  : "A complete account inventory is not available."}
              </small>
              {measured(u?.measuredAt)}
            </div>
            <div className="admin-signups">
              {u ? (
                <>
                  <div
                    className="admin-bars"
                    role="img"
                    aria-label={`Daily sign-ups: ${u.days.map((d) => `${reportingPeriod(d.day)}: ${d.count}`).join("; ")}`}
                  >
                    {u.days.map((d) => (
                      <div
                        key={d.day}
                        title={`${reportingPeriod(d.day)}: ${d.count} sign-ups`}
                      >
                        <i
                          style={{ height: `${(100 * d.count) / maxSignups}%` }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="admin-chart-labels">
                    <span>
                      {u.days.length
                        ? formatEstDate(reportingDayStart(u.days[0].day))
                        : ""}
                    </span>
                    <span>
                      {u.days.length
                        ? formatEstDate(
                            reportingDayStart(u.days.at(-1)!.day) +
                              ADMIN_CACHE_MS,
                          )
                        : ""}
                    </span>
                  </div>
                  <details>
                    <summary>Daily sign-up counts</summary>
                    <p>Reporting days run from 7 PM to 7 PM EST.</p>
                    <table>
                      <thead>
                        <tr>
                          <th>Reporting period (EST)</th>
                          <th>Sign-ups</th>
                        </tr>
                      </thead>
                      <tbody>
                        {u.days.map((d) => (
                          <tr key={d.day}>
                            <td>{reportingPeriod(d.day)}</td>
                            <td>{d.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </>
              ) : (
                <p>
                  Sign-up trend unavailable. Counts are never inferred from page
                  traffic.
                </p>
              )}
            </div>
          </section>
          <div className="admin-section-heading">
            <h2>Traffic &amp; discovery</h2>
            <span>Available aggregate measurements</span>
          </div>
          <div className="admin-cards admin-traffic">
            <article>
              <span>Hosting traffic · 30 complete reporting days</span>
              <strong>
                {t
                  ? `${(t.bytes / 1024 ** 2).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`
                  : "Unavailable"}
              </strong>
              <p>
                {t
                  ? `${date(t.from)} – ${date(t.through)}. Reported data served, including assets and repeat requests; not visitors or page views.`
                  : "Firebase Hosting transfer metrics are not available to this reader."}
              </p>
              {measured(t?.measuredAt)}
            </article>
            <article>
              <span>Popular pages</span>
              <strong>Unavailable</strong>
              <p>
                No connected page-view analytics. Hosting requests do not
                identify visits to hash-based tabs.
              </p>
            </article>
            <article>
              <span>Referrers</span>
              <strong>Unavailable</strong>
              <p>
                No connected aggregate referral source. No referrer URLs or
                visitor identifiers are collected by this dashboard.
              </p>
            </article>
            <article>
              <span>Countries &amp; regions</span>
              <strong>Unavailable</strong>
              <p>
                No connected aggregate geography source. Visitor location is not
                inferred from account profiles.
              </p>
            </article>
          </div>
          <details
            className="admin-history"
            onToggle={(e) => {
              if (e.currentTarget.open) void readHistory();
            }}
          >
            <summary>Historical free-tier report · October 2026</summary>
            <p>
              This archived report predates the paid pilot. Its allowance
              percentages and paused status do not describe the current
              operating budget.
            </p>
            {historyBusy && <p role="status">Loading historical report…</p>}
            {historyError && <p role="alert">{historyError} Close and reopen this section after one minute to retry.</p>}
            {history && (
              <>
                <p>
                  Report measured {date(history.generatedAt)}. Collection was{" "}
                  {history.collection.state.toLowerCase()} as measured{" "}
                  {date(history.collection.measuredAt)}.
                </p>
                <div className="admin-history-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Resource</th>
                        <th>Historical measurement</th>
                        <th>Measured at</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.rows.map((row) => (
                        <tr key={row.id}>
                          <td>{row.resource}</td>
                          <td>
                            {row.measured == null
                              ? "Unavailable"
                              : `${row.measured.toLocaleString()} ${row.unit}`}
                          </td>
                          <td>{date(row.measuredAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </details>
        </>
      )}
    </section>
  );
}
