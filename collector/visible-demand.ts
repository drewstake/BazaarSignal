import { createHash } from 'node:crypto';
import type { Demand } from './portfolio-demand';

export interface VisibleLease { owner: string; assets: string[]; expiresAt: number }
export type VisibleDemand = Record<string, VisibleLease>;
export const validAssetKey = (id: string) => /^bz_[A-Za-z0-9_:-]{1,100}$/.test(id);

/** Authenticated presence is a separate mutation; cache GETs never create demand.
 * Store only hashed principals and public asset keys, never portfolio contents.
 * Abandoned tabs expire; a hidden/unmounted tab explicitly releases its lease. */
export function changeVisibleDemand(previous: VisibleDemand | undefined, uid: string, tab: string,
  assets: string[], active: boolean, now: number, interval: number, groups: number): VisibleDemand {
  if (!uid || !/^[a-zA-Z0-9_-]{1,80}$/.test(tab) || !Array.isArray(assets) || assets.length>100 ||
    assets.some(id=>typeof id!=='string'||!validAssetKey(id)) || !Number.isFinite(interval) || interval<60_000)
    throw new Error('Invalid visible portfolio presence');
  const owner=createHash('sha256').update(uid).digest('hex'), key=`${owner}:${tab}`;
  const next=Object.fromEntries(Object.entries(previous??{}).filter(([,v])=>v.expiresAt>now));
  delete next[key];
  if(active&&assets.length) {
    if(Object.keys(next).length>=groups || Object.values(next).filter(v=>v.owner===owner).length>=8)
      throw new Error('Reviewed active reader capacity reached');
    next[key]={owner,assets:[...new Set(assets)].sort(),expiresAt:now+Math.min(2*interval+60_000,25*3600_000)};
  }
  if(Buffer.byteLength(JSON.stringify(next))>128*1024)throw new Error('Reviewed visible demand storage capacity reached');
  return next;
}
export function visibleDemand(leases: VisibleDemand | undefined, now: number): Demand {
  const assets=new Set(Object.values(leases??{}).filter(v=>v.expiresAt>now).flatMap(v=>v.assets));
  return {version:1,sampledAt:now,complete:true,
    bazaar:[...assets].filter(id=>id.startsWith('bz_')).map(id=>id.slice(3)).sort()};
}
