import { afterEach, expect, it, vi } from "vitest";
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();vi.resetModules();});
it('retains saved prices through a budget deferral, avoids repeat reads and checks again after reset',async()=>{
  vi.stubEnv('VITE_MARKET_UPDATES_PAUSED','false');vi.stubEnv('VITE_MARKET_OPERATING_MODE','free-tier');vi.stubGlobal('caches',undefined);
  let now=Date.parse('2026-10-03T02:00:00Z');vi.spyOn(Date,'now').mockImplementation(()=>now);
  const retryAt=Date.parse('2026-10-03T07:00:00Z'),expiresAt=now+86400000;
  vi.stubEnv('VITE_MARKET_TRIAL_ID','free-test');vi.stubEnv('VITE_MARKET_TRIAL_END',new Date(expiresAt).toISOString());
  const usage={mode:'normal',pollMs:3600000,expiresAt,trialId:'free-test'};
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({items:['saved'],status:{upstreamAt:123},usage}))
    .mockResolvedValueOnce(Response.json({error:'Waiting for app budget reset',usage:{...usage,mode:'slow',pollMs:3600000,retryAt}},{status:429}))
    .mockResolvedValueOnce(Response.json({items:['updated'],usage}));
  vi.stubGlobal('fetch',fetcher);
  const {cachedMarketRequest}=await import('../src/companion/request-cache');
  const {pollingDirective}=await import('../src/companion/polling');
  const url='https://cache.example/api/companion/bazaar';await cachedMarketRequest(url);now+=3600000;
  expect(await cachedMarketRequest(url)).toMatchObject({items:['saved'],status:{upstreamAt:123,error:'Waiting for app budget reset'},usage:{retryAt}});
  await cachedMarketRequest(url);expect(fetcher).toHaveBeenCalledTimes(2);
  await expect(cachedMarketRequest('https://cache.example/api/companion/auctions/abc/command')).rejects.toThrow('reset');
  expect(fetcher).toHaveBeenCalledTimes(2);expect(pollingDirective().mode).toBe('slow');
  now=retryAt;expect(await cachedMarketRequest(url)).toMatchObject({items:['updated']});
  expect(fetcher).toHaveBeenCalledTimes(3);expect(pollingDirective().retryAt).toBeUndefined();
});
it('revalidates at the collection boundary even when an old cached response is only minutes old',async()=>{
  vi.stubEnv('VITE_MARKET_UPDATES_PAUSED','false');vi.stubEnv('VITE_MARKET_OPERATING_MODE','free-tier');vi.stubGlobal('caches',undefined);
  let now=Date.parse('2026-10-02T03:59:00Z');vi.spyOn(Date,'now').mockImplementation(()=>now);
  const fetcher=vi.fn(async()=>Response.json({version:String(now),items:[]}));vi.stubGlobal('fetch',fetcher);
  const {cachedMarketRequest}=await import('../src/companion/request-cache');const url='https://cache.example/api/companion/snapshot';
  await cachedMarketRequest(url);now=Date.parse('2026-10-02T04:01:59Z');await cachedMarketRequest(url);
  expect(fetcher).toHaveBeenCalledTimes(1);
  now+=1000;const responses=await Promise.all(Array.from({length:20},()=>cachedMarketRequest(url)));
  expect(fetcher).toHaveBeenCalledTimes(2);expect(responses[0]).toMatchObject({version:String(now)});
});
it("shares parallel reads, reuses recent results and handles 304 without decoding an empty body",async()=>{
  vi.stubEnv("VITE_MARKET_UPDATES_PAUSED","false");vi.stubGlobal("caches",undefined);
  let now=Date.now();vi.spyOn(Date,"now").mockImplementation(()=>now);
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{"version":"one","items":[]}',{headers:{ETag:'"one"'}})).mockResolvedValueOnce(new Response(null,{status:304}));
  vi.stubGlobal("fetch",fetcher);const {cachedMarketRequest}=await import("../src/companion/request-cache");
  const url="https://cache.example/api/companion/bazaar";
  const all=await Promise.all(Array.from({length:100},()=>cachedMarketRequest(url)));
  expect(fetcher).toHaveBeenCalledTimes(1);expect(all[0]).toEqual({version:"one",items:[]});
  await cachedMarketRequest(url);expect(fetcher).toHaveBeenCalledTimes(1);
  now+=20000;await expect(cachedMarketRequest(url)).resolves.toEqual(all[0]);
  expect(fetcher.mock.calls[1][1].headers).toEqual({"If-None-Match":'"one"'});
});
it("a pause returns the last saved snapshot but never a cached availability command or a network fallback",async()=>{
  vi.stubEnv("VITE_MARKET_UPDATES_PAUSED","false");vi.stubGlobal("caches",undefined);
  const fetcher=vi.fn(async()=>new Response('{"version":"one","items":[],"status":{"upstreamAt":123}}'));
  vi.stubGlobal("fetch",fetcher);const {cachedMarketRequest}=await import("../src/companion/request-cache");
  const url="https://cache.example/api/companion/bazaar";await cachedMarketRequest(url);
  const {applyPollingDirective}=await import("../src/companion/polling");applyPollingDirective({mode:"paused",pollMs:0});
  await expect(cachedMarketRequest(url)).resolves.toMatchObject({status:{upstreamAt:123,usage:{mode:"paused"}}});
  await expect(cachedMarketRequest("https://cache.example/api/companion/auctions/abc/command")).rejects.toThrow("paused");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('a new bounded production trial reuses old cached data without inheriting its expired permission',async()=>{
  const now=Date.now(),end=now+600000;
  vi.stubEnv('DEV',false);vi.stubEnv('PROD',true);
  vi.stubEnv('VITE_MARKET_UPDATES_PAUSED','false');vi.stubEnv('VITE_MARKET_TRIAL_ID','new-trial');
  vi.stubEnv('VITE_MARKET_TRIAL_END',new Date(end).toISOString());
  const old={at:now-3600000,etag:'"old"',body:{version:'old',items:[],status:{upstreamAt:now-3600000},usage:{mode:'normal',pollMs:20000,expiresAt:now-3000000,trialId:'old-trial'}}};
  vi.stubGlobal('caches',{open:async()=>({match:async()=>Response.json(old),delete:async()=>{},put:async()=>{},keys:async()=>[]})});
  const fetcher=vi.fn(async()=>Response.json({version:'fresh',items:[],usage:{mode:'normal',pollMs:20000,expiresAt:end,trialId:'new-trial'}}));
  vi.stubGlobal('fetch',fetcher);
  const {cachedMarketRequest}=await import('../src/companion/request-cache');
  const {pollingDirective}=await import('../src/companion/polling');
  const url='https://cache.example/api/companion/bazaar';
  await expect(cachedMarketRequest(url)).resolves.toMatchObject({version:'old',status:{upstreamAt:now-3600000},usage:{trialId:'new-trial'}});
  expect(pollingDirective().mode).toBe('normal');expect(fetcher).not.toHaveBeenCalled();
  await expect(cachedMarketRequest(url)).resolves.toMatchObject({version:'fresh'});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(pollingDirective().expiresAt).toBe(end);
});
