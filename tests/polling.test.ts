import { afterEach, expect, it, vi } from "vitest";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetModules();});
it('an hourly tab opened at :47 checks at :02, then keeps the same clock phase after hidden time',async()=>{
  vi.stubEnv('VITE_MARKET_OPERATING_MODE','free-tier');
  const {visiblePoll,doc}=await setup();vi.setSystemTime(new Date('2026-10-02T03:47:00Z'));
  const task=vi.fn(async()=>{}),stop=visiblePoll(task);
  await vi.advanceTimersByTimeAsync(0);expect(task).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(15*60_000);expect(task).toHaveBeenCalledTimes(2);
  doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(65*60_000);expect(task).toHaveBeenCalledTimes(2);
  doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);expect(task).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(55*60_000);expect(task).toHaveBeenCalledTimes(4);stop();
});
it('hourly timeout waits for the next clock slot rather than retrying in a loop',async()=>{
  vi.stubEnv('VITE_MARKET_OPERATING_MODE','free-tier');
  const {visiblePoll}=await setup();vi.setSystemTime(new Date('2026-10-02T03:02:00Z'));
  const task=vi.fn((signal:AbortSignal)=>new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve())));
  const stop=visiblePoll(task);await vi.advanceTimersByTimeAsync(3599999);
  expect(task).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect(task).toHaveBeenCalledTimes(2);stop();
});
async function setup() {
  vi.useFakeTimers();vi.stubEnv("VITE_MARKET_UPDATES_PAUSED","false");
  const doc=Object.assign(new EventTarget(),{visibilityState:"visible"});
  vi.stubGlobal("document",doc);vi.stubGlobal("window",new EventTarget());
  const api=await import("../src/companion/polling");return {...api,doc};
}
it("loads immediately, polls at 20 seconds, and reuses a recent result on tab return",async()=>{
  const {visiblePoll,doc}=await setup();const task=vi.fn(async()=>{}),stop=visiblePoll(task);
  await vi.advanceTimersByTimeAsync(0);expect(task).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5000);doc.visibilityState="hidden";doc.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(5000);doc.visibilityState="visible";doc.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(9999);expect(task).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(task).toHaveBeenCalledTimes(2);stop();
});
it("slows to 60 seconds and completely stops timers while paused, including visibility changes",async()=>{
  const {visiblePoll,applyPollingDirective,doc,pollingDirective}=await setup();const task=vi.fn(async()=>{}),stop=visiblePoll(task);
  await vi.advanceTimersByTimeAsync(0);applyPollingDirective({mode:"slow",pollMs:60000});
  await vi.advanceTimersByTimeAsync(59999);expect(task).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(task).toHaveBeenCalledTimes(2);
  applyPollingDirective({mode:"paused",pollMs:0});
  await vi.advanceTimersByTimeAsync(86400_000);doc.dispatchEvent(new Event("visibilitychange"));
  expect(task).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
  applyPollingDirective({mode:"normal",pollMs:20000});expect(pollingDirective().mode).toBe("paused");stop();
});
it("a configured pause loads the local cache once and never starts another poll",async()=>{
  vi.stubEnv("VITE_MARKET_UPDATES_PAUSED","true");vi.useFakeTimers();
  vi.stubGlobal("document",Object.assign(new EventTarget(),{visibilityState:"visible"}));
  const {visiblePoll}=await import("../src/companion/polling");const task=vi.fn(async()=>{}),stop=visiblePoll(task);
  await vi.advanceTimersByTimeAsync(86400_000);expect(task).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);stop();
});
it("a trial deadline aborts in-flight polling without needing another server reply and cannot be extended",async()=>{
  const {visiblePoll,applyPollingDirective,pollingDirective}=await setup();
  let signal:AbortSignal|undefined;
  const task=vi.fn((s:AbortSignal)=>{signal=s;return new Promise<void>(resolve=>s.addEventListener('abort',()=>resolve()));});
  const end=Date.now()+5000;
  applyPollingDirective({mode:'normal',pollMs:20000,expiresAt:end});
  const stop=visiblePoll(task);await vi.advanceTimersByTimeAsync(0);
  applyPollingDirective({mode:'normal',pollMs:20000,expiresAt:end+5000});
  expect(pollingDirective().expiresAt).toBe(end);
  await vi.advanceTimersByTimeAsync(5000);
  expect(signal?.aborted).toBe(true);expect(pollingDirective().mode).toBe('paused');
  await vi.advanceTimersByTimeAsync(86400_000);expect(task).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);stop();
});
it('an explicit free-tier release permits an hourly cadence and a month-end deadline without timer overflow',async()=>{
  vi.useFakeTimers();vi.stubEnv('PROD',true);vi.stubEnv('DEV',false);
  vi.stubEnv('VITE_MARKET_UPDATES_PAUSED','false');vi.stubEnv('VITE_MARKET_OPERATING_MODE','free-tier');
  vi.stubEnv('VITE_MARKET_TRIAL_ID','free-october');
  const end=Date.now()+30*86_400_000;vi.stubEnv('VITE_MARKET_TRIAL_END',new Date(end).toISOString());
  const p=await import('../src/companion/polling');
  expect(p.configuredPause).toBe(false);expect(p.pollingDirective().pollMs).toBe(3_600_000);
  await vi.advanceTimersByTimeAsync(25*86_400_000);expect(p.pollingDirective().mode).toBe('normal');
  await vi.advanceTimersByTimeAsync(5*86_400_000);expect(p.pollingDirective().mode).toBe('paused');
});
