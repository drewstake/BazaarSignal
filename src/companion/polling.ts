import { PORTFOLIO_COLLECTION_ENABLED } from '../../shared/companion/portfolio-policy';
import { MARKET_REFRESH_MS, nextMarketRead } from '../../shared/market-schedule';
import { paidPilotActive, PAID_PILOT_INTERVAL } from '../../shared/paid-pilot';
export const PAUSED_MESSAGE = "Updates paused to protect the free allowance";
export type PollDirective = { mode: "normal" | "warning" | "slow" | "paused"; pollMs: number; bazaarMs?: number; auctionMs?: number; retryAt?: number; reason?: string; expiresAt?: number; serverNow?: number; trialId?: string };
const configuredEnd = Date.parse(import.meta.env.VITE_MARKET_TRIAL_END ?? "");
const configuredTrialId = import.meta.env.VITE_MARKET_TRIAL_ID;
const paidMode = paidPilotActive(import.meta.env.VITE_MARKET_OPERATING_MODE);
const liveMode = paidMode || import.meta.env.VITE_MARKET_OPERATING_MODE === "free-tier";
const maximumWindow = liveMode ? 32 * 86400_000 : 15 * 60_000;
const boundedTrial = /^[a-zA-Z0-9_-]{1,100}$/.test(configuredTrialId ?? '') && Number.isFinite(configuredEnd) && configuredEnd > Date.now() && configuredEnd - Date.now() <= maximumWindow;
export const configuredPause = (!PORTFOLIO_COLLECTION_ENABLED && !paidMode) || import.meta.env.VITE_MARKET_UPDATES_PAUSED === "true" ||
  (!import.meta.env.DEV && (import.meta.env.VITE_MARKET_UPDATES_PAUSED !== "false" || !boundedTrial));
let directive: PollDirective = { mode: configuredPause ? "paused" : "normal", pollMs: paidMode ? PAID_PILOT_INTERVAL : liveMode ? MARKET_REFRESH_MS : 20_000,
  ...(boundedTrial ? { expiresAt: configuredEnd, trialId: configuredTrialId } : {}) };
let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
function expire() {
  if (directive.expiresAt !== undefined && Date.now() >= directive.expiresAt)
    applyPollingDirective({ mode: "paused", pollMs: 0, reason: liveMode ? "Allowance period ended; usage review required" : "Measurement trial ended" });
  else armDeadline();
}
function armDeadline() {
  clearTimeout(deadlineTimer);
  if (directive.mode !== "paused" && directive.expiresAt !== undefined)
    deadlineTimer = setTimeout(expire, Math.min(2147483647, Math.max(0, directive.expiresAt - Date.now())));
}
armDeadline();
export const pollingDirective = () => { expire(); return directive; };
export const nextScheduledMarketCheck = (after = Date.now()) =>
  liveMode && pollingDirective().mode !== 'paused' ? Math.max(nextMarketRead(after, directive.pollMs),directive.retryAt??0) : null;
export function applyPollingDirective(next: PollDirective) {
  // A running tab cannot silently resume itself after a pause. Reload only after
  // an operator has verified all allowances and enabled a new release.
  if (directive.mode === "paused") return;
  const valid = next && ["normal", "warning", "slow", "paused"].includes(next.mode) && Number.isFinite(next.pollMs) && next.pollMs >= 0 &&
    (next.retryAt===undefined||(Number.isFinite(next.retryAt)&&next.retryAt>=0&&next.retryAt<=(next.expiresAt??Infinity)))&&
    (next.mode === "paused" || ((!configuredTrialId || next.trialId === configuredTrialId) && (next.expiresAt === undefined ? !import.meta.env.PROD :
      Number.isFinite(next.expiresAt) && next.expiresAt > Date.now() && next.expiresAt - Date.now() <= maximumWindow)));
  const value: PollDirective = valid
    ? { ...next, pollMs: next.mode === "paused" ? 0 : Math.max(liveMode ? MARKET_REFRESH_MS : next.mode === "slow" ? 60_000 : 20_000, next.pollMs) }
    : { mode: "paused", pollMs: 0, reason: "Usage policy is inconsistent" };
  // Replayed cached responses and late replies can shorten, never extend, a trial.
  if (directive.expiresAt !== undefined) value.expiresAt = Math.min(directive.expiresAt, value.expiresAt ?? directive.expiresAt);
  if (JSON.stringify(value) === JSON.stringify(directive)) return;
  directive = value;
  armDeadline();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("market-usage-policy"));
}

