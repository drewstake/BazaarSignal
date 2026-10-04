import type { User } from 'firebase/auth';
import { auth } from '../data';
import { fixtureMode, getBazaar, marketRequest } from './api';
import { applyPollingDirective, pollingDirective, visiblePoll } from './polling';
import type { BazaarItem, Listing } from '../../shared/companion/types';

export interface PortfolioMarket {
  bazaar: BazaarItem[]; listings: Listing[];
  versions?: {bazaar:string|null;auctions:string|null};
}
export async function portfolioMarket(assets:string[],signal?:AbortSignal):Promise<PortfolioMarket> {
  if(fixtureMode)return {bazaar:(await import('./fixtures')).bazaarFixtures(),listings:[]};
  try {return await marketRequest(`portfolio-prices?assets=${encodeURIComponent([...new Set(assets)].sort().join(','))}`,signal);}
  catch(error) {
    // Read the previous full public cache during the paused migration. This
    // branch cannot fetch: getBazaar uses the same terminal pause gate.
    if(pollingDirective().mode!=='paused'||!assets.some(id=>id.startsWith('bz_')))throw error;
    const saved=await getBazaar(signal),keys=new Set(assets);
    return {bazaar:saved.items.filter(i=>keys.has(`bz_${i.id}`)),listings:[]};
  }
}

/** Presence is authenticated and is never saved in the public price cache.
 * Gate before tokens or network. Hidden/unmounted portfolios relinquish demand;
 * bounded server leases handle crashes and lost disconnects. */
export function visiblePortfolioPresence(user:User,assets:string[]) {
  if(fixtureMode||!assets.length||pollingDirective().mode==='paused')return ()=>{};
  const tab=crypto.randomUUID();let registered=false,closed=false;
  const url=new URL(`${(import.meta.env.VITE_MARKET_API_URL??'').replace(/\/$/,'')}/api/companion/presence`,location.origin);
  async function send(active:boolean,signal?:AbortSignal) {
    if(auth?.currentUser!==user||pollingDirective().mode==='paused')return;
    const token=await user.getIdToken();
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
