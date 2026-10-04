import { PORTFOLIO_COLLECTION_ENABLED } from '../../shared/companion/portfolio-policy';
export const PAUSED_MESSAGE = "Updates paused to protect the free allowance";
export type PollDirective = { mode: "normal" | "warning" | "slow" | "paused"; pollMs: number; retryAt?: number; reason?: string; expiresAt?: number; serverNow?: number; trialId?: string };
const configuredEnd = Date.parse(import.meta.env.VITE_MARKET_TRIAL_END ?? "");
const configuredTrialId = import.meta.env.VITE_MARKET_TRIAL_ID;
const liveMode = import.meta.env.VITE_MARKET_OPERATING_MODE === "free-tier";
export const hourlyMarketMode = liveMode;
const maximumWindow = liveMode ? 32 * 86400_000 : 15 * 60_000;
const boundedTrial = /^[a-zA-Z0-9_-]{1,100}$/.test(configuredTrialId ?? '') && Number.isFinite(configuredEnd) && configuredEnd > Date.now() && configuredEnd - Date.now() <= maximumWindow;
export const configuredPause = !PORTFOLIO_COLLECTION_ENABLED || import.meta.env.VITE_MARKET_UPDATES_PAUSED === "true" ||
  (!import.meta.env.DEV && (import.meta.env.VITE_MARKET_UPDATES_PAUSED !== "false" || !boundedTrial));
let directive: PollDirective = { mode: configuredPause ? "paused" : "normal", pollMs: liveMode ? 3600_000 : 20_000,
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
    ? { ...next, pollMs: next.mode === "paused" ? 0 : Math.max(liveMode ? 3600_000 : next.mode === "slow" ? 60_000 : 20_000, next.pollMs) }
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
) {
  const hidden = () => document.visibilityState === "hidden";
  let closed = false, busy = false, completedAt = 0, attempted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const paused = () => market && pollingDirective().mode === "paused";
  const delay = () => Math.max(interval, market ? pollingDirective().pollMs : interval);
  const schedule = () => {
    clearTimeout(timer);
    if (!closed && !hidden() && !busy && !(attempted && paused()))
      timer = setTimeout(run, completedAt ? Math.max(0,
        Math.max(market && liveMode ? nextMarketRead(completedAt, delay()) : completedAt + delay(),market?directive.retryAt??0:0) - Date.now()) : initialDelay);
  };
  const run = async () => {
    clearTimeout(timer);
    if (closed || busy || hidden() || (attempted && paused())) return;
    busy = true;
    attempted = true;
    const current = new AbortController();
    controller = current;
    const timeout = setTimeout(() => current.abort(), 20_000);
    try { await task(current.signal); }
    catch { /* Callers display errors; a rejection must never break cleanup. */ }
    finally {
      clearTimeout(timeout);
      // A timeout must not form an immediate retry loop. Visibility returns also
      // retain this attempt's clock slot, even when its request was aborted.
      completedAt = Date.now();
      busy = false;
      schedule();
    }
  };
  const visibility = () => {
    if (hidden()) { clearTimeout(timer); controller?.abort(); }
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
import { nextMarketRead } from '../../shared/market-schedule';
