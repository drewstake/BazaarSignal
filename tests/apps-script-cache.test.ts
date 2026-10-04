import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedMarket } from '../apps-script/companion';
import { fetchJson } from '../apps-script/store';

vi.mock('../apps-script/store', () => ({ fetchJson: vi.fn() }));
let properties: Record<string, string>, cache: Map<string, string>, owned: boolean, busy: boolean;
const snapshot = { lastUpdated: Date.parse('2026-10-02T03:00:08Z'), products: { EXAMPLE: { price: 42, description: 'x'.repeat(40000) } } };

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T03:02:00Z'));
  properties = { MARKET_OPERATING_MODE: 'free-tier', MARKET_UPDATES_PAUSED: 'false',
    MARKET_TRIAL_START: '2026-10-02T02:45:00Z', MARKET_TRIAL_END: '2026-11-01T07:00:00Z' };
  cache = new Map(); owned = false; busy = false;
  vi.stubGlobal('PropertiesService', { getScriptProperties: () => ({
    getProperty: (key: string) => properties[key], setProperty: (key: string, value: string) => properties[key] = value,
  }) });
  vi.stubGlobal('CacheService', { getScriptCache: () => ({
    get: (key: string) => cache.get(key), getAll: (keys: string[]) => Object.fromEntries(keys.filter(k => cache.has(k)).map(k => [k, cache.get(k)])),
    put: (key: string, value: string) => cache.set(key, value),
    putAll: (values: Record<string, string>) => Object.entries(values).forEach(([k, v]) => cache.set(k, v)),
  }) });
  vi.stubGlobal('LockService', { getScriptLock: () => ({
    hasLock: () => owned, tryLock: () => { if (busy) return false; owned = true; return true; }, releaseLock: () => { owned = false; },
  }) });
  vi.mocked(fetchJson).mockReset().mockReturnValue(snapshot);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Hourly Apps Script market downloads', () => {
  it('the production pause gate overrides previous live properties before any I/O',()=>{
    expect(()=>sharedMarket('raw-bazaar')).toThrow(/paused/);
    expect(fetchJson).not.toHaveBeenCalled();
  });
  it('does not consume the hourly download before publication or outside the fresh-check window', () => {
    for(const stamp of ['2026-10-02T03:00:20Z','2026-10-02T03:01:29Z','2026-10-02T03:02:30Z','2026-10-02T03:55:00Z']) {
      vi.setSystemTime(new Date(stamp));
      expect(() => sharedMarket('raw-bazaar',true)).toThrow(/hourly price check/);
    }
    expect(fetchJson).not.toHaveBeenCalled();
    expect(properties.MARKET_LAST_CLOUD_SLOT).toBeUndefined();
    vi.setSystemTime(new Date('2026-10-02T04:01:45Z'));
    sharedMarket('raw-bazaar',true);expect(fetchJson).toHaveBeenCalledOnce();
  });
  it('shares a large snapshot across repeated checks without refreshing its source timestamp', () => {
    expect(sharedMarket('raw-bazaar',true)).toEqual(snapshot);
    vi.advanceTimersByTime(5 * 60_000);
    expect(sharedMarket('raw-bazaar',true)).toEqual(snapshot);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(owned).toBe(false);
  });
  it('does not redownload an evicted snapshot or retry a failed download in the same hour', () => {
    sharedMarket('raw-bazaar',true); cache.clear();
    expect(() => sharedMarket('raw-bazaar',true)).toThrow(/next collection/);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-02T04:02:00Z'));
    vi.mocked(fetchJson).mockImplementationOnce(() => { throw new Error('Network failed'); });
    expect(() => sharedMarket('raw-bazaar',true)).toThrow('Network failed');
    expect(() => sharedMarket('raw-bazaar',true)).toThrow(/next collection/);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(owned).toBe(false);
  });
  it('permits the next hour but stops at the fixed reviewed deadline even with cached data', () => {
    sharedMarket('raw-bazaar',true); vi.advanceTimersByTime(3600_000); sharedMarket('raw-bazaar',true);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date(properties.MARKET_TRIAL_END));
    expect(() => sharedMarket('raw-bazaar',true)).toThrow(/paused/);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });
  it('preserves an outer alert mutation lock and refuses a lock held by a different execution', () => {
    busy = true;
    expect(() => sharedMarket('raw-bazaar',true)).toThrow(/busy/);
    expect(fetchJson).not.toHaveBeenCalled();
    busy = false; owned = true;
    expect(sharedMarket('raw-bazaar',true)).toEqual(snapshot);
    expect(owned).toBe(true);
  });
});
