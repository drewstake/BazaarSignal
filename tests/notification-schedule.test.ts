import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../shared/companion/portfolio-policy',()=>({PORTFOLIO_EVALUATION_ENABLED:true}));
import { scheduledMinuteTick } from '../apps-script/backend';

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

it('attempts enabled notification work after each five-minute publication, with no off-slot I/O',()=>{
  vi.useFakeTimers();
  // Stop at the first property read; this tests the real clock gate without mail/storage work.
  const read=vi.fn(()=>{throw new Error('Offline fixture');});
  vi.stubGlobal('PropertiesService',{getScriptProperties:read});
  for(let minute=0;minute<60;minute++) {
    vi.setSystemTime(Date.parse('2026-10-04T03:00:00Z')+minute*60_000);
    read.mockClear();const result=scheduledMinuteTick();
    if(minute%5===2) { expect(result.ok).toBe(false);expect(read).toHaveBeenCalledOnce(); }
    else { expect(result).toEqual({ok:true,skipped:true});expect(read).not.toHaveBeenCalled(); }
  }
});
