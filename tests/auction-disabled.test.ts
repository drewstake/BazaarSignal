import { afterEach, expect, it, vi } from 'vitest';
import { SqliteCache } from '../collector/cache-store';
import { MarketCollector } from '../collector/engine';
import { createLiveRuntime, liveDailyMaximums, liveMaximums, pacificDay, type LiveAllowanceState } from '../collector/allowance-live';
import { MARKET_REFRESH_MS } from '../shared/market-schedule';

const stores: SqliteCache[] = [];
const store = () => { const s = new SqliteCache(':memory:'); stores.push(s); return s; };
afterEach(async()=>{ vi.restoreAllMocks(); for(const s of stores.splice(0)) await s.close(); });

it('explicit auction collection and valuation do no storage or upstream work while disabled',async()=>{
  const s=store(),network=vi.fn(),collector=new MarketCollector(s,undefined,network);
  const read=vi.spyOn(s,'read'),write=vi.spyOn(s,'commit');
  await collector.tick(['auctions']);
  await expect(collector.portfolioAuctions(['v1_'+'a'.repeat(64)])).rejects.toThrow('disabled');
  expect(await collector.portfolioPrices(['v1_'+'a'.repeat(64)])).toEqual({bazaar:[],listings:[],fixture:false});
  expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();
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
  const shutdown=vi.fn(),runtime=createLiveRuntime({id:state.id,expiresAt:state.expiresAt,store:()=>s,shutdown,network,now:()=>now,
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
