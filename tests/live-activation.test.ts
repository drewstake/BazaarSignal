import { expect, it } from 'vitest';
import { requireExistingBrowserDelivery, requireLiveCapacity } from '../collector/live-activation';
import { capacityFixture } from './support/capacity-fixture';

const now=Date.parse('2026-10-04T12:00:00Z');
it('refuses private, conditional and merely Google-authenticated invocation without changing IAM',()=>{
  for(const policy of [{}, {bindings:[]},
    {bindings:[{role:'roles/run.invoker',members:['allAuthenticatedUsers']}]},
    {bindings:[{role:'roles/run.invoker',members:['allUsers'],condition:{expression:'true'}}]},
    {bindings:[{role:'roles/viewer',members:['allUsers']}]}]) {
    const before=JSON.stringify(policy);
    expect(()=>requireExistingBrowserDelivery(policy)).toThrow('cannot change production permissions');
    expect(JSON.stringify(policy)).toBe(before);
  }
  expect(()=>requireExistingBrowserDelivery({bindings:[{role:'roles/run.invoker',members:['allUsers']}]})).not.toThrow();
});
it('requires a sustainable full-period cadence and preserves all reservations on success and refusal',()=>{
  const state=capacityFixture(now);state.monthlyReserved={cpuSeconds:8340,collectorInvocations:39};
  const before=JSON.stringify(state);
  expect(requireLiveCapacity(state,now).mode).toBe('slow');
  expect(JSON.stringify(state)).toBe(before);
  state.capacity!.meters.cpuSeconds.measured=135000;
  const exhausted=JSON.stringify(state);
  expect(()=>requireLiveCapacity(state,now)).toThrow('No sustainable cadence: cpuSeconds');
  expect(JSON.stringify(state)).toBe(exhausted);
});
it('refuses missing, expired evidence and an explicit stop, including otherwise valid ledgers',()=>{
  const missing=capacityFixture(now);delete missing.capacity;
  expect(()=>requireLiveCapacity(missing,now)).toThrow('evidence');
  expect(()=>requireLiveCapacity(capacityFixture(now),now+900001)).toThrow('evidence');
  const stopped=capacityFixture(now);stopped.stoppedAt=now;stopped.reason='Owner requested stop';
  const before=JSON.stringify(stopped);
  expect(()=>requireLiveCapacity(stopped,now)).toThrow();
  expect(JSON.stringify(stopped)).toBe(before);
});
