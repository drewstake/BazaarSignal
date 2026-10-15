import { createHash } from 'node:crypto';
import { livePolicy } from '../collector/allowance-live';
import type { Control } from '../collector/coordinator';
import type { MeasurementState } from '../collector/measurement';

export const policyTransitionHash = (raw: string) => createHash('sha256').update(raw).digest('hex');
export function assertMeasurementPolicy(control: Control, zeroRetries: boolean) {
  const { auctionMinMs: retired, ...active } = control.policy as typeof livePolicy & { auctionMinMs?: number };
  if(JSON.stringify(active)!==JSON.stringify({...livePolicy,maxRetries:zeroRetries?0:livePolicy.maxRetries}) ||
      (retired!==undefined&&retired!==3600000))throw new Error('Shared collector policy is not prepared for this run; no grant installed');
}
export function measurementPolicyTransition(control: Control, ledger: MeasurementState, now: number, restore = false) {
  if (!ledger.stoppedAt || !ledger.reason || ledger.expiresAt <= now ||
      Object.values(ledger.measurementRuns ?? {}).some(r => ['armed','claimed'].includes(r.status)) || control.lease !== null)
    throw new Error('Policy transition requires an owner stop, no lease and every grant terminal');
  assertMeasurementPolicy(control,restore);
  const next = structuredClone(control);
  // Retain the retired field, all jobs, due times, request history and counters.
  next.policy.maxRetries = restore ? livePolicy.maxRetries : 0;
  next.revision++;
  return next;
}

// Two document preconditions make the control change and unchanged stopped
// ledger atomic. An overlapping claim/counter update rejects the whole batch.
export function policyTransitionWrites(controlDoc: any, ledgerDoc: any, next: Control) {
  for (const doc of [controlDoc,ledgerDoc]) if (!doc.name || !doc.updateTime || typeof doc.fields?.value?.stringValue !== 'string')
    throw new Error('Exact document versions required');
  return [
    {update:{name:controlDoc.name,fields:{value:{stringValue:JSON.stringify(next)}}},updateMask:{fieldPaths:['value']},currentDocument:{updateTime:controlDoc.updateTime}},
    {update:{name:ledgerDoc.name,fields:{value:ledgerDoc.fields.value}},updateMask:{fieldPaths:['value']},currentDocument:{updateTime:ledgerDoc.updateTime}},
  ];
}
