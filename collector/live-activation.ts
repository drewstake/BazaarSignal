import { validateLive, liveInvocationCharge, nextPacificReset, type LiveAllowanceState } from './allowance-live';
import { chooseCadence } from './capacity-plan';

export interface InvocationPolicy {
  bindings?: { role: string; members?: string[]; condition?: unknown }[];
}

/** Activation consumes existing access. It must never grant access as a side
 * effect of resuming the scheduler. Firebase tokens authenticate presence in
 * the application; they do not grant Cloud Run invocation permission. */
export function requireExistingBrowserDelivery(policy: InvocationPolicy) {
  if (!policy.bindings?.some(binding => binding.role === 'roles/run.invoker' &&
    !binding.condition && binding.members?.includes('allUsers')))
    throw new Error('Browser delivery is blocked by private Cloud Run invocation. Activation cannot change production permissions.');
}

/** Read-only preflight, shared by first activation and stopped-ledger recovery.
 * No counter is changed and a syntactically valid report alone is insufficient:
 * at least one cadence must fit every full-period projection. */
export function requireLiveCapacity(state: LiveAllowanceState, now: number) {
  validateLive(state, now);
  const decision = chooseCadence(state.capacity, {...state, dailyEnd: nextPacificReset(now)},
    liveInvocationCharge('collector', 'bazaar-inline'), liveInvocationCharge('browser'), now);
  if (decision.mode === 'paused')
    throw new Error(`Collection activation blocked: ${decision.reasons.join('; ')}`);
  return decision;
}
