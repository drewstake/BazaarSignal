import { fetchJson } from "./store";
import { hourlyAlertWindow } from '../shared/market-schedule';
import { PORTFOLIO_COLLECTION_ENABLED } from '../shared/companion/portfolio-policy';
declare const PropertiesService: any, CacheService: any, LockService: any;

/** Cache-only bridge. No public request, alert mutation or email job fetches Hypixel. */
export function sharedMarket(path: string, enabled = PORTFOLIO_COLLECTION_ENABLED) {
  if (!enabled) throw new Error("Market data: Updates paused to protect the free allowance.");
  // Fail closed by default. The preserved email worker can still deliver queued
  // mail and edit existing targets without issuing a billable market request.
  const properties = PropertiesService.getScriptProperties();
  const start = Date.parse(properties.getProperty("MARKET_TRIAL_START") ?? "");
  const end = Date.parse(properties.getProperty("MARKET_TRIAL_END") ?? "");
  const live = properties.getProperty("MARKET_OPERATING_MODE") === "free-tier";
  if (properties.getProperty("MARKET_UPDATES_PAUSED") !== "false" ||
      !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > (live ? 32 * 86400_000 : 15 * 60_000) ||
      Date.now() < start || Date.now() >= end)
    throw new Error("Market data: Updates paused to protect the free allowance.");
  // The production origin is public configuration, not a credential. A Script
  // Property can override it for a different deployment without changing auth.
  const base = (properties.getProperty("MARKET_API_URL") ?? "https://marketapi-k5a64sgi2q-uc.a.run.app").replace(/\/$/, "");
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(base))
    throw new Error("Market data service is not configured. Set MARKET_API_URL to the shared collector HTTPS origin.");
  if (!live || path !== 'raw-bazaar') return fetchJson(`${base}/api/companion/${path}`);
  // The aligned alert check and queued-mail worker share ONE hourly download.
  // Only public market data enters this cache; freshness checks remain in core.
  const cache=CacheService.getScriptCache(),slot=Math.floor(Date.now()/3600_000);
  const prefix=`market:${properties.getProperty('MARKET_TRIAL_START')}:${slot}:`;
  const read=()=>{
    const count=Number(cache.get(prefix+'count'));if(!Number.isInteger(count)||count<1||count>450)return null;
    const keys=Array.from({length:count},(_,i)=>prefix+i),parts=cache.getAll(keys);
    return keys.every(k=>typeof parts[k]==='string')?JSON.parse(keys.map(k=>parts[k]).join('')):null;
  };
  const hit=read();if(hit)return hit;
  // Never spend the hour's download on the previous snapshot before publication,
  // or on prices that cannot pass the existing three-minute freshness check.
  if(!hourlyAlertWindow(Date.now()))throw new Error('Market data: waiting for the next hourly price check.');
  const lock=LockService.getScriptLock(),alreadyLocked=lock.hasLock();
  if(!alreadyLocked&&!lock.tryLock(5000))throw new Error('Market data: cached hourly update is busy.');
  try {
    const second=read();if(second)return second;
    // Cache eviction must not silently multiply paid cloud calls within a slot.
    const marker=properties.getProperty('MARKET_LAST_CLOUD_SLOT');
    if(marker===String(slot))throw new Error('Market data: hourly snapshot is unavailable until the next collection.');
    properties.setProperty('MARKET_LAST_CLOUD_SLOT',String(slot));
    const result=fetchJson(`${base}/api/companion/${path}`),text=JSON.stringify(result);
    if(text.length>9_000_000)throw new Error('Market data: response exceeded cache limit.');
    const parts:Record<string,string>={};let count=0;
    for(let i=0;i<text.length;i+=20000)parts[prefix+count++]=text.slice(i,i+20000);
    cache.putAll(parts,3600);cache.put(prefix+'count',String(count),3600);return result;
  } finally {if(!alreadyLocked)lock.releaseLock();}
}
