import { afterEach, expect, it, vi } from 'vitest';
import { SqliteCache } from '../collector/cache-store';
import { MarketCollector } from '../collector/engine';
import { createLiveRuntime, liveDailyMaximums, liveMaximums, pacificDay, type LiveAllowanceState } from '../collector/allowance-live';
import { MARKET_REFRESH_MS } from '../shared/market-schedule';
import { marketHandler } from '../collector/routes';
import { changeVisibleDemand, visibleDemand } from '../collector/visible-demand';
import { trialGoogleStore } from '../collector/trial-google';
import { offlineGoogle } from './support/offline-google';
import { defaultPolicy } from '../collector/policy';
import { emptyJob } from '../collector/coordinator';

const stores: SqliteCache[] = [];
const store = () => { const s = new SqliteCache(':memory:'); stores.push(s); return s; };
afterEach(async()=>{ vi.restoreAllMocks(); for(const s of stores.splice(0)) await s.close(); });

it('explicit auction collection and valuation do no storage or upstream work after removal',async()=>{
  const s=store(),network=vi.fn(),collector=new MarketCollector(s,undefined,network);
  const read=vi.spyOn(s,'read'),write=vi.spyOn(s,'commit');
  await collector.tick(['auctions', 'auctions_ended', 'unknown-job']);
  expect('portfolioAuctions' in collector).toBe(false);
  expect(await collector.portfolioPrices(['v1_'+'a'.repeat(64)])).toMatchObject({bazaar:[],listings:[],fixture:false});
  expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();
});

it.each(['/api/companion/auctions', '/api/companion/portfolio-auctions', '/api/companion/auctions/abc/check', '/api/companion/player-names'])('retired route %s returns 410 without cache, ledger or upstream I/O', async(url)=>{
  const s=store(),network=vi.fn(),collector=new MarketCollector(s,undefined,network);
  const read=vi.spyOn(s,'read'),write=vi.spyOn(s,'commit');let code=0;
  await marketHandler(collector)({url,method:'GET',headers:{}} as any,
    {setHeader(){},writeHead(n:number){code=n;return this;},end(){}} as any);
  expect(code).toBe(410);expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();
});

it('rejects new auction presence and ignores legacy auction leases',()=>{
  const now=Date.now(),asset='v1_'+'a'.repeat(64);
  expect(()=>changeVisibleDemand(undefined,'user','tab',[asset],true,now,60000,1)).toThrow('Invalid');
  expect(visibleDemand({legacy:{owner:'user',assets:[asset],expiresAt:now+60000}},now).bazaar).toEqual([]);
});

it('rejects auction publication before paid I/O and preserves historical counters and retained blobs',async()=>{
  const f=offlineGoogle(),s=trialGoogleStore(f.config);
  f.snapshot('auctions','historical snapshot');f.seed('live-allowance','historical accounting');
  const before=JSON.stringify(f.counts),objects=[...f.objects.keys()];
  await expect(s.commit('control',null,'{}',{key:'auctions',value:'new'})).rejects.toThrow('retired');
  await expect(s.commit('auctions',null,'new')).rejects.toThrow('retired');
  expect(JSON.stringify(f.counts)).toBe(before);expect([...f.objects.keys()]).toEqual(objects);
  expect(f.read('live-allowance')).toBe('historical accounting');
  await s.cleanup();expect([...f.objects.keys()]).toEqual(objects);
});

it('restarts on a legacy policy without changing counters, auction jobs or active safeguards',async()=>{
  const now=Date.now(),s=store(),network=vi.fn(),c=new MarketCollector(s,defaultPolicy,network,()=>now);
  const state={...c.coordinator.empty(),policy:{...defaultPolicy,auctionMinMs:3600000},totalRequests:100,
    requests:[{at:now-100,retry:false,path:'historical'}],jobs:Object.fromEntries(['catalog','election','bazaar','auctions'].map(key=>[key,{...emptyJob(),nextAt:now+60000}]))};
  await s.commit('control',null,JSON.stringify(state));const write=vi.spyOn(s,'commit');
  await c.tick();expect(write).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();
  await c.coordinator.acquire();await c.coordinator.release();
  expect(await c.coordinator.state()).toMatchObject({policy:state.policy,totalRequests:100,requests:state.requests,jobs:state.jobs});
  const changed=new MarketCollector(s,{...defaultPolicy,reserve:.3},network,()=>now);
  await expect(changed.tick()).rejects.toThrow('policy differs');
});

it.each([false,true])('live collection skips auctions with portfolio demand=%s and keeps five-minute Bazaar refreshes',async(withDemand)=>{
  let now=Date.parse('2026-10-04T03:00:00Z');const s=store();
  const state:LiveAllowanceState={version:1,id:'free-offline',startsAt:now-1,expiresAt:now+86400000,
    monthlyLimits:{...liveMaximums},monthlyReserved:{},dailyLimits:{...liveDailyMaximums},dailyReserved:{},
    day:pacificDay(now),observed:{},evidence:'Offline test only'};
  await s.commit('live-allowance',null,JSON.stringify(state));
  const savedAuction=JSON.stringify({version:'existing',data:{listings:[]}});
  await s.commit('auctions',null,savedAuction);
  const network=vi.fn(async(input:Parameters<typeof fetch>[0])=>{
    const path=String(input);
    if(path.includes('/auctions'))throw new Error('Auction collection must stay disabled');
    const data=path.includes('/items')?{items:[]}:path.includes('/election')?{mayor:{name:'Normal',perks:[]}}:
      {lastUpdated:now,products:{COOKIE:{buy_summary:[{amount:10,orders:1,pricePerUnit:100}],sell_summary:[{amount:10,orders:1,pricePerUnit:90}]}}};
    return Response.json({success:true,...data});
  });
  const shutdown=vi.fn(),runtime=createLiveRuntime({requireCapacity:false,id:state.id,expiresAt:state.expiresAt,store:()=>s,shutdown,network,now:()=>now,
    ...(withDemand?{portfolioDemand:async()=>({version:1 as const,sampledAt:now,complete:true,bazaar:['COOKIE'],auctions:['v1_'+'a'.repeat(64)]})}:{})});
  await runtime.collect('first');expect(network).toHaveBeenCalledTimes(3);
  now+=MARKET_REFRESH_MS;await runtime.collect('next');expect(network).toHaveBeenCalledTimes(4);
  expect(network.mock.calls.every(([url])=>!String(url).includes('/auctions'))).toBe(true);
  expect(await s.read('auctions')).toBe(savedAuction);
  expect(JSON.parse((await s.read('bazaar'))!).upstreamAt).toBe(now);
  expect(JSON.parse((await s.read('control'))!).jobs.auctions).toBeUndefined();
  const ledger=JSON.parse((await s.read('live-allowance'))!);
  expect(ledger.monthlyLimits).toEqual(state.monthlyLimits);expect(ledger.observed.auctionsRefreshesCompleted).toBeUndefined();
  expect(shutdown).not.toHaveBeenCalled();
});