/** Immediate cache load, then visible-only nonoverlapping polls. Pauses have no timer. */
export function visiblePoll(
  task: (signal: AbortSignal) => Promise<void>,
  interval = 20_000,
  initialDelay = 0,
  market = true,
  options: { retryFailures?: boolean } = {},
) {
  const hidden = () => document.visibilityState === "hidden";
  let closed = false, busy = false, completedAt = 0, attempted = false;
  let attemptedRetryAt: number | undefined;
  let resumePending = false, failures = 0;
  let failureRetryAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const paused = () => market && pollingDirective().mode === "paused";
  const delay = () => Math.max(interval, market ? pollingDirective().pollMs : interval);
  const schedule = () => {
    clearTimeout(timer);
    if (!closed && !hidden() && !busy && !(attempted && paused())) {
      const policy = market ? pollingDirective() : undefined;
      const retryAt = policy?.retryAt;
      // A server recovery deadline replaces the normal clock slot. Consume it
      // once so a failed retry without a new directive cannot create a hot loop.
      const recoveryAt = retryAt !== attemptedRetryAt ? retryAt : undefined;
      const failureAt = failureRetryAt === undefined ? undefined : Math.max(failureRetryAt,
        policy?.mode === 'slow' && retryAt === undefined ? completedAt + delay() : 0);
      const nextAt = Math.max(retryAt ?? 0, recoveryAt ?? (resumePending ? Date.now() : failureAt) ??
        (completedAt ? (market && liveMode
          ? nextMarketRead(completedAt, delay()) : completedAt + delay()) : Date.now() + initialDelay));
      timer = setTimeout(run, Math.max(0, nextAt - Date.now()));
    }
  };
  const run = async () => {
    clearTimeout(timer);
    if (closed || busy || hidden() || (attempted && paused())) return;
    busy = true;
    attempted = true;
    resumePending = false;
    const retryAt = market ? pollingDirective().retryAt : undefined;
    if (retryAt !== undefined && retryAt <= Date.now()) attemptedRetryAt = retryAt;
    const current = new AbortController();
    controller = current;
    let failed = false, timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; current.abort(new DOMException('Price request timed out.', 'TimeoutError')); }, 20_000);
    try { await task(current.signal); }
    catch { failed = true; }
    finally {
      clearTimeout(timeout);
      // Visibility cancellation leaves a read unfinished. Resume it on return;
      // actual failures use bounded backoff, never an immediate retry loop.
      completedAt = Date.now();
      if (!current.signal.aborted || timedOut) {
        failures = failed || timedOut ? Math.min(failures + 1, 5) : 0;
        const policy = market ? pollingDirective() : undefined;
        failureRetryAt = options.retryFailures && failures
          ? completedAt + Math.max(Math.min(60_000 * 2 ** (failures - 1), delay()),
            policy?.mode === 'slow' && policy.retryAt === undefined ? policy.pollMs : 0)
          : undefined;
      }
      busy = false;
      schedule();
    }
  };
  const visibility = () => {
    if (hidden()) {
      clearTimeout(timer);
      // An interrupted recovery still needs a read when the user returns.
      if (busy && !controller?.signal.aborted) {
        attemptedRetryAt = undefined;
        resumePending = true;
      }
      controller?.abort();
    }
    else schedule();
  };
  const policy = () => {
    if (paused()) { clearTimeout(timer); controller?.abort(); }
    else schedule();
  };
  schedule();
  document.addEventListener("visibilitychange", visibility);
  if (typeof window !== "undefined") window.addEventListener("market-usage-policy", policy);
  return () => {
    closed = true;
    clearTimeout(timer);
    controller?.abort();
    document.removeEventListener("visibilitychange", visibility);
    if (typeof window !== "undefined") window.removeEventListener("market-usage-policy", policy);
  };
}
