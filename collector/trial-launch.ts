import type { CacheStore } from "./cache-store";
import { prepareTrial, type TrialPreflight } from "./trial-preflight";
import { TrialStopped, type TrialState } from "./trial";

export interface TrialLaunchControl {
  /** Reads the actual deployed revision, deadline, limits, schedule and IAM.
   * Throws unless both handlers match the plan and collection is contained. */
  verifyContained(plan: TrialPreflight): Promise<void>;
  openApi(): Promise<void>;
  resumeCollector(): Promise<void>;
  verifyRunning(): Promise<void>;
  stop(): Promise<void>;
}
interface LaunchHistory {
  version: 1;
  attempts: Record<string, { expiresAt: number }>;
}
const DRAIN_MS = 180_000;

/** One-shot operator launch. No deployment, deadline extension, retries, billing
 * changes or background loop. Every failed/ambiguous activation is contained.
 * Its I/O is additional to the runtime envelope and must be in plan.overhead. */
export async function launchTrial(
  plan: TrialPreflight,
  store: CacheStore,
  control: TrialLaunchControl,
  apply = false,
  clock = Date.now,
) {
  // Reject an invalid plan before making even an inspection request.
  prepareTrial(plan, clock());
  if (apply && (clock() < plan.startsAt || clock() >= plan.expiresAt - 60_000))
    throw new TrialStopped("No active measurement window remains");
  await control.verifyContained(plan);
  const serverNow = store.time ? await store.time() : clock();
  if (Math.abs(serverNow - clock()) > 5000)
    throw new TrialStopped("Operator clock differs from server time");
  const offset = serverNow - clock();
  const now = () => clock() + offset;
  const previous = await store.read("trial");
  if (previous) {
    const old = JSON.parse(previous) as TrialState;
    if (
      old.version !== 1 || !Number.isFinite(old.expiresAt) ||
      old.expiresAt + DRAIN_MS > now()
    ) throw new TrialStopped("Previous trial is active, uncertain or still draining");
  }
  const historyRaw = await store.read("trial-launches");
  const history: LaunchHistory = historyRaw
    ? JSON.parse(historyRaw)
    : { version: 1, attempts: {} };
  if (
    history.version !== 1 || !history.attempts ||
    typeof history.attempts !== "object" || Array.isArray(history.attempts) ||
    Object.keys(history.attempts).length >= 100 ||
    Object.hasOwn(history.attempts, plan.id) ||
    ["__proto__", "constructor", "prototype"].includes(plan.id) ||
    Object.values(history.attempts).some(a =>
      !a || !Number.isFinite(a.expiresAt) || a.expiresAt + DRAIN_MS > now())
  ) throw new TrialStopped("Trial launch identity was used, is busy or needs review");
  prepareTrial(plan, now());
  if (!apply) return { status: "ready-for-one-launch" as const, id: plan.id, expiresAt: plan.expiresAt };

  // Claim before installing a ledger or touching IAM/Scheduler. Concurrent
  // losers MUST NOT roll back the winning operator's activation.
  history.attempts[plan.id] = { expiresAt: plan.expiresAt };
  if (!await store.commit("trial-launches", historyRaw, JSON.stringify(history)))
    throw new TrialStopped("Another launch claimed the durable reservation");
  let ledgerAttempted = false;
  try {
    // Recheck containment after the claim; the first inspection is not a lease
    // on deployment settings. Do not mutate IAM or restart an existing trial.
    await control.verifyContained(plan);
    const state = prepareTrial(plan, now());
    ledgerAttempted = true;
    if (!await store.commit("trial", previous, JSON.stringify(state)))
      throw new TrialStopped("Trial ledger changed during launch");
    const raw = await store.read("trial");
    if (raw !== JSON.stringify(state)) throw new TrialStopped("Trial installation is unverified");
    // Deadline and evidence may expire during any control-plane request.
    const activationOpen = () => {
      if (now() < plan.startsAt || now() >= plan.expiresAt - 60_000)
        throw new TrialStopped("No active measurement window remains");
    };
    activationOpen();
    await control.openApi();
    activationOpen();
    await control.resumeCollector();
    await control.verifyRunning();
    activationOpen();
    return { status: "started" as const, id: state.id, expiresAt: state.expiresAt };
  } catch (error) {
    const cleanup = await Promise.allSettled([
      control.stop(),
      (async () => {
        if (!ledgerAttempted) return;
        const raw = await store.read("trial");
        if (!raw) return;
        const state = JSON.parse(raw) as TrialState;
        if (state.id !== plan.id) return;
        state.stoppedAt ??= now();
        state.stopReason ??= "Trial launch failed; no automatic retry";
        if (!await store.commit("trial", raw, JSON.stringify(state)))
          throw new TrialStopped("Failed launch ledger stop is unverified");
      })(),
    ]);
    const failures = cleanup.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failures.length)
      throw new AggregateError([error, ...failures.map(r => r.reason)], "Launch failed and containment is incomplete");
    throw error;
  }
}
