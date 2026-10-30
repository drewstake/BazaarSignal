import type { User } from 'firebase/auth';
import { auth } from '../data';
import { sessionToken } from '../session-token';
import { fixtureMode, getBazaar, marketRequest } from './api';
import { applyPollingDirective, pollingDirective, visiblePoll } from './polling';
import type { BazaarItem } from '../../shared/companion/types';

export interface PortfolioMarket {
  bazaar: BazaarItem[]; listings: never[];
  versions?: {bazaar:string|null};
  error?: string | null;
  stale?: boolean;
  retryable?: boolean;
}
/** Keep only requested quotes, retaining their original sample times during a
 * transient partial failure. A valid empty response still removes missing data. */
export function reconcilePortfolioPrices(previous: BazaarItem[], result: PortfolioMarket, assets: string[]) {
  if (!result.retryable) return result.bazaar;
  const wanted = new Set(assets.map(id => id.replace(/^bz_/, '')));
  return [...new Map([...previous, ...result.bazaar].filter(item => wanted.has(item.id)).map(item => [item.id, item])).values()];
}
export async function portfolioMarket(assets:string[],signal?:AbortSignal):Promise<PortfolioMarket> {
  assets=[...new Set(assets.filter(id=>/^bz_[A-Za-z0-9_:-]{1,100}$/.test(id)))].sort();
  if(!assets.length)return {bazaar:[],listings:[]};
  if(fixtureMode)return {bazaar:(await import('./fixtures')).bazaarFixtures(),listings:[]};
  try {
    const results: PortfolioMarket[] = [];
    // The API accepts at most 100 assets. Sequential reads let every batch
    // observe the previous response's budget/pause directive before doing I/O.
    for (let offset = 0; offset < assets.length; offset += 100) {
      signal?.throwIfAborted();
      try {
        const result = await marketRequest<PortfolioMarket>(`portfolio-prices?assets=${encodeURIComponent(assets.slice(offset, offset + 100).join(','))}`, signal);
        if (!Array.isArray(result?.bazaar)) throw new Error('The market response is invalid.');
        const requested = assets.slice(offset, offset + 100);
        const present = new Set(result.bazaar.map(item => `bz_${item.id}`));
        results.push({ ...result, retryable: !!(result.error || result.stale) && requested.some(id => !present.has(id)) });
      } catch (error) {
        signal?.throwIfAborted();
        if (!results.length) throw error;
        return { bazaar: results.flatMap(result => result.bazaar), listings: [], stale: true, retryable: true,
          error: `Some prices are unavailable: ${error instanceof Error ? error.message : 'Market service unavailable.'}` };
      }
    }
    if (results.length === 1) return results[0];
    return { bazaar: results.flatMap(result => result.bazaar), listings: [],
      error: results.find(result => result.error)?.error ?? null,
      stale: results.some(result => result.stale), retryable: results.some(result => result.retryable) };
  }
  catch(error) {
    // Read the previous full public cache during the paused migration. This
    // branch cannot fetch: getBazaar uses the same terminal pause gate.
    if(pollingDirective().mode!=='paused'||!assets.some(id=>id.startsWith('bz_')))throw error;
    const saved=await getBazaar(signal),keys=new Set(assets);
    return {bazaar:saved.items.filter(i=>keys.has(`bz_${i.id}`)),listings:[],error:saved.error,stale:saved.status?.stale};
  }
}

/** Presence is authenticated and is never saved in the public price cache.
 * Gate before tokens or network. Hidden/unmounted portfolios relinquish demand;
 * bounded server leases handle crashes and lost disconnects. */
export function visiblePortfolioPresence(user:User,assets:string[]) {
  // Paid collection and mail run every 15 minutes regardless of visible demand. Skip the
  // no-op admission (and token/preflight/leave requests) before creating timers.
  if(import.meta.env.VITE_MARKET_OPERATING_MODE==='paid-budget')return ()=>{};
  assets=assets.filter(id=>/^bz_[A-Za-z0-9_:-]{1,100}$/.test(id));
  if(fixtureMode||!assets.length||pollingDirective().mode==='paused')return ()=>{};
  const tab=crypto.randomUUID();let registered=false,closed=false;
  const url=new URL(`${(import.meta.env.VITE_MARKET_API_URL??'').replace(/\/$/,'')}/api/companion/presence`,location.origin);
  async function send(active:boolean,signal?:AbortSignal) {
    if(auth?.currentUser!==user||pollingDirective().mode==='paused')return;
    const token=await sessionToken(user);
    if(active&&(closed||document.visibilityState==='hidden'||signal?.aborted||auth?.currentUser!==user))return;
    const r=await fetch(url,{method:'POST',credentials:'omit',signal:signal??AbortSignal.timeout(10_000),
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({tab,assets,active}),keepalive:!active});
    const body=await r.json();if(body.usage)applyPollingDirective(body.usage);
    if(!r.ok)throw new Error('Visible portfolio monitoring unavailable');
    registered=active;
  }
  const stop=visiblePoll(signal=>send(true,signal),60_000);
  const hide=()=>{if(document.visibilityState==='hidden'&&registered)void send(false).catch(()=>{});};
  document.addEventListener('visibilitychange',hide);
  return ()=>{closed=true;stop();document.removeEventListener('visibilitychange',hide);if(registered)void send(false).catch(()=>{});};
}
